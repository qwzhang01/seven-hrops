// Database module for SQLite operations
//
// Architecture (see openspec/changes/arch-db-rust-only/design.md):
//   - `connection`   — opening the DB, PRAGMAs, Tauri managed state
//   - `models`      — Rust structs that mirror the SQLite tables
//   - `migrations`  — versioned DDL scripts (user_version-based)
//   - `repositories` — CRUD helpers for each table

pub mod connection;
pub mod models;
pub mod migrations;
pub mod repositories;
