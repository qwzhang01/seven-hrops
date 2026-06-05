//! Sandbox 错误码统一枚举 — Phase B Task 1.x
//!
//! 与 [phase-b-platform-foundation/specs/rust-native-bridge/spec.md] 保持一致：
//!   - SANDBOX_DENY_READ
//!   - SANDBOX_DENY_WRITE
//!   - SANDBOX_DENY_NETWORK
//!   - SANDBOX_SESSION_NOT_FOUND
//!   - SANDBOX_PATH_TRAVERSAL
//!
//! 所有错误以 [`SandboxError`] 形式向上抛出，序列化后形成 `{ code, message, ... }`
//! 的结构化错误，前端 / 测试可按 `code` 字段精确断言。

use serde::Serialize;
use std::fmt;

/// Sandbox 拒绝/异常的错误码集合。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxErrorCode {
    /// fs_read 路径不在 read_paths 白名单。
    SandboxDenyRead,
    /// fs_write 路径不在 write_paths 白名单。
    SandboxDenyWrite,
    /// network 请求 host 不在 network_hosts 白名单。
    SandboxDenyNetwork,
    /// session_id 未注册（前端忘了 sandbox_create 或已 drop）。
    SandboxSessionNotFound,
    /// canonicalize 失败 / 含 `..` 跨越白名单。
    SandboxPathTraversal,
}

impl SandboxErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            SandboxErrorCode::SandboxDenyRead => "SANDBOX_DENY_READ",
            SandboxErrorCode::SandboxDenyWrite => "SANDBOX_DENY_WRITE",
            SandboxErrorCode::SandboxDenyNetwork => "SANDBOX_DENY_NETWORK",
            SandboxErrorCode::SandboxSessionNotFound => "SANDBOX_SESSION_NOT_FOUND",
            SandboxErrorCode::SandboxPathTraversal => "SANDBOX_PATH_TRAVERSAL",
        }
    }
}

impl fmt::Display for SandboxErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 结构化沙箱错误。`message` 用人类可读的摘要，`reason` 给审计日志细节。
#[derive(Debug, Clone, Serialize)]
pub struct SandboxError {
    pub code: &'static str,
    pub message: String,
    pub reason: Option<String>,
}

impl SandboxError {
    pub fn new(code: SandboxErrorCode, message: impl Into<String>) -> Self {
        Self {
            code: code.as_str(),
            message: message.into(),
            reason: None,
        }
    }

    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

impl fmt::Display for SandboxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.reason {
            Some(r) => write!(f, "[{}] {} ({})", self.code, self.message, r),
            None => write!(f, "[{}] {}", self.code, self.message),
        }
    }
}

impl std::error::Error for SandboxError {}

/// 便于 Tauri 命令直接 `?` 转 `String`。
impl From<SandboxError> for String {
    fn from(e: SandboxError) -> Self {
        // 序列化为 JSON，前端可结构化解析；解析失败兜底 Display
        serde_json::to_string(&e).unwrap_or_else(|_| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_code_strings_match_spec() {
        assert_eq!(SandboxErrorCode::SandboxDenyRead.as_str(), "SANDBOX_DENY_READ");
        assert_eq!(SandboxErrorCode::SandboxDenyWrite.as_str(), "SANDBOX_DENY_WRITE");
        assert_eq!(
            SandboxErrorCode::SandboxDenyNetwork.as_str(),
            "SANDBOX_DENY_NETWORK"
        );
        assert_eq!(
            SandboxErrorCode::SandboxSessionNotFound.as_str(),
            "SANDBOX_SESSION_NOT_FOUND"
        );
        assert_eq!(
            SandboxErrorCode::SandboxPathTraversal.as_str(),
            "SANDBOX_PATH_TRAVERSAL"
        );
    }

    #[test]
    fn sandbox_error_serializes_with_code_and_message() {
        let err = SandboxError::new(SandboxErrorCode::SandboxDenyRead, "blocked")
            .with_reason("path not in read_paths");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "SANDBOX_DENY_READ");
        assert_eq!(json["message"], "blocked");
        assert_eq!(json["reason"], "path not in read_paths");
    }

    #[test]
    fn into_string_yields_json_for_tauri_command() {
        let err = SandboxError::new(SandboxErrorCode::SandboxDenyWrite, "x");
        let s: String = err.into();
        assert!(s.contains("\"code\":\"SANDBOX_DENY_WRITE\""));
    }
}
