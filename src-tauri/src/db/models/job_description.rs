// src-tauri/src/db/models/job_description.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobDescription {
    pub id: String,
    pub project_id: String,
    pub raw_text: Option<String>,
    pub parsed_data: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobDescriptionInput {
    pub project_id: String,
    pub raw_text: Option<String>,
    pub parsed_data: Option<String>,
    pub status: Option<String>,
}
