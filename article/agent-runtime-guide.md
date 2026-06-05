# Seven HROps Agent Runtime — 架构详解与使用指南

> 本文档深入介绍 `@agent-runtime` 的架构设计、代码结构、使用方法、应用对接与扩展方式。

---

## 目录

1. [它是什么](#1-它是什么)
2. [整体架构](#2-整体架构)
3. [代码目录结构](#3-代码目录结构)
4. [核心循环原理](#4-核心循环原理)
5. [各模块详解](#5-各模块详解)
6. [使用案例](#6-使用案例)
7. [外部应用对接](#7-外部应用对接)
8. [扩展指南](#8-扩展指南)
9. [推荐代码导读顺序](#9-推荐代码导读顺序)
10. [常见问题](#10-常见问题)

---

## 1. 它是什么

`@agent-runtime` 是 Seven HROps 项目的 **自包含 Agent 执行引擎**。它能：

- 🔄 运行多步骤 Agent 循环（LLM 推理 → 工具调用 → 获取结果 → 继续推理）
- 🤖 对接多种 AI 模型提供商（OpenAI、Anthropic、Ollama 及任何 OpenAI 兼容端点）
- 🔌 通过 MCP（Model Context Protocol）协议集成工具服务器，实现工具发现与执行
- 📋 管理会话（Session）、权限（Permission）、技能（Skill）、Agent 定义与插件钩子

**一句话概括：它是让你的 AI 不只是「聊天」，而是「干活」的执行引擎。**

### 技术栈

| 技术 | 作用 |
|------|------|
| [Effect 4.x](https://effect.website/) | 核心框架：依赖注入(Layer)、流式处理(Stream)、错误处理、资源管理 |
| [Vercel AI SDK v6](https://sdk.vercel.ai/) | 模型适配层：统一 OpenAI/Anthropic/Ollama 流式接口 |
| [MCP SDK](https://modelcontextprotocol.io/) | 工具协议：工具发现、调用与生命周期管理 |
| [Drizzle ORM](https://orm.drizzle.team/) + SQLite | 数据层：内嵌 MCP Server 直接操作应用数据库 |

---

## 2. 整体架构

### 2.1 分层架构图

```
┌──────────────────────────────────────────────────────────────┐
│                     前端 (React + Zustand)                    │
│   aiStore.ts → agentService.ts → window.__agentRuntime       │
└───────────────────────────┬──────────────────────────────────┘
                            │ runtime.runPromise(Effect)
┌───────────────────────────▼──────────────────────────────────┐
│                   Agent Runtime (Effect 4.x)                  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Session 层（面向用户的最高 API）                         │  │
│  │  Session → SessionPrompt → SessionProcessor              │  │
│  └────────────┬──────────────────────────────┬──────────────┘  │
│               │                              │                 │
│  ┌────────────▼──────────┐  ┌────────────────▼──────────────┐ │
│  │  Agent 层              │  │  ToolRuntime（核心循环引擎）   │ │
│  │  Agent 定义 + 权限     │  │  LLM 流 → 工具调用 → 循环     │ │
│  └────────────┬──────────┘  └────────┬──────────┬────────────┘ │
│               │                      │          │              │
│  ┌────────────▼──────────┐  ┌────────▼──┐ ┌────▼────────────┐ │
│  │  Skill 层              │  │  Provider  │ │  MCP 模块       │ │
│  │  行为指南 + 权限过滤   │  │  AI 模型   │ │  工具发现/执行  │ │
│  └───────────────────────┘  └───────────┘ └────┬────────────┘ │
│                                                 │              │
│  ┌──────────────────────────────────────────────▼──────────┐  │
│  │  基础设施层                                              │  │
│  │  Config │ Bus │ EffectBridge │ InstanceState │ Plugin   │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│               内嵌 MCP Server (同进程)                        │
│   HR 数据工具集 → Drizzle ORM → SQLite                       │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 数据流总览

```
用户输入 → Session.run() → SessionPrompt.run() → ToolRuntime.stream()
                                                        │
                                     ┌──────────────────┤
                                     ▼                  ▼
                              Provider.adapter      MCP.callTool()
                              (AI SDK streamText)   (工具执行)
                                     │                  │
                                     ▼                  ▼
                              text-delta 事件      tool-result
                              tool-call 事件            │
                                     │                  │
                                     └────────┬─────────┘
                                              │
                                     追加消息，继续循环
                                              │
                                     ┌────────▼─────────┐
                                     │  SessionProcessor │
                                     │  事件回调 → UI    │
                                     └──────────────────┘
```

### 2.3 Layer 依赖拓扑

所有服务通过 Effect 的 `Layer` 按依赖顺序组装。`createAppLayer()` 中的层次为：

```
Infrastructure (InstanceState, EffectBridge, Bus)     ← 无依赖
       ↓
Configuration (Config)                                ← 无依赖
       ↓
Core Agent (Permission, Skill, Agent, Plugin)         ← 依赖 Config
       ↓
Provider (AI Model Adapter)                           ← 依赖 Config
       ↓
MCP (Tool Server Integration)                         ← 无创建时依赖
       ↓
Session (SessionProcessor → SessionPrompt)            ← 依赖 Agent + Processor
```

### 2.4 内嵌式 MCP Server 架构

与传统「spawn 子进程跑 MCP Server」的方式不同，Seven HROps 采用 **内嵌式（Embedded）** 架构：

```
传统方式（IPC 通信）：
  Agent Runtime → stdio/HTTP → 子进程 MCP Server → 数据库
  （有 IPC 开销，进程管理复杂）

内嵌方式（同进程直连）：
  Agent Runtime → MCP 模块 → 内嵌 MCP Server → SQLite（同进程直连）
  （零 IPC 开销，无需进程管理）
```

---

## 3. 代码目录结构

```
src/agent-runtime/
├── index.ts                    ← 包入口，统一导出所有模块和类型
│
├── core/                       ← 基础设施层
│   ├── app-runtime.ts          ← AppRuntime 主入口：createAppLayer() + createRuntime()
│   ├── runtime.ts              ← makeRuntime() 工具函数 + 全局 memoMap
│   ├── bridge.ts               ← EffectBridge：Effect ↔ Promise 桥梁
│   ├── instance-state.ts       ← 实例级状态管理（Scope 生命周期）
│   ├── observability.ts        ← 可观测性（当前为 no-op）
│   └── memo-map.ts             ← 全局共享 MemoMap（跨 Runtime 实例共享单例）
│
├── config/                     ← 配置管理
│   └── index.ts                ← Config.Service：内存配置，支持 get/set/getModel/getProvider
│
├── agent/                      ← Agent 定义与工具循环引擎
│   ├── agent.ts                ← Agent.Service：3 个内置 Agent + 动态注册
│   └── tool-runtime.ts         ← ToolRuntime：核心 Agent Loop（LLM → 工具 → 循环）
│
├── session/                    ← 会话管理
│   ├── session.ts              ← Session.Service：创建/运行/历史/中止 会话
│   ├── prompt.ts               ← SessionPrompt：组装 prompt → 调用 ToolRuntime → 返回结果
│   └── processor.ts            ← SessionProcessor：流式事件处理（text-delta/tool-start/finish）
│
├── provider/                   ← AI 模型适配器
│   └── index.ts                ← Provider.Service：OpenAI/Anthropic/Ollama/Custom 适配
│
├── mcp/                        ← MCP 协议集成
│   └── index.ts                ← MCP.Service：连接/断开/发现工具/调用工具/内嵌服务器注册
│
├── permission/                 ← 权限系统
│   └── index.ts                ← Permission.Service：allow/deny/ask 规则评估 + 通配符匹配
│
├── skill/                      ← 技能管理
│   └── index.ts                ← Skill.Service：内置技能 + 动态注册 + Agent 权限过滤
│
├── plugin/                     ← 插件系统
│   └── index.ts                ← Plugin.Service：钩子注册与触发（V1 为基础实现）
│
├── bus/                        ← 事件总线
│   └── index.ts                ← Bus.Service：基于 PubSub 的发布/订阅
│
└── src/
    └── tool-registry/
        └── index.ts            ← 内嵌 MCP Server：HR 数据工具集实现
```

---

## 4. 核心循环原理

### 4.1 ToolRuntime 循环

ToolRuntime 是整个 Agent Runtime 的**心脏**，它实现了一个**递归 Stream 循环**：

```
步骤 1：将消息 + 工具定义发送给 AI 模型
步骤 2：流式接收模型响应（文本增量 + 工具调用）
步骤 3：如果模型返回了工具调用 → 并发执行所有工具
步骤 4：将工具结果作为新消息追加，回到步骤 1
步骤 5：直到模型不再发出工具调用，或达到 maxSteps 上限
```

### 4.2 事件类型

在循环过程中，会产生以下事件（`LLMStreamEvent`）：

| 事件类型 | 说明 | 来源 |
|----------|------|------|
| `text-delta` | 文本增量（模型输出的一个片段） | Provider 流 |
| `reasoning-delta` | 推理增量（o1 等推理模型） | Provider 流 |
| `tool-call` | 模型发起的工具调用 | Provider 流 |
| `tool-result` | 工具执行结果 | ToolRuntime |
| `tool-error` | 工具执行错误 | ToolRuntime |
| `finish` | 当前步骤完成（reason: "tool-calls"/"stop"/"length"） | Provider 流 |
| `error` | 流式错误 | Provider 流 |

### 4.3 递归 Stream 的实现机制

核心代码位于 `agent/tool-runtime.ts` 的 `stream()` 函数。它使用 `Stream.unwrap` 实现递归：

```ts
// 伪代码展示核心结构
const loop = (messages, step) =>
  Stream.unwrap(
    Effect.gen(function* () {
      // 1. 流式获取模型响应
      const modelStream = model.stream({ messages, tools, systemPrompt, temperature })
        .pipe(Stream.tap(event => accumulate(state, event)))

      // 2. 模型流结束后，判断是否需要继续
      const continuation = Stream.unwrap(
        Effect.gen(function* () {
          if (state.finishReason !== "tool-calls") {
            return Stream.empty  // 模型没有调用工具，循环结束
          }

          // 3. 并发执行所有工具调用（最多 10 个并发）
          const results = yield* Effect.forEach(toolCalls, dispatch, { concurrency: 10 })

          // 4. 检查停止条件
          if (stopWhen?.({ step, maxSteps }) || step + 1 >= maxSteps) {
            return Stream.fromIterable(resultEvents)
          }

          // 5. 构建后续消息，递归继续
          const followUpMessages = [...messages, assistantMsg, ...toolResultMsgs]
          return Stream.fromIterable(resultEvents).pipe(
            Stream.concat(loop(followUpMessages, step + 1))  // 递归！
          )
        })
      )

      return modelStream.pipe(Stream.concat(continuation))
    })
  )
```

**关键设计点：**

1. **`Stream.unwrap`**：接受一个返回 Stream 的 Effect，实现「先等前一步完成，再决定下一步发什么」
2. **`accumulate`**：在 `Stream.tap` 中逐事件累积 assistantContent 和 toolCalls，不丢失任何中间状态
3. **`Effect.forEach(..., { concurrency: 10 })`**：工具调用并发执行，最大 10 并发
4. **`stopWhen`**：自定义停止条件函数，默认为 `step + 1 >= maxSteps`

---

## 5. 各模块详解

### 5.1 Core — 基础设施层

#### AppRuntime（`core/app-runtime.ts`）

主入口，提供两个关键 API：

```ts
// 1. 创建带配置的 Runtime
const runtime = createRuntime({
  providers: { openai: { apiKey: "sk-..." } },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
  mcpServers: { ... },
})

// 2. 使用默认配置的 Runtime（全局单例）
import { AppRuntime } from "@agent-runtime"
await AppRuntime.runPromise(someEffect)
```

返回的 runtime 对象有以下方法：

| 方法 | 说明 |
|------|------|
| `runPromise(effect)` | 执行 Effect 并返回 Promise（最常用） |
| `runSync(effect)` | 同步执行 Effect |
| `runPromiseExit(effect)` | 执行 Effect 并返回 Exit（含成功/失败详情） |
| `runFork(effect)` | 在后台 Fiber 中执行 Effect |
| `runCallback(effect)` | 以回调方式执行 Effect |
| `dispose()` | 释放 Runtime 资源 |

#### EffectBridge（`core/bridge.ts`）

当 Effect 代码需要与普通 JS/TS 代码（如 React 状态更新、事件回调）交互时，使用 EffectBridge：

```ts
// 在 Effect 内部使用
const bridge = yield* EffectBridge.Service
bridge.promise(someEffect)   // 返回 Promise
bridge.fork(someEffect)      // 后台执行，不等待
bridge.run(someEffect)       // 返回 Effect（可在 Stream 中使用）
```

#### MemoMap（`core/memo-map.ts`）

全局共享的 `MemoMap`，确保不同 `createRuntime()` 调用创建的 Runtime 实例**共享 Layer 单例**。这意味着：

```ts
// 两个 runtime 共享同一个 Config、Agent、MCP 等实例
const runtime1 = createRuntime(config1)
const runtime2 = createRuntime(config2)
// runtime1 和 runtime2 的 InstanceState、Bus 等是同一个实例
```

### 5.2 Config（`config/index.ts`）

**配置结构：**

```ts
interface AgentRuntimeConfig {
  providers: Record<string, ProviderConfig>  // AI 提供商配置
  defaultModel: ModelConfig                  // 默认模型
  mcpServers: Record<string, MCPConfig>      // 外部 MCP 服务器
  agentModels?: Record<string, ModelConfig>  // Agent 特定模型覆盖
  permissions?: PermissionRule[]             // 全局权限规则
  skills?: Record<string, { description?: string; content: string }>  // 自定义技能
  debug?: boolean                            // 调试模式
}

interface ModelConfig {
  modelID: string     // 如 "gpt-4o", "claude-sonnet-4", "qwen3:8b"
  providerID: string  // 如 "openai", "anthropic", "ollama"
}

interface ProviderConfig {
  apiKey?: string                           // API 密钥
  baseURL?: string                          // 自定义端点
  headers?: Record<string, string>          // 自定义请求头
  models?: Record<string, string>           // 模型名映射：本地名 → 提供商模型 ID
}
```

**Config.Service 方法：**

| 方法 | 说明 |
|------|------|
| `get()` | 获取完整配置 |
| `set(update)` | 更新配置（merge） |
| `getModel(agentName?)` | 获取模型配置（优先 agentModels，fallback defaultModel） |
| `getProvider(providerID)` | 获取提供商配置 |
| `getMCPServers()` | 获取 MCP 服务器配置 |

**模型名映射示例：**

```ts
providers: {
  custom: {
    apiKey: "sk-...",
    baseURL: "https://my-llm-endpoint.com/v1",
    models: {
      "my-model": "actual-provider-model-id",  // 本地用 "my-model" → 实际发送 "actual-provider-model-id"
    },
  },
}
```

### 5.3 Agent（`agent/agent.ts`）

**Agent 定义结构：**

```ts
interface Info {
  name: string                  // 唯一标识
  description?: string          // 描述（何时使用此 Agent）
  mode: "primary" | "subagent"  // primary=面向用户, subagent=被其他 Agent 调用
  model?: ModelConfig           // 模型覆盖
  prompt?: string               // System Prompt
  permission: Rule[]            // 权限规则集
  tools?: string[]              // 可用工具白名单
  temperature?: number          // 温度覆盖
}
```

**三个内置 Agent：**

| Agent | mode | 用途 | temperature | 可用工具 |
|-------|------|------|-------------|----------|
| `assistant` | `primary` | 通用 HR 助手 | 0.7 | chat, list_projects, get_project, list_resumes, get_resume, get_jd, save_screening_result |
| `screener` | `subagent` | 简历筛选专家 | 0.3 | get_resume, get_jd, save_screening_result, list_resumes |
| `compliance` | `subagent` | 合规检查专家 | 0.2 | get_resume, get_jd, get_project |

**Agent.Service 方法：**

| 方法 | 说明 |
|------|------|
| `get(name)` | 获取 Agent 定义 |
| `list()` | 列出所有 Agent（primary 优先） |
| `defaultAgent()` | 获取默认 Agent（第一个 primary） |
| `register(agent)` | 注册新 Agent（name 不可重复） |

### 5.4 Provider（`provider/index.ts`）

基于 Vercel AI SDK v6 的模型适配层。支持四种提供商：

```
openai    → createOpenAI()   → gpt-4o / gpt-4o-mini 等
anthropic → createAnthropic() → claude-sonnet-4 等
ollama    → createOllama()    → qwen3:8b 等本地模型
custom    → createOpenAI()    → 任何 OpenAI 兼容端点（如 vLLM、LiteLLM）
```

**核心适配接口 `ModelAdapter`：**

```ts
interface ModelAdapter {
  stream: (options: {
    messages: ReadonlyArray<ModelMessage>
    tools: ReadonlyArray<ToolDefinition>
    systemPrompt?: string
    temperature?: number
  }) => Stream.Stream<LLMStreamEvent, Error>
}
```

ToolRuntime 只与 `ModelAdapter` 交互，不关心底层是哪家模型。

**Provider.Service 方法：**

| 方法 | 说明 |
|------|------|
| `createModelAdapter(modelConfig)` | 根据模型配置创建适配器 |
| `listProviders()` | 列出已配置的提供商 |
| `getDefaultAdapter()` | 获取默认模型适配器 |

**消息格式转换：**

Provider 内部将 Runtime 的 `ModelMessage` + `ContentPart` 转换为 AI SDK 的 `ModelMessage` 格式：
- `ContentPart.text` → AI SDK text part
- `ContentPart.tool-call` → AI SDK tool-call part（含 `toolCallId`、`toolName`、`input`）
- `ContentPart.tool-result` → AI SDK tool-result part（含 `toolCallId`、`toolName`、`output`）

### 5.5 MCP（`mcp/index.ts`）

MCP 模块支持两种来源的工具：

#### 外部 MCP Server（通过 `MCP.Service.connect()`）

```ts
// 本地服务器（stdio）
{ type: "local", command: ["node", "./my-mcp-server.js"], environment: { API_KEY: "..." } }

// 远程服务器（HTTP Streamable / SSE）
{ type: "remote", url: "https://my-mcp-server.example.com/mcp", headers: { Authorization: "Bearer ..." } }
```

**连接过程：**
1. 根据类型创建 Transport（StdioClientTransport / StreamableHTTPClientTransport / SSEClientTransport）
2. 创建 MCP Client 并连接
3. 发现工具（`client.listTools()`）
4. 注册工具变更监听器（`ToolListChangedNotification`）
5. 外部工具命名：`{sanitizedServerName}_{sanitizedToolName}`

#### 内嵌 MCP Server（通过 `registerInternalServer()`）

```ts
import { registerInternalServer } from "@agent-runtime/mcp"
import { createServer } from "@agent-runtime/src/mcp-server"

const db = getDb()
const mcpServer = createServer(db)

// 注册后，内嵌服务器的工具对 Agent 可见
// 工具命名：internal_{serverName}_{toolName}
await Effect.runPromise(registerInternalServer('seven-hrops', mcpServer))
```

**MCP.Service 方法：**

| 方法 | 说明 |
|------|------|
| `connect(name, config)` | 连接外部 MCP 服务器 |
| `disconnect(name)` | 断开 MCP 服务器 |
| `status()` | 获取所有服务器状态 |
| `tools()` | 获取所有可用工具（外部 + 内嵌） |
| `callTool(name, args)` | 调用指定工具 |
| `listServers()` | 列出所有服务器 |

### 5.6 Session（`session/session.ts`）

Session 是**面向用户的最高层 API**，封装了完整的对话生命周期。

**Session 数据结构：**

```ts
interface SessionInfo {
  id: string           // 会话 ID，格式 "session-{timestamp}-{random}"
  createdAt: number    // 创建时间
  updatedAt: number    // 更新时间
  messageCount: number // 消息数量
  agentName: string    // 使用的 Agent
}
```

**Session.Service 方法：**

| 方法 | 说明 |
|------|------|
| `create(agentName?)` | 创建新会话（默认使用 primary Agent） |
| `run(sessionID, options)` | 运行一轮对话 |
| `getHistory(sessionID)` | 获取会话消息历史 |
| `abort(sessionID)` | 中止当前处理 |
| `list()` | 列出所有会话 |

**`run()` 方法参数：**

```ts
interface SessionRunOptions {
  message: string                  // 用户消息
  agentName?: string               // 覆盖 Agent
  maxSteps?: number                // 最大循环步数（默认 50，上限 100）
  temperature?: number             // 温度覆盖
  systemPrompt?: string            // System Prompt 覆盖
  onEvent?: ProcessorEventHandler  // 流式事件回调
}
```

**`run()` 返回值：**

```ts
interface SessionRunResult {
  sessionID: string
  messageID: string
  content: ContentPart[]      // 助手回复内容（文本 + 工具调用 + 工具结果）
  finishReason: string        // "stop" | "tool-calls" | "max-steps" | "aborted" | "error"
  error?: string
}
```

**内置工具：**

Session 自动注入两个内置工具：
- `chat`：发送聊天消息给用户（模型用于结构化对话响应）
- `think`：内部推理工具（帮助模型分步思考，不影响用户可见输出）

### 5.7 SessionPrompt（`session/prompt.ts`）

SessionPrompt 是 Session 的内部引擎，负责：

1. **解析 Agent**：获取 Agent 定义（prompt、tools、temperature）
2. **组装消息**：history + 当前用户消息
3. **确定 System Prompt**：`options.systemPrompt ?? agent.prompt ?? "You are {name}. {description}"`
4. **过滤工具**：根据 Agent 的 `tools` 白名单过滤可用工具
5. **创建 Processor**：用于事件处理和结果收集
6. **运行 ToolRuntime**：执行核心循环
7. **返回结果**：收集 `ProcessorResult`

### 5.8 SessionProcessor（`session/processor.ts`）

SessionProcessor 负责流式事件的生命周期管理：

**ProcessorEvent 类型：**

| 事件类型 | data 结构 | 说明 |
|----------|-----------|------|
| `text-delta` | `{ type: "text-delta", text }` | 文本增量 |
| `text-complete` | `{ type: "text-complete", text }` | 文本完成（完整文本） |
| `tool-start` | `{ type: "tool-start", toolName, callID, input }` | 工具开始执行 |
| `tool-complete` | `{ type: "tool-complete", callID, result }` | 工具执行成功 |
| `tool-error` | `{ type: "tool-error", callID, error }` | 工具执行失败 |
| `finish` | `{ type: "finish", reason }` | 对话完成 |
| `error` | `{ type: "error", error }` | 错误 |

**使用示例：**

```ts
const result = await runtime.runPromise(
  Session.Service.run(sessionID, {
    message: "帮我筛选简历",
    onEvent: (event) => {
      switch (event.type) {
        case "text-delta":
          // 追加文本到 UI
          appendText(event.data.text)
          break
        case "tool-start":
          // 显示工具调用状态
          showToolStatus(event.data.toolName, "running")
          break
        case "tool-complete":
          // 工具完成
          showToolStatus(event.data.callID, "done")
          break
        case "finish":
          // 对话完成
          setLoading(false)
          break
      }
    },
  })
)
```

### 5.9 Permission（`permission/index.ts`）

**规则结构：**

```ts
interface Rule {
  permission: string   // 权限标识，支持通配符："*"、"read*"
  pattern: string      // 匹配模式，支持通配符："*"、"screening*"
  action: "allow" | "deny" | "ask"
}
```

**规则评估逻辑：**

```ts
// 1. 合并所有 Ruleset（Agent 的 permission + 全局 approved）
const rules = [...agentRules, ...approvedRules]

// 2. 倒序查找第一个匹配的规则（后定义的优先）
const match = [...rules].reverse().find(rule =>
  wildcardMatch(permission, rule.permission) &&
  wildcardMatch(pattern, rule.pattern)
)

// 3. 未匹配则默认 "ask"
```

**通配符匹配：**
- `*` 匹配所有
- `read*` 匹配以 `read` 开头的
- 其他精确匹配

**当前 HROps 默认行为：** auto-allow（`ask` 动作自动放行），UI 层可拦截显示权限对话框。

### 5.10 Skill（`skill/index.ts`）

Skill 是给 Agent 的**行为指南**（Markdown 格式），注入到 system prompt 引导 Agent 行为。

**Skill 定义结构：**

```ts
interface Info {
  name: string           // 唯一标识
  description?: string   // 描述
  content: string        // Markdown 内容（注入到 prompt）
}
```

**内置 Skill：**

| Skill | 说明 |
|-------|------|
| `screener` | 简历筛选技能：5 个评分维度 + 输出格式 + 规则 |
| `compliance` | 合规检查技能：JD 合规项 + 简历 PII 检测 + 输出格式 |

**Skill.Service 方法：**

| 方法 | 说明 |
|------|------|
| `get(name)` | 获取单个 Skill |
| `all()` | 列出所有 Skill |
| `available(agent?)` | 列出 Agent 可用的 Skill（受权限过滤） |
| `register(skill)` | 注册新 Skill |
| `registerMany(skills)` | 批量注册 Skill |

**`fmt()` 工具函数：** 将 Skill 列表格式化为 Markdown，便于注入到 prompt。

```ts
import { formatSkills } from "@agent-runtime/skill"
const skillText = formatSkills(skills)
// 输出：
// ## Available Skills
// - **screener**: Screen candidate resumes against job descriptions
// - **compliance**: Check JDs for discriminatory language
```

### 5.11 Plugin（`plugin/index.ts`）

钩子式插件系统，当前为基础实现。

**Hook 类型：**

```ts
interface Hooks {
  "tool.execute.before"?: HookHandler   // 工具执行前
  "tool.execute.after"?: HookHandler    // 工具执行后
  "experimental.text.complete"?: HookHandler  // 文本完成（实验性）
  [key: string]: HookHandler | undefined      // 自定义钩子
}
```

**Plugin.Service 方法：**

| 方法 | 说明 |
|------|------|
| `trigger(name, input, output)` | 触发钩子（传入 input 和 output，返回可能被修改的 output） |
| `registerHook(name, handler)` | 注册钩子处理函数 |
| `list()` | 列出所有钩子 |

### 5.12 Bus（`bus/index.ts`）

基于 Effect PubSub 的事件总线。

**Bus.Service 方法：**

| 方法 | 说明 |
|------|------|
| `publish(type, data)` | 发布事件 |
| `subscribe(type)` | 订阅特定类型事件（返回 Stream） |
| `subscribeAll()` | 订阅所有事件（返回 Stream） |

**使用示例：**

```ts
// 发布
yield* Bus.Service.publish("session.created", { sessionID: "..." })

// 订阅
const stream = Bus.Service.subscribe("session.created")
yield* stream.pipe(
  Stream.tap((event) => Effect.sync(() => console.log(event))),
  Stream.runDrain,
)
```

---

## 6. 使用案例

### 6.1 最小可用示例

```ts
import { createRuntime, Session } from "@agent-runtime"
import { Effect } from "effect"

// 1. 创建 Runtime
const runtime = createRuntime({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY! },
  },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
})

// 2. 创建会话并对话
const result = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    const session = yield* sessionService.create("assistant")
    return yield* sessionService.run(session.id, {
      message: "你好，帮我看看有哪些项目",
    })
  })
)

console.log("回复内容:", result.content)
console.log("完成原因:", result.finishReason)

// 3. 清理
await runtime.dispose()
```

### 6.2 流式对话（实时显示）

```ts
import { createRuntime, Session } from "@agent-runtime"
import { Effect } from "effect"

const runtime = createRuntime({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY! },
  },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
})

// 创建会话
const sessionInfo = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    return yield* sessionService.create("assistant")
  })
)

// 流式对话
const result = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    return yield* sessionService.run(sessionInfo.id, {
      message: "帮我筛选前端工程师岗位的简历",
      onEvent: (event) => {
        switch (event.type) {
          case "text-delta":
            process.stdout.write(event.data.text)  // 实时打印文本
            break
          case "tool-start":
            console.log(`\n🔧 调用工具: ${event.data.toolName}`)
            console.log(`   参数:`, event.data.input)
            break
          case "tool-complete":
            console.log(`✅ 工具完成: ${event.data.callID}`)
            break
          case "tool-error":
            console.error(`❌ 工具错误: ${event.data.error}`)
            break
          case "finish":
            console.log(`\n🏁 对话完成，原因: ${event.data.reason}`)
            break
        }
      },
    })
  })
)
```

### 6.3 多轮对话

```ts
import { createRuntime, Session } from "@agent-runtime"
import { Effect } from "effect"

const runtime = createRuntime({
  providers: { openai: { apiKey: "sk-..." } },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
})

// 创建一个会话，多轮复用
const sessionID = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    const session = yield* sessionService.create("assistant")
    return session.id
  })
)

// 第一轮
const r1 = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    return yield* sessionService.run(sessionID, { message: "列出所有项目" })
  })
)

// 第二轮（同一会话，带上下文）
const r2 = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    return yield* sessionService.run(sessionID, { message: "第一个项目有多少简历？" })
  })
)

// 查看完整历史
const history = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    return yield* sessionService.getHistory(sessionID)
  })
)
console.log("对话历史:", history)
```

### 6.4 使用 Ollama 本地模型

```ts
const runtime = createRuntime({
  providers: {
    ollama: {
      baseURL: "http://localhost:11434",  // Ollama 默认地址
    },
  },
  defaultModel: { modelID: "qwen3:8b", providerID: "ollama" },
})
```

### 6.5 使用自定义 OpenAI 兼容端点

```ts
const runtime = createRuntime({
  providers: {
    myprovider: {
      apiKey: "my-api-key",
      baseURL: "https://my-llm-endpoint.com/v1",
      headers: { "X-Custom-Header": "value" },
      models: {
        "fast": "llama3-8b",
        "smart": "llama3-70b",
      },
    },
  },
  defaultModel: { modelID: "smart", providerID: "myprovider" },
})
```

### 6.6 为不同 Agent 配置不同模型

```ts
const runtime = createRuntime({
  providers: {
    openai: { apiKey: "sk-..." },
    anthropic: { apiKey: "sk-ant-..." },
  },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
  agentModels: {
    assistant: { modelID: "gpt-4o", providerID: "openai" },       // 通用助手用 GPT
    screener: { modelID: "claude-sonnet-4", providerID: "anthropic" },  // 筛选用 Claude
    compliance: { modelID: "gpt-4o-mini", providerID: "openai" },  // 合规用小模型
  },
})
```

### 6.7 连接外部 MCP Server

```ts
const runtime = createRuntime({
  providers: { openai: { apiKey: "sk-..." } },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
  mcpServers: {
    // 本地 MCP Server（通过 stdio 启动子进程）
    "filesystem": {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      environment: { NODE_ENV: "production" },
      timeout: 30000,
    },
    // 远程 MCP Server（通过 HTTP/SSE 连接）
    "remote-tools": {
      type: "remote",
      url: "https://my-mcp-server.example.com/mcp",
      headers: { Authorization: "Bearer my-token" },
      timeout: 60000,
    },
  },
})

// 连接后，外部工具自动可用
// 外部工具命名：filesystem_read_file, remote_tools_search
```

---

## 7. 外部应用对接

### 7.1 对接架构

Seven HROps 的 Agent Runtime 运行在**前端进程**中（Tauri Webview / 浏览器），不需要 Rust 后端中转：

```
┌─────────────────────────────────────────────────┐
│  Tauri / Browser 前端进程                        │
│                                                  │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │  React UI    │───▶│  agentService.ts      │  │
│  │  Components  │    │  (封装 Session API)    │  │
│  └──────────────┘    └───────────┬───────────┘  │
│                                  │               │
│                      ┌───────────▼───────────┐  │
│                      │  window.__agentRuntime │  │
│                      │  (ManagedRuntime)      │  │
│                      └───────────┬───────────┘  │
│                                  │               │
│                      ┌───────────▼───────────┐  │
│                      │  Agent Runtime         │  │
│                      │  (Effect 4.x)          │  │
│                      └───────────┬───────────┘  │
│                                  │               │
│                      ┌───────────▼───────────┐  │
│                      │  内嵌 MCP Server       │  │
│                      │  → SQLite (同进程)     │  │
│                      └───────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 7.2 初始化流程

**步骤 1：在 Zustand Store 中初始化 Runtime**

```ts
// src/stores/aiStore.ts
initializeRuntime: async () => {
  set({ connectionStatus: 'connecting' });
  try {
    // 1. 动态导入模块
    const { createRuntime } = await import('@/agent-runtime/core/app-runtime');
    const { createServer } = await import('@/agent-runtime/src/mcp-server');
    const { registerInternalServer } = await import('@/agent-runtime/mcp');
    const { Effect } = await import('effect');

    // 2. 获取数据库实例
    const { getDb } = await import('@/db');
    const db = getDb();

    // 3. 创建内嵌 MCP Server
    const mcpServer = createServer(db);

    // 4. 注册内嵌服务器（使工具对 Agent 可见）
    //    注册后工具命名为：internal_seven-hrops_{toolName}
    await Effect.runPromise(registerInternalServer('seven-hrops', mcpServer));

    // 5. 创建 Runtime
    const runtime = createRuntime({
      providers: {},
      defaultModel: { modelID: 'qwen3:8b', providerID: 'ollama' },
      mcpServers: {},  // 无外部 MCP 服务器
    });

    // 6. 挂到全局（跨模块访问）
    window.__agentRuntime = runtime;

    set({ connectionStatus: 'connected' });
  } catch (error) {
    console.warn('[AIStore] Agent runtime initialization failed:', error);
    set({ connectionStatus: 'connected' });  // Fallback
  }
},
```

**步骤 2：创建 agentService 封装层**

```ts
// src/services/agentService.ts
import { useAIStore } from '@/stores/aiStore';

async function getAgentRuntime() {
  // 优先从全局取（已初始化）
  if (window.__agentRuntime) return window.__agentRuntime;

  // 兜底：创建新实例
  const { createRuntime } = await import('@/agent-runtime/core/app-runtime');
  return createRuntime();
}

// 非流式对话
export async function chatWithAgent(request) {
  const runtime = await getAgentRuntime();
  const { Session } = await import('@/agent-runtime/session/session');
  const { Effect } = await import('effect');

  return runtime.runPromise(
    Effect.gen(function* () {
      const sessionService = yield* Session.Service;
      const sessionInfo = yield* sessionService.create(request.agentName);
      return yield* sessionService.run(sessionInfo.id, {
        message: request.message,
        agentName: request.agentName,
        maxSteps: request.maxSteps,
      });
    })
  );
}

// 流式对话
export async function chatWithStream(request, onEvent) {
  const runtime = await getAgentRuntime();
  const { Session } = await import('@/agent-runtime/session/session');
  const { Effect } = await import('effect');

  await runtime.runPromise(
    Effect.gen(function* () {
      const sessionService = yield* Session.Service;
      const sessionInfo = yield* sessionService.create(request.agentName);
      yield* sessionService.run(sessionInfo.id, {
        message: request.message,
        agentName: request.agentName,
        maxSteps: request.maxSteps,
        onEvent: (event) => {
          onEvent({
            type: event.type,
            sessionID: request.sessionID,
            messageID: event.messageID,
            text: event.data?.text,
            name: event.data?.toolName,
            // ... 映射其他字段
          });
        },
      });
    })
  );
}
```

**步骤 3：在 React 组件中使用**

```tsx
// src/components/layout/RightPanel.tsx
import { AgentService } from '@/services/agentService';

function ChatPanel() {
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');

  const handleSend = async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    await AgentService.chatStream(
      { sessionID, message: text, agentName: 'assistant' },
      (event) => {
        switch (event.type) {
          case 'text-delta':
            setStreamingText(prev => prev + event.text);
            break;
          case 'tool-start':
            setMessages(prev => [...prev, {
              role: 'tool',
              name: event.name,
              status: 'running',
            }]);
            break;
          case 'finish':
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: streamingText,
            }]);
            setStreamingText('');
            break;
        }
      }
    );
  };

  return (/* JSX */);
}
```

### 7.3 对接其他应用的步骤

如果你的应用也想对接 Agent Runtime，按以下步骤操作：

**1. 安装依赖**

```bash
npm install effect @ai-sdk/openai @ai-sdk/anthropic ollama-ai-sdk ai zod @modelcontextprotocol/sdk
```

**2. 创建 MCP Server（内嵌方式）**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

function createMyAppServer(db: YourDB) {
  const server = new McpServer({ name: "my-app", version: "1.0.0" })
  const tools = []

  // 用 registerTool 辅助函数注册工具（同时注册到 MCP Server 和收集定义）
  function registerTool(name, description, parameters, execute) {
    server.tool(name, description, parameters, execute)
    tools.push({ name, description, parameters, execute })
  }

  registerTool("query_data", "查询业务数据", {
    table: z.string().describe("表名"),
    filter: z.record(z.unknown()).optional().describe("过滤条件"),
  }, async ({ table, filter }) => {
    const data = db.query(table, filter)
    return { content: [{ type: "text", text: JSON.stringify(data) }] }
  })

  return { server, tools }
}
```

**3. 初始化 Runtime**

```ts
import { createRuntime } from "@agent-runtime/core/app-runtime"
import { registerInternalServer } from "@agent-runtime/mcp"
import { Effect } from "effect"

const db = createMyDB()
const mcpServer = createMyAppServer(db)

// 注册内嵌服务器
await Effect.runPromise(registerInternalServer("my-app", mcpServer))

// 创建 Runtime
const runtime = createRuntime({
  providers: { openai: { apiKey: process.env.OPENAI_API_KEY } },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
})
```

**4. 使用 Runtime**

```ts
import { Session } from "@agent-runtime/session/session"

const result = await runtime.runPromise(
  Effect.gen(function* () {
    const sessionService = yield* Session.Service
    const session = yield* sessionService.create("assistant")
    return yield* sessionService.run(session.id, {
      message: "帮我查一下上个月的订单数据",
      onEvent: (event) => console.log(event),
    })
  })
)
```

---

## 8. 扩展指南

### 8.1 自定义 Skill

Skill 是注入到 Agent System Prompt 中的 Markdown 行为指南。你可以定义自己的 Skill 来引导 Agent 行为。

#### 通过配置注册

```ts
const runtime = createRuntime({
  providers: { openai: { apiKey: "sk-..." } },
  defaultModel: { modelID: "gpt-4o", providerID: "openai" },
  skills: {
    "interview-generator": {
      description: "Generate structured interview questions based on JD and candidate profile",
      content: `# Interview Generation Skill

## Overview
Generate structured interview questions for candidate evaluation.

## Question Categories
1. **Technical Skills** (30%): Questions assessing technical competency
2. **Behavioral** (30%): STAR-format behavioral questions
3. **Cultural Fit** (20%): Team dynamics and values alignment
4. **Problem Solving** (20%): Case study and scenario questions

## Output Format
For each question provide:
- Category
- Question text
- Expected answer direction
- Evaluation criteria (1-5 scale)
- Time allocation (minutes)

## Rules
- Tailor questions to the specific JD requirements
- Include at least 2 questions per category
- Avoid discriminatory or illegal questions
- Provide scoring rubric for consistency`,
    },
  },
})
```

#### 通过代码动态注册

```ts
import { Skill } from "@agent-runtime/skill"
import { Effect } from "effect"

await runtime.runPromise(
  Effect.gen(function* () {
    const skillService = yield* Skill.Service

    // 注册单个 Skill
    yield* skillService.register({
      name: "salary-analysis",
      description: "Analyze salary benchmarks and market data",
      content: `# Salary Analysis Skill

## Overview
Analyze salary competitiveness against market benchmarks.

## Analysis Dimensions
1. **Market Position**: Percentile ranking
2. **Internal Equity**: Compared to similar roles
3. **Geographic Adjustment**: Cost of living
4. **Experience Premium**: Years of experience

## Output Format
- Current salary vs market median
- Recommended adjustment
- Risk assessment (flight risk)`,
    })

    // 批量注册
    yield* skillService.registerMany([
      {
        name: "onboarding-plan",
        description: "Generate onboarding plans for new hires",
        content: "# Onboarding Plan Skill\n\n## Overview\n...",
      },
      {
        name: "exit-interview",
        description: "Conduct exit interview analysis",
        content: "# Exit Interview Skill\n\n## Overview\n...",
      },
    ])
  })
)
```

#### 查看可用 Skill

```ts
await runtime.runPromise(
  Effect.gen(function* () {
    const skillService = yield* Skill.Service

    // 列出所有 Skill
    const allSkills = yield* skillService.all()

    // 列出某个 Agent 可用的 Skill（受权限过滤）
    const { Agent } = yield* Effect.service(Agent.Service)
    const agent = yield* Agent.Service.get("screener")
    const availableSkills = yield* skillService.available(agent)

    // 格式化 Skill 列表（用于注入 prompt）
    import { formatSkills } from "@agent-runtime/skill"
    console.log(formatSkills(availableSkills))
  })
)
```

### 8.2 自定义 Agent

你可以注册自己的 Agent，定义其行为、可用工具和权限。

#### 基本注册

```ts
import { Agent } from "@agent-runtime/agent"
import { Effect } from "effect"

await runtime.runPromise(
  Effect.gen(function* () {
    const agentService = yield* Agent.Service

    yield* agentService.register({
      name: "interviewer",
      description: "Interview question generation and evaluation specialist",
      mode: "subagent",  // 被其他 Agent 调用
      prompt: `You are a professional interview specialist for HR operations.

Your task is to:
1. Generate structured interview questions based on JD requirements
2. Create evaluation rubrics for consistent scoring
3. Suggest follow-up questions based on candidate responses

Always tailor questions to the specific role and level.`,
      permission: [
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "interview", pattern: "*", action: "allow" },
      ],
      tools: ["get_jd", "get_resume", "list_resumes"],  // 可用工具白名单
      temperature: 0.4,
    })
  })
)
```

#### 注册 Primary Agent

```ts
yield* agentService.register({
  name: "hr-copilot",
  description: "Primary HR copilot that coordinates all HR operations",
  mode: "primary",  // 面向用户
  prompt: `You are an AI HR Copilot named 小七 (Seven).

You help HR professionals with:
- Resume screening and evaluation
- Interview preparation
- Compliance checking
- Salary analysis
- Onboarding planning

Always be helpful, professional, and evidence-based.
Delegate specialized tasks to the appropriate sub-agents.`,
  permission: [
    { permission: "*", pattern: "*", action: "allow" },  // 完全权限
  ],
  tools: [
    "chat", "think",
    "list_projects", "get_project", "create_project",
    "list_resumes", "get_resume",
    "get_jd", "save_jd",
    "save_screening_result",
  ],
  temperature: 0.7,
})
```

#### 为 Agent 指定模型

```ts
// 方式 1：在 createRuntime 配置中指定
const runtime = createRuntime({
  agentModels: {
    interviewer: { modelID: "claude-sonnet-4", providerID: "anthropic" },
  },
})

// 方式 2：在 Agent 定义中指定
yield* agentService.register({
  name: "interviewer",
  mode: "subagent",
  model: { modelID: "gpt-4o-mini", providerID: "openai" },  // 覆盖全局配置
  // ...
})
```

### 8.3 自定义 MCP 工具

#### 在内嵌 MCP Server 中添加工具

编辑 `src/agent-runtime/src/mcp-server/index.ts`，使用 `registerTool` 辅助函数：

```ts
// 使用 registerTool 辅助函数（同时注册到 MCP Server 和收集定义）
registerTool(
  server,    // McpServer 实例
  tools,     // InternalToolDefinition[] 收集数组
  "search_candidates",   // 工具名
  "Search candidates by skills, experience, or keywords",  // 描述
  {
    // Zod schema 定义参数（会自动转为 JSON Schema 给模型）
    keywords: z.array(z.string()).describe("Search keywords"),
    min_experience: z.number().optional().describe("Minimum years of experience"),
    skills: z.array(z.string()).optional().describe("Required skills"),
    location: z.string().optional().describe("Preferred location"),
  },
  async ({ keywords, min_experience, skills, location }) => {
    // 实现查询逻辑
    const candidates = db.select().from(schema.resumes).all()

    // 过滤和排序
    const filtered = candidates.filter(c => {
      // ... 过滤逻辑
      return true
    })

    return {
      content: [{
        type: "text",
        text: JSON.stringify(filtered, null, 2),
      }],
    }
  },
)
```

**`registerTool` 辅助函数的工作原理：**

```ts
function registerTool(
  server: McpServer,
  tools: InternalToolDefinition[],
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  execute: (args: Record<string, unknown>) => Promise<McpToolResult>,
) {
  // 同时做两件事：
  // 1. 注册到 MCP Server（供 MCP 协议发现）
  server.tool(name, description, parameters, async (args) => {
    return (await execute(args)) as McpToolResult
  })

  // 2. 收集到 tools 数组（供 Agent Runtime 的 MCP 模块直接调用）
  tools.push({ name, description, parameters, execute: execute as InternalToolDefinition["execute"] })
}
```

#### 创建独立的内嵌 MCP Server

如果你想创建一个全新的内嵌 MCP Server（不修改现有代码）：

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { InternalMcpServer, InternalToolDefinition } from "@/agent-runtime/mcp/index"

export function createAnalyticsServer(analyticsClient: any): InternalMcpServer {
  const server = new McpServer({
    name: "hr-analytics",
    version: "1.0.0",
  })

  const tools: InternalToolDefinition[] = []

  function registerTool(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    execute: (args: Record<string, unknown>) => Promise<any>,
  ) {
    server.tool(name, description, parameters, execute)
    tools.push({ name, description, parameters, execute })
  }

  registerTool("get_turnover_rate", "Get employee turnover rate", {
    department: z.string().optional().describe("Department filter"),
    period: z.enum(["quarter", "year"]).describe("Time period"),
  }, async ({ department, period }) => {
    const data = analyticsClient.getTurnoverRate({ department, period })
    return { content: [{ type: "text", text: JSON.stringify(data) }] }
  })

  registerTool("get_hiring_funnel", "Get hiring funnel metrics", {
    project_id: z.string().describe("Project ID"),
  }, async ({ project_id }) => {
    const data = analyticsClient.getHiringFunnel(project_id)
    return { content: [{ type: "text", text: JSON.stringify(data) }] }
  })

  return { server, tools }
}
```

注册到 Runtime：

```ts
import { registerInternalServer } from "@agent-runtime/mcp"
import { createAnalyticsServer } from "./my-analytics-server"
import { Effect } from "effect"

const analyticsServer = createAnalyticsServer(myAnalyticsClient)
await Effect.runPromise(registerInternalServer("hr-analytics", analyticsServer))
```

注册后，工具命名为 `internal_hr-analytics_get_turnover_rate` 和 `internal_hr-analytics_get_hiring_funnel`。

#### 连接外部 MCP Server

```ts
import { MCP } from "@agent-runtime/mcp"
import { Effect } from "effect"

// 连接外部 MCP Server
await runtime.runPromise(
  Effect.gen(function* () {
    const mcpService = yield* MCP.Service

    // 连接本地 MCP Server
    yield* mcpService.connect("filesystem", {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"],
    })

    // 连接远程 MCP Server
    yield* mcpService.connect("remote-api", {
      type: "remote",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer token" },
    })

    // 查看连接状态
    const status = yield* mcpService.status()
    console.log(status)
    // { filesystem: { status: "connected" }, remote-api: { status: "connected" } }

    // 列出所有可用工具
    const tools = yield* mcpService.tools()
    console.log(tools.map(t => t.name))
    // ["filesystem_read_file", "filesystem_write_file", "remote-api_search", ...]
  })
)
```

### 8.4 自定义 Plugin Hook

```ts
import { Plugin } from "@agent-runtime/plugin"
import { Effect } from "effect"

await runtime.runPromise(
  Effect.gen(function* () {
    const pluginService = yield* Plugin.Service

    // 注册工具执行前的审计钩子
    yield* pluginService.registerHook("tool.execute.before", async (input, output) => {
      console.log(`[AUDIT] Tool "${input.name}" called with args:`, input.args)
    })

    // 注册工具执行后的日志钩子
    yield* pluginService.registerHook("tool.execute.after", async (input, output) => {
      console.log(`[AUDIT] Tool "${input.name}" returned:`, output)
    })

    // 注册自定义钩子
    yield* pluginService.registerHook("screening.completed", async (input, output) => {
      // 发送通知、更新统计等
      await notifyHRManager(input.projectID, output.summary)
    })
  })
)
```

### 8.5 使用 Permission 控制 Agent 行为

```ts
// 在 Agent 定义中设置权限
yield* agentService.register({
  name: "readonly-analyst",
  mode: "subagent",
  permission: [
    { permission: "read", pattern: "*", action: "allow" },      // 允许所有读操作
    { permission: "write", pattern: "*", action: "deny" },      // 禁止所有写操作
    { permission: "screening", pattern: "export", action: "ask" },  // 导出需确认
  ],
  tools: ["list_projects", "get_project", "list_resumes", "get_resume", "get_jd"],
  // 注意：没有 save_screening_result 等写工具
})
```

---

## 9. 推荐代码导读顺序

| 顺序 | 文件 | 关注点 | 行数 |
|------|------|--------|------|
| 1️⃣ | `index.ts` | 全局导出，建立模块全貌认知 | 138 |
| 2️⃣ | `core/runtime.ts` | 理解 `ManagedRuntime` + `memoMap` 机制 | 38 |
| 3️⃣ | `core/app-runtime.ts` | 看 `createAppLayer()` 的 Layer 拓扑组装 | 116 |
| 4️⃣ | `core/bridge.ts` | Effect ↔ Promise 桥梁（前端集成关键） | 49 |
| 5️⃣ | `config/index.ts` | 配置结构（providers、defaultModel、mcpServers、skills） | 118 |
| 6️⃣ | `agent/agent.ts` | 3 个内置 Agent 的定义和权限规则 | 179 |
| 7️⃣ | **`agent/tool-runtime.ts`** | ⭐ **核心中的核心**：工具调用循环引擎 | 263 |
| 8️⃣ | `provider/index.ts` | AI SDK 适配器实现（stream 转换逻辑、Zod schema 转换） | 313 |
| 9️⃣ | `session/processor.ts` | 流式事件处理器（text-delta / tool-start / finish） | 214 |
| 🔟 | `session/prompt.ts` | Prompt 组装 → ToolRuntime 调用 → 结果返回 | 154 |
| 1️⃣1️⃣ | `session/session.ts` | 会话生命周期管理（消息历史 + MCP 工具收集 + 内置工具） | 260 |
| 1️⃣2️⃣ | `mcp/index.ts` | MCP 客户端连接 + 内嵌服务器注册 + 工具发现 | 427 |
| 1️⃣3️⃣ | `src/tool-registry/index.ts` | Tool Registry 入口（注册所有 toolpack） | 627 |
| 1️⃣4️⃣ | `permission/index.ts` | 规则评估 + 通配符匹配 + Deferred 权限确认 | 196 |
| 1️⃣5️⃣ | `skill/index.ts` | 技能定义 + 格式化输出 + Agent 权限过滤 | 164 |
| 1️⃣6️⃣ | `stores/aiStore.ts` | 前端集成入口：Runtime 初始化 + 全局挂载 | 182 |
| 1️⃣7️⃣ | `services/agentService.ts` | 前端封装层：Session API 调用 + 事件映射 | 361 |

**阅读建议：**

- 初次阅读按 1→7 的顺序，重点关注 `tool-runtime.ts`
- 了解前端集成按 16→17 的顺序
- 扩展开发时参考 8.1-8.5 的具体章节

---

## 10. 常见问题

### Q1：为什么用 Effect 而不是直接用 Promise？

Effect 提供了：
- **依赖注入**：通过 Layer/Context 实现模块解耦，方便测试和替换
- **资源安全**：Scope 自动管理资源生命周期，不会泄漏
- **流式处理**：Stream 比 AsyncIterable 更强大（背压、错误恢复、组合）
- **错误类型安全**：Effect 的错误是类型级别的，不会遗漏处理

### Q2：内嵌 MCP Server 和外部 MCP Server 怎么选？

| 场景 | 推荐 | 原因 |
|------|------|------|
| 操作应用数据库 | 内嵌 | 零 IPC 开销，直接操作 |
| 调用外部 API | 外部 | 隔离运行，崩溃不影响主进程 |
| 文件系统操作 | 外部 | 更安全，MCP 协议天然沙箱化 |
| 调试/开发工具 | 外部 | 方便独立启动和测试 |

### Q3：Agent 的 tools 白名单和 Agent 的 permission 有什么区别？

- `tools`：**硬限制**，白名单外的工具 Agent 完全看不到
- `permission`：**软限制**，控制工具的使用权限（allow/deny/ask），受权限评估逻辑影响

### Q4：如何调试 Agent 的工具调用？

1. 使用 `onEvent` 回调监听所有事件：
   ```ts
   onEvent: (event) => console.log("[EVENT]", event.type, event.data)
   ```

2. 在 config 中开启 debug：
   ```ts
   createRuntime({ debug: true })
   ```

3. 注册 Plugin Hook 审计工具调用：
   ```ts
   Plugin.Service.registerHook("tool.execute.before", async (input, output) => {
     console.log("[TOOL CALL]", input)
   })
   ```

### Q5：如何限制 Agent 的循环步数？

```ts
// 全局限制（所有对话）
const result = yield* sessionService.run(sessionID, {
  message: "...",
  maxSteps: 10,  // 最多 10 步循环（默认 50，上限 100）
})

// 自定义停止条件
import { ToolRuntime } from "@agent-runtime"
// 使用 stepCountIs 工具函数
const stopWhen = ToolRuntime.stepCountIs(5)  // 5 步后停止
```

### Q6：如何处理工具执行超时？

MCP 配置中的 `timeout` 字段控制超时：

```ts
mcpServers: {
  "slow-api": {
    type: "remote",
    url: "https://slow-api.example.com/mcp",
    timeout: 120000,  // 2 分钟超时
  },
}
```

### Q7：为什么工具名有 `internal_` 前缀？

内嵌 MCP Server 的工具自动加上 `internal_{serverName}_` 前缀，外部 MCP Server 的工具自动加上 `{serverName}_` 前缀。这是为了：
1. **避免命名冲突**：不同服务器的同名工具不会冲突
2. **来源可追溯**：从工具名就能看出属于哪个服务器

### Q8：如何动态更新配置？

```ts
await runtime.runPromise(
  Effect.gen(function* () {
    const configService = yield* Config.Service

    // 切换模型
    yield* configService.set({
      defaultModel: { modelID: "claude-sonnet-4", providerID: "anthropic" },
    })

    // 添加新的 provider
    yield* configService.set({
      providers: {
        ...(yield* configService.get()).providers,
        deepseek: { apiKey: "sk-...", baseURL: "https://api.deepseek.com/v1" },
      },
    })
  })
)
```

---

## 附录：完整类型导出索引

```ts
// 从 @agent-runtime 导出的所有类型
export type AgentRuntimeConfig    // 配置结构
export type ModelConfig           // 模型配置
export type ProviderConfig        // 提供商配置
export type AgentInfo             // Agent 定义
export type ToolDefinition        // 工具定义
export type ToolCall              // 工具调用
export type ToolResult            // 工具执行结果
export type LLMStreamEvent        // LLM 流式事件
export type ModelMessage          // 模型消息
export type ContentPart           // 消息内容片段
export type ModelAdapter          // 模型适配器接口
export type StreamOptions         // ToolRuntime 流选项
export type StopCondition         // 停止条件函数
export type SessionInfo           // 会话信息
export type SessionMessage        // 会话消息
export type SessionRunOptions     // 会话运行选项
export type SessionRunResult      // 会话运行结果
export type PromptInput           // Prompt 输入
export type PromptResult          // Prompt 结果
export type ProcessorEvent        // 处理器事件
export type ProcessorEventData    // 处理器事件数据
export type ProcessorEventHandler // 处理器事件回调
export type ProcessorResult       // 处理器结果
export type PermissionAction      // 权限动作
export type PermissionRule        // 权限规则
export type PermissionRuleset     // 权限规则集
export type SkillInfo             // 技能信息
export type MCPConfig             // MCP 配置
export type MCPStatus             // MCP 状态
export type PluginHooks           // 插件钩子
export type HookHandler           // 钩子处理函数
export type ProviderInfo          // 提供商信息
export type BusEvent              // 总线事件
```
