//! Phase B Task 2.3~2.5 / 9.3: 通用文档解析命令。
//!
//! - `parse_pdf`：
//!   - `ffi-real` feature 关闭（默认）：返回 `FFI_NOT_IMPLEMENTED`
//!   - `ffi-real` feature 开启：通过 `pdfium-render` 动态加载 `libpdfium.dylib` 提取文本
//!     库路径优先环境变量 `PDFIUM_LIB_PATH`，其次 `~/.seven-hrops/native/pdfium/<arch>/libpdfium.dylib`
//! - `parse_docx`：通过 `docx-rs::read_docx` 提取文本（最小：拼接所有段落文本）。
//! - `parse_excel`：通过 `calamine::open_workbook_auto` 列出 Sheet 名 + 行数 +
//!   文本矩阵（每行字符串列表）。
//!
//! 所有命令接 `session_id` 并先调 `fs_guard::check_read` 校验路径在白名单内。

use crate::native::errors::NativeError;
use crate::sandbox::fs_guard;
use std::sync::OnceLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ──────────────────────────────────────────────────────────────────────────────
// Result types
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfParseResult {
    pub text: String,
    pub page_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocxParseResult {
    pub text: String,
    pub paragraph_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcelSheet {
    pub name: String,
    pub row_count: u32,
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcelParseResult {
    pub sheets: Vec<ExcelSheet>,
}

// ──────────────────────────────────────────────────────────────────────────────
// parse_pdf — Phase B.9 真实实现（ffi-real feature）
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn parse_pdf(
    session_id: String,
    path: String,
) -> Result<PdfParseResult, String> {
    let path = PathBuf::from(path);
    let canonical = fs_guard::check_read(&session_id, &path)?;

    #[cfg(feature = "ffi-real")]
    {
        return parse_pdf_real(&canonical).await.map_err(String::from);
    }

    #[cfg(not(feature = "ffi-real"))]
    {
        let _ = canonical;
        Err(String::from(NativeError::ffi_not_implemented("parse_pdf")))
    }
}

#[cfg(feature = "ffi-real")]
async fn parse_pdf_real(path: &PathBuf) -> Result<PdfParseResult, NativeError> {
    use pdfium_render::prelude::*;

    // pdfium 库路径：优先环境变量，其次默认安装路径
    let lib_path = std::env::var("PDFIUM_LIB_PATH").ok().map(PathBuf::from).unwrap_or_else(|| {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let arch = if cfg!(target_arch = "aarch64") { "mac-arm64" } else { "mac-x64" };
        home.join(".seven-hrops").join("native").join("pdfium").join(arch).join("libpdfium.dylib")
    });

    // 进程级单例：确保 pdfium bindings 只绑定一次
    // Pdfium::bind_to_library() 是进程级操作，重复调用会报 AlreadyInitialized
    static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

    let pdfium = PDFIUM.get_or_init(|| {
        let bindings = Pdfium::bind_to_library(lib_path.to_str().unwrap_or_default())
            .expect("pdfium bind failed");
        Pdfium::new(bindings)
    });

    let path = path.clone();
    tokio::task::spawn_blocking(move || {
        let doc = pdfium
            .load_pdf_from_file(path.to_str().unwrap_or_default(), None)
            .map_err(|e| NativeError::parse_failed(format!("pdfium load failed: {:?}", e)))?;

        let page_count = doc.pages().len() as u32;
        let mut text_parts: Vec<String> = Vec::with_capacity(page_count as usize);

        for page in doc.pages().iter() {
            let page_text = page
                .text()
                .map_err(|e| NativeError::parse_failed(format!("pdfium text extract failed: {:?}", e)))?;
            text_parts.push(page_text.all());
        }

        Ok(PdfParseResult {
            text: text_parts.join("\n"),
            page_count,
        })
    })
    .await
    .map_err(|e| NativeError::parse_failed(format!("spawn_blocking join error: {}", e)))?
}

// ──────────────────────────────────────────────────────────────────────────────
// parse_docx
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn parse_docx(
    session_id: String,
    path: String,
) -> Result<DocxParseResult, String> {
    let path = PathBuf::from(path);
    let canonical = fs_guard::check_read(&session_id, &path)?;
    let bytes = tokio::fs::read(&canonical)
        .await
        .map_err(|e| String::from(NativeError::io_failed(e)))?;
    extract_docx_text(&bytes).map_err(String::from)
}

fn extract_docx_text(bytes: &[u8]) -> Result<DocxParseResult, NativeError> {
    use docx_rs::{DocumentChild, ParagraphChild, RunChild};

    let docx = docx_rs::read_docx(bytes).map_err(|e| {
        NativeError::parse_failed(format!("read_docx failed: {:?}", e))
    })?;

    let mut paragraphs: Vec<String> = Vec::new();
    for child in docx.document.children {
        if let DocumentChild::Paragraph(p) = child {
            let mut buf = String::new();
            for pc in p.children {
                if let ParagraphChild::Run(run) = pc {
                    for rc in run.children {
                        if let RunChild::Text(t) = rc {
                            buf.push_str(&t.text);
                        }
                    }
                }
            }
            paragraphs.push(buf);
        }
    }

    let paragraph_count = paragraphs.len() as u32;
    Ok(DocxParseResult {
        text: paragraphs.join("\n"),
        paragraph_count,
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// parse_excel
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn parse_excel(
    session_id: String,
    path: String,
) -> Result<ExcelParseResult, String> {
    let path = PathBuf::from(path);
    let canonical = fs_guard::check_read(&session_id, &path)?;

    // calamine 是同步 API，放进 spawn_blocking 避免阻塞 tokio runtime
    tokio::task::spawn_blocking(move || extract_excel(&canonical))
        .await
        .map_err(|e| String::from(NativeError::parse_failed(format!("join error: {}", e))))?
        .map_err(String::from)
}

fn extract_excel(path: &std::path::Path) -> Result<ExcelParseResult, NativeError> {
    use calamine::{open_workbook_auto, Reader};

    let mut wb = open_workbook_auto(path)
        .map_err(|e| NativeError::parse_failed(format!("open_workbook_auto failed: {}", e)))?;

    let names = wb.sheet_names();
    let mut sheets = Vec::with_capacity(names.len());
    for name in names {
        let range = wb
            .worksheet_range(&name)
            .map_err(|e| NativeError::parse_failed(format!("worksheet_range[{}]: {}", name, e)))?;
        let rows: Vec<Vec<String>> = range
            .rows()
            .map(|row| row.iter().map(data_to_string).collect::<Vec<_>>())
            .collect();
        let row_count = rows.len() as u32;
        sheets.push(ExcelSheet { name, row_count, rows });
    }
    Ok(ExcelParseResult { sheets })
}

fn data_to_string(d: &calamine::Data) -> String {
    use calamine::Data;
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => f.to_string(),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => dt.as_f64().to_string(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("#ERR:{:?}", e),
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{registry, ManifestSource, SandboxContext};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fresh_session(prefix: &str) -> (String, PathBuf) {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let sid = format!("{}-{}-{}", prefix, std::process::id(), n);
        let tmp = std::env::temp_dir().join(format!("seven-native-parse-{}", &sid));
        std::fs::create_dir_all(&tmp).unwrap();
        let canon = std::fs::canonicalize(&tmp).unwrap();
        let ctx = SandboxContext::new(
            sid.clone(),
            ManifestSource::User,
            vec![canon.clone()],
            vec![canon.clone()],
            vec![],
        );
        registry().insert(ctx);
        (sid, canon)
    }

    #[tokio::test]
    async fn parse_pdf_returns_ffi_not_implemented_in_stub_phase() {
        let (sid, dir) = fresh_session("pdf-stub");
        let f = dir.join("sample.pdf");
        std::fs::write(&f, b"%PDF-1.4\n").unwrap(); // 任意非空内容
        let err = parse_pdf(sid, f.to_string_lossy().into_owned()).await.unwrap_err();
        assert!(err.contains("FFI_NOT_IMPLEMENTED"), "got {}", err);
        assert!(err.contains("\"feature\":\"parse_pdf\""), "got {}", err);
    }

    #[tokio::test]
    async fn parse_pdf_deny_outside_whitelist() {
        let (sid, _) = fresh_session("pdf-deny");
        let outside = std::env::temp_dir().join(format!("seven-stranger-{}.pdf", std::process::id()));
        std::fs::write(&outside, b"%PDF-1.4").unwrap();
        let err = parse_pdf(sid, outside.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "got {}", err);
    }

    /// 使用 docx-rs 自身写一个最小 docx，避免引入 fixtures 文件。
    fn write_minimal_docx(path: &PathBuf, paragraphs: &[&str]) {
        use docx_rs::{Docx, Paragraph, Run};
        let mut docx = Docx::new();
        for &line in paragraphs {
            docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(line)));
        }
        let file = std::fs::File::create(path).unwrap();
        docx.build().pack(file).unwrap();
    }

    #[tokio::test]
    async fn parse_docx_round_trip_text() {
        let (sid, dir) = fresh_session("docx-ok");
        let f = dir.join("hello.docx");
        write_minimal_docx(&f, &["第一段", "second line"]);
        let res = parse_docx(sid, f.to_string_lossy().into_owned()).await.unwrap();
        assert_eq!(res.paragraph_count, 2);
        assert!(res.text.contains("第一段"));
        assert!(res.text.contains("second line"));
    }

    #[tokio::test]
    async fn parse_docx_deny_outside() {
        let (sid, _) = fresh_session("docx-deny");
        let outside = std::env::temp_dir().join(format!("seven-stranger-{}.docx", std::process::id()));
        std::fs::write(&outside, b"PK\x03\x04").unwrap();
        let err = parse_docx(sid, outside.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "got {}", err);
    }

    #[tokio::test]
    async fn parse_docx_invalid_returns_parse_failed() {
        let (sid, dir) = fresh_session("docx-bad");
        let f = dir.join("bad.docx");
        std::fs::write(&f, b"not a real docx").unwrap();
        let err = parse_docx(sid, f.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("NATIVE_PARSE_FAILED"), "got {}", err);
    }

    /// 用 calamine 不能直接写 xlsx；我们用最小 CSV→自动识别失败兜底。
    /// 改方案：测试只覆盖 deny 路径与"打开损坏文件返回 parse_failed"。
    #[tokio::test]
    async fn parse_excel_deny_outside() {
        let (sid, _) = fresh_session("xlsx-deny");
        let outside = std::env::temp_dir().join(format!("seven-stranger-{}.xlsx", std::process::id()));
        std::fs::write(&outside, b"PK\x03\x04").unwrap();
        let err = parse_excel(sid, outside.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "got {}", err);
    }

    #[tokio::test]
    async fn parse_excel_invalid_returns_parse_failed() {
        let (sid, dir) = fresh_session("xlsx-bad");
        let f = dir.join("bad.xlsx");
        std::fs::write(&f, b"not a real xlsx").unwrap();
        let err = parse_excel(sid, f.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("NATIVE_PARSE_FAILED"), "got {}", err);
    }
}
