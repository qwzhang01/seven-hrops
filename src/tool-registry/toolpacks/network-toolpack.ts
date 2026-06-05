/**
 * network-toolpack — Phase F Task 4.1
 *
 * Provides `get_weather(city)`: calls the Rust `http_get_json` command
 * (which enforces sandbox networkGuard). On failure, returns mock data
 * to keep the demo chain alive.
 *
 * Design ref: openspec/changes/roll-out-7-capabilities/design.md §D3
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

const GetWeatherArgs = z.object({
  city: z.string().min(1),
})

/** Fallback mock data when network request fails (design.md §Risks). */
const MOCK_WEATHER = { condition: "sunny", temp: 22, humidity: 45 }

export function register(toolRegistry: ToolRegistry): void {
  toolRegistry.register(metaOf("get_weather"), async (args, ctx) => {
    const r = GetWeatherArgs.safeParse(args)
    if (!r.success) {
      throw new InvalidToolArgsError(
        "get_weather",
        r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      )
    }

    const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY ?? ""
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(r.data.city)}&appid=${apiKey}&units=metric&lang=zh_cn`

    try {
      const result = (await getDispatcher()("http_get_json", {
        url,
        session_id: ctx.sessionId,
        timeout_ms: 8000,
      })) as { status: number; body: Record<string, unknown> }

      if (result.status === 200) {
        const body = result.body as {
          weather?: Array<{ description?: string }>
          main?: { temp?: number; humidity?: number }
        }
        return {
          city: r.data.city,
          condition: body.weather?.[0]?.description ?? "unknown",
          temp: body.main?.temp ?? MOCK_WEATHER.temp,
          humidity: body.main?.humidity ?? MOCK_WEATHER.humidity,
        }
      }

      // Non-200: fallback to mock
      return { city: r.data.city, ...MOCK_WEATHER, _fallback: true }
    } catch {
      // Network failure: return mock data (design.md §Risks mitigation)
      return { city: r.data.city, ...MOCK_WEATHER, _fallback: true }
    }
  })
}
