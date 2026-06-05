# HSAS — HROps Agent & Skill Spec 规范 v1

> 版本：v1.0 | 日期：2026-05-27 | 状态：设计稿
>
> 平台底座的「宪法」：所有 Agent / Skill / Capability 必须遵守此规范。内置能力（Capability）与用户自定义能力**同构**，没有特权。
>
> 📖 词汇与命名公约（中文"能力" / 英文 `Capability` 双轨使用、与"功能"/"技能"的差异举例）统一见 [14-通用约定.md](./14-通用约定.md) §〇。>
> 📖 词汇与命名公约（中文"能力" / 英文 `Capability` 双轨使用、与"功能"/"技能"的畅难举例）统一见 [14-通用约定.md](./14-通用约定.md) §〇。

---

## 〇、设计原则

1. **K8s 风格**：`apiVersion / kind / metadata / spec` 四段式，方便人和机器都能解析
2. **声明式**：清单只描述"是什么"，不写"怎么做"，运行时由平台决定加载顺序、依赖解析、生命周期
3. **可演进**：通过 `apiVersion` 隔离破坏性变更（v1 → v1beta2 → v2），旧清单永远兼容
4. **可校验**：每个字段都有 JSON Schema，安装前必须通过 `manifestValidator.validate()`
5. **可序列化**：YAML（人编辑）↔ JSON（DB / API）↔ TS Object（运行时）三向无损互转

---

## 一、版本与命名

### 1.1 apiVersion

格式：`<group>/<version>`

| apiVersion | 状态 | 说明 |
|---|---|---|
| `hsas.seven-hrops/v1` | ✅ 当前稳定版 | 适用于内置 9 个能力 + 用户能力 |
| `hsas.seven-hrops/v1beta2` | 🚧 预留 | 重大新增字段时启用 |
| `hsas.seven-hrops/v2` | ❌ 不兼容时 | 必须提供 v1 → v2 迁移工具 |

### 1.2 kind 取值

| kind | 用途 |
|---|---|
| `Agent` | 执行体：System Prompt + 工具白名单 + 权限 |
| `Skill` | 可复用的知识/流程包 |
| `Capability` | UI 入口（左侧 CapabilityCard） |
| `ToolPack`（v1.1+） | 第三方工具包 |
| `MarketplacePackage`（v2.0+） | 商店分发的复合包（含多个 Agent + Skill） |

### 1.3 name 命名规则

```
^[a-z][a-z0-9-]{2,62}[a-z0-9]$
```

- 长度 4～64 字符
- 只允许小写字母、数字、连字符
- 必须以字母开头、字母或数字结尾
- 不能连续多个连字符（`--`）
- 全平台**唯一**（同一 kind 内）
- **保留前缀**：`builtin-` / `system-` / `hsas-` 不允许用户使用

合法示例：`screener` / `my-tech-screener` / `dj-v2` / `校招-技术筛选` ❌（不允许中文）

---

## 二、公共字段（所有 kind 共用）

### 2.1 metadata

```yaml
metadata:
  name: my-tech-screener           # 必填，唯一 ID
  displayName: 互联网技术岗筛选      # 必填，UI 显示名（支持中文）
  description: 一句话描述           # 必填，最多 200 字
  source: user                     # 必填：builtin | user | marketplace
  version: 1.0.0                   # 必填，semver
  author: zhangsan                 # 可选，作者标识
  authorEmail: san@example.com     # 可选
  icon: 🧑‍💻                       # 可选，emoji 或图片 URL
  tags: ["screening", "tech"]      # 可选，最多 10 个
  createdAt: 2026-05-27T10:00:00Z  # 必填，ISO 8601
  updatedAt: 2026-05-27T10:00:00Z  # 可选
  deprecated: false                # 可选，标记后 UI 灰显
  deprecatedReason: ""             # 可选
  homepage: https://...            # 可选
  signature: ""                    # 可选，marketplace 包必填（v2.1+）
```

### 2.2 source 三种来源的差异

| source | 加载方式 | 存储位置 | 默认权限 | 可卸载 |
|---|---|---|---|---|
| `builtin` | 启动时 seed | 编译进 app（YAML） | 全部工具 | ❌（仅 disable） |
| `user` | SQLite + FS 扫描 | `~/.seven-hrops/` + DB | 沙箱（safe + write） | ✅ |
| `marketplace` | 安装时下载 | `~/.seven-hrops/marketplace/` | 沙箱（safe，含签名校验） | ✅ |

---

## 三、Agent Manifest

### 3.1 完整字段定义

```yaml
apiVersion: hsas.seven-hrops/v1
kind: Agent
metadata:
  # 见 §2.1
spec:
  # ─── 基础 ───────────────────────────────────────
  mode: subagent                   # 必填：primary | subagent
  basePrompt: |                    # 必填：System Prompt 主体（不含 contextTemplate）
    你是...
  contextTemplate: |               # 可选：上下文模板，由 contextBuilder 渲染
    当前工作空间：{{workspacePath}}
    当前 JD：{{jdContent}}
  contextKeys:                     # 可选：声明此 Agent 需要的上下文 key
    - workspacePath
    - jdContent

  # ─── 能力组合 ───────────────────────────────────
  skills:                          # 可选：引用的 Skill 列表（按顺序拼接）
    - screener
    - tech-stack-detector
  inheritFrom:                     # 可选：继承自另一个 Agent（v1.1+）
    name: screener
    overrides: ["basePrompt", "tools.allowed"]

  # ─── 工具 ───────────────────────────────────────
  tools:                           # 必填
    allowed:                       # 白名单（必填，可为空数组）
      - list_files
      - parse_resume_batch
    deny: []                       # 可选：黑名单（优先级高于 allowed）
    autoApprove:                   # 可选：跳过 ask 直接执行的工具
      - list_files

  # ─── 权限规则（沿用现有 Permission.Rule）──────────
  permission:                      # 可选，未声明时使用默认沙箱规则
    - { permission: read,      pattern: "*",                 action: allow }
    - { permission: write,     pattern: "screening_results/*", action: allow }
    - { permission: write,     pattern: "*",                 action: ask   }
    - { permission: network,   pattern: "*",                 action: deny  }

  # ─── 模型 ───────────────────────────────────────
  model:                           # 可选，未声明时用全局默认
    provider: anthropic            # anthropic | openai | tencent | ...
    modelID: claude-4.7-sonnet
    temperature: 0.3
    maxTokens: 4096
    topP: 0.95

  # ─── 资源限制（沙箱）─────────────────────────────
  resources:                       # 可选
    maxTokensPerSession: 100000    # user 默认 100K，builtin 不限
    maxToolCallsPerMinute: 60
    maxConcurrentSessions: 3

  # ─── 网络（marketplace 必填）───────────────────
  network:                         # 可选
    allowedHosts:                  # marketplace source 必填
      - api.openai.com
      - api.anthropic.com

  # ─── 文件系统沙箱 ──────────────────────────────
  filesystem:                      # 可选
    readPaths:
      - "{{workspacePath}}/**"
      - "~/.seven-hrops/{{name}}/data/**"
    writePaths:
      - "{{workspacePath}}/output/**"
      - "~/.seven-hrops/{{name}}/data/**"

  # ─── 入口（与 Capability 关联）─────────────────
  capabilityBinding:               # 可选：直接绑定为一个 UI 能力
    capabilityId: tech-screening
    autoCreate: true               # true 表示安装 Agent 时自动创建对应 Capability

  # ─── 触发器（v1.1+）─────────────────────────────
  triggers:                        # 可选：被动唤醒方式
    - type: chat                   # 普通聊天（默认）
    - type: webhook                # 接 orchestrator 转发
      route: "/wecom/screening"
    - type: schedule
      cron: "0 9 * * MON"          # 每周一 9:00 主动执行
```

### 3.2 必填字段一览

| 路径 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `apiVersion` | string | ✅ | 固定 `hsas.seven-hrops/v1` |
| `kind` | string | ✅ | 固定 `Agent` |
| `metadata.name` | string | ✅ | 见 §1.3 |
| `metadata.displayName` | string | ✅ | |
| `metadata.description` | string | ✅ | |
| `metadata.source` | enum | ✅ | |
| `metadata.version` | semver | ✅ | |
| `metadata.createdAt` | ISO8601 | ✅ | |
| `spec.mode` | enum | ✅ | |
| `spec.basePrompt` | string | ✅ | 至少 50 字符 |
| `spec.tools.allowed` | string[] | ✅ | 可为 `[]` |

### 3.3 校验规则

| 规则 | 错误码 |
|---|---|
| `metadata.name` 不符合命名规则 | `INVALID_NAME` |
| `metadata.name` 已存在 | `DUPLICATE_NAME` |
| `spec.tools.allowed` 中工具不在 ToolRegistry | `UNKNOWN_TOOL` |
| 用户 Agent 引用了 `defaultAllowedSources` 不含 `user` 的工具 | `TOOL_NOT_PERMITTED_FOR_SOURCE` |
| `spec.skills` 中 Skill 不存在 | `UNKNOWN_SKILL` |
| `spec.basePrompt` 长度 < 50 字符 | `PROMPT_TOO_SHORT` |
| `spec.model.provider` 未配置 | `MODEL_PROVIDER_NOT_CONFIGURED` |
| `spec.permission` 中 action 不是 allow/deny/ask | `INVALID_PERMISSION_ACTION` |
| 循环继承（A inherit B, B inherit A） | `CIRCULAR_INHERIT` |

---

## 四、Skill Manifest

> 对齐 Anthropic Skill 生态：`SKILL.md + frontmatter + 资源目录`，方便未来跨平台复用。

### 4.1 目录结构

```
~/.seven-hrops/skills/<skill-name>/
├── SKILL.md                    # 必须：主文件（frontmatter + Markdown 正文）
├── prompts/                    # 可选：子提示词
│   ├── nodejs.md
│   └── golang.md
├── examples/                   # 可选：few-shot 样例
│   └── case-1.json
├── resources/                  # 可选：参考资料（PDF / DOC / 图片）
│   └── jd-template.docx
└── tools/                      # 可选：随 Skill 分发的本地脚本（v1.1+）
    └── parse-package-json.ts
```

### 4.2 SKILL.md frontmatter

```markdown
---
apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: tech-stack-detector
  displayName: 技术栈识别
  description: 从简历中识别技术栈与版本，按生态归类
  source: user
  version: 1.0.0
  author: zhangsan
  tags: ["screening", "tech"]
  createdAt: 2026-05-27T10:00:00Z
spec:
  # ─── 适用范围 ─────────────────────────────────
  applicableAgents:                # 可选：白名单 Agent 名（空表示所有）
    - screener
    - my-tech-screener
  applicableCapabilities:          # 可选：白名单 Capability
    - resume-screening

  # ─── 依赖 ─────────────────────────────────────
  requiredTools:                   # 必填：声明此 Skill 至少需要哪些工具
    - read_file
    - parse_resume_batch
  requiredSkills: []               # 可选：依赖的其他 Skill（链式加载）

  # ─── 资源声明 ────────────────────────────────
  resources:                       # 可选：列出附属文件，方便平台校验
    - prompts/nodejs.md
    - prompts/golang.md
    - examples/case-1.json
    - resources/jd-template.docx

  # ─── 输入输出契约 ─────────────────────────────
  inputs:                          # 可选：期望的输入字段
    - { key: resumeText, type: string, required: true }
  outputs:                         # 可选：声明输出 schema
    schema: |
      {
        "stack": ["string"],
        "yearsOfExperience": "object",
        "ecosystem": "string"
      }

  # ─── 加载策略 ────────────────────────────────
  loadStrategy: lazy               # eager | lazy；lazy 表示首次匹配时才注入 prompt
  triggerKeywords:                 # 可选：lazy 模式下，命中关键词才加载
    - 技术栈
    - 编程语言
    - tech stack
---

# 技术栈识别技能

## 识别维度
1. **语言**：JavaScript/TypeScript/Go/Python/Rust...
2. **框架**：React/Vue/Spring/FastAPI...
3. **基础设施**：K8s/Docker/AWS/阿里云...

## 输出格式
{ "stack": [...], "yearsOfExperience": {...}, "ecosystem": "..." }

## 例子
见 `examples/case-1.json`
```

### 4.3 校验规则

| 规则 | 错误码 |
|---|---|
| 缺少 `SKILL.md` | `MISSING_SKILL_FILE` |
| frontmatter 解析失败 | `INVALID_FRONTMATTER` |
| `spec.resources` 中文件不存在 | `RESOURCE_NOT_FOUND` |
| `spec.requiredTools` 中工具不在 ToolRegistry | `UNKNOWN_TOOL` |
| `spec.requiredSkills` 形成循环依赖 | `CIRCULAR_SKILL_DEPENDENCY` |
| Skill 包总大小 > 10MB（user）/ 50MB（builtin） | `SKILL_TOO_LARGE` |

---

## 五、Capability Manifest

### 5.1 完整字段

```yaml
apiVersion: hsas.seven-hrops/v1
kind: Capability
metadata:
  # 见 §2.1
spec:
  # ─── 绑定 ─────────────────────────────────────
  agentName: my-tech-screener      # 必填：绑定的 Agent

  # ─── UI 配置 ─────────────────────────────────
  category: hr-screening           # 必填：UI 分组
  order: 100                       # 可选：同分组内排序，越小越靠前
  badge: NEW                       # 可选：角标
  color: "#1890ff"                 # 可选：主题色

  # ─── 上下文 ─────────────────────────────────
  contextKeys:                     # 必填：进入此能力时需注入的上下文 key
    - workspacePath
    - jdId
    - projectId

  # ─── 入口对话 ───────────────────────────────
  entryPrompt: |                   # 可选：进入能力时的开场白
    我是技术岗简历筛选助手，请提供 JD 和简历文件夹路径。
  quickReplies:                    # 可选：快捷回复按钮
    - 帮我打开最近的 JD
    - 用上次的筛选标准
    - 重新设置评分维度

  # ─── 表单输入（可选）─────────────────────────
  inputSchema:                     # 可选：固定参数表单
    - { key: experienceYears, label: 年限, type: number, default: 0 }
    - { key: education,        label: 学历, type: select,
        options: ["不限", "大专", "本科", "硕士", "博士"] }

  # ─── 可见性 ─────────────────────────────────
  visibility:                      # 可选
    enabled: true
    requiredFeatureFlags: []       # 可选：feature flag 控制
    requiredRoles: []              # 可选：v2.0+ 多用户场景
```

### 5.1 category 取值（v1）

| category | 中文 |
|---|---|
| `hr-screening` | 招聘筛选 |
| `hr-jd` | JD 与岗位 |
| `hr-interview` | 面试与评估 |
| `hr-report` | 报告与文档 |
| `hr-internal` | 内部访谈 |
| `productivity` | 效率工具 |
| `entertainment` | 休闲娱乐（音乐电台） |
| `system` | 系统能力（协调者 / Builder） |
| `custom` | 用户自定义（默认） |

### 5.2 校验规则

| 规则 | 错误码 |
|---|---|
| `spec.agentName` 不存在 | `AGENT_NOT_FOUND` |
| `spec.contextKeys` 含未注册的 key | `UNKNOWN_CONTEXT_KEY` |
| `metadata.name` 重复 | `DUPLICATE_CAPABILITY` |

---

## 六、JSON Schema（节选）

```typescript
// src/platform/manifestSchema.ts
import { Schema } from 'effect'

// ─── 公共 ─────────────────────────────────────
export const Name = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]{2,62}[a-z0-9]$/),
  Schema.filter((s) => !s.includes('--'), { message: () => '不允许连续连字符' }),
)

export const SemVer = Schema.String.pipe(
  Schema.pattern(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
)

export const Source = Schema.Literal('builtin', 'user', 'marketplace')

export const Metadata = Schema.Struct({
  name: Name,
  displayName: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  source: Source,
  version: SemVer,
  author: Schema.optional(Schema.String),
  authorEmail: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String).pipe(Schema.maxItems(10))),
  createdAt: Schema.String, // ISO 8601
  updatedAt: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean),
  homepage: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
})

// ─── Agent ────────────────────────────────────
export const AgentManifest = Schema.Struct({
  apiVersion: Schema.Literal('hsas.seven-hrops/v1'),
  kind: Schema.Literal('Agent'),
  metadata: Metadata,
  spec: Schema.Struct({
    mode: Schema.Literal('primary', 'subagent'),
    basePrompt: Schema.String.pipe(Schema.minLength(50)),
    contextTemplate: Schema.optional(Schema.String),
    contextKeys: Schema.optional(Schema.Array(Schema.String)),
    skills: Schema.optional(Schema.Array(Name)),
    inheritFrom: Schema.optional(Schema.Struct({
      name: Name,
      overrides: Schema.Array(Schema.String),
    })),
    tools: Schema.Struct({
      allowed: Schema.Array(Schema.String),
      deny: Schema.optional(Schema.Array(Schema.String)),
      autoApprove: Schema.optional(Schema.Array(Schema.String)),
    }),
    permission: Schema.optional(Schema.Array(Schema.Struct({
      permission: Schema.String,
      pattern: Schema.String,
      action: Schema.Literal('allow', 'deny', 'ask'),
    }))),
    model: Schema.optional(Schema.Struct({
      provider: Schema.String,
      modelID: Schema.String,
      temperature: Schema.optional(Schema.Number),
      maxTokens: Schema.optional(Schema.Number),
      topP: Schema.optional(Schema.Number),
    })),
    resources: Schema.optional(Schema.Struct({
      maxTokensPerSession: Schema.optional(Schema.Number),
      maxToolCallsPerMinute: Schema.optional(Schema.Number),
      maxConcurrentSessions: Schema.optional(Schema.Number),
    })),
    network: Schema.optional(Schema.Struct({
      allowedHosts: Schema.Array(Schema.String),
    })),
    filesystem: Schema.optional(Schema.Struct({
      readPaths: Schema.optional(Schema.Array(Schema.String)),
      writePaths: Schema.optional(Schema.Array(Schema.String)),
    })),
    capabilityBinding: Schema.optional(Schema.Struct({
      capabilityId: Name,
      autoCreate: Schema.optional(Schema.Boolean),
    })),
  }),
})

export type AgentManifest = Schema.Schema.Type<typeof AgentManifest>

// ─── Skill / Capability 见完整代码 ─────────────
```

---

## 七、生命周期与加载顺序

### 7.1 启动流程

```
1. ToolRegistry.registerAll()           ← 工具元数据先就位
2. 加载内置 Skill（按依赖拓扑排序）
3. 加载内置 Agent（解析 inheritFrom）
4. 加载内置 Capability（绑定 Agent）
5. SQLite 加载用户 Skill / Agent / Capability
6. 文件系统扫描 ~/.seven-hrops/skills/* （增量）
7. UI 订阅 Registry 变更事件
```

### 7.2 安装流程（用户场景）

```
用户提交 Manifest
  │
  ▼
manifestValidator.validate()        ← schema 校验
  │
  ▼
toolRegistry.assertAllowed()        ← 工具权限校验
  │
  ▼
sandbox.checkResourceLimits()       ← 资源限制校验
  │
  ▼
[预览] 给用户展示：将启用哪些工具、读写哪些路径
  │
  ▼
用户确认 → SQLite 写入 → AgentLoader.load()
  │
  ▼
广播 'capability-installed' 事件 → UI 刷新
```

### 7.3 卸载流程

```
1. 检查依赖：是否有 Agent 引用了将卸载的 Skill？
2. 关闭关联会话（通知用户保存 / 自动保存）
3. AgentLoader.unload() / SkillLoader.unload()
4. 删除 SQLite 行 / 文件系统资源
5. 广播 'capability-uninstalled' 事件
```

### 7.4 升级流程（同名 + 新版本号）

```
1. 加载新 Manifest
2. 校验通过 → 备份旧版本到 SQLite history 表
3. AgentLoader.reload(newManifest) = unload(old) + load(new)
4. 提示用户："X 已从 v1.0.0 升级到 v1.1.0，主要变更：..."
```

---

## 八、与 Permission.Service 的对接

`spec.permission` 字段直接复用 [`src/agent-runtime/permission/index.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/agent-runtime/permission/index.ts) 的 `Rule` 格式：

```typescript
interface Rule {
  permission: string   // 权限域：read / write / network / screening / ...
  pattern: string      // glob 风格：* / write/screening_results/* / specific_tool
  action: 'allow' | 'deny' | 'ask'
}
```

加载时机：

```typescript
// AgentLoader.load
async load(manifest: AgentManifest) {
  const rules = manifest.spec.permission ?? this.getDefaultRulesBySource(manifest.metadata.source)
  await this.permissionService.setApproved(rules)
  // ...
}
```

---

## 九、与 ToolRegistry 的对接

每个工具在 ToolRegistry 中声明 `defaultAllowedSources`，AgentLoader 加载时会强校验：

```typescript
function assertToolAllowed(manifest: AgentManifest, toolName: string) {
  const meta = TOOL_REGISTRY[toolName]
  if (!meta) throw new ValidationError('UNKNOWN_TOOL', toolName)
  if (!meta.defaultAllowedSources.includes(manifest.metadata.source)) {
    throw new ValidationError('TOOL_NOT_PERMITTED_FOR_SOURCE', {
      tool: toolName,
      source: manifest.metadata.source,
      allowed: meta.defaultAllowedSources,
    })
  }
}
```

---

## 十、示例库

### 10.1 最小化 Agent（仅必填字段）

```yaml
apiVersion: hsas.seven-hrops/v1
kind: Agent
metadata:
  name: hello-agent
  displayName: 你好 Agent
  description: 最小化示例
  source: user
  version: 1.0.0
  createdAt: 2026-05-27T10:00:00Z
spec:
  mode: subagent
  basePrompt: |
    你是一个友好的助手，用中文回答用户问题，回答风格简洁明了。
    避免冗长的解释，优先给出可执行的步骤。
  tools:
    allowed: []
```

### 10.2 完整 Agent（继承内置 screener）

```yaml
apiVersion: hsas.seven-hrops/v1
kind: Agent
metadata:
  name: my-tech-screener
  displayName: 互联网技术岗筛选
  description: 针对互联网研发岗位定制的简历筛选
  source: user
  version: 1.0.0
  author: zhangsan
  icon: 🧑‍💻
  tags: ["screening", "tech"]
  createdAt: 2026-05-27T10:00:00Z
spec:
  mode: subagent
  inheritFrom:
    name: screener
    overrides: ["basePrompt", "skills"]
  basePrompt: |
    你是专注于互联网研发岗（前端/后端/算法）的简历筛选助手。
    评分维度：
    - 技术栈匹配（40%）
    - 项目复杂度（25%）
    - 大厂/独角兽经历（15%）
    - 学历（10%）
    - 文化契合（10%）
  contextTemplate: |
    工作空间：{{workspacePath}}
    JD：{{jdContent}}
  contextKeys: [workspacePath, jdContent]
  skills:
    - screener
    - tech-stack-detector
  tools:
    allowed:
      - list_files
      - parse_resume_batch
      - save_screening_result
      - generate_screening_report
    autoApprove:
      - list_files
  permission:
    - { permission: read,      pattern: "*",                  action: allow }
    - { permission: screening, pattern: "*",                  action: allow }
    - { permission: write,     pattern: "screening_results/*", action: allow }
  model:
    provider: anthropic
    modelID: claude-4.7-sonnet
    temperature: 0.3
  capabilityBinding:
    capabilityId: tech-screening
    autoCreate: true
```

### 10.3 Skill 包（tech-stack-detector）

`~/.seven-hrops/skills/tech-stack-detector/SKILL.md`：

```markdown
---
apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: tech-stack-detector
  displayName: 技术栈识别
  description: 从简历中识别技术栈与版本
  source: user
  version: 1.0.0
  createdAt: 2026-05-27T10:00:00Z
spec:
  applicableAgents: [screener, my-tech-screener]
  requiredTools: [read_file]
  resources:
    - prompts/nodejs.md
    - prompts/golang.md
  loadStrategy: lazy
  triggerKeywords: [技术栈, 编程语言, tech stack]
---

# 技术栈识别技能

## 识别维度
1. 语言、框架、基础设施

## 输出格式
{ "stack": [...], "yearsOfExperience": {...} }
```

### 10.4 Capability（绑定 my-tech-screener）

```yaml
apiVersion: hsas.seven-hrops/v1
kind: Capability
metadata:
  name: tech-screening
  displayName: 技术岗简历筛选
  description: 互联网研发岗的专属简历筛选能力
  source: user
  version: 1.0.0
  icon: 🧑‍💻
  createdAt: 2026-05-27T10:00:00Z
spec:
  agentName: my-tech-screener
  category: hr-screening
  order: 100
  contextKeys: [workspacePath, jdId, projectId]
  entryPrompt: |
    我是技术岗简历筛选助手，请告诉我 JD 路径和简历文件夹位置。
  quickReplies:
    - 帮我打开最近的 JD
    - 用上次的筛选标准
  inputSchema:
    - { key: experienceYears, label: 年限, type: number, default: 0 }
```

### 10.5 内置 screener（builtin source 示例）

```yaml
apiVersion: hsas.seven-hrops/v1
kind: Agent
metadata:
  name: screener
  displayName: 简历筛选
  description: HROps 内置简历筛选 Agent
  source: builtin
  version: 1.0.0
  icon: 📋
  createdAt: 2026-05-27T00:00:00Z
spec:
  mode: subagent
  basePrompt: |
    你是 Seven HROps 的简历筛选助手...（完整 prompt 见 01-简历筛选.md）
  contextKeys: [workspacePath, jdContent, projectId]
  tools:
    allowed:
      - list_files
      - parse_resume_batch
      - save_screening_result
      - list_screening_results
      - generate_screening_report
      - read_file
      - export_to_html
  permission:
    - { permission: "*", pattern: "*", action: allow }   # builtin 全开
  capabilityBinding:
    capabilityId: resume-screening
    autoCreate: true
```

---

## 十一、错误码总表

| 错误码 | 含义 | 处理建议 |
|---|---|---|
| `INVALID_API_VERSION` | apiVersion 不识别 | 检查拼写或升级平台 |
| `INVALID_KIND` | kind 不在白名单 | 使用 Agent / Skill / Capability |
| `INVALID_NAME` | name 不符合命名规则 | 见 §1.3 |
| `DUPLICATE_NAME` | 同 kind 同 name 已存在 | 改名或先卸载旧版本 |
| `MISSING_REQUIRED_FIELD` | 必填字段缺失 | 见 §3.2 / §4.x / §5.x |
| `UNKNOWN_TOOL` | 引用的工具未注册 | 检查 ToolRegistry |
| `TOOL_NOT_PERMITTED_FOR_SOURCE` | 用户/marketplace Agent 用了内置专属工具 | 申请授权或换工具 |
| `UNKNOWN_SKILL` | 引用的 Skill 不存在 | 先安装 Skill |
| `CIRCULAR_INHERIT` | Agent 继承形成环 | 重构继承关系 |
| `CIRCULAR_SKILL_DEPENDENCY` | Skill 依赖形成环 | 重构依赖关系 |
| `RESOURCE_NOT_FOUND` | Skill 声明的资源文件不存在 | 检查文件路径 |
| `PROMPT_TOO_SHORT` | basePrompt 少于 50 字符 | 补充更详细的角色定义 |
| `MODEL_PROVIDER_NOT_CONFIGURED` | 模型提供商未配置 | 在设置页配置 API Key |
| `INVALID_PERMISSION_ACTION` | action 不是 allow/deny/ask | 修正为合法值 |
| `SKILL_TOO_LARGE` | Skill 包超过大小限制 | 拆分或精简资源 |
| `AGENT_NOT_FOUND` | Capability 绑定的 Agent 不存在 | 先安装 Agent |
| `UNKNOWN_CONTEXT_KEY` | 引用了未注册的 contextKey | 检查 contextBuilder |
| `SIGNATURE_INVALID` | marketplace 签名校验失败 | 确认包来源可信 |
| `RESOURCE_LIMIT_EXCEEDED` | 资源限制超出沙箱上限 | 申请提权或调低 |

---

## 十二、未来演进规划

| 版本 | 主要变更 |
|---|---|
| `v1` (当前) | 三类清单 + 沙箱 + AgentBuilder |
| `v1.1` | 新增 `ToolPack` kind / `inheritFrom` 完整支持 / `triggers.schedule` |
| `v1.2` | Skill 资源 hash 校验 / 增量升级 |
| `v2.0` | `MarketplacePackage` / 签名机制 / 多用户角色 |
| `v2.1` | A2A（Agent-to-Agent）协议 / 跨平台 Skill 复用（OpenCode、Anthropic） |

---

## 十三、实现 checklist

平台底座（Phase 0）落地清单：

- [ ] [`manifestSchema.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/manifestSchema.ts)：定义三类 Schema（Agent / Skill / Capability）
- [ ] [`manifestValidator.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/manifestValidator.ts)：实现完整校验，含错误码
- [ ] [`toolRegistry.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/toolRegistry.ts)：工具元数据登记
- [ ] [`agentLoader.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/agentLoader.ts)：load / unload / reload
- [ ] [`skillLoader.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/skillLoader.ts)：含目录扫描、frontmatter 解析
- [ ] [`capabilityRegistry.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/capabilityRegistry.ts)：增删查改、事件广播
- [ ] [`sandbox.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/sandbox.ts)：FS / 网络 / 频率 / Token 拦截
- [ ] `Agent.Service.unregister`：在 [`agent.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/agent-runtime/agent/agent.ts) 增加运行时注销功能
- [ ] SQLite 迁移：`capabilities` / `agent_manifests` / `skill_manifests` / `manifest_history` 四张表
- [ ] `~/.seven-hrops/` 目录约定与初始化脚本

---

## 十四、`needsWorkspace` 字段说明（session-workspace-binding）

> 新增于 2026-06-02，来源：[`openspec/changes/use_def/session-workspace-binding/`](../../openspec/changes/use_def/session-workspace-binding/)

### 字段定义

```yaml
spec:
  needsWorkspace: true  # 或 false，必须显式声明
```

### 规则

1. **必须显式声明**：所有 Capability Manifest 的 `spec` 中必须包含 `needsWorkspace: true` 或 `needsWorkspace: false`。未声明则 `pnpm lint:hsas` 报错（错误码 `NEEDS_WORKSPACE_NOT_DECLARED`）。

2. **语义**：
   - `true`：该能力需要文件输入输出（如简历筛选、JD 优化、报告生成）。创建会话时平台自动创建 Workspace 并绑定到会话。
   - `false`：该能力是纯对话（如 assistant、music-radio）。创建会话时不创建 Workspace，文件树区域显示空状态。

3. **默认值**：Schema 层面 `needsWorkspace` 是 `optional`（默认 `false`），但 Lint 层面**强制要求显式声明**，不允许依赖默认值。

### 示例

```yaml
# 需要工作空间的能力
spec:
  agentName: screener
  category: hr-screening
  needsWorkspace: true  # ✅ 显式声明
  contextKeys:
    - workspacePath
    - jdContent

# 纯对话能力
spec:
  agentName: assistant
  category: general
  needsWorkspace: false  # ✅ 显式声明
```

### 错误示例

```yaml
# ❌ 未声明 needsWorkspace → pnpm lint:hsas 报错
spec:
  agentName: screener
  category: hr-screening
  contextKeys:
    - workspacePath
```
