// src-tauri/src/db/models/resume.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resume {
    pub id: String,
    pub project_id: String,
    pub file_path: Option<String>,
    pub file_name: String,
    pub file_type: String,
    pub parsed_data: Option<String>,
    pub parse_status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeInput {
    pub project_id: String,
    pub file_path: Option<String>,
    pub file_name: String,
    pub file_type: String,
    pub parsed_data: Option<String>,
    pub parse_status: Option<String>,
}
