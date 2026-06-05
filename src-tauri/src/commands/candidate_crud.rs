// src-tauri/src/commands/candidate_crud.rs

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::candidate_repo;
use crate::db::models::candidate::CandidateInput;

#[tauri::command]
pub async fn candidate_create(
    resume_id: Option<String>,
    project_id: String,
    name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    summary: Option<String>,
    skills: Option<String>,
    experience: Option<String>,
    education: Option<String>,
    status: Option<String>,
    source: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = CandidateInput {
        resume_id,
        project_id,
        name,
        phone,
        email,
        skills,
        experience,
        education,
        summary,
        status,
        source,
    };
    let candidate = candidate_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(candidate.id)
}

#[tauri::command]
pub async fn candidate_list(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let candidates = candidate_repo::list_by_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    
    let result: Vec<serde_json::Value> = candidates
        .into_iter()
        .map(|c| serde_json::json!({
            "id": c.id,
            "resume_id": c.resume_id,
            "project_id": c.project_id,
            "name": c.name,
            "phone": c.phone,
            "email": c.email,
            "summary": c.summary,
            "skills": c.skills,
            "experience": c.experience,
            "education": c.education,
            "status": c.status,
            "source": c.source,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }))
        .collect();
    
    Ok(result)
}

#[tauri::command]
pub async fn candidate_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let candidate = candidate_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let result = candidate.map(|c| serde_json::json!({
        "id": c.id,
        "resume_id": c.resume_id,
        "project_id": c.project_id,
        "name": c.name,
        "phone": c.phone,
        "email": c.email,
        "summary": c.summary,
        "skills": c.skills,
        "experience": c.experience,
        "education": c.education,
        "status": c.status,
        "source": c.source,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }));
    
    Ok(result)
}

#[tauri::command]
pub async fn candidate_update(
    id: String,
    name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    summary: Option<String>,
    skills: Option<String>,
    experience: Option<String>,
    education: Option<String>,
    status: Option<String>,
    source: Option<String>,
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = CandidateInput {
        resume_id: None,
        project_id: String::new(),
        name,
        phone,
        email,
        summary,
        skills,
        experience,
        education,
        status,
        source,
    };
    let candidate = candidate_repo::update(&conn, &id, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "id": candidate.id,
        "resume_id": candidate.resume_id,
        "project_id": candidate.project_id,
        "name": candidate.name,
        "phone": candidate.phone,
        "email": candidate.email,
        "summary": candidate.summary,
        "skills": candidate.skills,
        "experience": candidate.experience,
        "education": candidate.education,
        "status": candidate.status,
        "source": candidate.source,
        "created_at": candidate.created_at,
        "updated_at": candidate.updated_at,
    }))
}

#[tauri::command]
pub async fn candidate_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    candidate_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
