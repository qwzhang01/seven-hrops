//! Phase B Task 3.6 / 3.6.1 / 3.7.x — 模型分发。
//!
//! ## 职责
//! - 维护内置 [`MODEL_REGISTRY`]（whisper-base-zh / pdfium-mac-arm64 / pdfium-mac-x64 /
//!   pdfium-win-x64），每条带 `(name, url_template, sha256, target_subpath)`。
//! - 实现 [`models_ensure`] Tauri 命令：返回 `{ status, path?, progress? }`，
//!   状态机覆盖三种结果：`ready` / `downloading` / `missing`。
//! - 后台异步下载（`reqwest` stream + `sha2`），进度通过 Tauri event
//!   `models://progress` 推送。
//! - sha256 校验失败时**自动删除损坏文件**并返回 [`NativeError::ModelChecksumMismatch`]。
//! - 支持 `local_path` 旁路：用户手动把模型放到本地，`models_ensure` 仅做 sha256 校验
//!   后软链/拷贝到目标路径。
//!
//! ## URL 占位策略（design Q4 选项 C）
//! Mirror 组织名通过环境变量 `SEVEN_MODEL_MIRROR_ORG` 注入；未配置时
//! `models_ensure` 立即返回 [`NativeError::ModelMirrorNotConfigured`]，让前端区分
//! "配置缺失"和"网络故障"。Phase B.9 接入真实 mirror 后，把 default 改为真实组织名。
//!
//! ## 路径
//! - 默认根：`~/.seven-hrops/models/`
//! - 测试可用环境变量 `SEVEN_HROPS_MODELS_DIR` override

use crate::native::errors::NativeError;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Runtime};
use tokio::io::AsyncWriteExt;

// ──────────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────────

/// 单条模型描述。`url_template` 中包含 `{org}` 占位符，运行时由
/// `SEVEN_MODEL_MIRROR_ORG` 环境变量替换；未配置则触发
/// `MODEL_MIRROR_NOT_CONFIGURED`。
pub struct ModelEntry {
    pub name: &'static str,
    pub url_template: &'static str,
    pub sha256: &'static str,
    /// 落盘相对路径（相对于 `models_root()`），默认与 `name` 同名。
    pub target_subpath: &'static str,
}

/// Phase B.0~B.4 占位 sha256 全为 `"PENDING"`，下载真实接入时（B.9）替换。
/// 此设计让 dev 环境下"未配置 mirror"路径优先触发，而不是被错误的 sha 校验干扰。
///
/// Phase B.9 手动步骤：
/// 1. 创建 GitHub 仓库 `<your-org>/seven-hrops-assets`
/// 2. 运行 `scripts/fetch-pdfium.sh --org <your-org>` 下载 pdfium 并获取 sha256
/// 3. 上传 whisper ggml-base 模型并获取 sha256
/// 4. 将下面所有 `sha256: "PENDING"` 替换为真实值
/// 5. 将 `{org}` 占位符替换为真实组织名（或设置 `SEVEN_MODEL_MIRROR_ORG` 环境变量）
pub const MODEL_REGISTRY: &[ModelEntry] = &[
    ModelEntry {
        name: "whisper-base-zh",
        url_template:
            "https://github.com/{org}/seven-hrops-assets/releases/download/whisper-v6611/ggml-base.bin",
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        target_subpath: "whisper/ggml-base.bin",
    },
    ModelEntry {
        name: "pdfium-mac-arm64",
        url_template:
            "https://github.com/{org}/seven-hrops-assets/releases/download/PDFium-v150.0/pdfium-mac-arm64.tgz",
        sha256: "9bc810acc9a877290d902bd1e60d799cac1b4855c82a4ee11f4a4653c8a038cc",
        target_subpath: "pdfium/mac-arm64/libpdfium.dylib",
    },
    ModelEntry {
        name: "pdfium-mac-x64",
        url_template:
            "https://github.com/{org}/seven-hrops-assets/releases/download/PDFium-v150.0/pdfium-mac-x64.tgz",
        sha256: "PENDING",
        target_subpath: "pdfium/mac-x64/libpdfium.dylib",
    },
    ModelEntry {
        name: "pdfium-win-x64",
        url_template:
            "https://github.com/{org}/seven-hrops-assets/releases/download/PDFium-v150.0/pdfium-win-x64.zip",
        sha256: "PENDING",
        target_subpath: "pdfium/win-x64/pdfium.dll",
    },
];

fn lookup(name: &str) -> Option<&'static ModelEntry> {
    MODEL_REGISTRY.iter().find(|m| m.name == name)
}

// ──────────────────────────────────────────────────────────────────────────────
// Filesystem layout
// ──────────────────────────────────────────────────────────────────────────────

/// 模型根目录。优先 env override（测试用），否则 `~/.seven-hrops/models/`。
pub fn models_root() -> PathBuf {
    if let Ok(p) = std::env::var("SEVEN_HROPS_MODELS_DIR") {
        return PathBuf::from(p);
    }
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".seven-hrops").join("models")
}

fn target_path(entry: &ModelEntry) -> PathBuf {
    models_root().join(entry.target_subpath)
}

fn resolve_url(entry: &ModelEntry) -> Result<String, NativeError> {
    match std::env::var("SEVEN_MODEL_MIRROR_ORG") {
        Ok(org) if !org.trim().is_empty() => {
            Ok(entry.url_template.replace("{org}", org.trim()))
        }
        _ => Err(NativeError::model_mirror_not_configured(
            "Set SEVEN_MODEL_MIRROR_ORG env var (Phase B.9 will replace the default)",
        )),
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API — Tauri command
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelStatus {
    /// 文件已存在且 sha256 校验通过，可直接使用
    Ready,
    /// 后台下载中（首启或重新下载），调用方应订阅 `models://progress` event
    Downloading,
    /// 文件不存在且未触发下载（极少；正常路径都会自动 spawn 下载）
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEnsureResult {
    pub status: ModelStatus,
    /// status == ready 时为目标文件绝对路径，其他状态为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// status == downloading 时的实时进度（0-100），其他状态为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub name: String,
    pub progress: u8,
    pub bytes: u64,
    pub total: Option<u64>,
}

/// 全局下载进度跟踪：按模型 name → AtomicU8(0-100)。
/// 当多个调用同时关心同一模型时，重复调用 `ensure` 不会启动第二次下载。
static PROGRESS: once_cell::sync::Lazy<dashmap::DashMap<String, Arc<AtomicU8>>> =
    once_cell::sync::Lazy::new(dashmap::DashMap::new);

fn progress_handle(name: &str) -> Arc<AtomicU8> {
    PROGRESS
        .entry(name.to_string())
        .or_insert_with(|| Arc::new(AtomicU8::new(0)))
        .clone()
}

#[tauri::command]
pub async fn models_ensure<R: Runtime>(
    app: tauri::AppHandle<R>,
    name: String,
    local_path: Option<String>,
) -> Result<ModelEnsureResult, String> {
    let entry = lookup(&name).ok_or_else(|| {
        String::from(NativeError::model_download_failed(format!(
            "unknown model name: {name}"
        )))
    })?;

    // 1) local_path 旁路：仅校验 sha256 并 promote 到目标位置
    if let Some(lp) = local_path {
        return ensure_from_local(entry, &lp).map_err(String::from);
    }

    // 2) 已存在 → 校验 sha → ready / mismatch
    let dst = target_path(entry);
    if dst.exists() {
        match verify_sha256(&dst, entry.sha256).await {
            Ok(true) => {
                return Ok(ModelEnsureResult {
                    status: ModelStatus::Ready,
                    path: Some(dst.to_string_lossy().into_owned()),
                    progress: None,
                });
            }
            Ok(false) => {
                let actual = sha256_of(&dst).await.unwrap_or_default();
                let _ = tokio::fs::remove_file(&dst).await;
                return Err(String::from(NativeError::model_checksum_mismatch(
                    entry.name.to_string(),
                    entry.sha256.to_string(),
                    actual,
                )));
            }
            Err(e) => return Err(String::from(e)),
        }
    }

    // 3) 未下载：检查 mirror 配置 → 启动后台下载 → 返回 downloading
    let url = resolve_url(entry).map_err(String::from)?;
    let already_running = PROGRESS
        .get(entry.name)
        .map(|p| {
            let v = p.load(Ordering::SeqCst);
            v > 0 && v < 100
        })
        .unwrap_or(false);

    let progress = progress_handle(entry.name).load(Ordering::SeqCst);
    if !already_running {
        spawn_download(app, entry, url);
    }
    Ok(ModelEnsureResult {
        status: ModelStatus::Downloading,
        path: None,
        progress: Some(progress),
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

fn ensure_from_local(entry: &ModelEntry, local_path: &str) -> Result<ModelEnsureResult, NativeError> {
    let lp = PathBuf::from(local_path);
    if !lp.exists() {
        return Err(NativeError::io_failed(format!(
            "local_path not found: {local_path}"
        )));
    }
    // 同步 sha256（local 旁路文件通常 < 200MB，同步可接受）
    let actual = sha256_of_blocking(&lp)
        .map_err(NativeError::io_failed)?;
    if actual != entry.sha256 {
        return Err(NativeError::model_checksum_mismatch(
            entry.name.to_string(),
            entry.sha256.to_string(),
            actual,
        ));
    }
    let dst = target_path(entry);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(NativeError::io_failed)?;
    }
    std::fs::copy(&lp, &dst).map_err(NativeError::io_failed)?;
    Ok(ModelEnsureResult {
        status: ModelStatus::Ready,
        path: Some(dst.to_string_lossy().into_owned()),
        progress: None,
    })
}

async fn verify_sha256(file: &Path, expected: &str) -> Result<bool, NativeError> {
    let actual = sha256_of(file).await?;
    Ok(actual == expected)
}

async fn sha256_of(file: &Path) -> Result<String, NativeError> {
    let path = file.to_path_buf();
    tokio::task::spawn_blocking(move || sha256_of_blocking(&path))
        .await
        .map_err(NativeError::io_failed)?
        .map_err(NativeError::io_failed)
}

fn sha256_of_blocking(file: &Path) -> Result<String, std::io::Error> {
    use std::io::Read as _;
    let mut f = std::fs::File::open(file)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn spawn_download<R: Runtime>(app: tauri::AppHandle<R>, entry: &'static ModelEntry, url: String) {
    let prog = progress_handle(entry.name);
    tokio::spawn(async move {
        if let Err(e) = run_download(&app, entry, &url, prog.clone()).await {
            log::warn!("[models] download {} failed: {}", entry.name, e);
            prog.store(0, Ordering::SeqCst);
            // emit 一条 progress=0 的失败信号（前端拿到后可读 lastError 状态）
            let _ = app.emit(
                "models://progress",
                ProgressEvent {
                    name: entry.name.to_string(),
                    progress: 0,
                    bytes: 0,
                    total: None,
                },
            );
        }
    });
}

async fn run_download<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entry: &ModelEntry,
    url: &str,
    prog: Arc<AtomicU8>,
) -> Result<(), NativeError> {
    let dst = target_path(entry);
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(NativeError::io_failed)?;
    }
    let tmp = dst.with_extension("download");
    if tmp.exists() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(NativeError::model_download_failed)?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(NativeError::model_download_failed)?
        .error_for_status()
        .map_err(NativeError::model_download_failed)?;

    let total = resp.content_length();
    let mut hasher = Sha256::new();
    let mut written: u64 = 0;
    let mut last_pct: u8 = 0;
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(NativeError::io_failed)?;

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(NativeError::model_download_failed)?;
        hasher.update(&bytes);
        file.write_all(&bytes)
            .await
            .map_err(NativeError::io_failed)?;
        written += bytes.len() as u64;
        let pct = match total {
            Some(t) if t > 0 => ((written * 100) / t).min(99) as u8,
            _ => 0,
        };
        if pct != last_pct {
            last_pct = pct;
            prog.store(pct, Ordering::SeqCst);
            let _ = app.emit(
                "models://progress",
                ProgressEvent {
                    name: entry.name.to_string(),
                    progress: pct,
                    bytes: written,
                    total,
                },
            );
        }
    }
    file.flush().await.map_err(NativeError::io_failed)?;
    drop(file);

    let actual = hex::encode(hasher.finalize());
    if actual != entry.sha256 {
        let _ = tokio::fs::remove_file(&tmp).await;
        prog.store(0, Ordering::SeqCst);
        return Err(NativeError::model_checksum_mismatch(
            entry.name.to_string(),
            entry.sha256.to_string(),
            actual,
        ));
    }
    tokio::fs::rename(&tmp, &dst)
        .await
        .map_err(NativeError::io_failed)?;
    prog.store(100, Ordering::SeqCst);
    let _ = app.emit(
        "models://progress",
        ProgressEvent {
            name: entry.name.to_string(),
            progress: 100,
            bytes: written,
            total,
        },
    );
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────────
// 内部工具：让 transcribe.rs 复用同步路径查询
// ──────────────────────────────────────────────────────────────────────────────

/// 给 transcribe / parse FFI 用：直接拿目标路径（不做下载、不校验）。
/// Phase F whisper.cpp 落地时调用；当前暂未被消费。
#[allow(dead_code)]
pub(crate) fn local_path_if_ready(name: &str) -> Option<PathBuf> {
    let entry = lookup(name)?;
    let p = target_path(entry);
    if p.exists() { Some(p) } else { None }
}

/// 给 transcribe 用：返回当前下载进度（0-100）。
pub(crate) fn current_progress(name: &str) -> u8 {
    PROGRESS
        .get(name)
        .map(|p| p.load(Ordering::SeqCst))
        .unwrap_or(0)
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn isolated_models_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "seven-models-{}-{}",
            label,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("SEVEN_HROPS_MODELS_DIR", &dir);
        dir
    }

    /// 跨测试共享的 env 锁：`SEVEN_HROPS_MODELS_DIR` / `SEVEN_MODEL_MIRROR_ORG`
    /// 是进程全局状态，多个测试并行设置会互相覆盖。
    pub(crate) fn env_lock() -> &'static parking_lot::Mutex<()> {
        static L: once_cell::sync::Lazy<parking_lot::Mutex<()>> =
            once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(()));
        &L
    }

    #[test]
    fn registry_contains_four_entries() {
        assert_eq!(MODEL_REGISTRY.len(), 4);
        for m in MODEL_REGISTRY {
            assert!(!m.url_template.is_empty(), "{} url_template is empty", m.name);
            assert!(m.url_template.starts_with("https://"), "{} url must be https", m.name);
            assert!(!m.sha256.is_empty());
        }
    }

    #[test]
    fn lookup_finds_known_models() {
        assert!(lookup("whisper-base-zh").is_some());
        assert!(lookup("pdfium-mac-arm64").is_some());
        assert!(lookup("nope").is_none());
    }

    #[test]
    fn resolve_url_requires_org_env() {
        let _g = env_lock().lock();
        std::env::remove_var("SEVEN_MODEL_MIRROR_ORG");
        let entry = lookup("whisper-base-zh").unwrap();
        let err = resolve_url(entry).unwrap_err();
        let s = serde_json::to_string(&err).unwrap();
        assert!(s.contains("MODEL_MIRROR_NOT_CONFIGURED"), "got {}", s);

        std::env::set_var("SEVEN_MODEL_MIRROR_ORG", "test-org");
        let url = resolve_url(entry).unwrap();
        assert!(url.contains("test-org"));
        assert!(!url.contains("{org}"));
        std::env::remove_var("SEVEN_MODEL_MIRROR_ORG");
    }

    #[test]
    fn ensure_from_local_checksum_mismatch_returns_error() {
        let _g = env_lock().lock();
        let _dir = isolated_models_dir("local-mm");
        let lp = std::env::temp_dir().join(format!("seven-local-{}.bin", uuid::Uuid::new_v4()));
        std::fs::write(&lp, b"hello world").unwrap();
        let entry = lookup("whisper-base-zh").unwrap();
        let err = ensure_from_local(entry, lp.to_str().unwrap()).unwrap_err();
        let s = serde_json::to_string(&err).unwrap();
        assert!(s.contains("MODEL_CHECKSUM_MISMATCH"), "got {}", s);
        let _ = std::fs::remove_file(&lp);
    }

    #[test]
    fn ensure_from_local_missing_path_returns_io_failed() {
        let _g = env_lock().lock();
        let _dir = isolated_models_dir("local-missing");
        let entry = lookup("whisper-base-zh").unwrap();
        let err = ensure_from_local(entry, "/nonexistent/path/x.bin").unwrap_err();
        let s = serde_json::to_string(&err).unwrap();
        assert!(s.contains("NATIVE_IO_FAILED"));
    }

    #[tokio::test]
    async fn sha256_of_blocking_matches_known_value() {
        let f = std::env::temp_dir().join(format!("seven-sha-{}.bin", uuid::Uuid::new_v4()));
        std::fs::write(&f, b"hello world").unwrap();
        let h = sha256_of(&f).await.unwrap();
        // sha256("hello world")
        assert_eq!(
            h,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn local_path_if_ready_reports_existence() {
        let _g = env_lock().lock();
        let dir = isolated_models_dir("ready-check");
        // 不存在
        assert!(local_path_if_ready("whisper-base-zh").is_none());
        // 创建文件 → 存在
        let entry = lookup("whisper-base-zh").unwrap();
        let p = dir.join(entry.target_subpath);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        assert!(local_path_if_ready("whisper-base-zh").is_some());
        // 清理 env，避免污染其他测试
        std::env::remove_var("SEVEN_HROPS_MODELS_DIR");
    }
}
