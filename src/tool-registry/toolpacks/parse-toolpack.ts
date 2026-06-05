/**
 * parse-toolpack — registers parse_pdf / parse_docx / parse_excel.
 * Delegates to Rust commands `parse_pdf` / `parse_docx` / `parse_xlsx`.
 *
 * Spec: openspec/changes/phase-b-platform-foundation/specs/mcp-toolpacks/spec.md
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

const PathArg = z.object({ path: z.string().min(1) })
const TranscribeArg = z.object({
  path: z.string().min(1),
  lang: z.string().optional(),
})

function parse<T>(toolName: string, schema: z.ZodSchema<T>, args: unknown): T {
  const r = schema.safeParse(args)
  if (!r.success) {
    throw new InvalidToolArgsError(
      toolName,
      r.error.issues.map((i) => ({ path: i.path, message: i.message })),
    )
  }
  return r.data
}

export function register(toolRegistry: ToolRegistry): void {
  toolRegistry.register(metaOf("parse_pdf"), async (args, ctx) => {
    const a = parse("parse_pdf", PathArg, args)
    return getDispatcher()("parse_pdf", { sessionId: ctx.sessionId, path: a.path })
  })

  toolRegistry.register(metaOf("parse_docx"), async (args, ctx) => {
    const a = parse("parse_docx", PathArg, args)
    return getDispatcher()("parse_docx", { sessionId: ctx.sessionId, path: a.path })
  })

  toolRegistry.register(metaOf("parse_excel"), async (args, ctx) => {
    const a = parse("parse_excel", PathArg, args)
    return getDispatcher()("parse_xlsx", { sessionId: ctx.sessionId, path: a.path })
  })

  // Phase F Task 2.5: transcribe_audio invoker (wraps Phase B Rust FFI command)
  toolRegistry.register(metaOf("transcribe_audio"), async (args, ctx) => {
    const a = parse("transcribe_audio", TranscribeArg, args)
    return getDispatcher()("transcribe_audio", {
      sessionId: ctx.sessionId,
      path: a.path,
      lang: a.lang ?? "zh",
    })
  })
}
