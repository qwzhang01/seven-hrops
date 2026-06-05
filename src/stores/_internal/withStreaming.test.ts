/**
 * Tests for the `withStreaming` helper.
 *
 * Spec reference:
 *   - openspec/changes/arch-capability-agent-contract/specs/ai-store-chat/spec.md
 *
 * The helper is store-agnostic: tests simply track calls to fake
 * `setFlag` / `onError` and assert ordering / counts.
 */

import { describe, it, expect, vi } from "vitest"
import { withStreaming, type StreamingHandle } from "./withStreaming"

const makeHandle = () => {
  const flagCalls: boolean[] = []
  const errors: Error[] = []
  const handle: StreamingHandle = {
    setFlag: (v) => {
      flagCalls.push(v)
    },
    onError: (err) => {
      errors.push(err)
    },
  }
  return { handle, flagCalls, errors }
}

describe("withStreaming — happy path", () => {
  it("toggles the flag true → false and never calls onError when body resolves", async () => {
    const { handle, flagCalls, errors } = makeHandle()
    const body = vi.fn(async () => {
      // body sees flag === true at this point
      expect(flagCalls).toEqual([true])
    })

    await withStreaming(handle, body)

    expect(body).toHaveBeenCalledOnce()
    expect(flagCalls).toEqual([true, false])
    expect(errors).toEqual([])
  })
})

describe("withStreaming — error normalisation", () => {
  it("delivers a real Error instance unchanged to onError", async () => {
    const { handle, flagCalls, errors } = makeHandle()
    const original = new Error("network failed")
    await withStreaming(handle, async () => {
      throw original
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(original)
    expect(flagCalls).toEqual([true, false])
  })

  it("wraps non-Error throwables into new Error(String(...))", async () => {
    const { handle, flagCalls, errors } = makeHandle()
    await withStreaming(handle, async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "boom"
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect(errors[0].message).toBe("boom")
    expect(flagCalls).toEqual([true, false])
  })

  it("still resets the flag when onError itself throws", async () => {
    const flagCalls: boolean[] = []
    const handle: StreamingHandle = {
      setFlag: (v) => {
        flagCalls.push(v)
      },
      onError: () => {
        throw new Error("onError exploded")
      },
    }

    await withStreaming(handle, async () => {
      throw new Error("body failed")
    })

    // The finally block ran even though onError threw.
    expect(flagCalls).toEqual([true, false])
  })
})

describe("withStreaming — concurrent invocations", () => {
  it("each invocation maintains its own setFlag sequence", async () => {
    const { handle, flagCalls } = makeHandle()
    // Two concurrent streamings sharing the same handle. The handle
    // contract is "current invocation owns the flag", so we expect
    // four toggles in total: [true, true, false, false] or any
    // interleaving where every true is matched by a false eventually.
    await Promise.all([
      withStreaming(handle, async () => {
        await new Promise((r) => setTimeout(r, 5))
      }),
      withStreaming(handle, async () => {
        await new Promise((r) => setTimeout(r, 1))
      }),
    ])
    expect(flagCalls).toHaveLength(4)
    const trues = flagCalls.filter((v) => v).length
    const falses = flagCalls.filter((v) => !v).length
    expect(trues).toBe(2)
    expect(falses).toBe(2)
  })
})
