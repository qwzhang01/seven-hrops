/**
 * Toolpack-side error types & branded handles.
 *
 * Spec: openspec/changes/phase-b-platform-foundation/specs/mcp-toolpacks/spec.md
 */

/** Opaque handle returned by webserver_publish; carried back to webserver_drop. */
export type WebserverHandle = string & { readonly __brand: "WebserverHandle" }

/** Phase B intentional stub — builder tools are deferred to Phase H. */
export class NotImplementedError extends Error {
  public readonly code = "NOT_IMPLEMENTED"
  public readonly toolName: string
  public readonly deferredTo: string

  constructor(toolName: string, deferredTo = "Phase H") {
    super(
      `NOT_IMPLEMENTED: tool "${toolName}" is registered but its implementation is deferred to ${deferredTo}.`,
    )
    this.name = "NotImplementedError"
    this.toolName = toolName
    this.deferredTo = deferredTo
  }
}

/**
 * Standard structured error for invalid arguments (zod validation failure).
 * Toolpacks throw this *before* calling the Tauri dispatcher.
 */
export class InvalidToolArgsError extends Error {
  public readonly code = "INVALID_TOOL_ARGS"
  public readonly toolName: string
  public readonly issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>

  constructor(
    toolName: string,
    issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
  ) {
    super(
      `INVALID_TOOL_ARGS: tool "${toolName}" rejected arguments: ${issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    )
    this.name = "InvalidToolArgsError"
    this.toolName = toolName
    this.issues = issues
  }
}
