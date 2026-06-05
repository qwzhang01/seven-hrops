//! Native bridge — Phase B L0 capabilities.
//!
//! 子模块约定：
//! - `errors`：所有 native 命令共用的结构化错误码枚举（`FFI_NOT_IMPLEMENTED` 等）
//! - `fs`：通用文件系统命令（`fs_read_text` / `fs_write_text` / `fs_list_dir` /
//!   `fs_stat` / `fs_canonicalize`）；全部接收 `session_id` 并先调
//!   `sandbox::fs_guard::check_*` 强制白名单 + 审计。
//! - `parse`：通用文档解析命令（`parse_pdf` / `parse_docx` / `parse_excel`）；
//!   `parse_pdf` 在本期为 stub，B.9 通过 `ffi-real` feature 接入 pdfium-render。

pub mod errors;
pub mod export;
pub mod fs;
pub mod fs_binary;
pub mod models;
pub mod network;
pub mod parse;
pub mod transcribe;
pub mod webserver;
