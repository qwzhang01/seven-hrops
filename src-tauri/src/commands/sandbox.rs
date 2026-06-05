//! Tauri command 层：sandbox_create / sandbox_drop — Phase B Task 1.8
//!
//! 前端在新建会话前先 invoke `sandbox_create`；session 结束 invoke `sandbox_drop`。
//! 后续所有 fs / network / native 命令都按 `session_id` 找 [`crate::sandbox::registry`]，
//! 因此 sandbox_create 是所有 native 命令的强制前置。

use serde::Deserialize;
use std::path::PathBuf;

use crate::sandbox::{self, ManifestSource, SandboxContext};

#[derive(Debug, Deserialize)]
pub struct SandboxCreateArgs {
    pub session_id: String,
    pub source: ManifestSource,
    /// 路径白名单（可省略）。省略 = 空，不享 fast-path 时所有 fs_read 都被 deny。
    #[serde(default)]
    pub read_paths: Vec<PathBuf>,
    #[serde(default)]
    pub write_paths: Vec<PathBuf>,
    #[serde(default)]
    pub network_hosts: Vec<String>,
}

#[tauri::command]
pub fn sandbox_create(args: SandboxCreateArgs) -> Result<(), String> {
    let SandboxCreateArgs {
        session_id,
        source,
        read_paths,
        write_paths,
        network_hosts,
    } = args;

    if session_id.trim().is_empty() {
        return Err("session_id must not be empty".to_string());
    }

    let ctx = match source {
        ManifestSource::Builtin => {
            // builtin 工厂；忽略前端传的白名单（fast-path 不需要）
            SandboxContext::builtin(session_id)
        }
        _ => SandboxContext::new(session_id, source, read_paths, write_paths, network_hosts),
    };
    sandbox::registry().insert(ctx);
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct SandboxDropArgs {
    pub session_id: String,
}

#[tauri::command]
pub fn sandbox_drop(args: SandboxDropArgs) -> Result<bool, String> {
    Ok(sandbox::registry().remove(&args.session_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_with_empty_session_id_is_rejected() {
        let err = sandbox_create(SandboxCreateArgs {
            session_id: "".to_string(),
            source: ManifestSource::User,
            read_paths: vec![],
            write_paths: vec![],
            network_hosts: vec![],
        })
        .unwrap_err();
        assert!(err.contains("session_id"));
    }

    #[test]
    fn create_then_drop_lifecycle() {
        let sid = format!("cmd-{}", uuid::Uuid::new_v4());
        sandbox_create(SandboxCreateArgs {
            session_id: sid.clone(),
            source: ManifestSource::User,
            read_paths: vec![PathBuf::from("/tmp/seven-x")],
            write_paths: vec![],
            network_hosts: vec![],
        })
        .unwrap();
        assert!(sandbox::registry().get(&sid).is_some());
        let removed = sandbox_drop(SandboxDropArgs {
            session_id: sid.clone(),
        })
        .unwrap();
        assert!(removed);
        assert!(sandbox::registry().get(&sid).is_none());
    }

    #[test]
    fn create_builtin_ignores_whitelists() {
        let sid = format!("cmd-builtin-{}", uuid::Uuid::new_v4());
        sandbox_create(SandboxCreateArgs {
            session_id: sid.clone(),
            source: ManifestSource::Builtin,
            read_paths: vec![PathBuf::from("/should/be/ignored")],
            write_paths: vec![],
            network_hosts: vec![],
        })
        .unwrap();
        let ctx = sandbox::registry().get(&sid).unwrap();
        assert_eq!(ctx.source, ManifestSource::Builtin);
        assert!(ctx.read_paths.is_empty(), "builtin should drop client-passed read_paths");
        let _ = sandbox_drop(SandboxDropArgs { session_id: sid });
    }
}
