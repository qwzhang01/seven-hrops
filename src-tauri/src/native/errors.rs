//! Native bridge 错误码统一枚举。
//!
//! 设计原则：
//! - 所有 `#[tauri::command]` 失败路径**必须**通过此处的 `code` 返回，
//!   前端按 code 做用户友好提示（不再依赖错误字符串模式匹配）。
//! - 沙箱拒绝走 [`crate::sandbox::errors::SandboxError`]，本枚举专管 native
//!   层自身的错误（IO 失败、文件类型不支持、FFI 未接入等）。
//! - `FFI_NOT_IMPLEMENTED` 在 B.0~B.4 阶段返回；B.9 启用 `ffi-real` feature
//!   后被真实 pdfium / whisper 实现替换。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code")]
pub enum NativeError {
    /// IO 失败（read/write/list/stat/canonicalize 真实磁盘错误）
    #[serde(rename = "NATIVE_IO_FAILED")]
    IoFailed { message: String },

    /// 文件类型不支持（如 parse_pdf 收到非 PDF 文件）
    #[serde(rename = "NATIVE_UNSUPPORTED_FILE")]
    UnsupportedFile { message: String },

    /// 解析过程失败（PDF 损坏、xlsx 格式异常等）
    #[serde(rename = "NATIVE_PARSE_FAILED")]
    ParseFailed { message: String },

    /// FFI 真实绑定尚未启用（Phase B.0~B.4 stub）
    #[serde(rename = "FFI_NOT_IMPLEMENTED")]
    FfiNotImplemented { feature: String },

    /// 沙箱拒绝（包装 `SandboxError`，便于前端统一拿 code）
    #[serde(rename = "SANDBOX_DENY")]
    SandboxDeny { message: String },

    // ─── Phase B Task 3.x — webserver / models / transcribe ───────────────

    /// Whisper 模型尚未下载完成；前端可读 `progress` 显示百分比并轮询。
    #[serde(rename = "WHISPER_MODEL_DOWNLOADING")]
    WhisperModelDownloading { progress: u8 },

    /// 已下载的模型文件 sha256 与 registry 不匹配；下载流程已自动删除损坏文件。
    #[serde(rename = "MODEL_CHECKSUM_MISMATCH")]
    ModelChecksumMismatch { name: String, expected: String, actual: String },

    /// 模型 Mirror 组织名未配置（环境变量 `SEVEN_MODEL_MIRROR_ORG` 缺失）；
    /// Phase B.0~B.4 期间默认未配置 → 此错被视为预期。
    #[serde(rename = "MODEL_MIRROR_NOT_CONFIGURED")]
    ModelMirrorNotConfigured { hint: String },

    /// 模型下载阶段网络/IO 失败（区别于 sha256 不匹配）。
    #[serde(rename = "MODEL_DOWNLOAD_FAILED")]
    ModelDownloadFailed { message: String },

    /// `webserver_drop` 时 handle 在 registry 中不存在（已被 GC 或 ID 错误）。
    #[serde(rename = "WEBSERVER_HANDLE_NOT_FOUND")]
    WebserverHandleNotFound { handle: String },

    /// 转写过程失败（FFI 已就绪但输入非法 / whisper 内部失败）。
    #[serde(rename = "TRANSCRIBE_FAILED")]
    TranscribeFailed { message: String },
}

impl NativeError {
    pub fn io_failed<E: std::fmt::Display>(e: E) -> Self {
        Self::IoFailed { message: e.to_string() }
    }
    pub fn parse_failed<E: std::fmt::Display>(e: E) -> Self {
        Self::ParseFailed { message: e.to_string() }
    }
    pub fn unsupported<S: Into<String>>(msg: S) -> Self {
        Self::UnsupportedFile { message: msg.into() }
    }
    pub fn ffi_not_implemented<S: Into<String>>(feature: S) -> Self {
        Self::FfiNotImplemented { feature: feature.into() }
    }
    pub fn sandbox_deny<E: std::fmt::Display>(e: E) -> Self {
        Self::SandboxDeny { message: e.to_string() }
    }
    pub fn whisper_model_downloading(progress: u8) -> Self {
        Self::WhisperModelDownloading { progress: progress.min(100) }
    }
    pub fn model_checksum_mismatch<S: Into<String>>(name: S, expected: S, actual: S) -> Self {
        Self::ModelChecksumMismatch {
            name: name.into(),
            expected: expected.into(),
            actual: actual.into(),
        }
    }
    pub fn model_mirror_not_configured<S: Into<String>>(hint: S) -> Self {
        Self::ModelMirrorNotConfigured { hint: hint.into() }
    }
    pub fn model_download_failed<E: std::fmt::Display>(e: E) -> Self {
        Self::ModelDownloadFailed { message: e.to_string() }
    }
    pub fn webserver_handle_not_found<S: Into<String>>(handle: S) -> Self {
        Self::WebserverHandleNotFound { handle: handle.into() }
    }
    pub fn transcribe_failed<E: std::fmt::Display>(e: E) -> Self {
        Self::TranscribeFailed { message: e.to_string() }
    }
}

impl std::fmt::Display for NativeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IoFailed { message } => write!(f, "[NATIVE_IO_FAILED] {}", message),
            Self::UnsupportedFile { message } => write!(f, "[NATIVE_UNSUPPORTED_FILE] {}", message),
            Self::ParseFailed { message } => write!(f, "[NATIVE_PARSE_FAILED] {}", message),
            Self::FfiNotImplemented { feature } => {
                write!(f, "[FFI_NOT_IMPLEMENTED] feature={}", feature)
            }
            Self::SandboxDeny { message } => write!(f, "[SANDBOX_DENY] {}", message),
            Self::WhisperModelDownloading { progress } => {
                write!(f, "[WHISPER_MODEL_DOWNLOADING] progress={}", progress)
            }
            Self::ModelChecksumMismatch { name, expected, actual } => write!(
                f,
                "[MODEL_CHECKSUM_MISMATCH] name={} expected={} actual={}",
                name, expected, actual
            ),
            Self::ModelMirrorNotConfigured { hint } => {
                write!(f, "[MODEL_MIRROR_NOT_CONFIGURED] {}", hint)
            }
            Self::ModelDownloadFailed { message } => {
                write!(f, "[MODEL_DOWNLOAD_FAILED] {}", message)
            }
            Self::WebserverHandleNotFound { handle } => {
                write!(f, "[WEBSERVER_HANDLE_NOT_FOUND] handle={}", handle)
            }
            Self::TranscribeFailed { message } => {
                write!(f, "[TRANSCRIBE_FAILED] {}", message)
            }
        }
    }
}

impl std::error::Error for NativeError {}

/// 让 `#[tauri::command]` 函数可以直接以 `?` 转 `String`，
/// 错误体本身是 JSON（含 `code`），前端 `JSON.parse(err)` 即可结构化解析。
impl From<NativeError> for String {
    fn from(e: NativeError) -> Self {
        serde_json::to_string(&e).unwrap_or_else(|_| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_with_tag_code() {
        let e = NativeError::ffi_not_implemented("parse_pdf");
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"code\":\"FFI_NOT_IMPLEMENTED\""), "got {}", s);
        assert!(s.contains("\"feature\":\"parse_pdf\""), "got {}", s);
    }

    #[test]
    fn display_includes_code_prefix() {
        let e = NativeError::io_failed("disk full");
        assert!(format!("{}", e).starts_with("[NATIVE_IO_FAILED]"));
    }

    #[test]
    fn round_trip_json() {
        let cases = vec![
            NativeError::io_failed("x"),
            NativeError::unsupported("y"),
            NativeError::parse_failed("z"),
            NativeError::ffi_not_implemented("w"),
            NativeError::sandbox_deny("v"),
            NativeError::whisper_model_downloading(42),
            NativeError::model_checksum_mismatch("whisper-base-zh", "aaa", "bbb"),
            NativeError::model_mirror_not_configured("set SEVEN_MODEL_MIRROR_ORG"),
            NativeError::model_download_failed("connection reset"),
            NativeError::webserver_handle_not_found("h-xxx"),
            NativeError::transcribe_failed("audio decode failure"),
        ];
        for e in cases {
            let s = serde_json::to_string(&e).unwrap();
            let back: NativeError = serde_json::from_str(&s).unwrap();
            assert_eq!(e, back);
        }
    }

    #[test]
    fn whisper_progress_clamped_to_100() {
        let e = NativeError::whisper_model_downloading(250);
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"progress\":100"), "got {}", s);
    }

    #[test]
    fn model_mirror_not_configured_carries_hint() {
        let e = NativeError::model_mirror_not_configured("set env");
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"code\":\"MODEL_MIRROR_NOT_CONFIGURED\""));
        assert!(s.contains("\"hint\":\"set env\""));
    }
}
