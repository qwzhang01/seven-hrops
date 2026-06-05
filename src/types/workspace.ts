// AI Workspace Type Definitions — v3.1
// BREAKING: Removed SkillCategory, SkillTaskType, SkillSpeed, SkillMetrics, Skill, LeftPanelSection

// --- Navigation Types ---
export type NavItemId = 'browser' | 'email' | 'im' | 'tasks' | 'workspaces' | null;

// --- Content Viewer Types ---
export interface ContentViewerTab {
  id: string;
  type: 'browser' | 'email' | 'output';
  title: string;
  url?: string;       // for browser tabs
  outputId?: string;  // for output preview tabs
}

// --- Workspace File Types ---
export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt?: number;
}

// --- Task Types ---
export type TaskType = 'once' | 'scheduled';

export interface TaskSchedule {
  repeat: boolean;
  cron?: string;       // cron expression for recurring tasks
  nextRunAt?: number;  // timestamp of next scheduled run
}

// --- Workspace Task Types ---
export type WorkspaceTaskStatus =
  | 'pending'
  | 'waiting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkspaceTask {
  id: string;
  capabilityId: string;
  capabilityName: string;
  capabilityIcon: string;
  title: string;
  description?: string;
  status: WorkspaceTaskStatus;
  progress: number; // 0-100
  type: TaskType;
  schedule?: TaskSchedule;
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  meta?: Record<string, unknown>;
  dependsOn?: string[];
}

// --- Chat Message Types ---
export type ChatMessageRole = 'user' | 'assistant' | 'system';
export type ChatMessageType = 'text' | 'action-card' | 'result-card' | 'progress';

export interface ActionOption {
  id: string;
  label: string;
  icon?: string;
  variant?: 'default' | 'primary' | 'danger';
}

export interface WorkspaceChatMessage {
  id: string;
  role: ChatMessageRole;
  type: ChatMessageType;
  content: string;
  timestamp: number;
  taskId?: string;
  actions?: ActionOption[];
  meta?: Record<string, unknown>;
  /** Optional email action — when present, AI message shows "📧 发送邮件" button */
  emailAction?: {
    recipientEmail?: string;
    subject?: string;
  };
}

// --- View Mode ---
export type WorkspaceViewMode = 'chat' | 'cards' | 'detail';

// --- Workspace Manager Types (workspaceManager.ts) ---

export interface WorkspaceInfo {
  id: string
  name: string
  /** Absolute path to the workspace directory. */
  path: string
  capabilityId: string
  createdAt: number
}

export interface FileTreeNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: FileTreeNode[]
}

export type ImportInputFileErrorCode =
  | "EMPTY_PATH"
  | "FILE_NOT_FOUND"
  | "DIRECTORY_NOT_SUPPORTED"
  | "READ_DENIED"
  | "COPY_FAILED"
  | "UNKNOWN"

export interface ImportInputFileSuccess {
  sourcePath: string
  targetPath: string
  fileName: string
  size?: number
}

export interface ImportInputFileFailure {
  sourcePath: string
  fileName?: string
  code: ImportInputFileErrorCode
  message: string
}

export interface ImportInputFilesResult {
  successes: ImportInputFileSuccess[]
  failures: ImportInputFileFailure[]
  successCount: number
  failureCount: number
}

// ─── Error Types ─────────────────────────────────────────────────────────────

/** Thrown by workspaceManager when a workspace id cannot be resolved. */
export class WorkspaceNotFoundError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Workspace not found: "${workspaceId}"`)
    this.name = "WorkspaceNotFoundError"
  }
}
