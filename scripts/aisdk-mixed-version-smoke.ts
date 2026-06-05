/**
 * AI SDK mixed-version smoke test
 *
 * Goal: prove that `ai@6.x` `streamText` accepts model instances created by
 * sub-packages with different npm minor versions (3.0 / 2.0 / 1.0), without
 * any real network call.
 *
 * Strategy:
 *   1. Replace global `fetch` with a stub that returns an OpenAI-compatible
 *      SSE stream (`data: {...}\n\ndata: [DONE]\n\n`).
 *   2. Build 3 model instances:
 *        - @ai-sdk/openai            (minor 3.0, LanguageModelV3 protocol)
 *        - @ai-sdk/openai-compatible (minor 2.0, LanguageModelV2 protocol)
 *        - @ai-sdk/alibaba           (minor 1.0, third-party provider)
 *   3. For each model, call `streamText({ model, prompt })` and consume
 *      `result.textStream`. If any of them throws a type/runtime
 *      incompatibility error, the smoke fails.
 *
 * Run:  pnpm tsx scripts/aisdk-mixed-version-smoke.ts
 */

import { streamText } from "ai"

// ---------- 1. fetch mock ----------
const SSE_BODY = [
  // OpenAI-compatible streaming chunk (works for openai / openai-compatible /
  // alibaba — they all parse the same SSE shape).
  `data: ${JSON.stringify({
    id: "chatcmpl-smoke",
    object: "chat.completion.chunk",
    created: 0,
    model: "smoke",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "hello" },
        finish_reason: null,
      },
    ],
  })}\n\n`,
  `data: ${JSON.stringify({
    id: "chatcmpl-smoke",
    object: "chat.completion.chunk",
    created: 0,
    model: "smoke",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })}\n\n`,
  `data: [DONE]\n\n`,
].join("")

;(globalThis as { fetch: typeof fetch }).fetch = (async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(SSE_BODY))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}) as typeof fetch

// ---------- 2. build models ----------
async function buildModels() {
  const { createOpenAI } = await import("@ai-sdk/openai")
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible")
  const { createAlibaba } = await import("@ai-sdk/alibaba")

  return {
    "@ai-sdk/openai (V3)": createOpenAI({
      apiKey: "smoke",
      baseURL: "http://smoke.local/v1",
    })("gpt-4o-mini"),
    "@ai-sdk/openai-compatible (V2)": createOpenAICompatible({
      name: "smoke",
      apiKey: "smoke",
      baseURL: "http://smoke.local/v1",
    }).chatModel("smoke-model"),
    "@ai-sdk/alibaba (V1)": createAlibaba({
      apiKey: "smoke",
      baseURL: "http://smoke.local/v1",
    })("qwen-turbo"),
  } as const
}

// ---------- 3. run ----------
async function main() {
  const models = await buildModels()
  let allOk = true
  for (const [label, model] of Object.entries(models)) {
    process.stdout.write(`→ ${label} ... `)
    try {
      const result = streamText({
        // @ts-expect-error - intentionally cross-version, this script's whole
        // point is to verify the runtime accepts mixed protocol versions.
        model,
        prompt: "ping",
      })
      let collected = ""
      for await (const delta of result.textStream) {
        collected += delta
      }
      console.log(`OK (received ${collected.length} chars: "${collected}")`)
    } catch (err) {
      allOk = false
      console.log(`FAIL`)
      console.error(err)
    }
  }
  if (!allOk) {
    console.error("\n❌ mixed-version smoke FAILED — V2/V3 混用存在运行时问题")
    process.exit(1)
  }
  console.log("\n✅ mixed-version smoke PASSED — V1/V2/V3 在 ai@6 下可混用")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
