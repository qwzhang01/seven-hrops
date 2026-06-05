// src-tauri/src/db/models/screening_result.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningResult {
    pub id: String,
    pub project_id: String,
    pub candidate_id: String,
    pub score: Option<i64>,
    pub dimensions: Option<String>,
    pub reasoning: Option<String>,
    pub level: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub shortlisted: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningResultInput {
    pub project_id: String,
    pub candidate_id: String,
    pub score: Option<i64>,
    pub dimensions: Option<String>,
    pub reasoning: Option<String>,
    pub level: Option<String>,
    pub status: Option<String>,
    pub notes: Option<String>,
    pub shortlisted: Option<bool>,
}
