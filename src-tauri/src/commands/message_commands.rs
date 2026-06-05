// src-tauri/src/commands/message_commands.rs
// Message 相关 Tauri 命令
// 对应 Task 2.2: Message 命令注册

use tauri::State;
use crate::db::connection::DbState;
use crate::db::repositories::message_repo;
use crate::db::models::message::MessageInput;

/// 创建单条消息
#[tauri::command]
pub async fn message_create(
    session_id: String,
    role: String,
    content: String,
    content_parts: Option<String>,  // JSON 字符串
    tool_calls: Option<String>,      // JSON 字符串
    tokens_used: Option<i64>,
    latency_ms: Option<i64>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let input = MessageInput {
        session_id,
        role,
        content,
        content_parts,
        tool_calls,
        tokens_used,
        latency_ms,
    };
    
    let message = message_repo::create(&conn, &input)
        .map_err(|e| e.to_string())?;
    
    // 更新会话的最后消息时间
    crate::db::repositories::session_repo::update_last_message(&conn, &message.session_id)
        .map_err(|e| e.to_string())?;
    
    Ok(message.id)
}

/// 获取会话的所有消息（按创建时间排序）
#[tauri::command]
pub async fn message_list_by_session(
    session_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let messages = message_repo::list_by_session(&conn, &session_id)
        .map_err(|e| e.to_string())?;
    
    let result: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|m| serde_json::json!({
            "id": m.id,
            "session_id": m.session_id,
            "role": m.role,
            "content": m.content,
            "content_parts": m.content_parts,
            "tool_calls": m.tool_calls,
            "tokens_used": m.tokens_used,
            "latency_ms": m.latency_ms,
            "created_at": m.created_at,
        }))
        .collect();
    
    Ok(result)
}

/// 更新消息内容（用于流式更新）
#[tauri::command]
pub async fn message_update_content(
    id: String,
    content: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    message_repo::update_content(&conn, &id, &content)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 更新消息的 tool_calls
#[tauri::command]
pub async fn message_update_tool_calls(
    id: String,
    tool_calls: String,  // JSON 字符串
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    message_repo::update_tool_calls(&conn, &id, &tool_calls)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 获取单条消息
#[tauri::command]
pub async fn message_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let message = message_repo::get_by_id(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    let result = message.map(|m| serde_json::json!({
        "id": m.id,
        "session_id": m.session_id,
        "role": m.role,
        "content": m.content,
        "content_parts": m.content_parts,
        "tool_calls": m.tool_calls,
        "tokens_used": m.tokens_used,
        "latency_ms": m.latency_ms,
        "created_at": m.created_at,
    }));
    
    Ok(result)
}

/// 删除消息（用于出错时回滚）
#[tauri::command]
pub async fn message_delete(
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    message_repo::delete(&conn, &id)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
