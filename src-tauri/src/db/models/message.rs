// src-tauri/src/db/models/message.rs
// Message model for persistent chat storage

use serde::{Deserialize, Serialize};

/// Message 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,  // 'user' | 'assistant' | 'system'
    pub content: String,
    pub content_parts: Option<String>,  // JSON，多模态内容
    pub tool_calls: Option<String>,  // JSON，工具调用记录
    pub tokens_used: Option<i64>,
    pub latency_ms: Option<i64>,
    pub created_at: String,
}

/// MessageInput 创建消息的输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageInput {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub content_parts: Option<String>,
    pub tool_calls: Option<String>,
    pub tokens_used: Option<i64>,
    pub latency_ms: Option<i64>,
}
