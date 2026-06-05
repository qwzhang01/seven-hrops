// src-tauri/src/db/repositories/session_repo.rs
// Session repository for persistent chat storage
// 会话即任务

use rusqlite::Connection;
use crate::db::models::session::{Session, SessionInput};
use uuid::Uuid;
use chrono::Utc;

/// 创建新会话
pub fn create(conn: &Connection, input: &SessionInput) -> rusqlite::Result<Session> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    
    let title = input.title.clone().unwrap_or_else(|| "新会话".to_string());
    let session_type = input.session_type.clone().unwrap_or_else(|| "normal".to_string());
    let status = input.status.clone().unwrap_or_else(|| "active".to_string());
    
    conn.execute(
        "INSERT INTO sessions (id, title, session_type, capability_id, capability_name, status, schedule_config, last_message_at, message_count, model_config, workspace_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        (
            &id,
            &title,
            &session_type,
            &input.capability_id,
            &input.capability_name,
            &status,
            &input.schedule_config,
            &None::<String>,
            &0i64,
            &input.model_config,
            &input.workspace_id,
            &now,
            &now,
        ),
    )?;

    Ok(Session {
        id,
        title,
        session_type,
        capability_id: input.capability_id.clone(),
        capability_name: input.capability_name.clone(),
        status,
        schedule_config: input.schedule_config.clone(),
        last_message_at: None,
        message_count: 0,
        model_config: input.model_config.clone(),
        workspace_id: input.workspace_id.clone(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 根据 ID 获取会话
pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Session>> {
    conn.query_row(
        "SELECT id, title, session_type, capability_id, capability_name, status, schedule_config, last_message_at, message_count, model_config, workspace_id, created_at, updated_at
         FROM sessions WHERE id = ? AND status != 'deleted'",
        [id],
        |row| {
            Ok(Session {
                id: row.get(0)?,
                title: row.get(1)?,
                session_type: row.get(2)?,
                capability_id: row.get(3)?,
                capability_name: row.get(4)?,
                status: row.get(5)?,
                schedule_config: row.get(6)?,
                last_message_at: row.get(7)?,
                message_count: row.get(8)?,
                model_config: row.get(9)?,
                workspace_id: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
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

/// 分页列出会话（不包括已删除的）
pub fn list_paginated(conn: &Connection, page: i64, page_size: i64) -> rusqlite::Result<Vec<Session>> {
    let offset = (page - 1) * page_size;
    let mut stmt = conn.prepare(
        "SELECT id, title, session_type, capability_id, capability_name, status, schedule_config, last_message_at, message_count, model_config, workspace_id, created_at, updated_at
         FROM sessions 
         WHERE status != 'deleted'
         ORDER BY last_message_at DESC NULLS LAST, created_at DESC
         LIMIT ?1 OFFSET ?2"
    )?;
    
    let result_iter = stmt.query_map([page_size, offset], |row| {
        Ok(Session {
            id: row.get(0)?,
            title: row.get(1)?,
            session_type: row.get(2)?,
            capability_id: row.get(3)?,
            capability_name: row.get(4)?,
            status: row.get(5)?,
            schedule_config: row.get(6)?,
            last_message_at: row.get(7)?,
            message_count: row.get(8)?,
            model_config: row.get(9)?,
            workspace_id: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    })?;
    
    result_iter.collect()
}

/// 获取总会话数（不包括已删除的）
pub fn count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM sessions WHERE status != 'deleted'",
        [],
        |row| row.get(0),
    )
}

/// 更新会话标题
pub fn update_title(conn: &Connection, id: &str, title: &str) -> rusqlite::Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
        (title, &now, id),
    )?;
    Ok(())
}

/// 更新会话状态（软删除：设置为 'deleted'）
pub fn update_status(conn: &Connection, id: &str, status: &str) -> rusqlite::Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE sessions SET status = ?1, updated_at = ?2 WHERE id = ?3",
        (status, &now, id),
    )?;
    Ok(())
}

/// 软删除会话（设置为 deleted 状态）
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    update_status(conn, id, "deleted")
}

/// 更新最后消息时间（发送消息时调用）
pub fn update_last_message(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE sessions SET last_message_at = ?1, message_count = message_count + 1, updated_at = ?2 WHERE id = ?3",
        (&now, &now, id),
    )?;
    Ok(())
}

/// 减少消息计数（删除消息时调用）
pub fn decrement_message_count(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE sessions SET message_count = MAX(0, message_count - 1), updated_at = ?1 WHERE id = ?2",
        (&now, id),
    )?;
    Ok(())
}

/// 绑定 workspace 到会话（持久化 session-workspace 关联）
///
/// Called after creating a workspace for a session with needsWorkspace: true.
/// Updates the workspace_id column in the sessions table.
///
/// Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D5
pub fn bind_workspace(conn: &Connection, session_id: &str, workspace_id: &str) -> rusqlite::Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE sessions SET workspace_id = ?1, updated_at = ?2 WHERE id = ?3",
        (workspace_id, &now, session_id),
    )?;
    Ok(())
}

/// 获取会话绑定的 workspace_id
///
/// Returns None if the session has no workspace binding.
pub fn get_workspace_id(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT workspace_id FROM sessions WHERE id = ? AND status != 'deleted'",
        [session_id],
        |row| row.get(0),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_connection;
    
    /// 为测试创建内存数据库连接
    fn get_test_connection() -> rusqlite::Connection {
        let conn = open_connection(std::path::Path::new(":memory:")).unwrap();
        // 运行迁移以创建表
        crate::db::migrations::run_migrations(&conn).unwrap();
        conn
    }
    
    #[test]
    fn test_create_and_get_session() {
        let conn = get_test_connection();
        let input = SessionInput {
            title: Some("测试会话".to_string()),
            session_type: Some("normal".to_string()),
            capability_id: None,
            capability_name: None,
            status: Some("active".to_string()),
            schedule_config: None,
            model_config: None,
        };
        
        let session = create(&conn, &input).unwrap();
        assert_eq!(session.title, "测试会话");
        assert_eq!(session.session_type, "normal");
        assert_eq!(session.status, "active");
        
        let fetched = get_by_id(&conn, &session.id).unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().title, "测试会话");
    }
    
    #[test]
    fn test_update_title() {
        let conn = get_test_connection();
        let input = SessionInput {
            title: Some("原始标题".to_string()),
            session_type: None,
            capability_id: None,
            capability_name: None,
            status: None,
            schedule_config: None,
            model_config: None,
        };
        
        let session = create(&conn, &input).unwrap();
        update_title(&conn, &session.id, "新标题").unwrap();
        
        let fetched = get_by_id(&conn, &session.id).unwrap().unwrap();
        assert_eq!(fetched.title, "新标题");
    }
    
    #[test]
    fn test_soft_delete_session() {
        let conn = get_test_connection();
        let input = SessionInput {
            title: Some("待删除会话".to_string()),
            session_type: None,
            capability_id: None,
            capability_name: None,
            status: None,
            schedule_config: None,
            model_config: None,
        };
        
        let session = create(&conn, &input).unwrap();
        delete(&conn, &session.id).unwrap();
        
        // 软删除后应该获取不到
        let fetched = get_by_id(&conn, &session.id).unwrap();
        assert!(fetched.is_none());
    }
    
    #[test]
    fn test_count_sessions() {
        let conn = get_test_connection();
        let initial_count = count(&conn).unwrap();
        
        let input = SessionInput {
            title: Some("计数测试".to_string()),
            session_type: None,
            capability_id: None,
            capability_name: None,
            status: None,
            schedule_config: None,
            model_config: None,
        };
        
        create(&conn, &input).unwrap();
        let new_count = count(&conn).unwrap();
        assert_eq!(new_count, initial_count + 1);
    }
}
