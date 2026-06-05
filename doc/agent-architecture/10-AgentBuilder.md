# AgentBuilder — 自然语言生成 Agent

> 版本：v1.0 | 日期：2026-05-27 | 状态：设计稿
>
> 平台旗舰特性：用户用一句话描述需求 → 元 Agent 自动生成完整的 Capability + Agent + Skill 清单 → 一键安装 → 立即可用。

---

## 一、产品形态

### 1.1 一句话定位

**"AgentBuilder 是 Seven HROps 平台自带的'Agent 工厂'，让不会写 Prompt 的 HR 也能 5 分钟造出自己的专属助手。"**

### 1.2 用户旅程

```
[主界面 +] → [AgentBuilder 对话框]
       ↓
用户描述："我要做一个面向校招生的简历筛选 Agent，
          重点看实习经历、ACM/Kaggle 比赛、开源项目"
       ↓
agent-builder Agent 启动多轮对话
  ├─ 澄清输入输出
  ├─ 推荐可复用的内置 Skill
  ├─ 询问是否新建 Skill
  └─ 询问工具授权范围
       ↓
[预览页] 展示生成的 Manifest（Capability + Agent + 可能的 Skill）
       ↓
用户确认 → 调用 install_capability → 写入 SQLite + 注册 Loader
       ↓
左侧 CapabilityCard 立即出现"校招筛选" → 点击就能用
```

### 1.3 入口位置

| 位置 | 说明 |
|---|---|
| 主界面左侧 CapabilityCard 区域 顶部 `+` 按钮 | 新建能力主入口 |
| 设置页 → 能力管理 → 新建 | 管理后台入口 |
| 任意 Agent 对话中输入 `/new-agent` | 快捷指令 |
| `agent-builder` Capability 卡片本身 | 把元 Agent 也作为一个可见能力 |

---

## 二、AgentBuilder Agent 定义

### 2.1 Manifest（写入 `src/platform/manifests/agents/agent-builder.yaml`）

```yaml
apiVersion: hsas.seven-hrops/v1
kind: Agent
metadata:
  name: agent-builder
  displayName: Agent 工厂
  description: 把自然语言需求转换为 HSAS 清单（Capability + Agent + Skill）
  source: builtin
  version: 1.0.0
  icon: 🛠️
  createdAt: 2026-05-27T00:00:00Z
spec:
  mode: primary
  basePrompt: |
    （见下方 §2.2 完整 System Prompt）
  contextKeys:
    - userName
    - workspacePath
    - existingCapabilities   # 已安装能力列表（避免重复）
  tools:
    allowed:
      - list_available_tools
      - list_available_skills
      - list_available_agents
      - list_existing_capabilities
      - create_agent_manifest
      - create_skill_manifest
      - create_capability_manifest
      - validate_manifest
      - preview_manifest
      - install_capability
    autoApprove:
      - list_available_tools
      - list_available_skills
      - list_available_agents
      - list_existing_capabilities
      - validate_manifest
      - preview_manifest
  permission:
    - { permission: builder, pattern: "*", action: allow }
  model:
    provider: anthropic
    modelID: claude-4.7-sonnet
    temperature: 0.5
  capabilityBinding:
    capabilityId: agent-builder
    autoCreate: true
```

### 2.2 System Prompt（核心）

```text
你是 Seven HROps 平台的 **Agent 工厂**，名字叫 Builder。

# 你的使命
帮助用户（多数是 HR、招聘官、HRBP）把需求变成可立即运行的 Agent。
用户大多数不懂技术，所以你要：
- 用人话沟通，不出现 "JSON / Schema / Manifest" 等术语
- 主动提问、主动建议，不要让用户面对空白页
- 优先复用已有能力，避免造重复的轮子

# 工作流程（5 步法）

## Step 1 — 倾听与澄清
当用户说"我要做一个 X 的助手"时，你需要在 3～5 轮对话内问清这三件事：
1. **场景**：什么时候用？面试前 / 面试中 / 入职后？
2. **输入**：你会给我什么？（JD / 简历 / 录音 / Word 文档 / 仅靠对话？）
3. **输出**：你想拿到什么？（评分表 / 报告 / 推送通知 / 一个总结？）

不要一次问 10 个问题。每轮最多 1～2 个核心问题，让用户轻松回答。

## Step 2 — 探索可复用资源
调用 list_existing_capabilities / list_available_skills / list_available_agents
看看：
- 是否已有相似能力？如有，先建议用户"试试现有的"
- 哪些 Skill 可以直接搭进来？（screener / compliance / tech-stack-detector ...）
- 内置 Agent 中有没有可以"继承"的（inheritFrom）？

## Step 3 — 决定是否新建 Skill
只有当现有 Skill 都覆盖不了用户的核心独特需求时，才提议新建 Skill。
新建 Skill 的判断标准：
- 这是一个可复用的"知识包"，未来其他 Agent 也用得上 → 值得新建
- 只是这个 Agent 自己用一次的逻辑 → 写进 Agent 的 basePrompt 即可

## Step 4 — 生成清单（关键）
按这个顺序生成：
1. 如果需要新 Skill → 调用 create_skill_manifest
2. 调用 create_agent_manifest
3. 调用 create_capability_manifest
4. 调用 validate_manifest 全量校验

# 工具调用规则
- 每次调用工具前，告诉用户你在做什么（一句话即可）
- 工具白名单**必须最小化**：用户没明确要的功能不要加工具
- 用户自定义 Agent 默认只能用 safe + write 类工具
- 涉及发送外部消息（企微）/ 删除数据 / 调用音频转录的工具 → 必须二次确认

## Step 5 — 预览与安装
调用 preview_manifest 把三份清单的关键信息渲染给用户看，重点突出：
- 这个 Agent 能做什么（一句话）
- 它会用哪些工具（中文名 + 风险标签）
- 它会读写哪些路径（文件系统沙箱）
- 是否需要发送外部消息

用户最终确认后，调用 install_capability 一键落地。

# 命名规则
- Agent / Capability 的 metadata.name 用英文小写连字符（例：my-tech-screener）
- displayName 用中文（例：互联网技术岗筛选）
- 不要用 "新-Agent-1" 这种没意义的名字，从用户输入提取语义

# 拒绝场景
- 用户要求生成"删库 / 群发骚扰邮件 / 爬取竞品数据"等违规需求 → 礼貌拒绝
- 用户要求"无限制权限" → 解释沙箱机制，引导细化需求
- 用户描述太模糊（"帮我做点什么"）→ 主动给 3 个示例方向让 ta 选

# 风格
- 中文为主，技术名词第一次出现时用中文 + 英文括注
- 用 Emoji 适度增加亲切感（不要每句话都用）
- 输出 Manifest 预览时，用中文标题 + 缩进，不要把 YAML 原文丢给用户

# 示例对话开头
> 用户："我要做一个能识别简历造假的 Agent"
> 你："👋 好的，我来帮你造一个'简历造假识别助手'。
>     先问你一个问题：你想让它**只做提示**（标红可疑点交给你判断），
>     还是**自动给出结论**（直接打分 + 拒/留）？
>     另外，你打算把哪些信息源给它？比如：
>     - 简历内容（PDF/Word）
>     - 候选人填写的入职表
>     - 公开领英 / 脉脉资料
>     选 1～2 个最重要的就行。"
```

### 2.3 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 元 Agent 是否内置 | ✅ 内置 | 用户不需要"先学会写 Agent 才能写 Agent"；保证生成质量与安全 |
| mode | `primary` | 直接面对用户，不是被其他 Agent 调用的子 Agent |
| 是否能修改自身 | ❌ 不能 | `agent-builder` 不允许调 `install_capability` 修改自己（防递归 bug） |
| 是否能创建 marketplace 包 | ❌ v1 不能 | 用户能创建的最高级别是 `source: user` |
| 模型温度 | 0.5 | 比筛选类 Agent（0.3）高，比聊天 Agent（0.7）低；需要一定创造性但不能漂 |

---

## 三、配套 MCP 工具

### 3.1 工具一览

| 工具名 | 类别 | 输入 | 输出 |
|---|---|---|---|
| `list_available_tools` | builder | filter? | 工具元数据列表（中文名 + 风险标签） |
| `list_available_skills` | builder | filter? | Skill 列表 |
| `list_available_agents` | builder | filter? | Agent 列表 |
| `list_existing_capabilities` | builder | filter? | 已安装 Capability 列表 |
| `create_agent_manifest` | builder | AgentSpecDraft | AgentManifest（含校验结果） |
| `create_skill_manifest` | builder | SkillSpecDraft | SkillManifest（含目录创建） |
| `create_capability_manifest` | builder | CapabilitySpecDraft | CapabilityManifest |
| `validate_manifest` | builder | { manifest } | { valid, errors[] } |
| `preview_manifest` | builder | { manifests[] } | 中文渲染的预览 HTML/Markdown |
| `install_capability` | builder | { manifests[] } | { installed, capabilityId } |

### 3.2 工具实现要点

#### `list_available_tools`

```typescript
// 返回结构示例
{
  tools: [
    {
      name: "list_files",
      displayName: "列出文件",
      category: "safe",
      riskLabel: "✅ 安全",
      description: "列出指定目录的文件",
      defaultAllowedSources: ["builtin", "user", "marketplace"],
    },
    {
      name: "send_wecom_message",
      displayName: "发送企微消息",
      category: "sensitive",
      riskLabel: "⚠️ 敏感（会发送外部消息）",
      description: "通过企业微信向指定用户/群发送消息",
      defaultAllowedSources: ["builtin"],
    },
    // ...
  ],
  // builder 会用这份列表给用户做"工具菜单"
}
```

特别处理：当调用方是 `agent-builder` 时，返回 `defaultAllowedSources` 中含 `user` 的工具时打绿标，否则打灰标 + 标注"需要授权才能给用户 Agent 用"。

#### `create_agent_manifest`

```typescript
// 输入：AgentSpecDraft（builder 内部生成的草稿，未必合法）
// 实现：
// 1. 补全默认值（version: 1.0.0 / createdAt: now / source: user）
// 2. 调用 manifestValidator.validate() 校验
// 3. 校验失败：返回 { valid: false, errors: [...] } 不抛异常（让 builder 修正）
// 4. 校验成功：返回 { valid: true, manifest } 但**不**写入 DB

interface CreateAgentManifestInput {
  metadata: Partial<Metadata>
  spec: Partial<AgentSpec>
}

interface CreateAgentManifestOutput {
  valid: boolean
  manifest?: AgentManifest
  errors?: ValidationError[]
}
```

#### `install_capability`

```typescript
// 输入：完整的 Capability + Agent + 可选的 Skill 清单
// 实现：
// 1. 事务开始
// 2. 逐个 validate
// 3. 写入 SQLite（agent_manifests / skill_manifests / capabilities）
// 4. 写文件系统（Skill 目录，如有）
// 5. 调用 SkillLoader.load → AgentLoader.load → CapabilityRegistry.install
// 6. 广播 'capability-installed' 事件 → 前端 Store 刷新 → 左侧 CapabilityCard 即时出现
// 7. 事务提交（失败回滚 + 删除已写文件）
```

---

## 四、UI 设计

### 4.1 AgentBuilderDialog（自然语言生成对话框）

```
┌────────────────────────────────────────────────────────┐
│  🛠️ 新建能力                                    [×]    │
├────────────────────────────────────────────────────────┤
│                                                         │
│  💬 与 Builder 对话区域（占主体）                        │
│                                                         │
│  ┌──────────────────────────────────────────────┐     │
│  │ 👋 我是 Builder，告诉我你想造一个什么样的助手  │     │
│  │ 也可以从下面的模板开始：                       │     │
│  │   📋 简历筛选类 / 📝 JD 优化类 / 🎤 面试类     │     │
│  └──────────────────────────────────────────────┘     │
│                                                         │
│  ┌──────────────────────────────────────────────┐     │
│  │ 用户：我要做一个 校招简历筛选 Agent...        │     │
│  └──────────────────────────────────────────────┘     │
│                                                         │
│  ┌──────────────────────────────────────────────┐     │
│  │ 🛠️ Builder：好的，先问你一个问题... [流式]    │     │
│  │ 🔍 工具调用：list_available_skills            │     │
│  │ ✅ 已找到 5 个可复用 Skill                     │     │
│  └──────────────────────────────────────────────┘     │
│                                                         │
│  ─────────────────────── ⓘ 进度: ●●●○○ ────────────    │
│                                                         │
│  [输入框]                                  [发送 ⏎]    │
└────────────────────────────────────────────────────────┘
```

进度条 5 个圆点对应 §2.2 中的 5 步法（倾听 → 探索 → 决定 Skill → 生成 → 预览安装）。

### 4.2 ManifestPreview（安装前预览页）

由 `preview_manifest` 工具返回结构化数据，前端用专门的预览组件渲染：

```
┌────────────────────────────────────────────────────────┐
│  即将安装：互联网技术岗筛选                              │
├────────────────────────────────────────────────────────┤
│                                                         │
│  📌 它能做什么                                          │
│     针对前端/后端/算法岗位筛选简历，                    │
│     输出 5 维度评分表和淘汰原因                         │
│                                                         │
│  🔧 会使用的工具（4 个）                                │
│     ✅ 列出文件（list_files）                           │
│     ✅ 解析简历（parse_resume_batch）                   │
│     ✅ 保存筛选结果（save_screening_result）            │
│     ✅ 生成报告（generate_screening_report）            │
│                                                         │
│  📁 文件读写范围                                        │
│     ✅ 读：当前工作空间                                 │
│     ✅ 写：当前工作空间/output/                         │
│     ❌ 不会访问其他位置                                 │
│                                                         │
│  📦 会安装的资源                                        │
│     • Capability：互联网技术岗筛选                      │
│     • Agent：my-tech-screener（继承自 screener）        │
│     • Skill：tech-stack-detector（新建）                │
│                                                         │
│  ⚠️ 风险提示                                            │
│     无敏感操作                                          │
│                                                         │
│  [取消]              [回去修改]         [确认安装 →]   │
└────────────────────────────────────────────────────────┘
```

### 4.3 CapabilityManager（能力管理页）

入口：设置 → 能力管理

```
┌──────────────────────────────────────────────────────────┐
│  能力管理                                  [+ 新建能力]  │
│  [全部] [内置] [我的] [已禁用]              [搜索]      │
├──────────────────────────────────────────────────────────┤
│  📋 简历筛选            内置  ✅ 启用     [禁用] [详情] │
│  📝 JD 优化             内置  ✅ 启用     [禁用] [详情] │
│  ...                                                      │
│  🧑‍💻 互联网技术岗筛选    我的  ✅ 启用     [编辑] [删除] │
│      作者：zhangsan  v1.0.0  · 安装于 2026-05-27         │
│  🎓 校招筛选            我的  ⏸️ 已禁用   [启用] [删除] │
└──────────────────────────────────────────────────────────┘
```

点击 `[编辑]` 可：
- 调整 displayName / icon / 描述
- 改 basePrompt
- 增减工具白名单
- 重新进入 AgentBuilder 对话（保留历史上下文）

点击 `[详情]` 可看到完整 Manifest（YAML 视图，开发者友好）。

---

## 五、安全闭环

### 5.1 三道防线

```
[第 1 道] AgentBuilder 在 prompt 层就拒绝违规需求
    ↓
[第 2 道] create_*_manifest 工具校验工具白名单（只能选 user 可用的工具）
    ↓
[第 3 道] install_capability 前展示预览，用户必须显式点"确认"
    ↓
[运行时] Sandbox 在每次工具调用前再校验（防止清单被绕过）
```

### 5.2 关键约束

| 约束 | 实现位置 |
|---|---|
| 用户 Agent 默认只能用 safe + write | ToolRegistry.defaultAllowedSources |
| 用户 Agent 不能调用 builder 类工具 | 同上（builder 仅 builtin） |
| AgentBuilder 自身不能修改自身 | install_capability 内黑名单 `agent-builder` |
| Skill 包大小 ≤ 10MB | manifestValidator 校验 |
| 单 Agent 工具白名单 ≤ 20 个 | manifestValidator 校验 |
| 网络请求需声明 allowedHosts | sandbox 拦截 |
| FS 写入路径必须在沙箱白名单 | sandbox 拦截 |

### 5.3 审计日志

所有 `install_capability` / `uninstall_capability` / `agent-builder` 对话历史全部落库到 `audit_log` 表，便于：
- 用户回顾"我什么时候装的这个 Agent"
- 出问题时回溯"这个 Agent 是怎么生成的"

---

## 六、典型对话示例

### 6.1 简单场景：复用内置能力

```
用户：我想要一个简历筛选 Agent

🛠️ Builder：让我先看看你已有的能力。
    🔍 [list_existing_capabilities]
    ✅ 你已经装了「简历筛选」能力（内置版本）。
    
    它的默认评分维度是：教育(20%)+经验(30%)+技能(30%)+项目(20%)
    你是要：
    A) 直接用现有的（推荐 ✅）
    B) 在它基础上做个性化版本（比如调整评分权重 / 加新维度）
    C) 从零开始造一个全新的

用户：B，我想加一个"开源贡献"维度，权重 15%

🛠️ Builder：明白了。我会基于内置版本"继承"一份新的，然后加上：
    - 新维度：开源贡献（15%）
    - 其他权重等比缩减
    
    给它起个名字吧？比如「带开源评估的简历筛选」？

用户：就叫「开源友好型筛选」

🛠️ Builder：好。我整理一下：
    - 名称：开源友好型筛选
    - 基于：简历筛选（内置）
    - 评分维度：教育(17%)+经验(25%)+技能(25%)+项目(18%)+开源贡献(15%)
    - 工具：和原版一样（4 个，无敏感操作）
    
    要不要我新建一个 "开源贡献评估" Skill？这样以后其他 Agent 也能用上。

用户：好

🛠️ Builder：[create_skill_manifest] [create_agent_manifest] [create_capability_manifest]
    [validate_manifest] ✅ 全部通过
    [preview_manifest]
    
    👀 预览准备好了，请看右侧 →
```

### 6.2 复杂场景：从零创建

```
用户：我要做一个能从录音里提取面试评价的 Agent

🛠️ Builder：这是一个不错的想法 👍
    在开始前我得问你两个事：
    
    1. 录音文件你打算放哪？
       A) 当前工作空间的某个文件夹
       B) 我每次手动选
    
    2. 输出你想要什么形式？
       A) 一份结构化的评分表（5 个维度 + 总评）
       B) 一段自然语言总结（适合直接发邮件）
       C) 都要

用户：1选A，放在 interviews/ 目录；2选C都要

🛠️ Builder：清楚了。这个 Agent 会需要：
    - 「读取文件」工具 ✅ 安全
    - 「转录音频」工具 ⚠️ 敏感（会调用语音识别服务）
    - 「保存面试评价」工具 ✅ 写入工作空间
    
    "转录音频"是敏感工具，因为它会把录音上传到云端识别。
    你希望：
    A) 每次转录前都问我一下（推荐 ✅）
    B) 一次授权，永久使用
    
用户：A

🛠️ Builder：[继续生成清单 ...]
```

---

## 七、与其他模块的协作

### 7.1 与 CapabilityRegistry

```
agent-builder.install_capability
    ↓
capabilityRegistry.install(manifest, source: 'user')
    ↓
emit 'capability-installed'
    ↓
capabilityStore.subscribe → setState
    ↓
CapabilityCard 列表自动刷新（Zustand 响应式）
```

### 7.2 与 ToolRegistry

`list_available_tools` 直接读 ToolRegistry，按 `defaultAllowedSources` 过滤。

### 7.3 与 Sandbox

`install_capability` 在写入前会调用 `sandbox.dryRun(manifest)`：
- 静态分析 prompt 是否包含已知的越权指令模式
- 检查 fs 路径是否在沙箱白名单
- 检查 network.allowedHosts 是否涉及黑名单域名

---

## 八、实施 Checklist

Phase 5（Week 5～6）落地清单：

- [ ] 编写 [`agent-builder.yaml`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/platform/manifests/agents/agent-builder.yaml) Manifest
- [ ] System Prompt 完整版（基于 §2.2，迭代 3～5 轮）
- [ ] MCP 工具组（10 个）：[`tool-registry/builder-toolpack.ts`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/tool-registry/builder-toolpack.ts)
- [ ] Sandbox.dryRun 静态分析
- [ ] [`AgentBuilderDialog`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/components/AgentBuilderDialog/) 组件（含进度条 / 流式输出 / 工具调用气泡）
- [ ] [`ManifestPreview`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/components/ManifestPreview/) 组件
- [ ] [`CapabilityManager`](/Users/avinzhang/git/avin-kit/d2c_website/seven-hrops/src/components/CapabilityManager/) 页面
- [ ] `audit_log` SQLite 表 + 写日志逻辑
- [ ] 5 种典型场景的回归测试用例
  1. 复用内置能力（继承）
  2. 从零创建（仅引用现有 Skill）
  3. 从零创建（新建 Skill）
  4. 创建带敏感工具的 Agent（授权流）
  5. 用户输入违规需求（拒绝流）
- [ ] 用户引导：首次进入应用时引导用户用 Builder 造一个"个人助手"做新手任务

---

## 九、未来演进

| 版本 | 增强 |
|---|---|
| v1 | 自然语言对话生成 |
| v1.1 | 表单模式（不会聊天的用户走表单） |
| v1.2 | 模板市场（HR 模板库 / 招聘模板库） |
| v2.0 | 支持从一段示例对话**反向**生成 Agent（"我希望它像这样回答"） |
| v2.1 | A/B 测试：同一需求生成两个 Agent 对比效果 |
| v2.2 | 自我进化：Agent 运行一段时间后，Builder 主动建议优化 prompt |

---

## 十、相关文档

- [00-总架构设计.md](./00-总架构设计.md)
- [11-HSAS-Spec.md](./11-HSAS-Spec.md) — 清单规范
- [09-全局协调者.md](./09-全局协调者.md) — orchestrator 也是 primary mode 的 Agent，可参考
