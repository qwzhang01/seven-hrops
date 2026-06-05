// src-tauri/src/db/repositories/message_repo.rs
// Message repository for persistent chat storage

use rusqlite::Connection;
use crate::db::models::message::{Message, MessageInput};
use uuid::Uuid;
use chrono::Utc;

/// 创建新消息
pub fn create(conn: &Connection, input: &MessageInput) -> rusqlite::Result<Message> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, content_parts, tool_calls, tokens_used, latency_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        (
            &id,
            &input.session_id,
            &input.role,
            &input.content,
            &input.content_parts,
            &input.tool_calls,
            &input.tokens_used,
            &input.latency_ms,
            &now,
        ),
    )?;
    
    // 更新会话的最后消息时间和消息计数
    super::session_repo::update_last_message(conn, &input.session_id)?;
    
    Ok(Message {
        id,
        session_id: input.session_id.clone(),
        role: input.role.clone(),
        content: input.content.clone(),
        content_parts: input.content_parts.clone(),
        tool_calls: input.tool_calls.clone(),
        tokens_used: input.tokens_used,
        latency_ms: input.latency_ms,
        created_at: now,
    })
}

/// 根据 ID 获取消息
pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Message>> {
    conn.query_row(
        "SELECT id, session_id, role, content, content_parts, tool_calls, tokens_used, latency_ms, created_at
         FROM messages WHERE id = ?",
        [id],
        |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                content_parts: row.get(4)?,
                tool_calls: row.get(5)?,
                tokens_used: row.get(6)?,
                latency_ms: row.get(7)?,
                created_at: row.get(8)?,
            })
        },
    )
    .map(Some)
    .or_else(|e| {
        if e == rusqlite::Error::QueryReturnedNoRows {
            Ok(None)
        } else {
            Err(e)
        }
    })
}

/// 获取会话的所有消息（按时间升序）
pub fn list_by_session(conn: &Connection, session_id: &str) -> rusqlite::Result<Vec<Message>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, content_parts, tool_calls, tokens_used, latency_ms, created_at
         FROM messages 
         WHERE session_id = ?
         ORDER BY created_at ASC"
    )?;
    
    let result_iter = stmt.query_map([session_id], |row| {
        Ok(Message {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            content_parts: row.get(4)?,
            tool_calls: row.get(5)?,
            tokens_used: row.get(6)?,
            latency_ms: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    
    result_iter.collect()
}

/// 更新消息内容（用于流式更新）
pub fn update_content(conn: &Connection, id: &str, content: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE messages SET content = ?1 WHERE id = ?2",
        (content, id),
    )?;
    Ok(())
}

/// 更新消息的 tool_calls
pub fn update_tool_calls(conn: &Connection, id: &str, tool_calls: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE messages SET tool_calls = ?1 WHERE id = ?2",
        (tool_calls, id),
    )?;
    Ok(())
}

/// 删除消息
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    // 先获取消息的 session_id，用于更新计数
    let session_id: Option<String> = conn.query_row(
        "SELECT session_id FROM messages WHERE id = ?",
        [id],
        |row| row.get(0),
    ).ok();
    
    conn.execute(
        "DELETE FROM messages WHERE id = ?1",
        [id],
    )?;
    
    // 减少会话的消息计数
    if let Some(sid) = session_id {
        super::session_repo::decrement_message_count(conn, &sid)?;
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_connection;
    use crate::db::repositories::session_repo;
    
    /// 为测试创建内存数据库连接
    fn get_test_connection() -> rusqlite::Connection {
        let conn = open_connection(std::path::Path::new(":memory:")).unwrap();
        // 运行迁移以创建表
        crate::db::migrations::run_migrations(&conn).unwrap();
        conn
    }
    
    #[test]
    fn test_create_and_get_message() {
        let conn = get_test_connection();
        
        // 先创建一个会话
        let session_input = crate::db::models::session::SessionInput {
            title: Some("测试会话".to_string()),
            session_type: None,
            capability_id: None,
            capability_name: None,
            status: None,
            schedule_config: None,
            model_config: None,
        };
        let session = session_repo::create(&conn, &session_input).unwrap();
        
        // 创建一条用户消息
        let msg_input = MessageInput {
            session_id: session.id.clone(),
            role: "user".to_string(),
            content: "你好".to_string(),
            content_parts: None,
            tool_calls: None,
            tokens_used: None,
            latency_ms: None,
        };
        
        let msg = create(&conn, &msg_input).unwrap();
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "你好");
        assert_eq!(msg.session_id, session.id);
        
        let fetched = get_by_id(&conn, &msg.id).unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().content, "你好");
    }
    
    #[test]
    fn test_list_by_session() {
        let conn = get_test_connection();
        
        // 创建一个会话
        let session_input = crate::db::models::session::SessionInput {
            title: Some("列表测试".to_string()),
            session_type: None,
            capability_id: None,
            capability_name: None,
            status: None,
            schedule_config: None,
            model_config: None,
        };
        let session = session_repo::create(&conn, &session_input).unwrap();
        
        // 创建两条消息
        let msg1 = MessageInput {
            session_id: session.id.clone(),
            role: "user".to_string(),
            content: "第一条".to_string(),
            content_parts: None,
            tool_calls: None,
            tokens_used: None,
            latency_ms: None,
        };
        let msg2 = MessageInput {
            session_id: session.id.clone(),
            role: "assistant".to_string(),
            content: "第二条".to_string(),
            content_parts: None,
            tool_calls: None,
            tokens_used: None,
            latency_ms: None,
        };
        
        create(&conn, &msg1).unwrap();
        create(&conn, &msg2).unwrap();
        
        let messages = list_by_session(&conn, &session.id).unwrap();
        assert_eq!(messages.len(), 2);
        // 按时间升序，第一条应该是 "user"
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].role, "assistant");
    }
    
    #[test]
    fn test_update_content() {
        let conn = get_test_connection();
        
        let session_input = crate::db::models::session::SessionInput {
            title: Some("更新测试".to_string()),
            session_type: None,
            capability_id: None,
            capability_name: None,
            status: None,
            schedule_config: None,
            model_config: None,
        };
        let session = session_repo::create(&conn, &session_input).unwrap();
        
        let msg_input = MessageInput {
            session_id: session.id.clone(),
            role: "assistant".to_string(),
            content: "原始内容".to_string(),
            content_parts: None,
            tool_calls: None,
            tokens_used: None,
            latency_ms: None,
        };
        
        let msg = create(&conn, &msg_input).unwrap();
        update_content(&conn, &msg.id, "更新后的内容").unwrap();
        
        let fetched = get_by_id(&conn, &msg.id).unwrap().unwrap();
        assert_eq!(fetched.content, "更新后的内容");
    }
}
