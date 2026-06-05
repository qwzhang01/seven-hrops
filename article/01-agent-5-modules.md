# 写一个 Agent 平台时，我们把架构拆成了 5 个模块

> **Seven HROps 架构复盘 · 第一篇**
>
> 项目：Seven HROps（基于 Seven Markdown 的 Agent 运行平台）

---

## 背景

去年年底开始做 **Seven HROps** 的时候，最初的诉求很简单：

> 做一个 HR 招聘助手，能读简历、筛简历、生成评估报告。

做着做着，需求变成了：

- 内置 9 个 HR 能力（简历筛选、JD 优化、面试评价…）
- 用户能自己定义 Agent（通过自然语言描述）
- 能从远程仓库安装第三方 Agent
- 不同来源的工具权限不同（`builtin` / `user` / `marketplace`）
- 要支持 19+ 个 LLM 提供商（OpenAI、Claude、DeepSeek、Ollama…）

这时候发现，**一个 `while` 循环搞不定了**。

这篇文章记录的是：**我们在拆分 Agent 平台架构时，最终定了哪 5 个模块、为什么是这 5 个、以及每个模块背后的一些决策**。

---

## 一、先说案例：HR 招聘助手

用一个具体场景贯穿全文，后面讲每个模块时都会回到这个场景。

HR 小张发来一条消息：

> "帮我筛选一下昨天收到的 Java 后端简历，把符合要求的整理成 Excel，然后发给我。"

这句话里实际发生了：

1. **读取文件**（读取简历 PDF）
2. **解析内容**（提取技能、工作年限、项目经验）
3. **条件判断**（是否符合 JD 要求）
4. **写文件**（生成 Excel 评估报告）
5. **发送消息**（通过企微通知 HR）

如果用传统 Workflow 写，要预先画清楚所有分支。但 HR 的下一次提问可能是：

- "能把不符合的也单独列出来吗？"
- "顺便帮我写个面试邀请邮件吧"

**Agent 的价值就在这里**：让 LLM 在运行时决定调哪个工具、什么顺序、什么时候停。

但做一个**能上生产的 Agent 平台**，问题就多了：

- 工具权限怎么控制？
- 用户自定义 Agent 怎么隔离？
- 模型从 GPT 换到 Claude，要改多少代码？
- 工具执行失败了，Agent 怎么恢复？

这些问题的答案，都在架构拆分里。

---

## 二、五个模块：我们是这么拆的

先上图，再解释为什么是这五个：

```
                    ┌─────────────────────────────────────┐
                    │       Session（AgentLoop）           │
                    │  while + max_steps + abort          │
                    └─────────────┬───────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
 ┌──────────────┐        ┌──────────────┐         ┌──────────────┐
 │   Agent      │        │  Provider    │         │ ToolRuntime  │
 │  定义 + 注册  │        │  LLM 模型适配  │         │  工具执行循环  │
 └──────┬───────┘        └──────┬───────┘         └──────┬───────┘
        │                         │                        │
        └─────────────────────────┼────────────────────────┘
                                  │
                          ┌───────▼────────┐
                          │  ToolRegistry   │
                          │  工具登记 + 权限  │
                          └────────────────┘
```

| 模块 | 职责 | 在 HR 案例里干嘛用 |
|------|------|---------------------|
| **Agent** | Agent 定义 + 注册中心 | 定义"简历筛选 Agent"可用哪些工具、用什么 Prompt |
| **Provider** | LLM 统一适配层 | 把 OpenAI / Claude / DeepSeek 归一化成一个接口 |
| **ToolRegistry** | 工具登记处 + 分级授权 | 登记 `read_file` / `parse_pdf` 等工具，控制谁能调用 |
| **ToolRuntime** | 工具解析 + 执行 + 结果回传 | 拿到 LLM 的"我要调 parse_pdf"，真去调 |
| **Session** | 会话管理 + AgentLoop | 决定什么时候继续推理、什么时候停、怎么处理中断 |

### 为什么是这五个，不是三个或八个？

我们当时的判断标准是：**职责能否独立替换、独立测试、独立扩展**。

- 少一个 → 扩展时就要改到不该改的地方（比如加工具要改主循环）
- 多一个 → 在制造没必要的抽象（比如把 `ToolRegistry` 拆成 `ToolRegistry` + `ToolPermission` + `ToolSchema`）

但更重要的是，这五个模块的拆分背后有一条**我们踩坑踩出来的不变量**：

> **Single Loop 不变量**：整个系统只有 **一个** Agentic Loop，在 `ToolRuntime` 里。Provider 层只负责发出 `tool-call` 事件，**不执行工具**。

这条不变量我们是在做多模型适配时踩坑踩出来的，后面会详细说。

---

## 三、Agent 模块：定义即注册

### 3.1 最早的版本（反例）

项目初期，我们把 Agent 定义硬编码在代码里：

```typescript
// v0.1 版本：Agent 定义硬编码
const AGENTS = {
  "resume-screening": {
    prompt: "你是简历筛选专家...",
    tools: ["read_file", "parse_pdf", "write_file"],
    model: "gpt-4o"
  }
}
```

这个写法很快遇到两个问题：

1. **加新 Agent 要改代码** —— 但我们要支持用户自定义 Agent
2. **Agent 定义散落在各处** —— Prompt、工具列表、模型配置混在一起，改起来容易漏

### 3.2 我们的解法：Agent 即数据

后来的做法是：**Agent 是一个 Schema 校验的数据结构**，通过 `AgentLoader` 从 HSAS Manifest 加载。

```typescript
// src/agent-runtime/agent/agent.ts

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary"]),
  model: Schema.optional(
    Schema.Struct({
      modelID: Schema.String,
      providerID: Schema.String,
    })
  ),
  prompt: Schema.optional(Schema.String),
  permission: Schema.Array(/*...*/),
  tools: Schema.optional(Schema.Array(Schema.String)),
  temperature: Schema.optional(Schema.Number),
})
```

**这样设计的原因**：

1. **Agent 定义与代码解耦** —— 内置 / 用户自定义 / 市场安装**使用完全相同的加载流程**，不需要 `if (source === 'builtin')` 之类的分支
2. **运行时注册** —— `Agent.Service` 提供 `register()` / `unregister()` API，支持动态加载
3. **Schema 校验** —— 使用 Effect.ts 的 `Schema` 做运行时类型校验

### 3.3 技术选型：为什么用 Effect.ts 的 Schema 而不是 Zod？

这个问题当时也讨论过。

最终选择 Effect.ts Schema 的原因是：**整个项目使用 Effect.ts 做异步流编排**，Schema 是 Effect 生态的一部分，和 `Effect.gen`、`Layer`、`Context` 无缝集成。

如果混用 Zod，会在类型流动和错误处理上产生摩擦——比如 Zod 的 `safeParse` 返回 `{ success, data, error }`，而 Effect.ts 的 Schema 直接融入 `Effect.gen` 的 `yield*` 流程。

---

## 四、Provider 模块：一个适配器，支持了 19 个 LLM

### 4.1 问题是怎么出现的

项目做了一段时间后，合规那边提了一个需求：

> "数据不能出境外，把模型换成 DeepSeek。"

然后产品经理又提了一个需求：

> "我们要支持本地部署的 Qwen，有些客户想用自己的模型。"

如果 `Session` 里直接写：

```typescript
// 反例：直接依赖具体 Provider
const response = await openai.chat.completions.create({...})
```

那每次换模型都要改主循环——这是**耦合**。

### 4.2 我们的解法：适配器模式

所有 LLM 提供商实现同一个接口，业务只依赖接口：

```typescript
// src/agent-runtime/provider/index.ts

export interface ModelAdapter {
  readonly stream: (options: {
    messages: ReadonlyArray<ModelMessage>
    tools: ReadonlyArray<ToolDefinition>
    systemPrompt?: string
    temperature?: number
  }) => Stream.Stream<LLMStreamEvent, Error>
}
```

**19 个 Provider 的适配工作我们拆成了三层**：

```
┌─────────────────────────────────────────────────────────┐
│  Provider.Service（Service 层壳）                       │
│  - createModelAdapter(providerID, modelID) → ModelAdapter │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                         │
┌─────────────────────┐    ┌─────────────────────────┐
│  ProviderRegistry   │    │  ProtocolAdapters       │
│  (registry.ts)     │    │  (protocols/*)          │
│  - resolve()       │    │  - openai-native        │
│  - 19 个插件      │    │  - openai-compatible    │
└─────────────────────┘    │  - anthropic-messages   │
                            │  - prompt-style-tool-call│
                            └─────────────────────────┘
```

**关键点**：

1. **协议归一化** —— 19 个 Provider 归纳为 4 种协议形态：
   - `openai-native`（OpenAI、Groq、Together 等）
   - `openai-compatible`（DeepSeek、Qwen、Doubao 等）
   - `anthropic-messages`（Claude 专用）
   - `prompt-style-tool-call`（豆包、Qwen 某些版本不支持原生 Function Calling，要把工具调用伪装成文本）

2. **Plugin 架构** —— 每个 Provider 是一个薄插件，放在 `plugins/` 目录，新增 Provider 只需加一个文件

3. **Dynamic Provider** —— 允许用户自定义 Provider（填 baseURL + apiKey），有白名单 + 二次确认机制

### 4.3 踩坑记录：Single-Loop 不变量

这部分是我们实际踩过的一个坑。

AI SDK（Vercel AI SDK）支持传 `execute` 函数给工具定义，让 SDK 自动执行工具调用。初期我们这么做了，然后遇到两个问题：

**问题 1：死锁**

SDK 等着 `tool-result`，但 `ToolRuntime` 已经执行了工具，SDK 永远收不到结果，UI 一直转圈。

**问题 2：双重执行**

同一个工具被执行两次，对话历史爆炸，`maxSteps` 会计数漂移。

**解法**：

```typescript
// src/agent-runtime/provider/index.ts (createAdapter 函数)

const aiSdkTools = convertToAiSdkToolsForDeclarationOnly(options.tools)
//                               ^^^^^^^^^^^^^^^^^^^^^^^^^
//                              只传 declaration，不传 execute

const result = streamText({
  model: resolved.sdkInstance,
  tools: aiSdkTools,           // 不含 execute
  stopWhen: aiStepCountIs(1),  // 关键：只让 SDK 跑一步
  // ...
})
```

**现在的规则是**：

> Provider 层 **SHALL NOT** 执行工具。Agent Loop 归 ToolRuntime 独占。

这条规则我们写进了 `arch-runtime-single-loop` 的架构文档里，作为不变量来遵守。

---

## 五、ToolRegistry 模块：工具的单一真相源

### 5.1 问题：工具权限怎么控制？

生产环境真实遇到的需求：

1. **内置工具**（如 `read_file`、`parse_pdf`）—— 所有 Agent 都能用
2. **系统工具**（如 `activate_capability`、`delegate_to_subagent`）—— 只有内置 Agent 能用
3. **网络工具**（如 `get_weather`）—— 用户自定义 Agent 可以用，但首次使用要弹确认框
4. **Builder 工具**（如 `create_agent_manifest`）—— 只有 `builder` 模式的 Agent 能用

如果权限检查散落在工具执行函数里，每加一个权限规则就要改 N 个工具函数。

### 5.2 我们的解法：单一真相源（Single Source of Truth）

**所有工具的元数据集中定义在一个文件里**：

```typescript
// src/tool-registry/toolpacks/_registry.ts

export const TOOL_REGISTRY: Readonly<Record<string, ToolMeta>> = Object.freeze({
  read_file: {
    name: "read_file",
    category: "safe",
    riskLevel: "low",
    description: "Read a UTF-8 text file. Sandbox-gated by session_id.",
    defaultAllowedSources: ["builtin", "user", "marketplace"],
    requireApproval: false,
    parameters: { /*...*/ },
  },
  activate_capability: {
    name: "activate_capability",
    category: "control",
    riskLevel: "high",
    description: "Switch the runtime active Capability.",
    defaultAllowedSources: ["builtin"],  // 只有内置代码能调用
    requireApproval: false,
    ownerAgent: "assistant",  // 只有 assistant Agent 能调用
    parameters: { /*...*/ },
  },
})
```

**三层权限隔离**：

| 层级 | 检查点 | 作用 |
|------|--------|------|
| **Source 层** | `defaultAllowedSources` | 控制工具对哪些来源开放 |
| **Agent 层** | `ownerAgent` | 工具归属某个 Agent，其他 Agent 调用会被拒绝 |
| **运行时层** | `requireApproval` / `requiresPermissionPrompt` | 控制是否需要用户确认 |

### 5.3 一个设计细节：注册时校验，而不是运行时

我们在 `register` 函数里加了一些强制校验：

```typescript
// src/platform/registry/toolRegistry.ts (register 函数)

const register = (meta: ToolMeta, invoker: ToolInvoker): void => {
  // 网络工具允许 user source 但未声明 requiresPermissionPrompt → 注册时直接报错
  if (meta.category === "network" && 
      meta.defaultAllowedSources.includes("user") && 
      !meta.requiresPermissionPrompt) {
    throw new Error(`NetworkToolMustGatePermission: ...`)
  }
  // ...
}
```

**这样设计的原因**：在注册时而不是运行时捕获错误。如果网络工具忘了加 `requiresPermissionPrompt`，注册时直接 `throw`，而不是上线后才发现用户 Agent 在静默调网络。

---

## 六、ToolRuntime 模块：Agent Loop 的唯一住所

### 6.1 核心循环

`ToolRuntime` 是整个系统的**心脏**，逻辑是：

1. 调用 `ModelAdapter.stream()` 获取 LLM 响应流
2. 累加 `tool-calls` 事件
3. 并发执行所有工具调用
4. 把工具结果喂回 LLM
5. 重复直到 LLM 停止（不再返回 tool_calls）

```typescript
// src/agent-runtime/agent/tool-runtime.ts

export const stream = (options: StreamOptions): Stream.Stream<LLMStreamEvent, Error> => {
  const loop = (messages: ReadonlyArray<ModelMessage>, step: number): Stream.Stream<...> =>
    Stream.unwrap(
      Effect.gen(function* () {
        // 1. 调 LLM
        const modelStream = options.model.stream({ messages, tools, ... })

        // 2. 累加 LLM 事件（text-delta / tool-call / finish）

        // 3. 如果本轮有 tool_calls，并发执行
        if (state.toolCalls.length > 0) {
          const dispatched = yield* Effect.forEach(
            state.toolCalls,
            (call) => dispatch(toolsByName, call, toolTimeoutMs),
            { concurrency: 10 }  // 并发执行
          )

          // 4. 把结果喂回 LLM，继续循环
          return resultStream.pipe(
            Stream.concat(loop(followUpMessages, step + 1))
          )
        }

        // 5. 没有 tool_calls → 结束
        return Stream.empty
      })
    )

  return loop(options.messages, 0)
}
```

**几个设计细节**：

1. **并发执行工具** —— 如果 LLM 一次返回 3 个互不依赖的 tool_call，用 `Effect.forEach(..., { concurrency: 10 })` 并发执行，延迟减半
2. **超时保护** —— 每个工具调用有 30s 超时，避免某个工具卡死导致整个 Agent 挂掉
3. **错误不终止** —— 工具执行失败返回 `tool-error` 事件，让 LLM 决定重试还是放弃

### 6.2 关于 DAG 的讨论

有人可能会问：

> "你这个 `while` 循环能处理复杂的工具依赖吗？比如工具 A 的结果是工具 B 的入参？"

我们的答案是：

- **简单依赖**（A → B → C）：LLM 会在第一轮调 A，拿到结果后在第二轮调 B，以此类推。`while` 循环天然支持。
- **复杂 DAG**（A 和 B 并行，结果汇合后调 C）：这才是 LangGraph 的强项。

但我们的经验是，**90% 的 HR 场景用简单依赖就够了**。等真的需要 DAG 时，再引入 LangGraph 也不迟。

**架构取舍**：

> 先让 90% 的场景跑起来，剩下的 10% 留扩展点。一开始就上 DAG，复杂度会劝退一半贡献者。

---

## 七、Session 模块：把所有人串起来

### 7.1 Session 的职责

`Session` 模块是 **AgentLoop 的编排者**，负责：

1. 创建会话 —— `Session.create(agentName)`
2. 运行会话 —— `Session.run(sessionID, { message, ... })`
3. 历史管理 —— `Session.getHistory(sessionID)`
4. 中断支持 —— `Session.abort(sessionID)`

```typescript
// src/agent-runtime/session/session.ts

const run = Effect.fn("Session.run")(function* (sessionID: string, options: SessionRunOptions) {
  // 1. 解析 Agent + Model
  const runAgentName = options.agentName ?? state.info.agentName
  const modelConfig = yield* configService.getModel(runAgentName)
  const modelAdapter = yield* providerService.createModelAdapter(modelConfig)

  // 2. 创建沙箱会话（Sandbox Session）
  yield* Effect.promise(() => toolRegistry.createSandboxSession(sessionID))

  // 3. 收集工具（MCP + 内置）
  const mcpTools = yield* mcpService.tools()
  const builtInTools = createBuiltInTools(sessionID)

  // 4. 启动 ToolRuntime 流（fork 到子 Fiber，支持中断）
  const fiber = yield* Effect.forkChild(promptService.run({
    sessionID,
    message: options.message,
    tools: [...mcpTools, ...builtInTools],
    model: modelAdapter,
    // ...
  }))

  // 5. 等待结果（如果 abort，Fiber 会被 interrupt）
  let result: PromptResult
  try {
    result = yield* Fiber.join(fiber)
  } finally {
    // 6. 清理沙箱会话
    void toolRegistry.dropSandboxSession(sessionID)
  }

  return { sessionID, content: result.content, finishReason: result.finishReason }
}))
```

**几个设计细节**：

1. **Effect.ts Fiber 做中断** —— `Session.abort()` 调用 `Fiber.interrupt()`，立即中断正在运行的 Agent
2. **Sandbox Lifecycle** —— `createSandboxSession` → `ToolRuntime.run` → `dropSandboxSession`，保证工具调用的路径安全性
3. **MCP 集成** —— 除了内置工具，还支持从 MCP Server 动态发现工具

---

## 八、串起来：一次完整的简历筛选请求

把 5 个模块组装起来，跑一遍小张的那条消息：

```
┌──────────────────────────────────────────────────────────────────┐
│ 小张：帮我筛选一下昨天收到的 Java 后端简历，把符合要求的   │
│       整理成 Excel，然后发给我。                              │
└──────────────────────────┬─────────────────────────────────────┘
                           │
           ════════════  Session.run() ════════════
                           │
            ┌──────────────▼──────────────┐
            │ Session.create("resume-screening") │
            │ → 加载 Agent 定义               │
            │ → 创建 Sandbox Session          │
            └──────────────┬──────────────┘
                           │
          ════════════ 第 1 轮 ════════════
                           │
            ┌──────────────▼──────────────┐
            │ Provider.stream()             │
            │ → LLM 返回:                   │
            │   tool_calls: [               │
            │     { name: "read_file",      │
            │       args: { path: "./resumes/" } } │
            │   ]                             │
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │ ToolRuntime.dispatch()        │
            │ → 执行 read_file             │
            │ → 返回文件列表                │
            └──────────────┬──────────────┘
                           │
          ════════════ 第 2 轮 ════════════
                           │
            ┌──────────────▼──────────────┐
            │ Provider.stream()             │
            │ → LLM 返回:                   │
            │   tool_calls: [               │
            │     { name: "parse_pdf",      │
            │       args: { path: "..." } } │
            │   ]                             │
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │ ToolRuntime.dispatch()        │
            │ → 并发执行多个 parse_pdf     │
            │ → 提取技能、工作年限、项目经验 │
            └──────────────┬──────────────┘
                           │
          ════════════ 第 3~N 轮 ════════════
                           │
            │ （循环直到 LLM 认为信息足够）
                           │
            ┌──────────────▼──────────────┐
            │ Provider.stream()             │
            │ → LLM 返回最终文本            │
            │   （不再有 tool_calls！）       │
            └──────────────┬──────────────┘
                           │
                           ▼
                  Session.finish()
                  → 返回最终结果给前端
```

**注意几个关键点**：

1. **LLM 一次返回多个 `parse_pdf`** —— `ToolRuntime` 并发执行，延迟减半
2. **整条链路上 `Session` 完全不知道工具是什么、模型是什么** —— 它只串模块
3. **换模型、加工具、改业务，主循环一行不用改**

---

## 九、上线后会撞墙的三件事

五模块跑通了，但生产环境的真正难题在后面。

### 9.1 持久化：小张明天还能接着聊吗？

最小实现里 `Session` 的状态存在内存 `Map` 里。一旦进程重启就什么都没了。

**扩展点在 `Session` 模块** —— 让 `InternalSessionState` 能 `dump()` 成 JSON，`load()` 回来。

我们的做法是把扩展点放在 `Session` 模块，但具体用 Redis 还是 PostgreSQL，因业务而异。关键是 **`Session.run` 一行不改**——它只看到一个 `InternalSessionState` 对象，至于这对象是新建的还是从存储里 load 出来的，与它无关。

### 9.2 上下文窗口：聊到第 30 轮怎么办？

小张聊到第 30 轮，`messages` 累计超过模型上下文窗口 → 报错。

**扩展点在 `SessionPrompt` 模块**，提供两种策略：

1. **截断**：丢最早的非 system 消息，简单但会丢信息
2. **压缩**：把早期对话用 LLM 摘成几百 token 的摘要，替换原消息

线上常见做法是**混合** —— 近 5 轮原文保留，再早的全部压缩成一段 summary。

### 9.3 用户自定义 Agent：不动核心代码扩能力

最后一个问题：

> "如果 HR 想加一个『薪酬测算』能力，但不让改 Agent 主代码，怎么做？"

**答案是 HSAS Manifest + AgentLoader。**

用户写一个 YAML 文件：

```yaml
# capabilities/salary-calculator/manifest.yaml
name: salary-calculator
description: 根据候选人的期望薪酬和历史薪酬计算薪酬区间
mode: primary
prompt: |
  你是薪酬测算专家。你可以：
  1. 读取历史薪酬数据（read_file）
  2. 计算薪酬区间（think）
  3. 生成薪酬报告（export_to_excel）
tools:
  - read_file
  - think
  - export_to_excel
```

`AgentLoader` 在平台启动时自动扫描 `capabilities/` 目录，加载所有 Manifest，调用 `Agent.Service.register()` 注册。

**全程不碰主循环**。

---

## 十、技术选型：为什么是这些技术？

### 10.1 为什么用 Effect.ts？

Effect.ts 是一个基于 TypeScript 的函数式编程框架。我们选它的原因是：

**Agent 系统本身就是一堆异步流的组合**，Effect 的 `Stream` / `Fiber` / `Layer` 正好对应这些需求：

1. **类型安全的依赖注入**（`Context.Service` / `Layer`）
2. **结构化并发**（`Fiber` / `forkChild` / `interrupt`）
3. **Schema 校验**（`Schema.Struct` / `Schema.Literals`）
4. **Stream 抽象**（`Stream.Stream<Event, Error>`）

不用 Effect.ts 可以吗？可以，但你得自己处理依赖注入、并发取消、错误类型、Schema 校验——相当于自己造一个简化的 Effect.ts。

### 10.2 为什么用 Tauri 2 而不是 Electron？

Tauri 2 的优势：

1. **体积小**：后端是 Rust，前端是 WebView，打包体积 ~10MB（Electron 是 ~150MB）
2. **安全性高**：Rust 后端可以做严格的 FS / Network 沙箱
3. **跨平台**：Windows / macOS / Linux 都支持

代价是 Rust 学习曲线陡，前端同学可能需要适应。

### 10.3 为什么不用 LangChain / LangGraph？

我们不是"不用"，而是"**先理解最小实现，再决定用不用**"。

LangChain 的 `AgentExecutor` 内核仍然是一个 `while` 循环，只是被 Chain 包了一层。LangGraph 把 `while` 换成了图，多了 Checkpoint、Interrupt、Human-in-the-loop 等生产级能力。

**我们的策略**：

1. **内核自己写** —— 确保理解每个细节，出问题时能快速定位
2. **外部能力用现成的** —— MCP 集成、Tool Calling 优化用 AI SDK
3. **等真的需要 DAG 时** —— 再引入 LangGraph，替换 `ToolRuntime`

---

## 十一、和主流框架的对应关系

理解五模块之后再看框架，就清晰多了：

| 模块 | Seven HROps | LangChain | LangGraph |
|------|-------------|-----------|-----------|
| 工具登记 | `ToolRegistry` | `@tool` + `ToolExecutor` | `ToolNode` |
| Agent 定义 | `Agent.Service` + `Schema` | `AgentExecutor` | `StateGraph` |
| LLM 调用 | `Provider` + `ModelAdapter` | `ChatModel.invoke()` | 同左 |
| 工具执行 | `ToolRuntime.stream()` | `AgentExecutor._execute` | `ToolNode.run()` |
| 主循环 | `Session.run()`（`while` + `Fiber`） | `AgentExecutor.run()` | `StateGraph.compile().invoke()` |
| 权限控制 | `ToolRegistry` 三层隔离 | 无原生支持 | 无原生支持 |
| 多模型 | `ProviderRegistry` + 19 个插件 | `ChatModel` 切换 | 同左 |

---

## 十二、总结

回头看，五个模块的拆分背后有一条主线：

> **每个模块都能独立替换、独立测试、独立扩展。**

具体说：

1. **Agent 模块** —— Agent 定义与代码解耦，通过 Manifest 加载
2. **Provider 模块** —— 19 个 LLM 适配器，统一接口
3. **ToolRegistry 模块** —— 工具的单一真相源，三层权限隔离
4. **ToolRuntime 模块** —— Agent Loop 的唯一住所，并发执行工具
5. **Session 模块** —— 把所有人串起来，支持中断和持久化

**一个核心不变量**：

> Single Loop —— 整个系统只有一个 Agentic Loop，在 `ToolRuntime` 里。Provider 层不执行工具。

**技术选型的核心判断**：

> 先理解最小实现，再决定用不用框架。框架替换的是编排方式，不是能力本身。

---

## 后记

这篇文章是基于 **Seven HROps** 真实代码的架构拆解。项目代号 "HROps" 是 HR Operations 的缩写，但架构是通用的——换掉工具集和 Prompt，你可以用它做客服、做代码助手、做数据分析。

**下一篇预告**：《Agent 平台的权限系统设计：三层隔离 + Sandbox + FS Guard》

---

**参考资料**：

- 项目地址：`（待补充）`
- OpenCode Agent Runtime：`https://github.com/opencode/opencode`（我们的 `ToolRuntime` 借鉴了 OpenCode 的设计）
- Effect.ts 官方文档：`https://effect.website/`
- Vercel AI SDK：`https://sdk.vercel.ai/`

---

*如果你也在做 Agent 平台，欢迎交流。有问题可以在评论区讨论。*
