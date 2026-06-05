/**
 * 豆包（火山方舟）真机 prompt-style tool-call payload 字节级复刻
 * ──────────────────────────────────────────────────────────────────
 *
 * **来源**：用户首次在 [`LLMConfigModal`](../../../components/modals/LLMConfigModal.tsx)
 * 接入火山方舟豆包后，在 e2e-resume-screening-redux 的 `01_inputs/` 简历任务
 * 中触发 `list_dir` 工具调用 —— 从浏览器 DevTools Network 复制 SSE raw bytes
 * 中 `<|FunctionCallBegin|>...<|FunctionCallEnd|>` 这一段（2026-05-31）。
 *
 * **真机锚点纪律**（来源：[`runtime-multimodel-real-machine-verification` change](
 * ../../../../openspec/changes/runtime-multimodel-real-machine-verification/specs/platform-foundation/spec.md)）：
 *
 * - 本文件中的字符串字节级复刻自真机抓包，**禁止改写**。任何对解析逻辑的修改
 *   都必须先在 `integration-doubao.test.ts` 的真机锚点 case 验证仍能解析此字串。
 * - 敏感字段（apiKey / token / userID）在抓包阶段已脱敏；本字串不含任何敏感数据。
 * - 此文件 **SHALL NOT** 由 codegen 工具生成或覆盖；修改时必须由人工 capture 替换。
 *
 * **观察到的形态偏差**（与原 change 自造 fixture 的差异）：
 * 1. 顶层是 JSON 数组 `[{...}]`（自造 fixture 是顶层对象 `{...}`）。
 * 2. 入参字段名是 `parameters`（自造 fixture 用 `arguments`）。
 *
 * 这两个偏差在 [`prompt-style-tool-call.ts`](../protocols/prompt-style-tool-call.ts)
 * 的 `parseToolCalls` 函数中通过「数组顶层逐项解析」+「`arguments ?? parameters`
 * 字段兼容」消化，本文件作为契约不变量守卫。
 */

/**
 * 豆包真机 SSE 中 prompt-style 工具调用的完整 payload（含 begin/end token）。
 *
 * 该字符串可直接作为 `text-delta` 事件投喂给 `prompt-style-tool-call` 装饰器，
 * 期望解出一条 `LLMStreamEvent.tool-call`：
 *
 * ```ts
 * {
 *   type: "tool-call",
 *   name: "list_dir",
 *   input: { dir_path: "01_inputs/" },
 *   id: "ps-...",
 * }
 * ```
 */
export const REAL_DOUBAO_TOOL_CALL_PAYLOAD =
  '<|FunctionCallBegin|>[{"name":"list_dir","parameters":{"dir_path":"01_inputs/"}}]<|FunctionCallEnd|>'

/**
 * 不含 begin/end token 的纯 JSON 体——用于 `__internal.parseToolCalls` 单元测试。
 * 与上面的 `REAL_DOUBAO_TOOL_CALL_PAYLOAD` 严格一致地剥离了首尾 21 / 19 字节边界 token。
 */
export const REAL_DOUBAO_TOOL_CALL_JSON_BODY =
  '[{"name":"list_dir","parameters":{"dir_path":"01_inputs/"}}]'
