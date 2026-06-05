// src-tauri/src/commands/job_description_crud.rs

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::job_description_repo;
use crate::db::models::job_description::JobDescriptionInput;

#[tauri::command]
pub async fn jd_create(
    project_id: String,
    raw_text: Option<String>,
    parsed_data: Option<String>,
    status: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = JobDescriptionInput {
        project_id,
        raw_text,
        parsed_data,
        status,
    };
    let jd = job_description_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(jd.id)
}

#[tauri::command]
pub async fn jd_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let jd = job_description_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let result = jd.map(|j| serde_json::json!({
        "id": j.id,
        "project_id": j.project_id,
        "raw_text": j.raw_text,
        "parsed_data": j.parsed_data,
        "status": j.status,
        "created_at": j.created_at,
    }));
    
    Ok(result)
}

#[tauri::command]
pub async fn jd_update(
    id: String,
    raw_text: Option<String>,
    parsed_data: Option<String>,
    status: Option<String>,
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = JobDescriptionInput {
        project_id: String::new(), // not used in update
        raw_text,
        parsed_data,
        status,
    };
    let jd = job_description_repo::update(&conn, &id, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "id": jd.id,
        "project_id": jd.project_id,
        "raw_text": jd.raw_text,
        "parsed_data": jd.parsed_data,
        "status": jd.status,
        "created_at": jd.created_at,
    }))
}

#[tauri::command]
pub async fn jd_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    job_description_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn jd_list_by_project(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let jds = job_description_repo::list_by_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    
    let result: Vec<serde_json::Value> = jds
        .into_iter()
        .map(|j| serde_json::json!({
            "id": j.id,
            "project_id": j.project_id,
            "raw_text": j.raw_text,
            "parsed_data": j.parsed_data,
            "status": j.status,
            "created_at": j.created_at,
        }))
        .collect();
    
    Ok(result)
}
