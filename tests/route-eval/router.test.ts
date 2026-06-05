/**
 * Route evaluation test — Phase G Task 11.2 / 11.3
 *
 * @network — requires real LLM API key. Excluded from default `pnpm test`.
 * Run with: pnpm test:route-eval
 *
 * Loads the real assistant manifest + real LLM, runs 100 routing queries,
 * and asserts hit rate >= 90%.
 *
 * On failure: outputs tests/fixtures/route-eval/last-run.json with miss details.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"
import { bootstrapPlatform, teardownPlatform } from "@/platform/bootstrap"
import { loadRuntimeConfig } from "@/platform/runtimeConfig"
import { useAIStore } from "@/stores/aiStore"
import { chatWithStream } from "@/services/agentService"

// ─── Types ───────────────────────────────────────────────────────────

interface RouteQuery {
  input: string
  expectedCapability: string
  allowFallback?: boolean
}

interface MissRecord {
  input: string
  expectedCapability: string
  predictedCapability: string | null
  allowFallback: boolean
}

// ─── Fixture loading ─────────────────────────────────────────────────

const QUERIES_PATH = resolve(__dirname, "../fixtures/route-eval/queries.json")
const LAST_RUN_PATH = resolve(__dirname, "../fixtures/route-eval/last-run.json")
const HIT_RATE_THRESHOLD = 0.9

// ─── Test ─────────────────────────────────────────────────────────────

describe("assistant route-eval @network", () => {
  it(`routing hit rate >= ${HIT_RATE_THRESHOLD * 100}% across 100 queries`, async () => {
    const queries: RouteQuery[] = JSON.parse(readFileSync(QUERIES_PATH, "utf-8"))
    expect(queries.length).toBeGreaterThanOrEqual(100)

    // Bootstrap platform with real LLM config
    const modelConfig = useAIStore.getState().modelConfig
    const runtimeConfig = loadRuntimeConfig(modelConfig)
    const api = await bootstrapPlatform({ runtimeConfig, exposeOnWindow: false })

    const misses: MissRecord[] = []
    let hits = 0

    try {
      for (const query of queries) {
        let predictedCapability: string | null = null

        // Run the assistant with the query and capture which capability it routes to
        // The assistant calls activate_capability(id) — we intercept via tool-result events
        await chatWithStream(
          {
            sessionID: `route-eval-${Date.now()}`,
            message: query.input,
            capabilityId: "assistant",
          },
          (event) => {
            if (event.type === "tool-call" && event.toolName === "activate_capability") {
              const args = event.toolArgs as { capability_id?: string }
              predictedCapability = args.capability_id ?? null
            }
          },
        )

        const isHit =
          predictedCapability === query.expectedCapability ||
          (query.allowFallback && predictedCapability !== null)

        if (isHit) {
          hits++
        } else {
          misses.push({
            input: query.input,
            expectedCapability: query.expectedCapability,
            predictedCapability,
            allowFallback: query.allowFallback ?? false,
          })
        }
      }
    } finally {
      await teardownPlatform(api)
    }

    const hitRate = hits / queries.length

    // Task 11.3: Output miss list when hit rate < threshold
    if (hitRate < HIT_RATE_THRESHOLD) {
      const runReport = {
        timestamp: new Date().toISOString(),
        totalQueries: queries.length,
        hits,
        misses: misses.length,
        hitRate: Math.round(hitRate * 100) / 100,
        threshold: HIT_RATE_THRESHOLD,
        missDetails: misses,
      }
      writeFileSync(LAST_RUN_PATH, JSON.stringify(runReport, null, 2), "utf-8")
      console.error(
        `[route-eval] Hit rate ${(hitRate * 100).toFixed(1)}% < ${HIT_RATE_THRESHOLD * 100}%. ` +
          `Miss details written to ${LAST_RUN_PATH}`,
      )
    }

    expect(hitRate).toBeGreaterThanOrEqual(HIT_RATE_THRESHOLD)
  }, 120_000)
})
