// src-tauri/src/db/models/candidate.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub id: String,
    pub resume_id: Option<String>,
    pub project_id: String,
    pub name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub summary: Option<String>,
    pub skills: Option<String>,
    pub experience: Option<String>,
    pub education: Option<String>,
    pub status: String,
    pub source: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateInput {
    pub resume_id: Option<String>,
    pub project_id: String,
    pub name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub summary: Option<String>,
    pub skills: Option<String>,
    pub experience: Option<String>,
    pub education: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
}
