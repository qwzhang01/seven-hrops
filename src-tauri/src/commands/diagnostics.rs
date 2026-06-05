//! Tauri command 层：诊断命令 — Phase B Task 6.7
//!
//! 当 `bootstrapPlatform()` 失败时，前端的 `<PlatformBootError />` 降级页
//! 会调用 `open_audit_log` 让用户在系统文件管理器中打开当日审计日志，
//! 用于排查启动问题。
//!
//! 安全契约：本命令只读 — 仅对用户暴露文件位置，不暴露文件内容。
//! 不接受任意 path 参数；目录由 audit::audit_dir() 集中决定。

use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::sandbox::audit;

#[derive(Debug, Deserialize)]
pub struct OpenAuditLogArgs {
    /// 占位字段：与其它 sandbox 命令保持一致的入参签名。
    /// 本命令为 system-level 诊断，不要求真实 session 注册，
    /// 但保留字段方便未来在审计上记录"谁打开了日志"。
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OpenAuditLogResult {
    /// 当日 jsonl 文件的绝对路径。
    pub path: String,
    /// 文件是否实际存在（Phase B 早期可能尚未产生任何审计记录）。
    pub exists: bool,
}

/// 解析当日审计日志文件路径。`<audit_dir>/<YYYY-MM-DD>.jsonl`
fn today_log_path() -> PathBuf {
    let date = Utc::now().format("%Y-%m-%d").to_string();
    audit::audit_dir().join(format!("{}.jsonl", date))
}

/// 返回当日审计日志的绝对路径与是否存在。
///
/// 设计说明：本命令故意 **不** 直接 `open` 文件 — Tauri v2 推荐通过前端的
/// `@tauri-apps/plugin-shell` 显式调 `open(path)`，这样权限策略在前端配
/// 置中可见可审计。我们这里只负责解析路径。
#[tauri::command]
pub fn open_audit_log(args: OpenAuditLogArgs) -> Result<OpenAuditLogResult, String> {
    let _ = args.session_id; // reserved for future audit-of-audit
    let path = today_log_path();
    Ok(OpenAuditLogResult {
        exists: path.exists(),
        path: path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_a_path_under_the_audit_dir() {
        let result = open_audit_log(OpenAuditLogArgs { session_id: None }).unwrap();
        assert!(result.path.contains("audit"));
        assert!(result.path.ends_with(".jsonl"));
    }

    #[test]
    fn exists_flag_matches_filesystem() {
        let result = open_audit_log(OpenAuditLogArgs { session_id: None }).unwrap();
        let actual = std::path::Path::new(&result.path).exists();
        assert_eq!(result.exists, actual);
    }
}
