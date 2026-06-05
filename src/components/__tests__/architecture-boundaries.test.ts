import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const componentsDir = join(process.cwd(), "src/components")

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return collectSourceFiles(path)
    if (/\.(ts|tsx)$/.test(entry)) return [path]
    return []
  })
}

describe("component architecture boundaries", () => {
  it("does not import services directly from components", () => {
    const offenders = collectSourceFiles(componentsDir).flatMap((file) => {
      const content = readFileSync(file, "utf8")
      const hasServiceImport = /from\s+["']@\/services\//.test(content)
      return hasServiceImport ? [relative(process.cwd(), file)] : []
    })

    expect(offenders).toEqual([])
  })
})
