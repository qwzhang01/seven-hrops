// src-tauri/src/commands/compliance_crud.rs

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::compliance_result_repo;
use crate::db::models::compliance_result::ComplianceResultInput;

#[tauri::command]
pub async fn compliance_check(
    resume_id: Option<String>,
    jd_id: Option<String>,
    issues: Option<String>,
    status: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = ComplianceResultInput {
        resume_id,
        jd_id,
        issues,
        status,
    };
    let result = compliance_result_repo::save(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(result.id)
}

#[tauri::command]
pub async fn compliance_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let result = compliance_result_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let value = result.map(|c| serde_json::json!({
        "id": c.id,
        "resume_id": c.resume_id,
        "jd_id": c.jd_id,
        "issues": c.issues,
        "status": c.status,
        "created_at": c.created_at,
    }));
    
    Ok(value)
}

#[tauri::command]
pub async fn compliance_list(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let results = compliance_result_repo::list_by_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    
    let value: Vec<serde_json::Value> = results
        .into_iter()
        .map(|c| serde_json::json!({
            "id": c.id,
            "resume_id": c.resume_id,
            "jd_id": c.jd_id,
            "issues": c.issues,
            "status": c.status,
            "created_at": c.created_at,
        }))
        .collect();
    
    Ok(value)
}

#[tauri::command]
pub async fn compliance_update(
    id: String,
    issues: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    compliance_result_repo::update_note(&conn, &id, &issues)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn compliance_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    compliance_result_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
