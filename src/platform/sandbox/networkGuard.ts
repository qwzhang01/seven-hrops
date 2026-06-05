/**
 * networkGuard — JS-side host whitelist for tool calls that touch the
 * network (e.g. `webserver_publish` returning a public URL, or future
 * MCP fetch tools).
 *
 * Layered defense (mirrors `toolWhitelistGuard`):
 *   L0 Rust  — `sandbox::network_guard` (definitive enforcement)
 *   L2 JS    — **this module** (early reject, no IPC round-trip)
 *
 * The L2 check exists so that purely-JS tools (e.g. an embedded fetch
 * polyfill) can be gated without crossing into Rust. When the same call
 * eventually reaches Rust, `network_guard` does the same check again.
 *
 * Wildcards: a leading `*.` means "any subdomain of". E.g.
 *   `*.example.com` matches `api.example.com` but NOT `example.com`.
 *
 * Usage:
 *   const guard = createNetworkGuard(["api.openai.com", "*.gongfeng.com"])
 *   guard.assert("https://api.openai.com/v1/chat") // ok
 *   guard.assert("https://attacker.evil")          // throws
 */

export class NetworkHostNotAllowedError extends Error {
  readonly code = "NETWORK_HOST_NOT_ALLOWED" as const
  constructor(
    readonly host: string,
    readonly allowed: ReadonlyArray<string>,
  ) {
    super(
      `Network host "${host}" is not in the manifest's spec.network.hosts allowlist (allowed: ${allowed.join(", ") || "<none>"})`,
    )
    this.name = "NetworkHostNotAllowedError"
  }
}

export interface NetworkGuard {
  readonly hosts: ReadonlyArray<string>
  has(urlOrHost: string): boolean
  assert(urlOrHost: string): void
}

const extractHost = (urlOrHost: string): string => {
  // Accept either bare host ("api.openai.com") or full URL.
  if (/^https?:\/\//i.test(urlOrHost)) {
    try {
      return new URL(urlOrHost).hostname.toLowerCase()
    } catch {
      return urlOrHost.toLowerCase()
    }
  }
  return urlOrHost.toLowerCase()
}

const matches = (pattern: string, host: string): boolean => {
  const p = pattern.toLowerCase()
  if (p === host) return true
  if (p.startsWith("*.")) {
    const suffix = p.slice(1) // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return false
}

export const createNetworkGuard = (
  hosts: ReadonlyArray<string>,
): NetworkGuard => {
  const normalised = hosts.map((h) => h.toLowerCase())
  return {
    hosts: normalised,
    has(urlOrHost: string): boolean {
      const host = extractHost(urlOrHost)
      return normalised.some((p) => matches(p, host))
    },
    assert(urlOrHost: string): void {
      const host = extractHost(urlOrHost)
      if (!normalised.some((p) => matches(p, host))) {
        throw new NetworkHostNotAllowedError(host, normalised)
      }
    },
  }
}
