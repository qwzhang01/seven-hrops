// src-tauri/src/db/models/export_record.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRecord {
    pub id: String,
    pub project_id: String,
    pub format: String,
    pub file_path: Option<String>,
    pub scope: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRecordInput {
    pub project_id: String,
    pub format: String,
    pub file_path: Option<String>,
    pub scope: Option<String>,
}
