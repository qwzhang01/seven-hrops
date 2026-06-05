-- 003_sessions_and_messages.sql
--
-- Session & Message tables for persistent chat storage
-- Sessions = Tasks (会话即任务)
-- Source: arch-session-db-persistence change
-- Idempotent: all CREATE TABLE are IF NOT EXISTS.

-- 1. sessions 表（会话即任务）
CREATE TABLE IF NOT EXISTS `sessions` (
    `id` text PRIMARY KEY NOT NULL,
    `title` text NOT NULL DEFAULT '新会话',
    `session_type` text NOT NULL DEFAULT 'normal' CHECK(`session_type` IN ('normal', 'scheduled')),
    `capability_id` text,
    `capability_name` text,
    `workspace_id` text,
    `status` text NOT NULL DEFAULT 'active' CHECK(`status` IN ('active', 'archived', 'deleted')),
    `schedule_config` text,  -- JSON，定时任务配置（未来使用）
    `last_message_at` text,
    `message_count` integer NOT NULL DEFAULT 0,
    `model_config` text,  -- JSON: {providerID, modelID, baseURL}
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    `updated_at` text DEFAULT (datetime('now')) NOT NULL);

-- 2. messages 表
CREATE TABLE IF NOT EXISTS `messages` (
    `id` text PRIMARY KEY NOT NULL,
    `session_id` text NOT NULL,
    `role` text NOT NULL CHECK(`role` IN ('user', 'assistant', 'system')),
    `content` text NOT NULL,
    `content_parts` text,  -- JSON，多模态内容
    `tool_calls` text,  -- JSON，工具调用记录
    `tokens_used` integer,
    `latency_ms` integer,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS `idx_sessions_status` ON `sessions`(`status`);
CREATE INDEX IF NOT EXISTS `idx_sessions_created_at` ON `sessions`(`created_at` DESC);
CREATE INDEX IF NOT EXISTS `idx_sessions_last_message` ON `sessions`(`last_message_at` DESC);
CREATE INDEX IF NOT EXISTS `idx_sessions_capability` ON `sessions`(`capability_id`);
CREATE INDEX IF NOT EXISTS `idx_messages_session_id` ON `messages`(`session_id`);
CREATE INDEX IF NOT EXISTS `idx_messages_created_at` ON `messages`(`created_at`);
CREATE INDEX IF NOT EXISTS `idx_sessions_workspace_id` ON `sessions`(`workspace_id`);