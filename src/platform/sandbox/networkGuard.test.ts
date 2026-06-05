/**
 * Tests for networkGuard (host whitelist + *. wildcard).
 */

import { describe, it, expect } from "vitest"
import {
  createNetworkGuard,
  NetworkHostNotAllowedError,
} from "./networkGuard"

describe("networkGuard", () => {
  it("matches exact host", () => {
    const g = createNetworkGuard(["api.openai.com"])
    expect(g.has("api.openai.com")).toBe(true)
    expect(g.has("evil.com")).toBe(false)
  })

  it("extracts hostname from full URL", () => {
    const g = createNetworkGuard(["api.openai.com"])
    expect(g.has("https://api.openai.com/v1/chat")).toBe(true)
    expect(g.has("http://Api.OpenAi.Com:8080/path")).toBe(true) // case-insensitive
  })

  it("supports leading *. wildcard for subdomains", () => {
    const g = createNetworkGuard(["*.gongfeng.com"])
    expect(g.has("api.gongfeng.com")).toBe(true)
    expect(g.has("a.b.gongfeng.com")).toBe(true)
    // wildcard does NOT match the bare apex domain
    expect(g.has("gongfeng.com")).toBe(false)
  })

  it("assert throws NetworkHostNotAllowedError with code", () => {
    const g = createNetworkGuard(["api.openai.com"])
    try {
      g.assert("https://attacker.evil")
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(NetworkHostNotAllowedError)
      expect((e as NetworkHostNotAllowedError).code).toBe(
        "NETWORK_HOST_NOT_ALLOWED",
      )
      expect((e as NetworkHostNotAllowedError).host).toBe("attacker.evil")
    }
  })

  it("rejects everything when allowlist is empty", () => {
    const g = createNetworkGuard([])
    expect(g.has("api.openai.com")).toBe(false)
    expect(() => g.assert("https://api.openai.com")).toThrow()
  })

  it("falls back to literal lowercase when URL parse fails", () => {
    const g = createNetworkGuard(["bad-url"])
    expect(g.has("BAD-URL")).toBe(true)
  })
})
