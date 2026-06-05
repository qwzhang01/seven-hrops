# 手动命令清单（Manual Commands）

> 本文件是 **用户手动执行命令的唯一索引**。
> 当 AI 让你"在终端跑某条命令"时，请回到这里查找；新增的命令也会持续追加到这里，不会散落在各个 proposal/tasks 文档里。
>
> 路径约定：所有命令默认在 **仓库根目录** `~/git/avin-kit/d2c_website/seven-hrops/` 执行；如果需要切到子目录，会在条目里显式标注。
>
> 最近更新：2026-06-02 (新增 §10「问题排查经验 — LLM Function-Calling 协议兼容性」; 新增 `doc/LLM_FUNCTION_CALLING_COMPAT.md` 排查经验文档; 新增 `test:e2e` E2E 测试命令 — session-workspace-binding)

---

## 0. 速查（最高频）

| 场景 | 命令 |
| --- | --- |
| 首次 clone / 拉取了新依赖 | `pnpm install` |
| 启动 Web 开发（仅前端） | `pnpm run dev` |
| 启动 Tauri 桌面端开发 | `pnpm run tauri dev` |
| 重新生成 manifest 类型（Rust → JSON Schema → TS） | `pnpm run codegen` |
| 校验 manifest 产物未漂移（CI 同款） | `pnpm run codegen:check` |
| 跑全部测试（前端单元 + 集成 + Rust） | `pnpm run test:all` |
| 仅跑 Rust 测试 | `pnpm run test:cargo` |
| 仅跑前端单元测试 | `pnpm run test` |
| 仅跑 E2E 场景测试（session-workspace-binding 等） | `pnpm run test:e2e` |
| 沙箱压测（user source 100% deny 验证） | `pnpm tsx scripts/sandbox-stress.ts` |
| builtin fast-path 性能基准（< 5ms 验证） | `pnpm tsx scripts/builtin-fastpath-bench.ts` |
| 下载 pdfium 二进制（需设置 SEVEN_MODEL_MIRROR_ORG） | `./scripts/fetch-pdfium.sh --org <your-org>` |
| 编译并运行 FFI 集成测试（需 cmake/ninja/pdfium） | `cargo test --features ffi-real --test ffi_integration -- --nocapture --ignored` |
| 校验 `ai` 主包 ≥ 6.0.0 且打印 `@ai-sdk/*` minor 分布（多模型适配层守卫） | `pnpm run check:aisdk-versions` |
| AI SDK V1/V2/V3 混用运行时烟雾测试（有变更时手动峙） | `pnpm run check:aisdk-smoke` |
| prompt-style 装饰器烟雾测试（阶段 3 验收、未来变更状态机时手动跑） | `pnpm run check:prompt-style-smoke` |
| DynamicProvider 安全约束自检（阶段 5 验收、修改白名单正则或 trust 流程时必跑） | `pnpm run check:dynamic-provider-safety` |
| ProviderRegistry 路由自检（阶段 6 验收、修改 registry resolve 逻辑、selectAdapter、resolvePromptStyle 时必跑） | `pnpm run check:registry-routing` |

---

## 1. 启动 / 开发

### 1.1 启动前端 Vite Dev Server（不带 Tauri 壳）
```bash
pnpm run dev
```
- 用途：纯前端调试，不需要桌面壳能力。
- 默认端口：`http://localhost:5173`。

### 1.2 启动 Tauri 桌面端开发模式
```bash
pnpm run tauri dev
```
- 用途：完整调试 Tauri + 前端，会同时编译 Rust 后端 + 启动 Vite。
- 首次运行会触发 Rust 全量编译（几分钟），之后增量很快。

### 1.3 预览前端生产构建
```bash
pnpm run build       # 先打前端
pnpm run preview     # 起静态服务器预览
```

---

## 2. 构建 / 打包

### 2.1 构建前端产物
```bash
pnpm run build
```
- 等价于：`tsc && vite build`，会先做 TypeScript 类型检查，再走 Vite 打包。
- 产物：`dist/`。

### 2.2 打包桌面端安装包
```bash
pnpm run tauri build
```
- 产物：`src-tauri/target/release/bundle/`（macOS 下的 `.dmg` / `.app`）。

---

## 3. Codegen（manifest 类型生成）

> 单一事实源 = `src-tauri/src/manifest/*.rs`。
> 链路：Rust struct → `cargo run --bin gen_manifest_schema` → `platform/schemas/*.schema.json` → `node scripts/gen-manifest-types.mjs` → `src/types/manifest.generated.ts`。

### 3.1 一键全量重生成（推荐）
```bash
pnpm run codegen
```
- 内部串行跑：`codegen:schema` → `codegen:types`。
- **修改任何 `src-tauri/src/manifest/*.rs` 之后必须执行**。

### 3.2 仅重生 JSON Schema（Rust 端）
```bash
pnpm run codegen:schema
```
- 等价于：`cargo run --manifest-path src-tauri/Cargo.toml --bin gen_manifest_schema`
- 产物：`platform/schemas/{agent,skill,capability}.schema.json`
- 产物里的 `$comment` 字段写有 "AUTO-GENERATED — DO NOT EDIT"，**不要手改这三份 JSON**。

### 3.3 仅重生 TS 类型（前端）
```bash
pnpm run codegen:types
```
- 等价于：`node scripts/gen-manifest-types.mjs`
- 输入：`platform/schemas/*.schema.json`
- 产物：`src/types/manifest.generated.ts`

### 3.4 验证产物未漂移（本地自检 / CI 同款）
```bash
pnpm run codegen:check
```
- 等价于：`pnpm run codegen && git diff --exit-code platform/schemas src/types/manifest.generated.ts`
- 退出码 0 = 通过；非 0 = 有人没跑 codegen 就提交了，需要补 `git add` 产物再提交。
- **CI 在 `.github/workflows/test.yml → codegen-drift` job 跑的就是这条命令**，PR 合入前会拦下漂移。
- 本地不强制（不装 git hook，详见 7.4），改完 `src-tauri/src/manifest/*.rs` 请自觉跑 `pnpm run codegen` 或 `pnpm run codegen:check`。

---

## 4. 测试

### 4.1 跑全部测试
```bash
pnpm run test:all
```
- 串行执行：前端单元 → 前端集成 → Rust。

### 4.2 前端单元测试
```bash
pnpm run test          # 跑一次
pnpm run test:watch    # watch 模式
pnpm run test:unit     # 跑一次 + 覆盖率
```

### 4.3 前端集成测试
```bash
pnpm run test:integration
```
- 配置：`vitest.integration.config.ts`。

### 4.4 Rust 测试
```bash
pnpm run test:cargo
```
- 等价于：`cargo test --manifest-path src-tauri/Cargo.toml --lib`

---

## 5. OpenSpec 工作流（提示词级别，记在这里以免忘）

> OpenSpec 不是 CLI，而是仓库内 `openspec/changes/<change-name>/` 目录约定。常用动作通过 AI Skill 触发，命令仅作辅助。

| 动作 | 触发方式 |
| --- | --- |
| 创建新 proposal | 对 AI 说："立即调用 openspec-propose 启动 proposal 生成" |
| 进入 explore 思考模式 | 对 AI 说："openspec/explore" |
| 实施 change 中的 tasks | 对 AI 说："opsx/apply" 或 "开始实施 <change-name>" |
| 归档已完成的 change | 对 AI 说："archive <change-name>" |

**手动 review 当前在飞 change**：
```bash
ls openspec/changes/
cat openspec/changes/<change-name>/tasks.md
```

### 6.1 OpenSpec CLI（AI Skill 调用，开发者了解即可）

> 以下命令通常由 `openspec-propose` / `openspec-apply-change` / `openspec-archive-change` 三个 Skill 在内部自动调用；开发者一般不直接敲，但偶尔需要诊断时可以手动跑。

```bash
# 列出所有 change（含 schema、状态）
pnpm openspec list --json

# 单个 change 的 artifact / 任务完成度
pnpm openspec status --change <change-name> --json

# 校验 change 的 proposal/design/specs/tasks 结构合法
pnpm openspec validate <change-name> --strict

# 归档 change（手动；推荐用 Skill `openspec-archive-change` 编排）
mkdir -p openspec/changes/archive
mv openspec/changes/<change-name> openspec/changes/archive/$(date +%Y-%m-%d)-<change-name>
```

- 归档动作约定：当 change 的 `proposal/design/specs/tasks` 全部 done 且实施任务全部 `[x]` 时归档；目录前缀 `YYYY-MM-DD-` 取归档当天日期。
- 归档前 SHALL 把 `specs/<capability>/spec.md` 中的 ADDED / MODIFIED / REMOVED 应用到 `openspec/specs/<capability>/spec.md` 的 stable 版本（`openspec-archive-change` skill 会提示是否需要先 sync）。

---

## 7. 常用维护类命令

### 7.1 清理 Rust 构建缓存
```bash
cargo clean --manifest-path src-tauri/Cargo.toml
```

### 7.2 清理 node_modules 重装
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### 7.3 检查 Rust 代码格式 / lint
```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

### 7.4 Codegen 漂移自检（Phase B Task 0.6，2026-05-28 改版）
```bash
pnpm run codegen:check
```
- **不使用本地 git hook**：seven-hrops 是 monorepo `~/git/avin-kit/` 下的子目录，与 mp_md / mcp-kit 共享同一个 `.git`，装本地 hook 会污染兄弟项目。
- 拦截策略：PR 合入前由 CI `codegen-drift` job 强制校验；本地由开发者自觉在改完 `src-tauri/src/manifest/*.rs` 后跑 `pnpm run codegen` 或 `pnpm run codegen:check`。
- 想做更严格的本地拦截？可在 IDE 配 file watcher 监听 `src-tauri/src/manifest/**/*.rs` 自动跑 `pnpm run codegen`，但**禁止往父级 `.git/hooks/` 装钩子**。

### 7.5 Phase B Task 3.x — 模型/转写/Webserver 环境变量

模型下载依赖 Mirror 组织名（现阶段为占位，未配置时会在首调转写 / pdf 解析时返回结构化错误 `MODEL_MIRROR_NOT_CONFIGURED`，dev 期间这是预期行为）：

```bash
# 临时（当前 shell）
export SEVEN_MODEL_MIRROR_ORG="<你的组织名>"
# 永久（写入 ~/.zshrc）
echo 'export SEVEN_MODEL_MIRROR_ORG="<你的组织名>"' >> ~/.zshrc
```

另有两个可选 env，只在本地调试重定向存储路径时才需要：
- `SEVEN_HROPS_MODELS_DIR`：覆盖默认模型路径 `~/.seven-hrops/models/`。
- `SEVEN_HROPS_AUDIT_DIR`：覆盖默认审计路径 `~/.seven-hrops/audit/`。

运行时查验启动是否成功：启动 app 后在 devtools 控制台 `await invoke('models_ensure', { name: 'whisper-base-zh' })`，未配置时会返回 `MODEL_MIRROR_NOT_CONFIGURED`，配置后会进入 `downloading` 状态。

---

## 8. Phase B 9.x FFI 手动验证清单（明天执行）

> **背景**：Phase B 代码已全部实现，9.x 任务需要本地 cmake/ninja 环境 + GitHub mirror 仓库，以下是完整的按序执行步骤。

### 第一步：安装构建工具
```bash
brew install cmake ninja pkg-config
# 验证
cmake --version && ninja --version && pkg-config --version
```

### 第二步：创建 GitHub mirror 仓库（一次性）
1. 在 GitHub 创建仓库 `<your-org>/seven-hrops-assets`
2. 创建两个 Release tag：
   - `pdfium-v6611`
   - `whisper-base-zh-v1`
3. 上传资产到对应 Release：
   - pdfium 二进制：从 [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases) 下载 `pdfium-mac-arm64.tgz`、`pdfium-mac-x64.tgz`、`pdfium-win-x64.zip`
   - **注意**：使用 PDFium **build 7857**（版本 `150.0.7857.0`），对应 Release tag `pdfium-v7857`
   - whisper 模型：从 [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp/releases) 下载 `ggml-base.bin`

### 第三步：下载 pdfium 并获取 sha256
```bash
export SEVEN_MODEL_MIRROR_ORG=<your-org>
./scripts/fetch-pdfium.sh
# 脚本末尾会打印 sha256，复制备用
```

### 第四步：更新 MODEL_REGISTRY sha256
编辑 `src-tauri/src/native/models.rs`，将所有 `sha256: "PENDING"` 和 `{org}` 占位符替换为真实值。

### 第五步：运行 FFI 集成测试
```bash
# 需要在 src-tauri 目录下执行
cd src-tauri

# 1. 测试 PDF 解析（已准备好 sample.pdf）
SEVEN_MODEL_MIRROR_ORG=qwzhang01 cargo test --features ffi-real --test ffi_integration -- test_parse_single_page_pdf --nocapture --ignored

# 2. 测试转写（会自动下载 whisper 模型，约 150MB，需要网络）
SEVEN_MODEL_MIRROR_ORG=qwzhang01 cargo test --features ffi-real --test ffi_integration -- test_transcribe_download_and_run --nocapture --ignored
```

### 第六步：验证 FFI_NOT_IMPLEMENTED 清零
```bash
# 启用 ffi-real 后，生产路径上不应再有 ffi_not_implemented 调用
cd src-tauri
cargo check --features ffi-real 2>&1 | grep "ffi_not_implemented" | grep -v "test\|//\|errors.rs" || echo "✅ clean"
```

### 第七步：回填数据到 RUN_REPORT.md
验证通过后，更新 `openspec/changes/phase-b-platform-foundation/RUN_REPORT.md` 第十章"待填实际数据"表格中的 sha256 和性能数据。

---

## 9. 维护规则（给 AI 看的）

1. **任何"请在终端运行"的指令，都必须先在本文件登记或更新条目，再让用户去跑**。
2. 新增条目至少包含：用途、命令、执行目录、预期产物/输出。
3. `package.json scripts` 是命令的唯一事实源，本文件只做"中文注释 + 场景索引"，不要在这里发明 `package.json` 里没有的别名命令。
4. 命令变更（重命名 / 删除 / 新增）时，**同步更新本文件**，并在 `最近更新` 字段标注日期。

---

## 10. 问题排查经验（给 AI 看的）

### 10.1 工具调用链中断 — LLM Function-Calling 协议兼容性

> **问题现象**：Agent 成功调用第一个工具（如 `list_dir`），但没有继续调用后续工具（如 `parse_pdf`），导致任务失败。
>
> **根因**：不同大模型对 function-calling 的消息协议支持程度不同。Claude/OpenAI 原生支持 AI SDK 标准格式，而豆包/Qwen/GLM 等模型使用 prompt-style 协议，**不支持**原生 function-calling 消息格式。
>
> **排查步骤**：
> 1. 检查 `resolved.promptStyle` 是否非 null（非 null = prompt-style 模型）
> 2. 检查错误消息是否包含 `AI_InvalidPromptError`
> 3. 检查 `provider/index.ts` 的 `stream()` 方法是否调用了 `flattenToolMessagesForPromptStyle()`
> 4. 查看详细排查清单：[`doc/LLM_FUNCTION_CALLING_COMPAT.md`](./LLM_FUNCTION_CALLING_COMPAT.md)
>
> **解决方案**：确保 `flattenToolMessagesForPromptStyle()` 在 `convertToAiSdkMessages()` 之前被调用（已实现在 `provider/index.ts`）。
>
> **经验教训**：
> - 不要假设所有模型都支持原生 function-calling
> - 测试时要注意模型协议差异（不能只用 OpenAI/Claude 测试就认为功能正常）
> - 错误消息可能不直接指向根因，要追踪完整的工具调用链
>
> **相关文档**：
> - [`doc/LLM_FUNCTION_CALLING_COMPAT.md`](./LLM_FUNCTION_CALLING_COMPAT.md) — 完整排查经验文档
> - [前端编码约定 §3.2](../.codebuddy/rules/frontend-conventions.md) — Provider 协议适配层边界

---

## 10. 当前状态总结（2026-05-28）

### 已完成
- ✅ Mirror 仓库已配置：`qwzhang01/seven-hrops-assets`
- ✅ 环境变量已设置：`SEVEN_MODEL_MIRROR_ORG="qwzhang01"`
- ✅ 模型注册表已更新：
  - 组织名：`qwzhang01`
  - whisper sha256：`60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`
  - pdfium-mac-arm64 sha256：`9bc810acc9a877290d902bd1e60d799cac1b4855c82a4ee11f4a4653c8a038cc`
  - 版本 tag：`pdfium-v7857`（PDFium `150.0.7857.0`）
- ✅ PDFium 已成功下载到 `~/.seven-hrops/native/pdfium/mac-arm64/libpdfium.dylib`
- ✅ `pdfium-render` 升级至 `0.9.1`，与 PDFium `150.0.7857.0` 完全兼容
- ✅ 项目构建通过（`ffi-real` 特性，含 pdfium-render 真实实现）

### 待完成
- ⏳ **运行 FFI 集成测试**：需要准备 `hello.wav` 测试音频文件
- ⏳ **其他平台 sha256**：pdfium-mac-x64 和 pdfium-win-x64（暂时不需要，先跑 mac）

### 可立即测试的功能
- ✅ **PDF 解析**：pdfium-render 0.9.1 + PDFium 7857 编译通过，可测试
- ✅ **Whisper 转录**：模型会自动下载，可以测试音频转写功能
- ✅ **其他文档解析**：DOCX 和 Excel 解析功能正常

---

## 11. 多模型协议适配层依赖安装（runtime-multimodel-protocol-adapter）

> **背景**：本 change 引入 `ProviderRegistry × ProtocolAdapter × ProviderPlugin` 三层抽象，覆盖 18 个主流 LLM 厂商（11 国际 + 7 国内）+ Ollama 本地 + Dynamic 动态扩展。需要新增 11 个 npm 包（`@ai-sdk/anthropic` 已在仓内，无需重装）。
>
> 见 `openspec/changes/runtime-multimodel-protocol-adapter/`。

### 11.1 一次性安装 11 个 `@ai-sdk/*` 包

```bash
pnpm add \
  @ai-sdk/openai-compatible \
  @ai-sdk/google \
  @ai-sdk/xai \
  @ai-sdk/groq \
  @ai-sdk/mistral \
  @ai-sdk/cohere \
  @ai-sdk/perplexity \
  @ai-sdk/togetherai \
  @ai-sdk/deepinfra \
  @ai-sdk/alibaba \
  @openrouter/ai-sdk-provider
```

- 不指定版本号：让 pnpm 解析当前 npm registry 上各包的最新可用版本，自动写回 `package.json`。
- 现有 `@ai-sdk/openai`（^3.0.0）、`@ai-sdk/anthropic`（^3.0.0）已在仓内，无需重装。
- ai-sdk 生态 sub-package 发版节奏不同，minor 跨越是常态（官方一线 3.x · 通用兼容 2.x · 第三方 1.x）。`ai@6.x` 运行时同时接受这三套协议的 model 实例，无须对齐。

### 11.2 校验 AI SDK 运行时兼容性

```bash
pnpm run check:aisdk-versions
```

- 等价于 `tsx scripts/check-aisdk-versions.ts`。
- **硬约束（exit 1）**：`ai` 主包未安装 / 版本低于 6.0.0。
- **软约束（warning）**：`@ai-sdk/*` 各包 minor 不一致 —— 这是 ai-sdk 生态常态，脚本只打印分布供人工识别，不退错。
- **CI 建议接入作为 PR 守门**（与 `codegen:check` 同等地位）。

### 11.2.1 混用运行时烟雾测试

```bash
pnpm run check:aisdk-smoke
```

- 等价于 `tsx scripts/aisdk-mixed-version-smoke.ts`。
- 用 mock fetch 分别向 `@ai-sdk/openai (V3)` · `@ai-sdk/openai-compatible (V2)` · `@ai-sdk/alibaba (V1)` 三个不同 minor 段的包发起 streamText 调用，验证三者在 `ai@6.x` 下可同台共存。
- **仅在升级 ai-sdk 主包或仓内任一 `@ai-sdk/*` major 变更时手动跑一次**，不进 CI（依赖本地 fetch 模拟，不应路灯中重复跑）。

### 11.2.2 prompt-style 装饰器烟雾测试

```bash
pnpm run check:prompt-style-smoke
```

- 等价于 `tsx scripts/prompt-style-decorator-smoke.ts`。
- 覆盖 spec.md `agent-runtime-llm-provider` 的 5 个核心 scenario：豆包正常 token 序列 / 1 字节 1 chunk 跨切割 / token 未闭合 abort / JSON 解析失败 / Qwen `<tool_call>` 风格。
- **阶段 3 实现后验收使用**；阶段 7.4–7.8 在 Vitest 中复现同样断言后可以考虑下架，不进 CI。

### 11.3 校验 typecheck 不破
```bash
pnpm exec tsc --noEmit
```

- 用途：校验 `ProviderConfig` 新增的 `protocol` / `promptStyle` / `dynamicPackage` 三个可选字段未破坏既有引用点。
- 等价 `pnpm run build` 的前半段（`tsc && vite build` 中的 `tsc`），但跳过打包，速度快得多。

### 11.4 单跑 provider 协议适配层测试

```bash
pnpm exec vitest run src/agent-runtime/provider
```

- 覆盖：阶段 7（协议层契约测试）、阶段 8（plugin 形态 + registry）、阶段 9（dynamic 安全约束）、阶段 11（豆包 / Anthropic / dynamic 集成测试）。
- 验证目标：协议层归一化输出 `LLMStreamEvent` 与现有 [`provider/single-loop.test.ts`](../src/agent-runtime/provider/single-loop.test.ts) 全部通过。

### 11.5 端到端验证（需要真实 API key）

```bash
pnpm run tauri dev
```

- 在桌面端切换 LLM 配置至火山方舟豆包，跑一次需要工具的对话（如简历筛选）。
- **核心成功判据**：UI 出现 tool-call bubble → 工具执行 → follow-up text 流式回来；这是本变更治本豆包工具调用的核心成功判据（spec.md `Scenario: 豆包模型 prompt-style 工具调用通过装饰器整流`）。
- 切到 OpenAI / Anthropic / DeepSeek / 智谱 GLM / 腾讯混元 各跑一次确认无 regression（对应 tasks 14.3）。

### 11.6 四 provider 真机验证配置参考（runtime-multimodel-protocol-adapter）

> 本节是 `runtime-multimodel-protocol-adapter` 归档后的「真机验证配置速查表」。**不是命令登记**——四个 provider 全部走 GUI 配置（顶部「大模型配置」按钮 → LLMConfigModal），但由于参数较多、易记错，统一固化在此供对照。验证顺序：豆包 → DeepSeek → 硅基流动 → Ollama，从「最可能暴露问题」到「最稳妥」递进。
>
> 全程只需 [`pnpm run tauri dev`](#11-端到端开发与运行) 这一条命令，每切换一个 provider 在 GUI 改完配置后跑一段「需要工具的对话」即可。

#### 11.6.1 豆包（火山方舟） — 治本目标，**必跑**

- **providerID**：`volcengine`
- **modelID**：填火山方舟控制台分配的 endpoint ID（形如 `ep-202404xx-xxxxxxxx`），不是 `doubao-pro` 这种通名
- **baseURL**：留空（plugin 默认 `https://ark.cn-beijing.volces.com/api/v3`）
- **apiKey**：火山方舟 API Key（控制台 → API Key 管理）
- **protocol**：留空 ⇒ 自动 `openai-compatible`
- **promptStyle**：留空 ⇒ 自动 `doubao`（[`VolcenginePlugin`](../src/agent-runtime/provider/plugins/volcengine.ts) 默认启用装饰器，**这是本变更核心治本路径**）
- **核心成功判据**：UI 出现 tool-call bubble（[`prompt-style-tool-call.ts`](../src/agent-runtime/provider/protocols/prompt-style-tool-call.ts) 装饰器把 `<|FunctionCallBegin|>...<|FunctionCallEnd|>` 整流成 `LLMStreamEvent.tool-call`）→ 工具执行 → follow-up text 流式回来
- **失败诊断**：
  - 看到 raw `<|FunctionCallBegin|>` 文本而非 tool-call bubble ⇒ 装饰器未启用，检查 `promptStyle` 字段是否被显式设为 `null`
  - tool-call 触发但参数 JSON 解析失败 ⇒ 模型输出格式漂移，记录原始 chunk 上报

##### 11.6.1.1 豆包真机 fixture 锚点（`runtime-multimodel-real-machine-verification`）

首次接入豆包时发现“原 change 自造 fixture vs 豆包真机 SSE”两个偏差：

1. 顶层 JSON 体是**数组** `[{...}, ...]`（允许同段并发多 tool-call）而非单对象。
2. 入参字段名是 **`parameters`**（豆包习惯）而非 OpenAI/AI-SDK 习惯的 `arguments`。

修复后，[`prompt-style-tool-call.ts`](../src/agent-runtime/provider/protocols/prompt-style-tool-call.ts) 的 `parseToolCalls` 同时兼容两种形态，且[`__fixtures__/doubao-real.ts`](../src/agent-runtime/provider/__fixtures__/doubao-real.ts) 以字节级复刻存了一条真机 payload 作为 [`integration-doubao.test.ts`](../src/agent-runtime/provider/integration-doubao.test.ts) Case D “real-machine fixture” 的套件 fixture。

纪律联动：[`.codebuddy/rules/frontend-conventions.md` §3.2.1](../.codebuddy/rules/frontend-conventions.md) 与 [`openspec/specs/platform-foundation/spec.md`](../openspec/specs/platform-foundation/spec.md)（archive 后）的「prompt-style ProtocolAdapter 测试 fixture 必须有真机锚点」Requirement。后续接入新的 prompt-style 模型卡（举例：GLM / ChatGLM / 未来 Hunyuan tool-call）时，**必须**在 `__fixtures__/<provider>-real.ts` 入仓一条真机字节 fixture 才能合入。

#### 11.6.2 DeepSeek — 验证 openai-compatible 协议层无 regression

- **providerID**：`deepseek`
- **modelID**：`deepseek-chat` / `deepseek-coder` / `deepseek-reasoner`（推荐 `deepseek-chat`）
- **baseURL**：留空（plugin 默认 `https://api.deepseek.com/v1`）
- **apiKey**：[DeepSeek 平台](https://platform.deepseek.com/api_keys) 的 API Key
- **protocol** / **promptStyle**：均留空 ⇒ `openai-compatible` + 无装饰器（DeepSeek 原生支持 OpenAI function-calling）
- **核心成功判据**：tool-call 通过 OpenAI 标准 `tool_calls` 字段返回，无装饰器介入
- **失败诊断**：
  - 401/403 ⇒ apiKey 无效或账户余额耗尽
  - tool-call 永远不触发 ⇒ DeepSeek 当前模型不支持 function-calling，换 `deepseek-chat`

#### 11.6.3 硅基流动 — 验证「未知 providerID + 显式 protocol」兜底分支

- **providerID**：填 `siliconflow`（任意字面，registry **没有具名 plugin**，会落到「分支 3：未知 providerID + 显式 protocol → OpenAI-Compatible 兜底」）
- **modelID**：硅基流动平台上的具体 model 字符串，**必须选支持 function-calling 的模型**：
  - 推荐：`Qwen/Qwen2.5-72B-Instruct` / `Qwen/Qwen2.5-Coder-32B-Instruct` / `deepseek-ai/DeepSeek-V2.5`
  - 慎选：32B 以下的小模型多数 function-calling 能力不稳定
- **baseURL**：**必填** `https://api.siliconflow.cn/v1`
- **apiKey**：[硅基流动控制台](https://cloud.siliconflow.cn/account/ak) 的 API Key
- **protocol**：**必须显式选** `openai-compatible`（这是触发兜底分支的关键——`config.protocol` 必须非空，否则 `UnknownProviderProtocolError`）
- **promptStyle**：留空（兜底路径不挂任何装饰器，除非用户显式选 `doubao` / `qwen`）
- **核心成功判据**：未知 providerID + 显式 protocol 成功路由到 `createOpenAICompatible` 兜底（[registry.ts](../src/agent-runtime/provider/registry.ts) 分支 3），tool-call 通过原生 function-calling 触发
- **失败诊断**：
  - `UnknownProviderProtocolError` 含 19 个内置 ID 列表 ⇒ 漏选 `protocol` 字段，按错误消息提示补
  - tool-call 不触发 ⇒ 切到 `Qwen/Qwen2.5-72B-Instruct` 这种明确支持的大模型

#### 11.6.4 Ollama 本地 — 验证零网络场景 + 国产开源模型 function-calling

- **providerID**：`ollama`
- **modelID**：本地已 `ollama pull` 过的千问模型 tag。**必须选明确支持 tools 的版本**：
  - ✅ 推荐：`qwen2.5:7b` / `qwen2.5:14b` / `qwen2.5-coder:7b`（Qwen2.5 系列原生支持 function-calling）
  - ❌ 慎用：`qwen3:*`（截至 2026-05 主线 Ollama 对 qwen3 的 tools 字段支持仍不稳定）
  - 用 `ollama list` 查本地已有 tag
- **baseURL**：留空（plugin 默认 `http://localhost:11434/v1`，含 `/v1` 后缀）
- **apiKey**：留空（本地实例无需鉴权）
- **protocol** / **promptStyle**：均留空 ⇒ `openai-compatible` + 无装饰器
- **前置条件**：终端启动 `ollama serve`（macOS 上 GUI 客户端开着即可）；确认 `curl http://localhost:11434/v1/models` 返回 200
- **核心成功判据**：本地千问模型通过 OpenAI-Compatible 协议响应 tool-call，全程零网络出站
- **失败诊断**：
  - `ECONNREFUSED localhost:11434` ⇒ Ollama 服务未启动
  - 模型回复纯文本而非 tool-call ⇒ 模型不支持 tools，换 `qwen2.5:7b`
  - 推理慢到 UI 像卡死 ⇒ 7B 模型在 M 系列 Mac 通常 10-30s 出首字，属正常现象

---

## §12 Phase F 七项核心能力上线

> 来源：`openspec/changes/roll-out-7-capabilities/`。Phase F 在保留 `resume-screening`
> 的基础上新增 6 项内置 capability：`interview-question-bank` / `interview-eval` /
> `screening-report` / `legal-rules` / `knowledge-pack` / `music-radio`。所有 manifest 走
> `import.meta.glob` 自动扫描，**新增能力本身无需任何手动登记命令**；本节只列「需要用户
> 主动开关 / 提供密钥 / 切构建特性才能完整体验」的事项。

### 12.1 首次跑通 7 项能力（最小路径，所有能力都用 stub / 无外部依赖）

```bash
pnpm install
pnpm dev          # 默认开发模式：transcribe = stub、get_weather = WEATHER_API_KEY_MISSING
```

判定：

- 左侧能力面板能看到 **7 张** capability 卡片（`order` 字段决定排序，
  `resume-screening` 排第 1，`music-radio` 排第 7）。
- 点 `interview-question-bank` / `screening-report` / `legal-rules` /
  `knowledge-pack` 直接可跑（仅本地工具，零外部依赖）。
- 点 `interview-eval` 选「文字稿」分支可跑；选「音频」分支会拿到
  `TRANSCRIBE_FEATURE_DISABLED`（属预期，按 12.2 启用真机模型）。
- 点 `music-radio` 不填 OpenWeather 密钥时，`get_weather` 返回
  `WEATHER_API_KEY_MISSING`，DJ Agent 走兜底 mood 链路（属预期，按 12.3 启用真机天气）。

### 12.2 启用 `transcribe_audio` 真机模型（whisper-rs FFI）

> 仅 `interview-eval` 的「音频转写」分支需要；其余 6 项能力**完全不依赖该 feature**。

#### 12.2.1 首次构建（需联网下载 whisper.cpp 子模块 + 编译）

```bash
cd src-tauri
cargo build --features ffi-real
```

> ⚠️ 该步骤会拉取 whisper.cpp + pdfium-render 原生依赖，首次编译耗时 5–15 分钟（取决
> 于网络与 CPU），属正常现象，请勿中断。

#### 12.2.2 准备 GGML 模型文件

`whisper-rs` 需要本地 `*.bin` 模型文件。推荐 `ggml-base.zh.bin`（约 142 MB，中文优化）：

```bash
mkdir -p ~/.seven-hrops/models
curl -L -o ~/.seven-hrops/models/ggml-base.zh.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.zh.bin
```

模型路径通过环境变量 `WHISPER_MODEL_PATH` 注入：

```bash
export WHISPER_MODEL_PATH=$HOME/.seven-hrops/models/ggml-base.zh.bin
```

#### 12.2.3 启动开发服务器（含 FFI feature）

```bash
pnpm tauri dev -- --features ffi-real
```

> 该命令直接通过 `pnpm tauri` 透传 `--features ffi-real` 给底层 `cargo`，无需也未在
> `package.json` 中登记别名（避免发明 `package.json scripts` 之外的命令）。如果你日常
> 反复使用 FFI 模式且想要短别名，可在 `package.json scripts` 自行补一个再来这里登记。

判定：上传一段 30s 中文音频到 `01_inputs/`，跑 `interview-eval` 能拿到正常文字稿（不再
返回 `TRANSCRIBE_FEATURE_DISABLED`），且 Markdown 报告里「锚点」字段含 `[mm:ss]` 时间戳。

失败诊断：

- `WHISPER_MODEL_NOT_FOUND` ⇒ `WHISPER_MODEL_PATH` 未设或文件不存在
- 音频时长 > 90s 推理慢到 UI 像卡死 ⇒ base 模型在 M1/M2 上单核处理 60s 音频约 8–15s，属正常现象；建议按 30s 切片

### 12.3 启用 `music-radio` 联网天气（OpenWeatherMap）

> 仅 `music-radio` 一个能力依赖；其余 6 项能力**完全不需要该密钥**。

#### 12.3.1 申请 API Key

注册 [OpenWeatherMap](https://openweathermap.org/) 拿 free tier 密钥（每分钟 60 次调用，
完全够本地体验用），密钥形如 `1234567890abcdef1234567890abcdef`。

#### 12.3.2 通过 `VITE_*` 环境变量注入

在仓库根目录创建 `.env.local`（已被 `.gitignore` 忽略）：

```
VITE_OPENWEATHER_API_KEY=你的密钥
```

或一次性注入：

```bash
VITE_OPENWEATHER_API_KEY=xxx pnpm dev
```

判定：跑 `music-radio` 能力，DJ 解说里出现真实城市天气描述（如「窗外 19 度的风」），节
目单的 weather 标签匹配 OpenWeather 返回的 condition。

> 网络白名单由 [`radio-dj.yaml`](../src/platform/manifests/agents/radio-dj.yaml) 的
> `network.allowedHosts: ["api.openweathermap.org"]` 强约束，DJ Agent 不能访问其他任何
> 域名；若工具试图调用其他 host 会被 `networkGuard` 直接 fail-fast。

### 12.4 一并构建：FFI + 网络两个能力都启用

```bash
export WHISPER_MODEL_PATH=$HOME/.seven-hrops/models/ggml-base.zh.bin
export VITE_OPENWEATHER_API_KEY=xxx
pnpm tauri dev -- --features ffi-real
```

7 张能力卡片**全部满血**可用。

### 12.5 不向后兼容说明

> Phase F 是 7 项核心能力的首次集中上线，**对现有用户的影响仅限两条**，且都属增量项，
> 没有破坏性变更：

1. `BUILTIN_*_SEEDS` 数组长度从 1（仅 smoke trio）增长到 7（smoke + 6 个新增）；如有自
   己的测试代码硬编码 `[0]` 索引去访问，请改用 `find((s) => s.filename.endsWith(name))`
   定位（参考 [`builtinSeed.test.ts`](../src/platform/builtinSeed.test.ts) 内的
   `findByBasename` helper）。
2. `transcribe_audio` 工具默认行为从「不存在」变更为「存在但默认返回
   `TRANSCRIBE_FEATURE_DISABLED`」；调用方应据此分支降级，不应再依赖工具自身缺失。

---

## §13 Phase G 静默切换与 Orchestrator（assistant-silent-switch）

> 来源：`openspec/changes/assistant-silent-switch/`。Phase G 落地 `assistant` 全局协调者 + `orchestrator` 企微桥，实现静默切换、上下文转移、企微 webhook 入站/出站闭环。

### 13.1 路由准确率评估（@network，需真实 LLM API Key）

```bash
pnpm test:route-eval
```

- 配置：`vitest.route-eval.config.ts`，测试文件：`tests/route-eval/router.test.ts`。
- 加载真实 assistant manifest + 真实 LLM，跑 100 条路由问句，断言命中率 ≥ 90%。
- **默认不在 `pnpm test` 中运行**（标记 `@network`），CI 仅 nightly 跑一次。
- 失败时输出 `tests/fixtures/route-eval/last-run.json` 详细 miss 列表。
- 前置条件：需要在 `aiStore` 中配置有效的 LLM API Key（与正常使用 App 相同）。

### 13.2 Orchestrator 特性开关与企微 webhook

#### 13.2.1 启用 orchestrator 特性（本地开发）

在 `.env.local` 中设置：

```
ORCHESTRATOR_ENABLED=1
WECOM_WEBHOOK_TOKEN=your-webhook-secret
WECOM_BOT_ID=your-bot-id
WECOM_ALLOWED_BOTS=bot-id-1,bot-id-2
```

或一次性注入：

```bash
ORCHESTRATOR_ENABLED=1 WECOM_WEBHOOK_TOKEN=xxx pnpm tauri dev
```

- `ORCHESTRATOR_ENABLED=1`：启用 `/webhook/wecom` 路由（默认 false，本地开发不误启）。
- `WECOM_WEBHOOK_TOKEN`：企微 webhook 签名密钥（HMAC-SHA256），密钥存 Rust 端防 XSS。
- `WECOM_BOT_ID`：默认出站 bot ID（`send_wecom_message` 工具使用）。
- `WECOM_ALLOWED_BOTS`：允许的 bot ID 白名单，逗号分隔。

#### 13.2.2 测试 wecom webhook 签名（本地 curl）

```bash
# 生成签名（需要 openssl）
TOKEN="your-webhook-secret"
BODY='{"fromUserId":"user-001","content":"我今天有几个待办","msgType":"text","receivedAt":1700000000}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$TOKEN" | awk '{print $2}')"

# 发送请求（需要先启动 Tauri 并获取 webserver 端口）
curl -X POST http://127.0.0.1:<PORT>/webhook/wecom \
  -H "Content-Type: application/json" \
  -H "x-wecom-signature: $SIG" \
  -d "$BODY"
```

#### 13.2.3 Rust orchestrator 特性测试

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib -- webserver::tests::wecom
```

- 覆盖：签名校验通过 / 失败 / 关闭特性 / 速率限制 4 个场景。
- 不需要 `--features orchestrator`（orchestrator 特性通过环境变量控制，非 Cargo feature）。

### 13.3 静默切换手动验收

1. 启动 App：`pnpm tauri dev`
2. 在左侧选择「assistant」能力（或等待默认激活）
3. 输入「帮我筛简历」
4. 断言：≤ 2s 内左侧高亮切换到「简历筛选」，底部出现 Toast「已切换到《简历筛选》」
5. 在 3s 内点 Toast 的「撤销」按钮
6. 断言：切回 assistant，原对话上下文完整

### 13.4 不向后兼容说明

- `WebhookPayload` 类型字段从 `{ type, content, fromUser }` 变更为 `{ fromUserId, content, msgType, msgId?, receivedAt }`，与 Rust 端 `WecomInboundPayload` 对齐。如有自定义代码依赖旧字段，请按新字段名更新。
- `ChatMessage` 类型新增可选 `metadata?: ChatMessageMetadata` 字段，不影响现有代码。

---

## §14 数据库架构 — DB 全由 Rust 管理

> 来源：`doc/task.md`（arch-db-rust-only 重构）。
> 本次重构将数据库访问路径统一为：**TS 侧通过 `invoke()` 调用 Tauri Command → Rust 侧 Repository 层 → rusqlite → SQLite 文件**。
> 不再使用 `tauri-plugin-sql`、`better-sqlite3`、`drizzle-orm`。

### 14.1 数据库文件位置

数据库文件由 Rust 侧 `init_db()` 在应用启动时自动创建，路径为：

```
macOS:   ~/Library/Application Support/com.seven-hrops.app/seven-hrops.db
Windows: %APPDATA%\com.seven-hrops.app\seven-hrops.db
Linux:   ~/.local/share/com.seven-hrops.app/seven-hrops.db
```

### 14.2 Migration 机制

Migration 由 Rust 侧在每次应用启动时自动执行（幂等），无需手动触发。

- Migration 文件位于 `src-tauri/src/db/migrations/`：
  - `001_initial_tables.sql` — 8 张业务表（projects、job_descriptions、resumes、candidates、screening_results、compliance_results、export_records、event_logs）
  - `002_capabilities.sql` — 4 张 platform 表（agent_manifests、skill_manifests、capabilities、manifest_history）
  - `003_sessions_and_messages.sql` — sessions 和 messages 表（会话持久化，详见 `openspec/changes/arch-session-db-persistence/`）
- 版本追踪：使用 SQLite `PRAGMA user_version` 记录已应用的 migration 版本号。
- 新增 migration：在 `src-tauri/src/db/migrations/` 下新建 `NNN_xxx.sql`，并在 `src-tauri/src/db/migrations.rs` 的 `MIGRATIONS` 数组中追加对应条目。

### 14.3 验证数据库是否正常初始化

启动应用后，可通过以下命令检查数据库文件和表结构：

```bash
# macOS 下查看数据库文件
ls -la ~/Library/Application\ Support/com.seven-hrops.app/

# 用 sqlite3 CLI 检查表结构（需要安装 sqlite3）
sqlite3 ~/Library/Application\ Support/com.seven-hrops.app/seven-hrops.db ".tables"
# 预期输出：15 张表（12 原有 + sessions + messages + idx）

# 检查 migration 版本
sqlite3 ~/Library/Application\ Support/com.seven-hrops.app/seven-hrops.db "PRAGMA user_version;"
# 预期输出：3（已应用 001 + 002 + 003 三个 migration）
```

### 14.4 TypeScript 侧 API 契约层

所有数据库操作通过 `src/services/db.ts` 中的 typed wrapper 函数调用，例如：

```ts
import { projectCreate, projectList } from '@/services/db';

// 创建项目
const projectId = await projectCreate({ name: '2024 校招', task_type: 'recruitment' });

// 列出所有项目
const projects = await projectList();
```

**禁止**在 Store 或 Component 层直接调用 `invoke()` 操作数据库，必须通过 `src/services/db.ts` 的 typed API。

### 14.5 已移除的依赖（无需手动操作）

以下依赖已在重构中移除，**不需要任何手动操作**：

| 已移除 | 替代方案 |
|--------|---------|
| `tauri-plugin-sql`（Cargo.toml） | `rusqlite = { version = "0.31", features = ["bundled"] }` |
| `@tauri-apps/plugin-sql`（package.json） | `@tauri-apps/api` 的 `invoke()` |
| `drizzle-orm` / `drizzle-kit`（package.json） | Rust 侧 Repository 层 |
| `better-sqlite3`（package.json） | 同上 |
| `src/db/` 目录 | `src/services/db.ts` 契约层 |
| `drizzle/` 目录 + `drizzle.config.ts` | `src-tauri/src/db/migrations/*.sql` |


