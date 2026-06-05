// Type definitions for Seven: HROps

// --- Task Types ---
export type TaskType = 'recruitment' | 'evaluation' | 'org-review' | 'job-management';

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  recruitment: '招聘',
  evaluation: '员工评估',
  'org-review': '组织力评估',
  'job-management': '岗位管理',
};

export const TASK_TYPE_ICONS: Record<TaskType, string> = {
  recruitment: '📋',
  evaluation: '👤',
  'org-review': '🏢',
  'job-management': '💼',
};

// --- Navigation Tree ---
export type NavNodeType =
  | 'jd'
  | 'resume-group'
  | 'resume-status'
  | 'screening'
  | 'screening-report'
  | 'interview-outline'
  | 'exam-paper'
  | 'interview-eval'
  | 'compare'
  | 'export'
  | 'browser';

export interface NavNode {
  id: string;
  type: NavNodeType;
  label: string;
  icon?: string;
  count?: number;
  children?: NavNode[];
  status?: string; // for resume-status nodes
  isActive?: boolean;
}

// --- Tab System ---
export type ViewType =
  | 'welcome'
  | 'workspace'
  | 'project-summary'
  | 'jd-editor'
  | 'candidate-list'
  | 'candidate-detail'
  | 'screening-result'
  | 'screening-report'
  | 'interview-outline'
  | 'exam-paper'
  | 'interview-eval'
  | 'interview-record'
  | 'interview-summary'
  | 'compare'
  | 'export'
  | 'browser';

export interface Tab {
  id: string;
  viewType: ViewType;
  title: string;
  icon?: string;
  isPinned?: boolean;
  meta?: Record<string, unknown>; // e.g. candidateId, jdId
}

// --- Candidate Status (Recruitment Task) ---
export type CandidateStatus =
  | 'pending'
  | 'screened'
  | 'shortlist'
  | 'interview-pending'
  | 'interview-scheduled'
  | 'interviewing'
  | 'interviewed'
  | 'evaluating'
  | 'offer-pending'
  | 'offered'
  | 'rejected'
  | 'talent-pool';

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  pending: '待筛选',
  screened: '已筛选',
  shortlist: 'Shortlist',
  'interview-pending': '待面试',
  'interview-scheduled': '面试安排中',
  interviewing: '面试中',
  interviewed: '已面试',
  evaluating: '评估中',
  'offer-pending': '待Offer',
  offered: '已Offer',
  rejected: '淘汰',
  'talent-pool': '人才库',
};

export const CANDIDATE_STATUS_ICONS: Record<CandidateStatus, string> = {
  pending: '⭐',
  screened: '✅',
  shortlist: '🎯',
  'interview-pending': '📋',
  'interview-scheduled': '📅',
  interviewing: '🎤',
  interviewed: '📝',
  evaluating: '🔍',
  'offer-pending': '📩',
  offered: '✅',
  rejected: '❌',
  'talent-pool': '🏦',
};

// --- Parse & Export Status ---
export type ParseStatus = 'pending' | 'parsing' | 'completed' | 'failed';
export type ExportFormat = 'excel' | 'word' | 'pdf' | 'markdown';

// --- Project ---
export interface Project {
  id: string;
  name: string;
  task_type: TaskType;
  created_at: string;
  updated_at: string;
}

// --- AI Chat ---
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

// --- Model Status ---

// Single source of truth: agent-runtime/provider/plugins owns the canonical
// provider id list (19 built-ins + "dynamic"). The frontend re-uses that
// union directly so UI ids and runtime ids never drift.
//
// History: prior to runtime-multimodel-protocol-adapter, the UI used
// ad-hoc names ("claude", "qwen", "gemini", "azure-openai") that did NOT
// match the registry. That alias layer was removed; the persist migrator
// in `aiStore` rewrites legacy values on disk to the canonical ids.
export type { ProviderID as ModelProvider } from '@/agent-runtime/provider/plugins';
export type ModelConnectionStatus = 'connected' | 'disconnected' | 'connecting';