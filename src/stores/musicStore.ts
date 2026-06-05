/**
 * Music Store — music player UI state.
 *
 * Design notes:
 *   - All actions are synchronous (no async logic).
 *   - State is not persisted (playback state resets on app restart).
 *   - Migrated from workspaceStore.ts (Phase C).
 */

import { create } from "zustand"
import type { TrackInfo } from "@/types/music"

export type { TrackInfo }

interface MusicState {
  // Visibility
  isVisible: boolean

  // Playback
  isPlaying: boolean
  currentTrack: TrackInfo | null
  /** Playback progress, 0–1. */
  progress: number

  // DJ mode (produced by dj agent)
  moodTag: string | null
  djComment: string | null
  playlist: TrackInfo[]

  // Actions (all synchronous)
  show: () => void
  hide: () => void
  toggle: () => void
  play: () => void
  pause: () => void
  setTrack: (track: TrackInfo | null) => void
  setProgress: (progress: number) => void
  setMoodTag: (tag: string | null) => void
  setDjComment: (comment: string | null) => void
  setPlaylist: (tracks: TrackInfo[]) => void
  nextTrack: () => void
  prevTrack: () => void
}

// ─── Store ───────────────────────────────────────────────────────────

export const useMusicStore = create<MusicState>()((set, get) => ({
  isVisible: false,
  isPlaying: false,
  currentTrack: null,
  progress: 0,
  moodTag: null,
  djComment: null,
  playlist: [],

  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),
  toggle: () => set((s) => ({ isVisible: !s.isVisible })),

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),

  setTrack: (track) => set({ currentTrack: track, progress: 0 }),
  setProgress: (progress) => set({ progress }),

  setMoodTag: (tag) => set({ moodTag: tag }),
  setDjComment: (comment) => set({ djComment: comment }),
  setPlaylist: (tracks) => set({ playlist: tracks }),

  nextTrack: () => {
    const { playlist, currentTrack } = get()
    if (playlist.length === 0) return
    const idx = playlist.findIndex((t) => t.id === currentTrack?.id)
    const next = playlist[(idx + 1) % playlist.length]
    set({ currentTrack: next, progress: 0 })
  },

  prevTrack: () => {
    const { playlist, currentTrack } = get()
    if (playlist.length === 0) return
    const idx = playlist.findIndex((t) => t.id === currentTrack?.id)
    const prev = playlist[(idx - 1 + playlist.length) % playlist.length]
    set({ currentTrack: prev, progress: 0 })
  },
}))
