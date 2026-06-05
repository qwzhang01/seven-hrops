/**
 * music-toolpack — Phase F Task 4.2
 *
 * Provides `get_user_playlist()` and `recommend_tracks({ mood, weather })`.
 * Uses a local mock catalogue (no third-party music API).
 *
 * Design ref: openspec/changes/roll-out-7-capabilities/design.md §D4
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"

// ── Local mock catalogue ─────────────────────────────────────────────

interface Track {
  id: string
  title: string
  artist: string
  mood: string[]
  weather: string[]
  genre: string
  duration: number // seconds
}

type Mood = "happy" | "calm" | "energetic" | "melancholy" | "focus"

const MOODS: Mood[] = ["happy", "calm", "energetic", "melancholy", "focus"]
const GENRES = ["pop", "jazz", "electronic", "classical", "folk", "rock", "r&b", "ambient"]
const WEATHERS = ["sunny", "rainy", "cloudy", "snowy", "windy"]

/** Generate a deterministic mock catalogue of 200 tracks. */
function generateCatalogue(): Track[] {
  const tracks: Track[] = []
  let id = 1
  for (const mood of MOODS) {
    for (let i = 0; i < 40; i++) {
      const genre = GENRES[i % GENRES.length]
      const weather = WEATHERS[i % WEATHERS.length]
      tracks.push({
        id: `track-${String(id).padStart(3, "0")}`,
        title: `${mood}-${genre}-${i + 1}`,
        artist: `Artist ${(i % 20) + 1}`,
        mood: [mood, ...(i % 3 === 0 ? [MOODS[(MOODS.indexOf(mood) + 1) % MOODS.length]] : [])],
        weather: [weather, ...(i % 4 === 0 ? [WEATHERS[(WEATHERS.indexOf(weather) + 1) % WEATHERS.length]] : [])],
        genre,
        duration: 180 + (i % 120),
      })
      id++
    }
  }
  return tracks
}

const CATALOGUE = generateCatalogue()

/** Simple user playlist (mock — returns last 10 "liked" tracks). */
const USER_PLAYLIST: Track[] = CATALOGUE.slice(0, 10)

// ── Schemas ──────────────────────────────────────────────────────────

const RecommendArgs = z.object({
  mood: z.string().min(1),
  weather: z.string().optional(),
  count: z.number().int().min(1).max(20).optional(),
})

// ── Registration ─────────────────────────────────────────────────────

export function register(toolRegistry: ToolRegistry): void {
  // get_user_playlist: returns the user's mock playlist
  toolRegistry.register(metaOf("get_user_playlist"), async () => {
    return {
      playlist: USER_PLAYLIST.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        genre: t.genre,
      })),
      total: USER_PLAYLIST.length,
    }
  })

  // recommend_tracks: match by mood + optional weather
  toolRegistry.register(metaOf("recommend_tracks"), async (args) => {
    const r = RecommendArgs.safeParse(args)
    if (!r.success) {
      throw new InvalidToolArgsError(
        "recommend_tracks",
        r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      )
    }

    const { mood, weather, count = 10 } = r.data
    const moodLower = mood.toLowerCase()
    const weatherLower = weather?.toLowerCase()

    // Score-based matching
    const scored = CATALOGUE.map((track) => {
      let score = 0
      if (track.mood.some((m) => m.includes(moodLower))) score += 3
      if (weatherLower && track.weather.some((w) => w.includes(weatherLower))) score += 2
      // Slight randomness for variety
      score += Math.random() * 0.5
      return { track, score }
    })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, count)

    return {
      tracks: scored.map((s) => ({
        id: s.track.id,
        title: s.track.title,
        artist: s.track.artist,
        genre: s.track.genre,
        duration: s.track.duration,
        matchScore: Math.round(s.score * 10) / 10,
      })),
      total: scored.length,
      query: { mood, weather },
    }
  })
}
