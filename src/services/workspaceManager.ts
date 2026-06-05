/**
 * Workspace Manager — workspace CRUD and file tree operations.
 *
 * Design notes:
 *   - Uses toolRegistry.invoke() as the ONLY L2→L1 call channel (fs-toolpack + sandbox-toolpack).
 *   - Never calls Tauri invoke() directly — sandbox lifecycle is also routed through toolRegistry.
 *   - Path convention: ~/SevenHROps/workspaces/<capabilityId>_<YYYYMMDD>_<uuid>/
 *   - Each workspace has a fixed subdirectory structure (01_inputs ~ 04_reports).
 */

import { toolRegistry } from "@/platform/registry/toolRegistry"
import type {
  FileTreeNode,
  ImportInputFileErrorCode,
  ImportInputFileFailure,
  ImportInputFilesResult,
  WorkspaceInfo,
} from "@/types/workspace"
import { WorkspaceNotFoundError } from "@/types/workspace"

export type { WorkspaceInfo, FileTreeNode }

// ─── Constants ───────────────────────────────────────────────────────

const BASE_DIR = "~/SevenHROps/workspaces"
const SESSION_ID = "workspace-manager"

// ─── Sandbox Session Bootstrap ───────────────────────────────────────

/**
 * Ensure the builtin sandbox session for workspace-manager is registered
 * in the Rust sandbox registry. Must be called before any fs tool invocation.
 *
 * Uses `source: "builtin"` so fs_guard fast-paths all path checks without
 * requiring an explicit whitelist.
 */
let _sessionReady: Promise<void> | null = null

/**
 * Ensure the builtin sandbox session for workspace-manager is registered
 * in the Rust sandbox registry. Must be called before any fs tool invocation.
 *
 * Routes through toolRegistry (sandbox-toolpack) — no direct Tauri invoke.
 * Uses `source: "builtin"` so fs_guard fast-paths all path checks.
 */
async function ensureSession(): Promise<void> {
  if (_sessionReady) return _sessionReady
  _sessionReady = toolRegistry
    .invoke(
      "sandbox_create",
      { session_id: SESSION_ID, source: "builtin" },
      { sessionId: SESSION_ID, source: "builtin" },
    )
    .then(() => undefined)
    .catch((err) => {
      // Reset so next call retries (e.g. after app reload)
      _sessionReady = null
      throw err
    })
  return _sessionReady
}

/** @internal Test-only helper to keep workspaceManager unit tests isolated. */
export function __resetWorkspaceManagerSessionForTest(): void {
  _sessionReady = null
}

const SUBDIRS = ["01_inputs", "02_processed", "03_outputs", "04_reports"] as const

// ─── Helpers ─────────────────────────────────────────────────────────

const generateId = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const formatDate = (ts: number): string =>
  new Date(ts).toISOString().split("T")[0].replace(/-/g, "")

const buildWorkspacePath = (capabilityId: string, date: string, id: string): string =>
  `${BASE_DIR}/${capabilityId}_${date}_${id}`

// ─── createWorkspace ─────────────────────────────────────────────────

/**
 * Create a new workspace directory with standard subdirectory structure.
 * Returns WorkspaceInfo with the generated path.
 */
export async function createWorkspace(capabilityId: string): Promise<WorkspaceInfo> {
  await ensureSession()
  const id = generateId()
  const createdAt = Date.now()
  const date = formatDate(createdAt)
  const path = buildWorkspacePath(capabilityId, date, id)
  const name = `${capabilityId}_${date}_${id.slice(0, 8)}`

  // Create main directory
  await toolRegistry.invoke("write_file", { path: `${path}/.workspace.json`, content: "" }, { sessionId: SESSION_ID, source: "builtin" })

  // Create subdirectories (by writing a .gitkeep placeholder)
  for (const subdir of SUBDIRS) {
    await toolRegistry.invoke(
      "write_file",
      { path: `${path}/${subdir}/.gitkeep`, content: "" },
      { sessionId: SESSION_ID, source: "builtin" },
    )
  }

  const info: WorkspaceInfo = { id, name, path, capabilityId, createdAt }

  // Write metadata
  await toolRegistry.invoke(
    "write_file",
    { path: `${path}/.workspace.json`, content: JSON.stringify(info, null, 2) },
    { sessionId: SESSION_ID, source: "builtin" },
  )

  return info
}

// ─── listWorkspaces ──────────────────────────────────────────────────

/**
 * List all workspaces by reading ~/SevenHROps/workspaces/ directory.
 * Parses .workspace.json from each subdirectory.
 */
export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  await ensureSession()
  try {
    const result = await toolRegistry.invoke(
      "list_dir",
      { path: BASE_DIR },
      { sessionId: SESSION_ID, source: "builtin" },
    )
    const entries = Array.isArray(result) ? result : []
    const infos: WorkspaceInfo[] = []

    for (const entry of entries) {
      const entryPath = typeof entry === "string" ? entry : (entry as { path: string }).path
      try {
        const raw = await toolRegistry.invoke(
          "read_file",
          { path: `${entryPath}/.workspace.json` },
          { sessionId: SESSION_ID, source: "builtin" },
        )
        if (typeof raw === "string" && raw.trim()) {
          infos.push(JSON.parse(raw) as WorkspaceInfo)
        }
      } catch {
        // Skip directories without .workspace.json
      }
    }

    return infos.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

// ─── getWorkspace ────────────────────────────────────────────────────

/**
 * Get a single workspace by id.
 */
export async function getWorkspace(id: string): Promise<WorkspaceInfo | null> {
  const all = await listWorkspaces()
  return all.find((w) => w.id === id) ?? null
}

// ─── addInputFile ─────────────────────────────────────────────────────────────

/**
 * Write a file into the workspace's `01_inputs/` subdirectory.
 *
 * @param workspaceId - The workspace id to write into.
 * @param fileName    - The file name (e.g. "resume.pdf").
 * @param content     - UTF-8 text content (or base64 for binary files).
 * @param sessionId   - Optional sandbox session id; defaults to SESSION_ID.
 *
 * @throws {WorkspaceNotFoundError} if the workspace cannot be resolved.
 */
export async function addInputFile(
  workspaceId: string,
  fileName: string,
  content: string,
  sessionId?: string,
): Promise<void> {
  await ensureSession()
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) {
    throw new WorkspaceNotFoundError(workspaceId)
  }

  const sid = sessionId ?? SESSION_ID
  const targetPath = `${workspace.path}/01_inputs/${fileName}`

  await toolRegistry.invoke(
    "write_file",
    { path: targetPath, content },
    { sessionId: sid, source: "builtin" },
  )
}

/**
 * Copy existing files into the workspace's `01_inputs/` subdirectory.
 *
 * This preserves binary files (PDF/DOCX/images) byte-for-byte, unlike
 * addInputFile which writes UTF-8 text content.
 */
export async function importInputFiles(
  workspaceId: string,
  sourcePaths: string[],
  sessionId?: string,
): Promise<ImportInputFilesResult> {
  await ensureSession()
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) {
    throw new WorkspaceNotFoundError(workspaceId)
  }

  const sid = sessionId ?? SESSION_ID
  const result: ImportInputFilesResult = {
    successes: [],
    failures: [],
    successCount: 0,
    failureCount: 0,
  }
  const usedTargetNames = new Set<string>()

  for (const sourcePath of sourcePaths) {
    const fileName = sanitizeFileName(getFileName(sourcePath))
    if (!sourcePath || !fileName) {
      result.failures.push(makeImportFailure(sourcePath, fileName, "EMPTY_PATH", "文件路径为空，无法导入"))
      continue
    }

    let stat: { is_file?: boolean; is_dir?: boolean; size?: number } | null = null
    try {
      stat = await toolRegistry.invoke(
        "stat_file",
        { path: sourcePath },
        { sessionId: sid, source: "builtin" },
      ) as { is_file?: boolean; is_dir?: boolean; size?: number }
    } catch (err) {
      result.failures.push(makeImportFailure(sourcePath, fileName, classifyImportError(err), formatImportError(err, "文件不存在或无读取权限")))
      continue
    }

    if (stat?.is_dir) {
      result.failures.push(makeImportFailure(sourcePath, fileName, "DIRECTORY_NOT_SUPPORTED", "暂不支持目录上传，请选择普通文件"))
      continue
    }

    if (!stat?.is_file) {
      result.failures.push(makeImportFailure(sourcePath, fileName, "FILE_NOT_FOUND", "只支持导入普通文件"))
      continue
    }

    const targetFileName = await resolveAvailableFileName(workspace.path, fileName, sid, usedTargetNames)
    usedTargetNames.add(targetFileName)
    const targetPath = `${workspace.path}/01_inputs/${targetFileName}`

    try {
      const copyResult = await toolRegistry.invoke(
        "copy_file",
        {
          fromPath: sourcePath,
          toPath: targetPath,
        },
        { sessionId: sid, source: "builtin" },
      ) as { to_path?: string; toPath?: string; size?: number } | undefined
      result.successes.push({
        sourcePath,
        targetPath: copyResult?.to_path ?? copyResult?.toPath ?? targetPath,
        fileName: targetFileName,
        size: copyResult?.size ?? stat.size,
      })
    } catch (err) {
      result.failures.push(makeImportFailure(sourcePath, fileName, classifyImportError(err), formatImportError(err, "文件复制失败")))
    }
  }

  result.successCount = result.successes.length
  result.failureCount = result.failures.length
  return result
}

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() ?? ""
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]/g, "_").trim()
}

async function resolveAvailableFileName(
  workspacePath: string,
  originalName: string,
  sessionId: string,
  reservedNames: Set<string>,
): Promise<string> {
  const { base, ext } = splitFileName(originalName)
  let candidate = originalName
  let index = 1

  while (reservedNames.has(candidate) || await fileExists(`${workspacePath}/01_inputs/${candidate}`, sessionId)) {
    candidate = `${base} (${index})${ext}`
    index += 1
  }

  return candidate
}

function splitFileName(fileName: string): { base: string; ext: string } {
  const lastDot = fileName.lastIndexOf(".")
  if (lastDot <= 0) return { base: fileName, ext: "" }
  return { base: fileName.slice(0, lastDot), ext: fileName.slice(lastDot) }
}

async function fileExists(path: string, sessionId: string): Promise<boolean> {
  try {
    const stat = await toolRegistry.invoke(
      "stat_file",
      { path },
      { sessionId, source: "builtin" },
    ) as { is_file?: boolean; is_dir?: boolean }
    return Boolean(stat.is_file || stat.is_dir)
  } catch {
    return false
  }
}

function makeImportFailure(
  sourcePath: string,
  fileName: string | undefined,
  code: ImportInputFileErrorCode,
  message: string,
): ImportInputFileFailure {
  return { sourcePath, fileName, code, message }
}

function classifyImportError(err: unknown): ImportInputFileErrorCode {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes("SANDBOX_DENY_READ")) return "READ_DENIED"
  if (message.includes("not found") || message.includes("No such file")) return "FILE_NOT_FOUND"
  return "COPY_FAILED"
}

function formatImportError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  const message = String(err)
  return message && message !== "undefined" ? message : fallback
}

/** Hidden / placeholder files that should not show up in the file tree UI. */
const HIDDEN_ENTRY_NAMES = new Set([".gitkeep", ".workspace.json", ".DS_Store"])

/**
 * Read a single directory and return its FileTreeNode children (one level only,
 * placeholder files filtered out).
 */
async function readDirEntries(path: string): Promise<FileTreeNode[]> {
  try {
    const result = await toolRegistry.invoke(
      "list_dir",
      { path },
      { sessionId: SESSION_ID, source: "builtin" },
    )
    const entries = Array.isArray(result) ? result : []

    return entries
      .map((entry): FileTreeNode | null => {
        if (typeof entry === "string") {
          const name = entry.split("/").pop() ?? entry
          if (HIDDEN_ENTRY_NAMES.has(name)) return null
          return { name, path: entry, type: "file" }
        }

        const obj = entry as { path?: string; name?: string; is_dir?: boolean; type?: string }
        const entryPath = obj.path ?? ""
        const fallbackName = entryPath ? (entryPath.split("/").pop() ?? entryPath) : ""
        const name = obj.name ?? fallbackName
        if (!name || HIDDEN_ENTRY_NAMES.has(name)) return null

        const isDir =
          obj.is_dir === true ||
          obj.type === "directory" ||
          obj.type === "dir"
        return {
          name,
          path: entryPath,
          type: isDir ? "directory" : "file",
        }
      })
      .filter((node): node is FileTreeNode => node !== null)
  } catch {
    return []
  }
}

/**
 * Recursively read a directory subtree as FileTreeNode[], up to a max depth
 * (defensive cap to avoid runaway recursion on symlink loops).
 */
async function readDirTree(path: string, depth: number, maxDepth: number): Promise<FileTreeNode[]> {
  const nodes = await readDirEntries(path)
  if (depth >= maxDepth) return nodes

  for (const node of nodes) {
    if (node.type === "directory") {
      node.children = await readDirTree(node.path, depth + 1, maxDepth)
    }
  }
  return nodes
}

/**
 * List files in a workspace (or a subdirectory) as a recursive tree.
 *
 * Returns one node per visible entry; directories carry a `children` array of
 * their own descendants. Placeholder files (`.gitkeep`, `.workspace.json`,
 * `.DS_Store`) are filtered out so the UI shows real content only.
 */
export async function listFiles(workspaceId: string, subdir?: string): Promise<FileTreeNode[]> {
  await ensureSession()
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) return []

  const targetPath = subdir ? `${workspace.path}/${subdir}` : workspace.path
  // Workspace tree is intentionally shallow (4 fixed subdirs + 1-2 levels),
  // so 5 is plenty and protects against pathological symlink loops.
  return readDirTree(targetPath, 0, 5)
}
