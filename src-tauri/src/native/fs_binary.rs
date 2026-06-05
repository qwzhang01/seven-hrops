//! fs_binary.rs — Phase F write-binary command.
//!
//! Exposes `fs_write_binary_file`: writes a base64-encoded byte buffer to disk.
//! Used by TS toolpacks that produce binary artefacts in the WebView main
//! thread (e.g. `pptxgenjs` ArrayBuffer → base64 → here). Sandbox-gated by
//! the write whitelist using the same pattern as `fs_write_text` /
//! `export_docx`.
//!
//! ## Error codes
//! | code | when |
//! |---|---|
//! | SANDBOX_DENY_WRITE | path is outside the session's write whitelist |
//! | SANDBOX_SESSION_NOT_FOUND | session_id is not registered |
//! | INVALID_BASE64 | `content_b64` is not valid base64 |
//! | CREATE_DIR_FAILED | parent directory cannot be created |
//! | FILE_WRITE_FAILED | OS-level write failure |

use crate::sandbox::fs_guard;
use base64::Engine;
use std::fs;
use std::path::PathBuf;

fn expand_tilde(path: &str) -> PathBuf {
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

#[tauri::command]
pub async fn fs_write_binary_file(
    session_id: String,
    path: String,
    content_b64: String,
) -> Result<u64, String> {
    let dest = expand_tilde(&path);

    fs_guard::check_write(&session_id, &dest).map_err(String::from)?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_b64.as_bytes())
        .map_err(|e| {
            format!(
                r#"{{"code":"INVALID_BASE64","message":"failed to decode content_b64: {}"}}"#,
                e
            )
        })?;

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                r#"{{"code":"CREATE_DIR_FAILED","message":"{}"}}"#,
                e.to_string().replace('"', "'")
            )
        })?;
    }

    fs::write(&dest, &bytes).map_err(|e| {
        format!(
            r#"{{"code":"FILE_WRITE_FAILED","message":"{}"}}"#,
            e.to_string().replace('"', "'")
        )
    })?;

    Ok(bytes.len() as u64)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{self, ManifestSource, SandboxContext};

    fn fresh_session(label: &str) -> (String, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let sid = format!("test-fsbin-{label}-{}", std::process::id());
        let canon = std::fs::canonicalize(dir.path()).unwrap();
        sandbox::registry().insert(SandboxContext::new(
            sid.clone(),
            ManifestSource::User,
            vec![canon.clone()],
            vec![canon],
            vec![],
        ));
        (sid, dir)
    }

    #[tokio::test]
    async fn writes_binary_payload() {
        let (sid, dir) = fresh_session("ok");
        let out = dir.path().join("nested/report.pptx");
        let payload = b"PK\x03\x04hello-pptx".to_vec();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&payload);
        let n = fs_write_binary_file(sid, out.to_string_lossy().into_owned(), b64)
            .await
            .unwrap();
        assert_eq!(n as usize, payload.len());
        assert_eq!(std::fs::read(&out).unwrap(), payload);
    }

    #[tokio::test]
    async fn rejects_invalid_base64() {
        let (sid, dir) = fresh_session("badb64");
        let out = dir.path().join("x.bin");
        let err = fs_write_binary_file(sid, out.to_string_lossy().into_owned(), "@@@".into())
            .await
            .unwrap_err();
        assert!(err.contains("INVALID_BASE64"), "got {}", err);
    }

    #[tokio::test]
    async fn deny_outside_sandbox() {
        let (sid, _dir) = fresh_session("deny");
        let stranger = std::env::temp_dir()
            .join(format!("seven-stranger-bin-{}.bin", std::process::id()));
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"x");
        let err = fs_write_binary_file(sid, stranger.to_string_lossy().into_owned(), b64)
            .await
            .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_WRITE"), "got {}", err);
    }
}
