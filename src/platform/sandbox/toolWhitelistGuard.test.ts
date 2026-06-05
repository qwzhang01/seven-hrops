/**
 * Tests for toolWhitelistGuard.
 */

import { describe, it, expect } from "vitest"
import {
  createToolWhitelistGuard,
  ToolNotInManifestError,
} from "./toolWhitelistGuard"

describe("toolWhitelistGuard", () => {
  it("allows tools in the whitelist", () => {
    const g = createToolWhitelistGuard(["read_file", "list_dir"])
    expect(g.has("read_file")).toBe(true)
    expect(() => g.assert("read_file")).not.toThrow()
  })

  it("rejects tools not in the whitelist", () => {
    const g = createToolWhitelistGuard(["read_file"])
    expect(g.has("write_file")).toBe(false)
    expect(() => g.assert("write_file")).toThrow(ToolNotInManifestError)
  })

  it("rejects every call when whitelist is empty", () => {
    const g = createToolWhitelistGuard([])
    expect(() => g.assert("read_file")).toThrow(/<empty>/)
  })

  it("error carries TOOL_NOT_IN_MANIFEST code", () => {
    const g = createToolWhitelistGuard(["read_file"])
    try {
      g.assert("rm -rf /")
      throw new Error("expected throw")
    } catch (e) {
      expect((e as ToolNotInManifestError).code).toBe("TOOL_NOT_IN_MANIFEST")
    }
  })
})
