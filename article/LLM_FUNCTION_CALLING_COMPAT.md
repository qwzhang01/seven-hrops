# LLM Function-Calling 协议兼容性排查经验

> **创建时间**：2026-06-02  
> **问题来源**：简历筛选能力中，豆包模型无法正确执行多轮工具调用（list_dir → parse_pdf）  
> **根因**：豆包模型不支持 AI SDK 原生 function-calling 消息格式，需要使用 prompt-style 协议

---

## 问题现象

### 预期行为
1. 用户导入简历 PDF 到 `01_inputs/` 目录
2. Agent 调用 `list_dir` 工具列出目录内容
3. Agent 根据 `list_dir` 返回的 tool-result，调用 `parse_pdf` 工具解析 PDF
4. 简历被成功解析和评估

### 实际行为
1. ✅ Agent 成功调用 `list_dir` 工具
2. ✅ `list_dir` 返回正确的 tool-result（包含 PDF 文件名）
3. ❌ Agent **没有**调用 `parse_pdf` 工具
4. ❌ 简历没有被解析

### 错误日志
```
AI_InvalidPromptError: The messages do not match the ModelMessage[] schema
```

---

## 根因分析

### 不同模型的 Function-Calling 协议差异

| 模型 | Function-Calling 协议 | 消息格式支持 | 需要预处理 |
|------|----------------------|-------------|-----------|
| **Claude (Anthropic)** | 原生 function-calling | ✅ 支持 AI SDK 标准格式 | ❌ 不需要 |
| **OpenAI GPT** | 原生 function-calling | ✅ 支持 AI SDK 标准格式 | ❌ 不需要 |
| **DeepSeek** | OpenAI 兼容 | ✅ 支持 AI SDK 标准格式 | ❌ 不需要 |
| **豆包 (Doubao)** | prompt-style | ❌ **不支持** AI SDK 标准格式 | ✅ 需要 |
| **Qwen (通义千问)** | prompt-style | ❌ **不支持** AI SDK 标准格式 | ✅ 需要 |
| **GLM (智谱)** | prompt-style | ❌ **不支持** AI SDK 标准格式 | ✅ 需要 |

### 协议差异详解

#### 1. 原生 Function-Calling（Claude / OpenAI / DeepSeek）

**请求格式**（AI SDK 标准）：
```json
[
  {
    "role": "assistant",
    "content": [
      {
        "type": "tool-call",
        "toolCallId": "call_abc123",
        "toolName": "list_dir",
        "input": "{\"path\": \"01_inputs\"}"
      }
    ]
  },
  {
    "role": "tool",
    "content": [
      {
        "type": "tool-result",
        "toolCallId": "call_abc123",
        "toolName": "list_dir",
        "output": "[{\"name\": \"resume.pdf\", \"type\": \"file\"}]"
      }
    ]
  }
]
```

**响应格式**（LLM API 返回）：
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "parse_pdf",
              "arguments": "{\"path\": \"01_inputs/resume.pdf\"}"
            }
          }
        ]
      }
    }
  ]
}
```

#### 2. Prompt-Style（豆包 / Qwen / GLM）

**请求格式**（纯文本）：
```
用户：请帮我解析简历

助手：好的，我来列出目录内容
[Calling tool "list_dir" with args: {"path": "01_inputs"}]

用户：[Tool "list_dir" result]:
[{"name": "resume.pdf", "type": "file"}]

助手：现在我来解
```

**响应格式**（LLM API 返回，文本流中嵌入特殊 token）：
```
<|FunctionCallBegin|>[{"name":"parse_pdf","parameters":{"path":"01_inputs/resume.pdf"}}]<|FunctionCallEnd|>现在我来解析这份简历...
```

---

## 解决方案

### 方案 A：消息预处理（已实施）

**适用场景**：prompt-style 模型（豆包 / Qwen / GLM）

**实现位置**：
- [`src/agent-runtime/provider/protocols/_shared.ts`](../src/agent-runtime/provider/protocols/_shared.ts) — `flattenToolMessagesForPromptStyle()`
- [`src/agent-runtime/provider/index.ts`](../src/agent-runtime/provider/index.ts) — `stream()` 方法

**核心逻辑**：
```typescript
// 在发送消息给 LLM 之前，根据模型协议类型决定是否预处理
const processedMessages = resolved.promptStyle
  ? flattenToolMessagesForPromptStyle(options.messages)  // prompt-style 模型：转为纯文本
  : options.messages                                      // 原生模型：保持标准格式

const result = streamText({
  model: resolved.sdkInstance,
  messages: convertToAiSdkMessages(processedMessages),
  // ...
})
```

**`flattenToolMessagesForPromptStyle()` 转换规则**：
1. `role: "assistant"` 中的 `tool-call` ContentPart → 编码为纯文本：
   ```
   [Calling tool "list_dir" with args: {"path": "01_inputs"}]
   ```
2. `role: "tool"` 消息 → 转为 `role: "user"` 纯文本：
   ```
   [Tool "list_dir" result]:
   [{"name": "resume.pdf", "type": "file"}]
   ```

### 方案 B：双向协议转换（未实施，未来可考虑）

**适用场景**：需要更精细控制的场景

**思路**：
- **输入方向**（消息发送给 LLM）：把标准 tool-call/tool-result 转为模型特定格式
- **输出方向**（解析 LLM 响应）：把模型特定格式转为标准 `LLMStreamEvent`

**当前状态**：输出方向已由 `prompt-style-tool-call.ts` 装饰器实现，输入方向待实现。

---

## 排查清单

当遇到"工具调用链中断"问题时，按以下顺序排查：

### 1. 确认模型协议类型

```typescript
// 检查 resolve 返回值
const resolved = registry.resolve(modelID)
console.log("promptStyle:", resolved.promptStyle)  // null = 原生，非 null = prompt-style
```

### 2. 检查错误消息

| 错误消息 | 可能原因 | 解决方案 |
|---------|---------|---------|
| `AI_InvalidPromptError` | 模型不支持 function-calling 消息格式 | 实施方案 A（消息预处理） |
| `tool_calls is required` | 模型期望 `tool_calls` 字段但没收到 | 检查 `stopWhen: stepCountIs(1)` 配置 |
| `<|FunctionCallBegin|>` 出现在 UI 上 | prompt-style 装饰器未启用 | 检查 `promptStyle` 配置 |

### 3. 检查 ToolRuntime 日志

```typescript
// 在 tool-runtime.ts 中添加日志
console.log("ToolRuntime: executing tool", toolName, "with input", input)
console.log("ToolRuntime: tool result", result)
```

### 4. 检查 LLM 请求负载

```typescript
// 在 provider/index.ts 中添加日志
console.debug("LLM Request Messages:", JSON.stringify(options.messages, null, 2))
```

### 5. 验证消息格式

**原生 function-calling 模型**：
- ✅ `role: "assistant"` + `content: [{type: "tool-call"}]`
- ✅ `role: "tool"` + `content: [{type: "tool-result"}]`

**prompt-style 模型**：
- ✅ 所有消息都是 `role: "user"` 或 `role: "assistant"`
- ✅ 消息内容是纯文本，不包含 `tool-call` / `tool-result` ContentPart

---

## 测试验证

### 单元测试

```bash
# 运行 provider 协议适配层测试
pnpm exec vitest run src/agent-runtime/provider

# 运行 tool-runtime 测试
pnpm exec vitest run src/agent-runtime/agent/tool-runtime.test.ts
```

### 集成测试

```bash
# 豆包真机验证（需要真实 API Key）
pnpm run tauri dev

# 在 GUI 中配置豆包模型，跑一段需要多轮工具调用的对话
# 预期：tool-call bubble 出现 → 工具执行 → follow-up text 流式返回
```

### 烟雾测试

```bash
# prompt-style 装饰器烟雾测试
pnpm run check:prompt-style-smoke
```

---

## 经验教训

### 1. 不要假设所有模型都支持原生 function-calling

**错误假设**：
> "AI SDK 的 `streamText` 会自动处理所有模型的 function-calling"

**正确认知**：
> AI SDK 只负责标准 OpenAI 格式的 function-calling，对于 prompt-style 模型需要额外的协议适配层

### 2. 测试时要注意模型协议差异

**错误做法**：
> 只用 OpenAI/Claude 测试工具调用，就认为功能正常

**正确做法**：
> 每个支持 tool-calling 的模型都要单独测试多轮工具调用场景

### 3. 错误消息可能不直接指向根因

**表面错误**：
```
AI_InvalidPromptError: The messages do not match the ModelMessage[] schema
```

**根因**：
> 豆包模型不支持 function-calling 消息格式，需要消息预处理

**排查方法**：
> 不要只看错误消息，要追踪完整的工具调用链：LLM 调用 → 工具执行 → follow-up 消息构造

---

## 相关文档

- [前端编码约定 §3.2](../.codebuddy/rules/frontend-conventions.md) — Provider 协议适配层边界
- [前端编码约定 §3.2.1](../.codebuddy/rules/frontend-conventions.md) — prompt-style ProtocolAdapter 测试 fixture 必须有真机锚点
- [runtime-multimodel-protocol-adapter spec](../openspec/changes/runtime-multimodel-protocol-adapter/specs/platform-foundation/spec.md) — 多模型协议适配层设计
- [runtime-multimodel-real-machine-verification spec](../openspec/changes/runtime-multimodel-real-machine-verification/specs/platform-foundation/spec.md) — 真机验证规范

---

## 更新记录

| 日期 | 更新内容 | 更新人 |
|------|---------|--------|
| 2026-06-02 | 初始版本，记录豆包模型 function-calling 兼容性问题和解决方案 | AI Assistant |
