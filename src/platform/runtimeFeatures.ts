/**
 * runtimeFeatures.ts — Phase F single source of truth for non-LLM runtime knobs.
 *
 * Two concerns kept deliberately separate from `runtimeConfig.ts` (which is
 * about LLM provider/agent assembly):
 *
 *   1. **Feature flags** (`features.*`): boolean toggles consumed by toolpacks
 *      and the UI. Declared centrally so a flag rename is grep-able.
 *   2. **Network secrets** (`networkSecrets.*`): API keys for external services
 *      that get injected into outbound HTTP requests by `network-toolpack`.
 *      Resolution order:
 *        a. `import.meta.env.VITE_*` (dev / per-developer overrides)
 *        b. `agent-runtime-config.json` top-level `networkSecrets` (rare; the
 *           JSON ships in the bundle and SHOULD NOT carry real keys)
 *        c. `undefined` → toolpack throws `*_API_KEY_MISSING`, agent degrades.
 *
 * This module exports a single `getRuntimeFeatures()` getter; tests can
 * `setRuntimeFeaturesForTest()` to inject fixtures.
 *
 * Spec ref: openspec/changes/roll-out-7-capabilities/specs/mcp-toolpacks/spec.md
 */

import baseConfig from "@/agent-runtime-config.json"

export interface RuntimeFeatures {
  readonly features: {
    /**
     * Whether to expose the `transcribe_audio` capability in the UI and
     * trigger `models_ensure(\"whisper-base-zh\")` ahead of the first call.
     * When `false`, interview-eval falls back to "paste transcript" flow.
     */
    readonly transcribe: boolean
  }
  readonly networkSecrets: {
    readonly openweatherApiKey?: string
  }
}

interface RawFeatureBlock {
  features?: { transcribe?: boolean }
  networkSecrets?: { openweatherApiKey?: string }
}

const RAW = baseConfig as unknown as RawFeatureBlock

function readEnv(key: string): string | undefined {
  // Vite injects VITE_* at build time; in vitest jsdom env the same vars
  // come from import.meta.env via `vite-node`.
  const v = (import.meta.env as Record<string, string | undefined>)[key]
  return v && v.trim().length > 0 ? v : undefined
}

function buildDefault(): RuntimeFeatures {
  const transcribe =
    typeof RAW.features?.transcribe === "boolean" ? RAW.features.transcribe : true
  const openweatherApiKey =
    readEnv("VITE_OPENWEATHER_API_KEY") ?? RAW.networkSecrets?.openweatherApiKey
  return {
    features: { transcribe },
    networkSecrets: { openweatherApiKey },
  }
}

let current: RuntimeFeatures = buildDefault()

/** Production / runtime accessor. */
export function getRuntimeFeatures(): RuntimeFeatures {
  return current
}

/** Test-only override. */
export function setRuntimeFeaturesForTest(v: RuntimeFeatures): void {
  current = v
}

/** Test-only reset to env+json defaults. */
export function resetRuntimeFeaturesForTest(): void {
  current = buildDefault()
}
