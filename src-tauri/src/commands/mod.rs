// Tauri command handlers — module index
//
// Architecture (see openspec/changes/arch-db-rust-only/design.md):
//   - `file_dialog` (file dialog commands, was `project`)
//   - CRUD commands live in dedicated `*_crud.rs` files
//   - All DB access goes through the `db` module (rusqlite)

pub mod browser;
pub mod diagnostics;
pub mod file_dialog;   // file dialog commands only
pub mod manifest_io;
pub mod sandbox;

// CRUD command modules (Task 20-26)
pub mod project_crud;
pub mod job_description_crud;
pub mod resume_crud;
pub mod candidate_crud;
pub mod screening_crud;
pub mod compliance_crud;
pub mod export_crud;

// Session & Message commands (Phase 2: arch-session-db-persistence)
pub mod session_commands;
pub mod message_commands;
