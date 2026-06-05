/**
 * Music Player Types
 *
 * Shared types for the music store and music player components.
 * Source of truth: src/types/music.ts
 */

export interface TrackInfo {
  id: string
  title: string
  artist?: string
  /** Duration in seconds. */
  duration?: number
  /** Local file path or stream URL. */
  url?: string
}
