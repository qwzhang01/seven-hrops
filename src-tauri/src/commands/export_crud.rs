// src-tauri/src/commands/export_crud.rs

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::export_record_repo;
use crate::db::models::export_record::ExportRecordInput;

#[tauri::command]
pub async fn export_create(
    project_id: String,
    format: String,
    file_path: Option<String>,
    scope: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = ExportRecordInput {
        project_id,
        format,
        file_path,
        scope,
    };
    let record = export_record_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(record.id)
}

#[tauri::command]
pub async fn export_list(
    project_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let records = export_record_repo::list(&conn, project_id.as_deref())
        .map_err(|e| e.to_string())?;
    
    let value: Vec<serde_json::Value> = records
        .into_iter()
        .map(|r| serde_json::json!({
            "id": r.id,
            "project_id": r.project_id,
            "format": r.format,
            "file_path": r.file_path,
            "scope": r.scope,
            "created_at": r.created_at,
        }))
        .collect();
    
    Ok(value)
}

#[tauri::command]
pub async fn export_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let record = export_record_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let value = record.map(|r| serde_json::json!({
        "id": r.id,
        "project_id": r.project_id,
        "format": r.format,
        "file_path": r.file_path,
        "scope": r.scope,
        "created_at": r.created_at,
    }));
    
    Ok(value)
}

#[tauri::command]
pub async fn export_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    export_record_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

// Event log commands

#[tauri::command]
pub async fn event_log_create(
    event_type: String,
    payload: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = crate::db::models::event_log::EventLogInput {
        event_type,
        payload,
    };
    let log = crate::db::repositories::event_log_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(log.id)
}

#[tauri::command]
pub async fn event_log_list(
    project_id: Option<String>,
    event_type: Option<String>,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let logs = crate::db::repositories::event_log_repo::list(&conn, project_id.as_deref(), event_type.as_deref(), limit)
        .map_err(|e| e.to_string())?;
    
    let value: Vec<serde_json::Value> = logs
        .into_iter()
        .map(|l| serde_json::json!({
            "id": l.id,
            "event_type": l.event_type,
            "payload": l.payload,
            "created_at": l.created_at,
        }))
        .collect();
    
    Ok(value)
}
