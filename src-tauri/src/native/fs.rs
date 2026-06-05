//! Phase B Task 2.2: 通用文件系统命令。
//!
//! 六个命令：`fs_read_text` / `fs_write_text` / `fs_copy_file` / `fs_list_dir` /
//! `fs_stat` / `fs_canonicalize`。**全部接收 `session_id` 作为第一个参数**，并先调
//! [`crate::sandbox::fs_guard`] 强制白名单 + 审计；任何业务字段（简历专用结构等）
//! 一律不暴露。
//!
//! 错误约定：
//! - 沙箱拒绝 → `SandboxError`（已自带 `code: SANDBOX_DENY_*`），通过其
//!   `Into<String>` impl 转成 JSON 字符串返回前端。
//! - IO 失败 → [`crate::native::errors::NativeError::IoFailed`]（code:
//!   `NATIVE_IO_FAILED`）。
//! - 文件类型不支持 → `NativeError::UnsupportedFile`（极少见，主要给 parse 用）。

use crate::native::errors::NativeError;
use crate::sandbox::fs_guard;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Expand a leading `~` to the current user's home directory.
/// If the home directory cannot be determined, the path is returned unchanged.
fn expand_tilde(path: String) -> PathBuf {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            let rest = path.trim_start_matches('~').trim_start_matches('/');
            if rest.is_empty() {
                return home;
            }
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

// ──────────────────────────────────────────────────────────────────────────────
// fs_read_text
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fs_read_text(session_id: String, path: String) -> Result<String, String> {
    let path = expand_tilde(path);
    let canonical = fs_guard::check_read(&session_id, &path)?;
    tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| String::from(NativeError::io_failed(e)))
}

// ──────────────────────────────────────────────────────────────────────────────
// fs_write_text
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fs_write_text(
    session_id: String,
    path: String,
    contents: String,
) -> Result<(), String> {
    let path = expand_tilde(path);
    let canonical = fs_guard::check_write(&session_id, &path)?;
    if let Some(parent) = canonical.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| String::from(NativeError::io_failed(e)))?;
        }
    }
    tokio::fs::write(&canonical, contents)
        .await
        .map_err(|e| String::from(NativeError::io_failed(e)))
}

// ──────────────────────────────────────────────────────────────────────────────
// fs_copy_file
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CopyFileResult {
    pub from_path: String,
    pub to_path: String,
    pub size: u64,
}

#[tauri::command]
pub async fn fs_copy_file(
    session_id: String,
    from_path: String,
    to_path: String,
) -> Result<CopyFileResult, String> {
    let from_path = expand_tilde(from_path);
    let to_path = expand_tilde(to_path);
    let from_canonical = fs_guard::check_read(&session_id, &from_path)?;
    let to_canonical = fs_guard::check_write(&session_id, &to_path)?;
    if let Some(parent) = to_canonical.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| String::from(NativeError::io_failed(e)))?;
        }
    }
    let size = tokio::fs::copy(&from_canonical, &to_canonical)
        .await
        .map_err(|e| String::from(NativeError::io_failed(e)))?;
    Ok(CopyFileResult {
        from_path: from_canonical.to_string_lossy().into_owned(),
        to_path: to_canonical.to_string_lossy().into_owned(),
        size,
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// fs_list_dir
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub async fn fs_list_dir(
    session_id: String,
    path: String,
) -> Result<Vec<DirEntryInfo>, String> {
    let path = expand_tilde(path);
    let canonical = fs_guard::check_read(&session_id, &path)?;
    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&canonical)
        .await
        .map_err(|e| String::from(NativeError::io_failed(e)))?;
    while let Some(entry) = rd
        .next_entry()
        .await
        .map_err(|e| String::from(NativeError::io_failed(e)))?
    {
        let meta = entry
            .metadata()
            .await
            .map_err(|e| String::from(NativeError::io_failed(e)))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let p = entry.path().to_string_lossy().into_owned();
        entries.push(DirEntryInfo {
            name,
            path: p,
            is_dir: meta.is_dir(),
            size: meta.len(),
        });
    }
    // 稳定排序：先目录后文件，名字字典序
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(entries)
}

// ──────────────────────────────────────────────────────────────────────────────
// fs_stat
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStat {
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
    /// Unix epoch seconds（macOS/Linux/Windows 一律 UTC 秒，不存在则 None）
    pub modified_secs: Option<i64>,
}

#[tauri::command]
pub async fn fs_stat(session_id: String, path: String) -> Result<FileStat, String> {
    let path = expand_tilde(path);
    let canonical = fs_guard::check_read(&session_id, &path)?;
    let meta = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| String::from(NativeError::io_failed(e)))?;
    let modified_secs = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    Ok(FileStat {
        path: canonical.to_string_lossy().into_owned(),
        is_dir: meta.is_dir(),
        is_file: meta.is_file(),
        size: meta.len(),
        modified_secs,
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// fs_canonicalize
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fs_canonicalize(session_id: String, path: String) -> Result<String, String> {
    let path = expand_tilde(path);
    let canonical = fs_guard::check_canonical_within(&session_id, &path)?;
    Ok(canonical.to_string_lossy().into_owned())
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

    fn fresh_session_with(
        prefix: &str,
        source: ManifestSource,
        read_paths: Vec<PathBuf>,
        write_paths: Vec<PathBuf>,
    ) -> (String, PathBuf) {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let sid = format!("{}-{}-{}", prefix, std::process::id(), n);
        let tmp = std::env::temp_dir().join(format!("seven-native-fs-{}", &sid));
        std::fs::create_dir_all(&tmp).unwrap();
        let canon = std::fs::canonicalize(&tmp).unwrap();
        let real_read = if read_paths.is_empty() { vec![canon.clone()] } else { read_paths };
        let real_write = if write_paths.is_empty() { vec![canon.clone()] } else { write_paths };
        let ctx = SandboxContext::new(
            sid.clone(),
            source,
            real_read,
            real_write,
            vec![],
        );
        registry().insert(ctx);
        (sid, canon)
    }

    #[tokio::test]
    async fn fs_read_text_happy_path() {
        let (sid, dir) = fresh_session_with("rd-ok", ManifestSource::User, vec![], vec![]);
        let f = dir.join("a.txt");
        std::fs::write(&f, "hello").unwrap();
        let got = fs_read_text(sid, f.to_string_lossy().into_owned()).await.unwrap();
        assert_eq!(got, "hello");
    }

    #[tokio::test]
    async fn fs_read_text_deny_outside_whitelist() {
        let (sid, _dir) = fresh_session_with("rd-deny", ManifestSource::User, vec![], vec![]);
        let outside = std::env::temp_dir().join(format!("seven-other-{}.txt", std::process::id()));
        std::fs::write(&outside, "x").unwrap();
        let err = fs_read_text(sid, outside.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "expected deny code, got {}", err);
    }

    #[tokio::test]
    async fn fs_write_text_happy_path() {
        let (sid, dir) = fresh_session_with("wr-ok", ManifestSource::User, vec![], vec![]);
        let f = dir.join("nested/created.txt");
        fs_write_text(sid, f.to_string_lossy().into_owned(), "data".into())
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "data");
    }

    #[tokio::test]
    async fn fs_write_text_deny_outside_whitelist() {
        let (sid, _dir) = fresh_session_with("wr-deny", ManifestSource::User, vec![], vec![]);
        let outside = std::env::temp_dir().join(format!("seven-other-w-{}.txt", std::process::id()));
        let err = fs_write_text(sid, outside.to_string_lossy().into_owned(), "x".into())
            .await
            .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_WRITE"), "got {}", err);
    }

    #[tokio::test]
    async fn fs_copy_file_happy_path_preserves_bytes() {
        let (sid, dir) = fresh_session_with("cp-ok", ManifestSource::User, vec![], vec![]);
        let from = dir.join("source.bin");
        let to = dir.join("nested/copied.bin");
        std::fs::write(&from, [0_u8, 159, 146, 150, 255]).unwrap();
        let result = fs_copy_file(
            sid,
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), vec![0_u8, 159, 146, 150, 255]);
        assert_eq!(result.size, 5);
        assert_eq!(result.to_path, to.to_string_lossy());
    }

    #[tokio::test]
    async fn fs_copy_file_happy_path_copies_text() {
        let (sid, dir) = fresh_session_with("cp-text", ManifestSource::User, vec![], vec![]);
        let from = dir.join("source.txt");
        let to = dir.join("nested/copied.txt");
        std::fs::write(&from, "hello copy").unwrap();
        let result = fs_copy_file(
            sid,
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "hello copy");
        assert_eq!(result.size, 10);
        assert_eq!(result.from_path, from.to_string_lossy());
    }

    #[tokio::test]
    async fn fs_copy_file_deny_source_outside_whitelist() {
        let (sid, dir) = fresh_session_with("cp-deny-r", ManifestSource::User, vec![], vec![]);
        let outside = std::env::temp_dir().join(format!("seven-copy-outside-{}.bin", std::process::id()));
        let to = dir.join("copied.bin");
        std::fs::write(&outside, [1_u8, 2, 3]).unwrap();
        let err = fs_copy_file(
            sid,
            outside.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "got {}", err);
    }

    #[tokio::test]
    async fn fs_list_dir_returns_entries_sorted() {
        let (sid, dir) = fresh_session_with("ls-ok", ManifestSource::User, vec![], vec![]);
        std::fs::create_dir_all(dir.join("zsub")).unwrap();
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        std::fs::write(dir.join("b.txt"), "22").unwrap();
        let got = fs_list_dir(sid, dir.to_string_lossy().into_owned()).await.unwrap();
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].name, "zsub");
        assert!(got[0].is_dir);
        assert_eq!(got[1].name, "a.txt");
        assert_eq!(got[1].size, 1);
        assert_eq!(got[2].name, "b.txt");
        assert_eq!(got[2].size, 2);
    }

    #[tokio::test]
    async fn fs_list_dir_deny_outside() {
        let (sid, _) = fresh_session_with("ls-deny", ManifestSource::User, vec![], vec![]);
        let outside = std::env::temp_dir();
        let err = fs_list_dir(sid, outside.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "got {}", err);
    }

    #[tokio::test]
    async fn fs_stat_returns_size_and_kind() {
        let (sid, dir) = fresh_session_with("st-ok", ManifestSource::User, vec![], vec![]);
        let f = dir.join("s.txt");
        std::fs::write(&f, "abcd").unwrap();
        let stat = fs_stat(sid, f.to_string_lossy().into_owned()).await.unwrap();
        assert!(stat.is_file);
        assert!(!stat.is_dir);
        assert_eq!(stat.size, 4);
        assert!(stat.modified_secs.is_some());
    }

    #[tokio::test]
    async fn fs_stat_deny_outside() {
        let (sid, _) = fresh_session_with("st-deny", ManifestSource::User, vec![], vec![]);
        let outside = std::env::temp_dir().join("seven-stat-deny.txt");
        std::fs::write(&outside, "1").unwrap();
        let err = fs_stat(sid, outside.to_string_lossy().into_owned()).await.unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "got {}", err);
    }

    #[tokio::test]
    async fn fs_canonicalize_happy_path() {
        let (sid, dir) = fresh_session_with("cn-ok", ManifestSource::User, vec![], vec![]);
        let f = dir.join("c.txt");
        std::fs::write(&f, "x").unwrap();
        let got = fs_canonicalize(sid, f.to_string_lossy().into_owned()).await.unwrap();
        assert!(got.ends_with("c.txt"));
    }

    #[tokio::test]
    async fn fs_canonicalize_deny_traversal() {
        let (sid, dir) = fresh_session_with("cn-deny", ManifestSource::User, vec![], vec![]);
        let traversal = dir.join("nested/../../escape.txt");
        let err = fs_canonicalize(sid, traversal.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        // 任意 SANDBOX_* 拒绝码均可（DENY_READ 或 PATH_TRAVERSAL）
        assert!(err.starts_with("{") && err.contains("SANDBOX_"), "got {}", err);
    }

    #[tokio::test]
    async fn unregistered_session_returns_session_not_found() {
        let bogus = "no-such-session-x".to_string();
        let f = std::env::temp_dir().join("any.txt");
        let err = fs_read_text(bogus, f.to_string_lossy().into_owned()).await.unwrap_err();
        assert!(err.contains("SANDBOX_SESSION_NOT_FOUND"), "got {}", err);
    }
}
