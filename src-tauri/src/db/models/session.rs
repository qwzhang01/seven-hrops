// src-tauri/src/db/models/session.rs
// Session model for persistent chat storage
// 会话即任务

use serde::{Deserialize, Serialize};

/// Session 会话（即任务）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub session_type: String,  // 'normal' | 'scheduled'
    pub capability_id: Option<String>,
    pub capability_name: Option<String>,
    pub status: String,  // 'active' | 'archived' | 'deleted'
    pub schedule_config: Option<String>,  // JSON
    pub last_message_at: Option<String>,
    pub message_count: i64,
    pub model_config: Option<String>,  // JSON: {providerID, modelID, baseURL}
    /// Workspace bound to this session.
    /// Set when capability.needsWorkspace == true.
    /// Stored in sessions.workspace_id column.
    /// See: openspec/changes/use_def/session-workspace-binding
    pub workspace_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// SessionInput 创建/更新会话的输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInput {
    pub title: Option<String>,
    pub session_type: Option<String>,
    pub capability_id: Option<String>,
    pub capability_name: Option<String>,
    pub status: Option<String>,
    pub schedule_config: Option<String>,
    pub model_config: Option<String>,
    /// Optional workspace_id to bind at creation time.
    /// When set, the session will be permanently bound to this workspace.
    pub workspace_id: Option<String>,
}
