import { describe, it, expect, beforeEach } from "vitest"
import { useMusicStore, type TrackInfo } from "../musicStore"

const makeTrack = (id: string): TrackInfo => ({
  id,
  title: `Track ${id}`,
  artist: "Artist",
})

describe("musicStore", () => {
  beforeEach(() => {
    useMusicStore.setState({
      isVisible: false,
      isPlaying: false,
      currentTrack: null,
      progress: 0,
      moodTag: null,
      djComment: null,
      playlist: [],
    })
  })

  // ── Visibility ───────────────────────────────────────────────────────

  describe("visibility", () => {
    it("show sets isVisible to true", () => {
      useMusicStore.getState().show()
      expect(useMusicStore.getState().isVisible).toBe(true)
    })

    it("hide sets isVisible to false", () => {
      useMusicStore.setState({ isVisible: true })
      useMusicStore.getState().hide()
      expect(useMusicStore.getState().isVisible).toBe(false)
    })

    it("toggle flips isVisible", () => {
      useMusicStore.getState().toggle()
      expect(useMusicStore.getState().isVisible).toBe(true)
      useMusicStore.getState().toggle()
      expect(useMusicStore.getState().isVisible).toBe(false)
    })
  })

  // ── Playback ─────────────────────────────────────────────────────────

  describe("playback", () => {
    it("play sets isPlaying to true", () => {
      useMusicStore.getState().play()
      expect(useMusicStore.getState().isPlaying).toBe(true)
    })

    it("pause sets isPlaying to false", () => {
      useMusicStore.setState({ isPlaying: true })
      useMusicStore.getState().pause()
      expect(useMusicStore.getState().isPlaying).toBe(false)
    })

    it("setTrack updates currentTrack and resets progress", () => {
      useMusicStore.setState({ progress: 0.5 })
      const track = makeTrack("t1")
      useMusicStore.getState().setTrack(track)
      expect(useMusicStore.getState().currentTrack).toEqual(track)
      expect(useMusicStore.getState().progress).toBe(0)
    })

    it("setTrack with null clears currentTrack", () => {
      useMusicStore.setState({ currentTrack: makeTrack("t1") })
      useMusicStore.getState().setTrack(null)
      expect(useMusicStore.getState().currentTrack).toBeNull()
    })

    it("setProgress updates progress", () => {
      useMusicStore.getState().setProgress(0.75)
      expect(useMusicStore.getState().progress).toBe(0.75)
    })
  })

  // ── DJ mode ──────────────────────────────────────────────────────────

  describe("dj mode", () => {
    it("setMoodTag updates moodTag", () => {
      useMusicStore.getState().setMoodTag("focus")
      expect(useMusicStore.getState().moodTag).toBe("focus")
    })

    it("setDjComment updates djComment", () => {
      useMusicStore.getState().setDjComment("Great vibes!")
      expect(useMusicStore.getState().djComment).toBe("Great vibes!")
    })

    it("setPlaylist updates playlist", () => {
      const tracks = [makeTrack("t1"), makeTrack("t2")]
      useMusicStore.getState().setPlaylist(tracks)
      expect(useMusicStore.getState().playlist).toEqual(tracks)
    })
  })

  // ── Navigation ───────────────────────────────────────────────────────

  describe("nextTrack / prevTrack", () => {
    const tracks = [makeTrack("t1"), makeTrack("t2"), makeTrack("t3")]

    beforeEach(() => {
      useMusicStore.setState({ playlist: tracks, currentTrack: tracks[0] })
    })

    it("nextTrack advances to next track", () => {
      useMusicStore.getState().nextTrack()
      expect(useMusicStore.getState().currentTrack?.id).toBe("t2")
    })

    it("nextTrack wraps around to first track", () => {
      useMusicStore.setState({ currentTrack: tracks[2] })
      useMusicStore.getState().nextTrack()
      expect(useMusicStore.getState().currentTrack?.id).toBe("t1")
    })

    it("prevTrack goes to previous track", () => {
      useMusicStore.setState({ currentTrack: tracks[1] })
      useMusicStore.getState().prevTrack()
      expect(useMusicStore.getState().currentTrack?.id).toBe("t1")
    })

    it("prevTrack wraps around to last track", () => {
      useMusicStore.getState().prevTrack()
      expect(useMusicStore.getState().currentTrack?.id).toBe("t3")
    })

    it("nextTrack resets progress to 0", () => {
      useMusicStore.setState({ progress: 0.8 })
      useMusicStore.getState().nextTrack()
      expect(useMusicStore.getState().progress).toBe(0)
    })

    it("does nothing when playlist is empty", () => {
      useMusicStore.setState({ playlist: [], currentTrack: null })
      useMusicStore.getState().nextTrack()
      expect(useMusicStore.getState().currentTrack).toBeNull()
    })
  })
})
