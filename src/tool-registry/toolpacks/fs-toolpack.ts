/**
 * fs-toolpack — registers 6 file-system tools that delegate to the Rust
 * Native Bridge (`fs_read_text` / `fs_write_text` / `fs_copy_file` /
 * `fs_list_dir` / `fs_stat` / `fs_canonicalize`). Each invoker:
 *
 *   1. Validates arguments via zod (rejects with InvalidToolArgsError on miss).
 *   2. Forwards `session_id` from `ctx.sessionId` to the Rust sandbox layer.
 *   3. Returns the dispatcher's response verbatim (errors thrown).
 *
 * Spec: openspec/changes/phase-b-platform-foundation/specs/mcp-toolpacks/spec.md
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

const ReadFile = z.object({ path: z.string().min(1) })
const WriteFile = z.object({ path: z.string().min(1), content: z.string() })
const CopyFile = z.object({ fromPath: z.string().min(1), toPath: z.string().min(1) })
const ListDir = z.object({ path: z.string().min(1) })
const StatFile = z.object({ path: z.string().min(1) })
const Canonicalize = z.object({ path: z.string().min(1) })

function parse<T>(toolName: string, schema: z.ZodSchema<T>, args: unknown): T {
  const result = schema.safeParse(args)
  if (!result.success) {
    throw new InvalidToolArgsError(
      toolName,
      result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    )
  }
  return result.data
}

/**
 * Guard: reject relative paths before they reach the Rust sandbox.
 *
 * The Rust fs_guard requires absolute paths. When the LLM passes a relative
 * path (e.g. "01_inputs/"), the OS resolves it relative to the process CWD
 * (not the workspace root), causing a confusing NATIVE_IO_FAILED error.
 *
 * By failing early with a clear message, the LLM can self-correct on the
 * next step instead of getting a cryptic OS error.
 *
 * `~` paths are allowed and passed through to the Rust `expand_tilde` helper.
 */
function assertAbsolutePath(toolName: string, fieldName: string, value: string): void {
  if (!value.startsWith("/") && !value.startsWith("~") && !value.match(/^[A-Za-z]:\\/)) {
    throw new InvalidToolArgsError(toolName, [
      {
        path: [fieldName],
        message: `Path must be absolute (starts with /). Got: "${value}". ` +
          `Use the workspacePath from the system prompt to build the full path, ` +
          `e.g. "<workspacePath>/01_inputs".`,
      },
    ])
  }
}

export function register(toolRegistry: ToolRegistry): void {
  toolRegistry.register(metaOf("read_file"), async (args, ctx) => {
    const a = parse("read_file", ReadFile, args)
    assertAbsolutePath("read_file", "path", a.path)
    return getDispatcher()("fs_read_text", { sessionId: ctx.sessionId, path: a.path })
  })

  toolRegistry.register(metaOf("write_file"), async (args, ctx) => {
    const a = parse("write_file", WriteFile, args)
    assertAbsolutePath("write_file", "path", a.path)
    return getDispatcher()("fs_write_text", {
      sessionId: ctx.sessionId,
      path: a.path,
      contents: a.content,
    })
  })

  toolRegistry.register(metaOf("copy_file"), async (args, ctx) => {
    const a = parse("copy_file", CopyFile, args)
    assertAbsolutePath("copy_file", "fromPath", a.fromPath)
    assertAbsolutePath("copy_file", "toPath", a.toPath)
    return getDispatcher()("fs_copy_file", {
      sessionId: ctx.sessionId,
      fromPath: a.fromPath,
      toPath: a.toPath,
    })
  })

  toolRegistry.register(metaOf("list_dir"), async (args, ctx) => {
    const a = parse("list_dir", ListDir, args)
    assertAbsolutePath("list_dir", "path", a.path)
    return getDispatcher()("fs_list_dir", { sessionId: ctx.sessionId, path: a.path })
  })

  toolRegistry.register(metaOf("stat_file"), async (args, ctx) => {
    const a = parse("stat_file", StatFile, args)
    assertAbsolutePath("stat_file", "path", a.path)
    return getDispatcher()("fs_stat", { sessionId: ctx.sessionId, path: a.path })
  })

  toolRegistry.register(metaOf("canonicalize_path"), async (args, ctx) => {
    const a = parse("canonicalize_path", Canonicalize, args)
    assertAbsolutePath("canonicalize_path", "path", a.path)
    return getDispatcher()("fs_canonicalize", { sessionId: ctx.sessionId, path: a.path })
  })
}
