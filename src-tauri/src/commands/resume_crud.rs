// src-tauri/src/commands/resume_crud.rs

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::resume_repo;
use crate::db::models::resume::ResumeInput;

#[tauri::command]
pub async fn resume_import(
    project_id: String,
    file_path: Option<String>,
    file_name: String,
    file_type: String,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = ResumeInput {
        project_id,
        file_path,
        file_name,
        file_type,
        parsed_data: None,
        parse_status: Some("pending".to_string()),
    };
    let resume = resume_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(resume.id)
}

#[tauri::command]
pub async fn resume_list(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let resumes = resume_repo::list_by_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    
    let result: Vec<serde_json::Value> = resumes
        .into_iter()
        .map(|r| serde_json::json!({
            "id": r.id,
            "project_id": r.project_id,
            "file_path": r.file_path,
            "file_name": r.file_name,
            "file_type": r.file_type,
            "parsed_data": r.parsed_data,
            "parse_status": r.parse_status,
            "created_at": r.created_at,
        }))
        .collect();
    
    Ok(result)
}

#[tauri::command]
pub async fn resume_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let resume = resume_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let result = resume.map(|r| serde_json::json!({
        "id": r.id,
        "project_id": r.project_id,
        "file_path": r.file_path,
        "file_name": r.file_name,
        "file_type": r.file_type,
        "parsed_data": r.parsed_data,
        "parse_status": r.parse_status,
        "created_at": r.created_at,
    }));
    
    Ok(result)
}

#[tauri::command]
pub async fn resume_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    resume_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn resume_update_parse_status(
    id: String,
    status: String,
    parsed_data: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    resume_repo::update_parse_status(&conn, &id, &status, parsed_data.as_deref())
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
