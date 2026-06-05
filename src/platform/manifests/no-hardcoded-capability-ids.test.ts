/**
 * no-hardcoded-capability-ids.test.ts — Phase G Task 7.6
 *
 * Lint test: skill markdown files (*.SKILL.md) must NOT contain hardcoded
 * capability IDs. The assistant agent should route dynamically using the
 * injected {{availableCapabilities}} list, not hardcoded strings.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

const SKILLS_DIR = join(__dirname, "./skills")

// Known capability IDs that should never appear hardcoded in skill prompts
const FORBIDDEN_IDS = [
  "resume-screening",
  "jd-optimization",
  "interview-planning",
  "interview-evaluation",
  "exam-design",
  "report-writing",
  "radio-dj",
]

describe("no-hardcoded-capability-ids (Task 7.6)", () => {
  const skillFiles = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".SKILL.md"))

  it("should find at least one skill markdown file", () => {
    expect(skillFiles.length).toBeGreaterThan(0)
  })

  for (const file of skillFiles) {
    it(`${file} does not contain hardcoded capability IDs`, () => {
      const content = readFileSync(join(SKILLS_DIR, file), "utf8")
      const violations: string[] = []

      for (const id of FORBIDDEN_IDS) {
        // Match the ID as a standalone word (not part of a longer identifier)
        const regex = new RegExp(`\\b${id}\\b`, "gi")
        if (regex.test(content)) {
          violations.push(id)
        }
      }

      expect(
        violations,
        `${file} contains hardcoded capability IDs: [${violations.join(", ")}]. ` +
          `Use {{availableCapabilities}} template injection instead.`,
      ).toHaveLength(0)
    })
  }
})
