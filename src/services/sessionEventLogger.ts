/**
 * 会话事件日志服务
 * 
 * 为智能助手提供会话事件跟踪能力，为未来企微集成预留接口。
 * 
 * 事件类型：
 * - session_started: 会话开始
 * - capability_activated: 能力被激活
 * - message_sent: 消息发送
 * - error_occurred: 错误发生
 * - session_completed: 会话完成
 * 
 * 当前实现：
 * 1. 控制台日志（开发调试）
 * 2. localStorage（离线场景和调试）
 * 3. TODO: 存入 DB 的 event_logs 表
 * 4. TODO: 推送到企微 webhook
 * 
 * Spec: openspec/changes/arch-session-db-persistence/specs/session-event-logger/spec.md
 */

// ─── Event Types ──────────────────────────────────────────────────

export type SessionEventType =
  | "session_started"
  | "capability_activated"
  | "message_sent"
  | "error_occurred"
  | "session_completed"

export interface SessionEvent {
  /** 事件 ID */
  id: string
  /** 会话 ID */
  sessionId: string
  /** 事件类型 */
  eventType: SessionEventType
  /** 事件负载（可选） */
  payload: Record<string, unknown>
  /** 事件时间戳 */
  timestamp: string
}

// ─── Configuration ──────────────────────────────────────────────

const MAX_LOCAL_EVENTS = 100
const LOCAL_STORAGE_KEY = "session_events"

// ─── Internal Helpers ───────────────────────────────────────────

/**
 * 生成事件 ID
 */
function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * 从 localStorage 读取事件列表
 */
function loadLocalEvents(): SessionEvent[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * 保存事件列表到 localStorage
 */
function saveLocalEvents(events: SessionEvent[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(events))
  } catch {
    // localStorage 不可用时忽略
  }
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * 记录会话事件
 * 
 * @param sessionId - 会话 ID
 * @param eventType - 事件类型
 * @param payload - 事件负载（可选）
 * @returns 创建的事件对象
 */
export async function logSessionEvent(
  sessionId: string,
  eventType: SessionEventType,
  payload: Record<string, unknown> = {},
): Promise<SessionEvent> {
  const event: SessionEvent = {
    id: generateEventId(),
    sessionId,
    eventType,
    payload,
    timestamp: new Date().toISOString(),
  }

  // 1. 控制台日志（开发调试）
  console.log(`[SessionEvent] ${eventType}:`, event)

  // 2. 本地存储（用于离线场景和调试）
  const events = loadLocalEvents()
  events.push(event)
  // 只保留最近 N 条
  if (events.length > MAX_LOCAL_EVENTS) {
    events.splice(0, events.length - MAX_LOCAL_EVENTS)
  }
  saveLocalEvents(events)

  // 3. TODO（未来）：存入 DB 的 event_logs 表
  // try {
  //   await invoke("event_log_create", {
  //     sessionId,
  //     eventType,
  //     payload: JSON.stringify(payload),
  //   })
  // } catch (err) {
  //   console.error("[sessionEventLogger] Failed to save to DB:", err)
  // }

  // 4. TODO（未来）：推送到企微 webhook
  // if (shouldNotifyWecom(eventType)) {
  //   await pushToWecom(event)
  // }

  return event
}

/**
 * 获取指定会话的事件列表
 * 
 * @param sessionId - 会话 ID
 * @param limit - 返回的最大事件数（默认 50）
 * @returns 事件列表（按时间倒序）
 */
export async function getSessionEvents(
  sessionId: string,
  limit: number = 50,
): Promise<SessionEvent[]> {
  const events = loadLocalEvents()
  return events
    .filter((e) => e.sessionId === sessionId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}

/**
 * 清除本地存储的事件（用于调试或隐私保护）
 */
export function clearLocalEvents(): void {
  localStorage.removeItem(LOCAL_STORAGE_KEY)
  console.log("[sessionEventLogger] Local events cleared")
}

/**
 * 判断事件类型是否需要通知企微
 * （未来实现）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function shouldNotifyWecom(eventType: SessionEventType): boolean {
  // 未来可以配置需要通知的事件类型
  const notifyTypes: SessionEventType[] = [
    "capability_activated",
    "error_occurred",
  ]
  return notifyTypes.includes(eventType)
}

/**
 * 推送事件到企微 webhook
 * （未来实现）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function pushToWecom(event: SessionEvent): Promise<void> {
  // TODO: 实现企微 webhook 推送
  // const webhookUrl = await getWecomWebhookUrl()
  // if (!webhookUrl) return
  // 
  // await fetch(webhookUrl, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     msgtype: "text",
  //     text: {
  //       content: formatEventForWecom(event),
  //     },
  //   }),
  // })
}
