// src-tauri/src/commands/screening_crud.rs

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::screening_result_repo;
use crate::db::models::screening_result::ScreeningResultInput;

#[tauri::command]
pub async fn screening_save(
    project_id: String,
    candidate_id: String,
    score: Option<i64>,
    dimensions: Option<String>,
    reasoning: Option<String>,
    level: Option<String>,
    status: Option<String>,
    notes: Option<String>,
    shortlisted: Option<bool>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = ScreeningResultInput {
        project_id,
        candidate_id,
        score,
        dimensions,
        reasoning,
        level,
        status,
        notes,
        shortlisted,
    };
    let result = screening_result_repo::save(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(result.id)
}

#[tauri::command]
pub async fn screening_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let result = screening_result_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let value = result.map(|s| serde_json::json!({
        "id": s.id,
        "project_id": s.project_id,
        "candidate_id": s.candidate_id,
        "score": s.score,
        "dimensions": s.dimensions,
        "reasoning": s.reasoning,
        "level": s.level,
        "status": s.status,
        "notes": s.notes,
        "shortlisted": s.shortlisted,
        "created_at": s.created_at,
    }));
    
    Ok(value)
}

#[tauri::command]
pub async fn screening_list(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let results = screening_result_repo::list_by_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    
    let value: Vec<serde_json::Value> = results
        .into_iter()
        .map(|s| serde_json::json!({
            "id": s.id,
            "project_id": s.project_id,
            "candidate_id": s.candidate_id,
            "score": s.score,
            "dimensions": s.dimensions,
            "reasoning": s.reasoning,
            "level": s.level,
            "status": s.status,
            "notes": s.notes,
            "shortlisted": s.shortlisted,
            "created_at": s.created_at,
        }))
        .collect();
    
    Ok(value)
}

#[tauri::command]
pub async fn screening_update_note(
    id: String,
    notes: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    screening_result_repo::update_note(&conn, &id, &notes)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn screening_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    screening_result_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
