// src-tauri/src/commands/project_crud.rs

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::project_repo;
use crate::db::models::project::ProjectInput;

#[tauri::command]
pub async fn project_create(
    name: String,
    task_type: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = ProjectInput { name: Some(name), task_type };
    let project = project_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(project.id)
}

#[tauri::command]
pub async fn project_list(
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let projects = project_repo::list(&conn)
        .map_err(|e| e.to_string())?;
    
    let result: Vec<serde_json::Value> = projects
        .into_iter()
        .map(|p| serde_json::json!({
            "id": p.id,
            "name": p.name,
            "task_type": p.task_type,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
        }))
        .collect();
    
    Ok(result)
}

#[tauri::command]
pub async fn project_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let project = project_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let result = project.map(|p| serde_json::json!({
        "id": p.id,
        "name": p.name,
        "task_type": p.task_type,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }));
    
    Ok(result)
}

#[tauri::command]
pub async fn project_update(
    id: String,
    name: Option<String>,
    task_type: Option<String>,
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = ProjectInput { name, task_type };
    let project = project_repo::update(&conn, &id, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "id": project.id,
        "name": project.name,
        "task_type": project.task_type,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }))
}

#[tauri::command]
pub async fn project_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    project_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
