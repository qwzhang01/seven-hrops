// repositories/mod.rs — Unified export for all DB repository modules
//
// Each repository module maps 1-to-1 to a SQLite table
// and provides typed CRUD helpers built on `rusqlite`.

pub mod project_repo;
pub mod job_description_repo;
pub mod resume_repo;
pub mod candidate_repo;
pub mod screening_result_repo;
pub mod compliance_result_repo;
pub mod export_record_repo;
pub mod event_log_repo;
pub mod session_repo;
pub mod message_repo;
