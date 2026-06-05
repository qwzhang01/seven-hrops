// services/db.ts — API contract layer between TypeScript and Rust
//
// All database access is now handled by the Rust side (`src-tauri/src/db/`).
// This module provides typed `invoke()` wrappers for every Tauri command
// that reads or writes the SQLite database.
//
// Design rationale: see openspec/changes/arch-db-rust-only/design.md
//   - TS never opens the database file directly.
//   - Every DB operation goes through a named Tauri command.
//   - Types here mirror the Rust structs in `db/models/`.
//   - `@tauri-apps/plugin-sql` is no longer used.

import { invoke } from '@tauri-apps/api/core';

// ─── Types mirroring `src-tauri/src/db/models/` ────────────────────

export interface Project {
  id: string;
  name: string;
  task_type: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectInput {
  name: string;
  task_type?: string;
}

export interface JobDescription {
  id: string;
  project_id: string;
  raw_text?: string;
  parsed_data?: string; // JSON string
  status: string;
  created_at: string;
}

export interface JobDescriptionInput {
  project_id: string;
  raw_text?: string;
  parsed_data?: string;
  status?: string;
}

export interface Resume {
  id: string;
  project_id: string;
  file_path?: string;
  file_name: string;
  file_type: string;
  parsed_data?: string; // JSON string
  parse_status: string;
  created_at: string;
}

export interface ResumeInput {
  project_id: string;
  file_path?: string;
  file_name: string;
  file_type: string;
  parsed_data?: string;
  parse_status?: string;
}

export interface Candidate {
  id: string;
  resume_id?: string;
  project_id: string;
  name?: string;
  phone?: string;
  email?: string;
  summary?: string;
  skills?: string;     // JSON string
  experience?: string;  // JSON string
  education?: string;   // JSON string
  status: string;
  source?: string;
  created_at: string;
  updated_at: string;
}

export interface CandidateInput {
  resume_id?: string;
  project_id: string;
  name?: string;
  phone?: string;
  email?: string;
  summary?: string;
  skills?: string;
  experience?: string;
  education?: string;
  status?: string;
  source?: string;
}

export interface ScreeningResult {
  id: string;
  project_id: string;
  candidate_id: string;
  score?: number;
  dimensions?: string; // JSON string
  reasoning?: string;
  level?: string;
  status: string;
  notes?: string;
  shortlisted: boolean;
  created_at: string;
}

export interface ScreeningResultInput {
  project_id: string;
  candidate_id: string;
  score?: number;
  dimensions?: string;
  reasoning?: string;
  level?: string;
  status?: string;
  notes?: string;
  shortlisted?: boolean;
}

export interface ComplianceResult {
  id: string;
  resume_id?: string;
  jd_id?: string;
  issues?: string; // JSON string
  status: string;
  created_at: string;
}

export interface ComplianceResultInput {
  resume_id?: string;
  jd_id?: string;
  issues?: string;
  status?: string;
}

export interface ExportRecord {
  id: string;
  project_id: string;
  format: string;
  file_path?: string;
  scope: string;
  created_at: string;
}

export interface ExportRecordInput {
  project_id: string;
  format: string;
  file_path?: string;
  scope?: string;
}

export interface EventLog {
  id: string;
  event_type: string;
  payload?: string; // JSON string
  created_at: string;
}

export interface EventLogInput {
  event_type: string;
  payload?: string;
}

// ─── Session types ────────────────────────────────────────────────

export type SessionType = 'normal' | 'scheduled';

export type SessionStatus = 'active' | 'archived' | 'deleted';

export interface Session {
  id: string;
  title: string;
  session_type: SessionType;
  capability_id?: string;
  capability_name?: string;
  status: SessionStatus;
  last_message_at?: string;
  message_count: number;
  model_config?: string; // JSON string
  /**
   * Optional workspace bound to this session.
   * Set when the capability declares `needsWorkspace: true`.
   * Undefined for pure-chat sessions (e.g. assistant, music-radio).
   * See: openspec/changes/use_def/session-workspace-binding
   */
  workspace_id?: string;
  created_at: string;
  updated_at: string;
}

export interface SessionInput {
  title?: string;
  session_type?: SessionType;
  capability_id?: string;
  capability_name?: string;
  status?: SessionStatus;
  schedule_config?: string; // JSON string
  model_config?: string; // JSON string
}

// ─── Message types ────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  content_parts?: string; // JSON string
  tool_calls?: string; // JSON string
  tokens_used?: number;
  latency_ms?: number;
  created_at: string;
}

export interface MessageInput {
  session_id: string;
  role: MessageRole;
  content: string;
  content_parts?: string;
  tool_calls?: string;
  tokens_used?: number;
  latency_ms?: number;
}

// ─── Project commands ─────────────────────────────────────────────────

export async function projectCreate(input: ProjectInput): Promise<string> {
  return invoke('project_create', { name: input.name, taskType: input.task_type });
}

export async function projectList(): Promise<Project[]> {
  return invoke('project_list');
}

export async function projectGet(id: string): Promise<Project | null> {
  return invoke('project_get', { id });
}

export async function projectUpdate(id: string, input: Partial<ProjectInput>): Promise<Project> {
  return invoke('project_update', { id, name: input.name, taskType: input.task_type });
}

export async function projectDelete(id: string): Promise<void> {
  return invoke('project_delete', { id });
}

// ─── Job Description commands ────────────────────────────────────────

export async function jdCreate(input: JobDescriptionInput): Promise<string> {
  return invoke('jd_create', {
    projectId: input.project_id,
    rawText: input.raw_text,
    parsedData: input.parsed_data,
    status: input.status,
  });
}

export async function jdGet(id: string): Promise<JobDescription | null> {
  return invoke('jd_get', { id });
}

export async function jdUpdate(id: string, input: Partial<JobDescriptionInput>): Promise<JobDescription> {
  return invoke('jd_update', {
    id,
    rawText: input.raw_text,
    parsedData: input.parsed_data,
    status: input.status,
  });
}

export async function jdDelete(id: string): Promise<void> {
  return invoke('jd_delete', { id });
}

export async function jdListByProject(projectId: string): Promise<JobDescription[]> {
  return invoke('jd_list_by_project', { projectId });
}

// ─── Resume commands ─────────────────────────────────────────────────

export async function resumeImport(input: ResumeInput): Promise<string> {
  return invoke('resume_import', {
    projectId: input.project_id,
    filePath: input.file_path,
    fileName: input.file_name,
    fileType: input.file_type,
  });
}

export async function resumeList(projectId: string): Promise<Resume[]> {
  return invoke('resume_list', { projectId });
}

export async function resumeGet(id: string): Promise<Resume | null> {
  return invoke('resume_get', { id });
}

export async function resumeDelete(id: string): Promise<void> {
  return invoke('resume_delete', { id });
}

export async function resumeUpdateParseStatus(id: string, status: string, parsedData?: string): Promise<void> {
  return invoke('resume_update_parse_status', { id, status, parsedData });
}

// ─── Candidate commands ──────────────────────────────────────────────

export async function candidateCreate(input: CandidateInput): Promise<string> {
  return invoke('candidate_create', {
    resumeId: input.resume_id,
    projectId: input.project_id,
    name: input.name,
    phone: input.phone,
    email: input.email,
    summary: input.summary,
    skills: input.skills,
    experience: input.experience,
    education: input.education,
    status: input.status,
    source: input.source,
  });
}

export async function candidateList(projectId: string): Promise<Candidate[]> {
  return invoke('candidate_list', { projectId });
}

export async function candidateGet(id: string): Promise<Candidate | null> {
  return invoke('candidate_get', { id });
}

export async function candidateUpdate(id: string, input: Partial<CandidateInput>): Promise<Candidate> {
  return invoke('candidate_update', {
    id,
    name: input.name,
    phone: input.phone,
    email: input.email,
    summary: input.summary,
    skills: input.skills,
    experience: input.experience,
    education: input.education,
    status: input.status,
    source: input.source,
  });
}

export async function candidateDelete(id: string): Promise<void> {
  return invoke('candidate_delete', { id });
}

// ─── Screening commands ──────────────────────────────────────────────

export async function screeningSave(input: ScreeningResultInput): Promise<string> {
  return invoke('screening_save', {
    projectId: input.project_id,
    candidateId: input.candidate_id,
    score: input.score,
    dimensions: input.dimensions,
    reasoning: input.reasoning,
    level: input.level,
    status: input.status,
    notes: input.notes,
    shortlisted: input.shortlisted,
  });
}

export async function screeningGet(id: string): Promise<ScreeningResult | null> {
  return invoke('screening_get', { id });
}

export async function screeningList(projectId: string): Promise<ScreeningResult[]> {
  return invoke('screening_list', { projectId });
}

export async function screeningUpdateNote(id: string, notes: string): Promise<void> {
  return invoke('screening_update_note', { id, notes });
}

export async function screeningDelete(id: string): Promise<void> {
  return invoke('screening_delete', { id });
}

// ─── Compliance commands ──────────────────────────────────────────────

export async function complianceCheck(input: ComplianceResultInput): Promise<string> {
  return invoke('compliance_check', {
    resumeId: input.resume_id,
    jdId: input.jd_id,
    issues: input.issues,
    status: input.status,
  });
}

export async function complianceGet(id: string): Promise<ComplianceResult | null> {
  return invoke('compliance_get', { id });
}

export async function complianceList(projectId: string): Promise<ComplianceResult[]> {
  return invoke('compliance_list', { projectId });
}

export async function complianceUpdate(id: string, issues: string): Promise<void> {
  return invoke('compliance_update', { id, issues });
}

export async function complianceDelete(id: string): Promise<void> {
  return invoke('compliance_delete', { id });
}

// ─── Export commands ──────────────────────────────────────────────────

export async function exportCreate(input: ExportRecordInput): Promise<string> {
  return invoke('export_create', {
    projectId: input.project_id,
    format: input.format,
    filePath: input.file_path,
    scope: input.scope,
  });
}

export async function exportList(projectId?: string): Promise<ExportRecord[]> {
  return invoke('export_list', { projectId });
}

export async function exportGet(id: string): Promise<ExportRecord | null> {
  return invoke('export_get', { id });
}

export async function exportDelete(id: string): Promise<void> {
  return invoke('export_delete', { id });
}

// ─── Event Log commands ──────────────────────────────────────────────

export async function eventLogCreate(input: EventLogInput): Promise<string> {
  return invoke('event_log_create', {
    eventType: input.event_type,
    payload: input.payload,
  });
}

export async function eventLogList(projectId?: string, eventType?: string, limit?: number): Promise<EventLog[]> {
  return invoke('event_log_list', {
    projectId,
    eventType,
    limit,
  });
}

// ─── Session commands ───────────────────────────────────────────────

/**
 * 创建新会话
 * @param capabilityId - 可选的能力 ID
 * @param capabilityName - 可选的能力名称
 * @param workspaceId - 可选的工作空间 ID（session-workspace-binding）
 * @returns 新会话的 ID
 */
export async function sessionCreate(
  capabilityId?: string,
  capabilityName?: string,
  workspaceId?: string,
): Promise<string> {
  return invoke('session_create', {
    capabilityId,
    capabilityName,
    workspaceId,
  });
}

/**
 * 绑定工作空间到会话（持久化到 DB）
 *
 * 在创建 workspace 后调用，将 workspace_id 写入 sessions 表。
 * 这样重启应用后 workspace 绑定不会丢失。
 *
 * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D5
 *
 * @param sessionId - 会话 ID
 * @param workspaceId - 工作空间 ID
 */
export async function sessionBindWorkspace(
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  return invoke('session_bind_workspace', {
    sessionId,
    workspaceId,
  });
}

/**
 * 获取单个会话
 * @param id - 会话 ID
 * @returns 会话对象或 null
 */
export async function sessionGet(id: string): Promise<Session | null> {
  const result = await invoke<Session | null>('session_get', { id });
  return result;
}

/**
 * 分页列出会话
 * @param page - 页码（从 1 开始）
 * @param pageSize - 每页数量（默认 5）
 * @param status - 可选的状态过滤
 * @returns 包含 items 和 total 的对象
 */
export async function sessionList(
  page: number = 1,
  pageSize: number = 5,
  status?: SessionStatus
): Promise<{ items: Session[]; total: number; page: number; page_size: number }> {
  return invoke('session_list', {
    page,
    pageSize,  // Tauri v2 默认使用驼峰命名转换
    status,
  });
}

/**
 * 更新会话标题
 * @param id - 会话 ID
 * @param title - 新标题
 */
export async function sessionUpdateTitle(id: string, title: string): Promise<void> {
  return invoke('session_update_title', { id, title });
}

/**
 * 更新会话的模型配置
 * @param id - 会话 ID
 * @param modelConfig - 模型配置（JSON 字符串）
 */
export async function sessionUpdateModelConfig(id: string, modelConfig: string): Promise<void> {
  return invoke('session_update_model_config', { id, modelConfig });
}

/**
 * 软删除会话（设置 status = 'deleted'）
 * @param id - 会话 ID
 */
export async function sessionDelete(id: string): Promise<void> {
  return invoke('session_delete', { id });
}

/**
 * 获取会话总数（用于分页）
 * @param status - 可选的状态过滤
 * @returns 会话总数
 */
export async function sessionCount(status?: SessionStatus): Promise<number> {
  return invoke('session_count', { status });
}

/**
 * 更新会话最后消息时间（内部使用）
 * @param id - 会话 ID
 */
export async function sessionUpdateLastMessage(id: string): Promise<void> {
  return invoke('session_update_last_message', { id });
}

// ─── Message commands ──────────────────────────────────────────────

/**
 * 创建单条消息
 * @param input - 消息输入对象
 * @returns 新消息的 ID
 */
export async function messageCreate(input: MessageInput): Promise<string> {
  return invoke('message_create', {
    sessionId: input.session_id,
    role: input.role,
    content: input.content,
    contentParts: input.content_parts,
    toolCalls: input.tool_calls,
    tokensUsed: input.tokens_used,
    latencyMs: input.latency_ms,
  });
}

/**
 * 获取会话的所有消息（按创建时间排序）
 * @param sessionId - 会话 ID
 * @returns 消息数组
 */
export async function messageListBySession(sessionId: string): Promise<Message[]> {
  return invoke('message_list_by_session', { sessionId });
}

/**
 * 更新消息内容（用于流式更新）
 * @param id - 消息 ID
 * @param content - 新内容
 */
export async function messageUpdateContent(id: string, content: string): Promise<void> {
  return invoke('message_update_content', { id, content });
}

/**
 * 更新消息的 tool_calls
 * @param id - 消息 ID
 * @param toolCalls - 工具调用（JSON 字符串）
 */
export async function messageUpdateToolCalls(id: string, toolCalls: string): Promise<void> {
  return invoke('message_update_tool_calls', { id, toolCalls });
}

/**
 * 获取单条消息
 * @param id - 消息 ID
 * @returns 消息对象或 null
 */
export async function messageGet(id: string): Promise<Message | null> {
  const result = await invoke<Message | null>('message_get', { id });
  return result;
}

/**
 * 删除消息（用于出错时回滚）
 * @param id - 消息 ID
 */
export async function messageDelete(id: string): Promise<void> {
  return invoke('message_delete', { id });
}