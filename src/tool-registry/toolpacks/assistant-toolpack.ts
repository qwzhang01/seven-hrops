/**
 * assistant-toolpack — 智能助手专用工具包
 * 
 * 提供意图识别和会话跟踪能力，为未来企微集成预留接口。
 * 
 * 工具列表：
 * - identify_intent: 分析用户消息，识别意图
 * - log_session_event: 记录会话事件
 * 
 * Spec: openspec/changes/arch-session-db-persistence/specs/assistant-toolpack/spec.md
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"

// ─── Zod Schemas ──────────────────────────────────────────────────

const IdentifyIntent = z.object({
  message: z.string().min(1, "消息不能为空"),
})

const LogSessionEvent = z.object({
  sessionId: z.string().min(1, "sessionId 不能为空"),
  eventType: z.enum([
    "session_started",
    "capability_activated",
    "message_sent",
    "error_occurred",
    "session_completed",
  ]),
  payload: z.record(z.unknown()).optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * 解析工具参数（统一错误处理）
 */
function parse<T>(name: string, schema: z.ZodSchema<T>, args: unknown): T {
  const r = schema.safeParse(args)
  if (!r.success) {
    throw new InvalidToolArgsError(
      name,
      r.error.issues.map((i) => ({ path: i.path, message: i.message })),
    )
  }
  return r.data
}

/**
 * 内置能力关键词映射表
 * 用于识别用户想要使用的具体能力
 */
const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  "resume-screening": ["简历", "筛选", "招聘", "候选人"],
  "report-writing": ["报告", "总结", "汇报"],
  "jd-optimization": ["JD", "职位描述", "招聘要求"],
  "interview-outline": ["面试", "提纲", "问题清单"],
  "interview-eval": ["评估", "评价", "面试评价"],
  "written-test": ["笔试", "考题", "试题"],
  "employee-interview": ["员工访谈", "1on1", "一对一"],
  "music-radio": ["音乐", "电台", "播放"],
}

// ─── Tool Implementations ─────────────────────────────────────────

export function register(toolRegistry: ToolRegistry): void {
  // ── identify_intent ─────────────────────────────────────────────
  // 分析用户消息，识别意图类型
  toolRegistry.register(metaOf("identify_intent"), async (args, _ctx) => {
    const a = parse("identify_intent", IdentifyIntent, args)

    const message = a.message.toLowerCase()
    
    // 1. 检测是否要使用某个能力
    for (const [capabilityId, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
      if (keywords.some((kw) => message.includes(kw.toLowerCase()))) {
        return {
          intent: "capability",
          capabilityId,
          confidence: 0.9,
          reason: `匹配到关键词: ${keywords.find((kw) => message.includes(kw.toLowerCase()))}`,
        }
      }
    }

    // 2. 检测闲聊意图
    const chatPatterns = [
      "你好", "hi", "hello", "谢谢", "感谢", "怎么样", "是什么",
      "今天", "天气", "笑话", "讲个",
    ]
    if (chatPatterns.some((p) => message.includes(p))) {
      return {
        intent: "chat",
        capabilityId: undefined,
        confidence: 0.8,
        reason: "匹配到闲聊模式",
      }
    }

    // 3. 检测任务管理意图
    const taskPatterns = ["任务", "待办", "提醒", "定时"]
    if (taskPatterns.some((p) => message.includes(p))) {
      return {
        intent: "task",
        capabilityId: undefined,
        confidence: 0.7,
        reason: "匹配到任务管理意图",
      }
    }

    // 4. 默认：认为是闲聊
    return {
      intent: "chat",
      capabilityId: undefined,
      confidence: 0.5,
      reason: "未匹配到特定意图，默认为闲聊",
    }
  })

  // ── log_session_event ───────────────────────────────────────────
  // 记录会话事件（为企微集成预留）
  toolRegistry.register(metaOf("log_session_event"), async (args, _ctx) => {
    const a = parse("log_session_event", LogSessionEvent, args)

    // 当前实现：仅记录到控制台和 localStorage（未来接入 DB 和企微）
    const event = {
      sessionId: a.sessionId,
      eventType: a.eventType,
      payload: a.payload ?? {},
      timestamp: new Date().toISOString(),
    }

    // 1. 控制台日志（开发调试）
    console.log(`[SessionEvent] ${a.eventType}:`, event)

    // 2. 本地存储（用于离线场景和调试）
    try {
      const events = JSON.parse(localStorage.getItem("session_events") ?? "[]")
      events.push(event)
      // 只保留最近 100 条
      if (events.length > 100) {
        events.splice(0, events.length - 100)
      }
      localStorage.setItem("session_events", JSON.stringify(events))
    } catch {
      // localStorage 不可用时忽略
    }

    // 3. TODO（未来）：存入 DB 的 event_logs 表
    // TODO（未来）：推送到企微 webhook

    return {
      success: true,
      eventId: `evt-${Date.now()}`,
      event,
    }
  })
}
