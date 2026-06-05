// src-tauri/src/commands/session_commands.rs
// Session 相关 Tauri 命令
// 对应 Task 2.1: Session 命令注册

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::session_repo;
use crate::db::models::session::SessionInput;

/// 创建新会话
/// 
/// 可选参数 workspace_id：创建时绑定工作空间
#[tauri::command]
pub async fn session_create(
    capability_id: Option<String>,
    capability_name: Option<String>,
    // Optional workspace_id to bind at creation time.
    // Passed by sessionStore.createSession after creating the workspace.
    // See: openspec/changes/use_def/session-workspace-binding
    workspace_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = SessionInput {
        title: Some("新会话".to_string()),
        session_type: Some("normal".to_string()),
        capability_id,
        capability_name,
        status: Some("active".to_string()),
        schedule_config: None,
        model_config: None,
        workspace_id,
    };
    
    let session = session_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    Ok(session.id)
}

/// 绑定 workspace 到已有会话
///
/// Called after lazily creating a workspace for an already-created session,
/// or when re-binding a session to a different workspace.
///
/// Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D5
#[tauri::command]
pub async fn session_bind_workspace(
    session_id: String,
    workspace_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    session_repo::bind_workspace(&conn, &session_id, &workspace_id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 获取单个会话
#[tauri::command]
pub async fn session_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let session = session_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let result = session.map(|s| serde_json::json!({
        "id": s.id,
        "title": s.title,
        "session_type": s.session_type,
        "capability_id": s.capability_id,
        "capability_name": s.capability_name,
        "status": s.status,
        "last_message_at": s.last_message_at,
        "message_count": s.message_count,
        "model_config": s.model_config,
        "workspace_id": s.workspace_id,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }));
    
    Ok(result)
}

/// 分页列出会话（不包括已删除的）
#[tauri::command]
pub async fn session_list(
    page: i64,
    page_size: i64,
    _status: Option<String>,  // 保留参数用于未来扩展
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let sessions = session_repo::list_paginated(&conn, page, page_size)
        .map_err(|e| e.to_string())?;
    
    let total = session_repo::count(&conn)
        .map_err(|e| e.to_string())?;
    
    let items: Vec<serde_json::Value> = sessions
        .into_iter()
        .map(|s| serde_json::json!({
            "id": s.id,
            "title": s.title,
            "session_type": s.session_type,
            "capability_id": s.capability_id,
            "capability_name": s.capability_name,
            "status": s.status,
            "last_message_at": s.last_message_at,
            "message_count": s.message_count,
            "workspace_id": s.workspace_id,
            "created_at": s.created_at,
            "updated_at": s.updated_at,
        }))
        .collect();
    
    Ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }))
}

/// 更新会话标题
#[tauri::command]
pub async fn session_update_title(
    id: String,
    title: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    session_repo::update_title(&conn, &id, &title)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 更新会话的 model_config
#[tauri::command]
pub async fn session_update_model_config(
    id: String,
    model_config: String,  // JSON 字符串
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // 直接更新数据库中的 model_config 字段
    conn.execute(
        "UPDATE sessions SET model_config = ?1, updated_at = ?2 WHERE id = ?3",
        (&model_config, &chrono::Utc::now().to_rfc3339(), &id),
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 软删除会话（设置 status = 'deleted'）
#[tauri::command]
pub async fn session_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    session_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 获取会话总数（用于分页）
#[tauri::command]
pub async fn session_count(
    _status: Option<String>,  // 保留参数用于未来扩展
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let count = session_repo::count(&conn)
        .map_err(|e| e.to_string())?;
    
    Ok(count)
}

/// 更新会话最后消息时间（内部使用）
#[tauri::command]
pub async fn session_update_last_message(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    session_repo::update_last_message(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
