// src-tauri/src/db/models/compliance_result.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceResult {
    pub id: String,
    pub resume_id: Option<String>,
    pub jd_id: Option<String>,
    pub issues: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceResultInput {
    pub resume_id: Option<String>,
    pub jd_id: Option<String>,
    pub issues: Option<String>,
    pub status: Option<String>,
}
