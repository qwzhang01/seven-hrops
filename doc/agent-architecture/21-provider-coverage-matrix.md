# Provider 覆盖矩阵（Provider Coverage Matrix）

> 19 个内置 ProviderPlugin + 1 个 Dynamic 模式 = 20 项总覆盖。每项的 `id` / npm 包 / `defaultBaseURL` / `defaultProtocol` / `promptStyle` 全部从 [`src/agent-runtime/provider/plugins/`](../../src/agent-runtime/provider/plugins/) 实际代码字面直接读取，**禁止抄写**。
>
> 修改本表前请先看 [20-多模型协议适配层.md](./20-多模型协议适配层.md) §四「扩展指南」。

---

## 一、内置 19 项 + Dynamic（按业务优先级排序）

### 1.1 国际一线（4 项）

| ID | 厂商显示名 | npm 包 | defaultBaseURL | defaultProtocol | promptStyle | 说明 |
|---|---|---|---|---|---|---|
| `openai` | OpenAI | `@ai-sdk/openai` | `https://api.openai.com/v1` | `openai-native` | — | 唯一会出现 `reasoning-delta` 事件的 plugin（GPT-4o / o1） |
| `anthropic` | Anthropic Claude | `@ai-sdk/anthropic` | `https://api.anthropic.com/v1` | `anthropic-messages` | — | SDK 已内化 content_block_delta 归一为 TextStreamPart |
| `google` | Google Gemini | `@ai-sdk/google` | `https://generativelanguage.googleapis.com/v1beta` | `openai-compatible` | — | 工厂名为 `createGoogleGenerativeAI`（特殊命名） |
| `xai` | xAI Grok | `@ai-sdk/xai` | `https://api.x.ai/v1` | `openai-compatible` | — | reasoning 计入 token usage（不暴露 reasoning-delta），故走 compatible |

### 1.2 OpenAI-Compatible 国际族（7 项）

| ID | 厂商显示名 | npm 包 | defaultBaseURL | defaultProtocol | promptStyle | 说明 |
|---|---|---|---|---|---|---|
| `groq` | Groq | `@ai-sdk/groq` | `https://api.groq.com/openai/v1` | `openai-compatible` | — | 极速推理（LPU） |
| `mistral` | Mistral | `@ai-sdk/mistral` | `https://api.mistral.ai/v1` | `openai-compatible` | — | 法国厂商 |
| `cohere` | Cohere | `@ai-sdk/cohere` | `https://api.cohere.com/v2` | `openai-compatible` | — | 注意 v2 而非 v1；官方域名 cohere.com |
| `perplexity` | Perplexity | `@ai-sdk/perplexity` | `https://api.perplexity.ai` | `openai-compatible` | — | 注意路径无 `/v1` 后缀 |
| `togetherai` | Together AI | `@ai-sdk/togetherai` | `https://api.together.xyz/v1` | `openai-compatible` | — | 开源模型托管 |
| `deepinfra` | DeepInfra | `@ai-sdk/deepinfra` | `https://api.deepinfra.com/v1/openai` | `openai-compatible` | — | 路径含 `/openai` 子段 |
| `openrouter` | OpenRouter | `@ai-sdk/openai-compatible` | `https://openrouter.ai/api/v1` | `openai-compatible` | — | 复用 openai-compatible 包，避免引入 `@openrouter/ai-sdk-provider` 多一个依赖 |

### 1.3 国内主流（7 项）

| ID | 厂商显示名 | npm 包 | defaultBaseURL | defaultProtocol | promptStyle | 说明 |
|---|---|---|---|---|---|---|
| `alibaba` | 通义千问（阿里云） | `@ai-sdk/alibaba` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `openai-compatible` | **不挂默认** | 多数 Qwen 模型卡支持原生 function-calling；仅 `qwen3-coder` 等需用户在 ProviderConfig 显式置 `"qwen"` |
| `volcengine` | 火山方舟豆包 | `@ai-sdk/openai-compatible` | `https://ark.cn-beijing.volces.com/api/v3` | `openai-compatible` | **`"doubao"`** | **本变更治本对象**，所有豆包模型卡都把工具调用编码为 `<\|FunctionCallBegin\|>...<\|FunctionCallEnd\|>` 文本流 |
| `deepseek` | DeepSeek | `@ai-sdk/openai-compatible` | `https://api.deepseek.com/v1` | `openai-compatible` | — | 注意：deepseek-r1 的 reasoning 走 `reasoning_content` 字段（暂未在本仓暴露） |
| `zhipu` | 智谱 GLM | `@ai-sdk/openai-compatible` | `https://open.bigmodel.cn/api/paas/v4` | `openai-compatible` | — | 路径含 `/paas/v4` |
| `moonshot` | Moonshot 月之暗面 | `@ai-sdk/openai-compatible` | `https://api.moonshot.cn/v1` | `openai-compatible` | — | Kimi 系列 |
| `lingyiwanwu` | 零一万物 | `@ai-sdk/openai-compatible` | `https://api.lingyiwanwu.com/v1` | `openai-compatible` | — | Yi 系列 |
| `hunyuan` | 腾讯混元 | `@ai-sdk/openai-compatible` | `https://api.hunyuan.cloud.tencent.com/v1` | `openai-compatible` | — | — |

### 1.4 本地推理（1 项）

| ID | 厂商显示名 | npm 包 | defaultBaseURL | defaultProtocol | promptStyle | 说明 |
|---|---|---|---|---|---|---|
| `ollama` | Ollama（本地） | `@ai-sdk/openai-compatible` | `http://localhost:11434/v1` | `openai-compatible` | — | apiKey 可缺省，本地实例无需鉴权 |

### 1.5 动态扩展（1 项）

| ID | 用途 | 必填字段 | 安全约束 |
|---|---|---|---|
| `dynamic` | 接入未列举的官方 ai-sdk provider 包（如 `@ai-sdk/cerebras`） | `dynamicPackage`（必须匹配 `^@ai-sdk/[a-z0-9-]+$`）+ `protocol` | 白名单 + 首次加载 Tauri confirm + 工厂形态校验 |

---

## 二、字段语义速查

### 2.1 `defaultProtocol` 三态

- `"openai-native"` —— 仅 `openai` 一项使用，唯一暴露 `reasoning-delta` 事件
- `"openai-compatible"` —— 17 项使用，覆盖绝大多数厂商 SSE 事件
- `"anthropic-messages"` —— 仅 `anthropic` 一项使用，SDK 已内化协议归一

### 2.2 `promptStyle` 三态

| 值 | 含义 | 何时用 |
|---|---|---|
| `undefined`（默认） | 走 plugin 默认（即上表"promptStyle"列） | 99% 用户场景 |
| `null` | 显式关闭装饰器 | volcengine 用户用纯文本对话场景，不需要工具调用解析 |
| `"doubao"` / `"qwen"` | 显式覆盖默认风格 | alibaba 用户在 `qwen3-coder` 模型卡上手工开启 `"qwen"` |

### 2.3 用户覆盖优先级

[`ProviderRegistry.resolve`](../../src/agent-runtime/provider/registry.ts) 按以下优先级合并：

```
ProviderConfig.protocol > ProviderPlugin.defaultProtocol
ProviderConfig.promptStyle > ProviderPlugin.promptStyle
ProviderConfig.baseURL > ProviderPlugin.defaultBaseURL
```

---

## 三、与 OpenSpec 的对应关系

- 数量决策：[design.md Decision 6 「Built-in 19 项」](../../openspec/changes/runtime-multimodel-protocol-adapter/design.md)
- 国内厂商选择：[proposal.md Why 段「七家国内主流厂商」](../../openspec/changes/runtime-multimodel-protocol-adapter/proposal.md)
- prompt-style 装饰器治本豆包：[design.md Decision 4 + Decision 5](../../openspec/changes/runtime-multimodel-protocol-adapter/design.md)
- dynamic 安全护栏：[design.md Decision 7 + Decision 9](../../openspec/changes/runtime-multimodel-protocol-adapter/design.md)
