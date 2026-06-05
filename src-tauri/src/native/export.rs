//! export.rs — Phase E native export commands.
//!
//! Exposes `export_docx`: generates a minimal .docx file from plain text
//! content using `docx-rs`. The output path is sandbox-gated via the
//! write whitelist (same pattern as `fs_write_text`).

use crate::sandbox::fs_guard;
use docx_rs::{Docx, Paragraph, Run};
use std::fs;
use std::path::PathBuf;

/// Expand a leading `~` to the current user's home directory.
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

/// Generate a .docx file at `path` with the given `content` (plain text).
///
/// Each `\n`-separated line becomes a separate paragraph.
/// The path must be within the session's write whitelist.
#[tauri::command]
pub async fn export_docx(
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let dest = expand_tilde(&path);
    // Sandbox write-path check
    fs_guard::check_write(&session_id, &dest)
        .map_err(|e| format!("SANDBOX_DENIED: {e}"))?;

    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("CREATE_DIR_FAILED: {e}"))?;
    }

    // Build docx: one paragraph per line
    let mut docx = Docx::new();
    for line in content.split('\n') {
        docx = docx.add_paragraph(
            Paragraph::new().add_run(Run::new().add_text(line)),
        );
    }

    // Write to file
    let file = fs::File::create(dest)
        .map_err(|e| format!("FILE_CREATE_FAILED: {e}"))?;
    docx.build()
        .pack(file)
        .map_err(|e| format!("DOCX_PACK_FAILED: {e:?}"))?;

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{self, ManifestSource, SandboxContext};

    fn fresh_session(label: &str) -> (String, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let sid = format!("test-export-{label}-{}", std::process::id());
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
    async fn export_docx_creates_file() {
        let (sid, dir) = fresh_session("ok");
        let out = dir.path().join("report.docx");
        let result = export_docx(
            sid,
            out.to_string_lossy().into_owned(),
            "Line one\nLine two\nLine three".to_string(),
        )
        .await;
        assert!(result.is_ok(), "export_docx failed: {:?}", result);
        assert!(out.exists(), "output file not created");
        // Verify it's a valid zip (docx is a zip)
        let bytes = std::fs::read(&out).unwrap();
        assert!(bytes.starts_with(b"PK"), "not a valid docx/zip");
    }

    #[tokio::test]
    async fn export_docx_deny_outside_sandbox() {
        let (sid, _) = fresh_session("deny");
        let outside = std::env::temp_dir()
            .join(format!("seven-stranger-export-{}.docx", std::process::id()));
        let result = export_docx(
            sid,
            outside.to_string_lossy().into_owned(),
            "content".to_string(),
        )
        .await;
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("SANDBOX_DENIED"),
            "expected SANDBOX_DENIED"
        );
    }
}
