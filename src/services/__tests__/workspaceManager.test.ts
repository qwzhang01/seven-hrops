import { describe, it, expect, vi, beforeEach } from "vitest"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import { WorkspaceNotFoundError } from "@/types/workspace"

// Mock toolRegistry before importing workspaceManager
vi.mock("@/platform/registry/toolRegistry", () => ({
  toolRegistry: {
    invoke: vi.fn(),
  },
}))

import {
  __resetWorkspaceManagerSessionForTest,
  addInputFile,
  createWorkspace,
  getWorkspace,
  importInputFiles,
  listFiles,
  listWorkspaces,
} from "../workspaceManager"

const mockInvoke = vi.mocked(toolRegistry.invoke)

const workspaceInfo = {
  id: "ws1",
  name: "test_20260528_ws1",
  path: "~/SevenHROps/workspaces/test_20260528_ws1",
  capabilityId: "test-cap",
  createdAt: 1748390400000,
}

function mockWorkspaceLookup(info = workspaceInfo): void {
  mockInvoke
    .mockResolvedValueOnce(undefined) // ensureSession: sandbox_create
    .mockResolvedValueOnce([{ path: info.path }]) // listWorkspaces: list_dir
    .mockResolvedValueOnce(JSON.stringify(info)) // listWorkspaces: read_file .workspace.json
}

describe("workspaceManager", () => {
  beforeEach(() => {
    __resetWorkspaceManagerSessionForTest()
    mockInvoke.mockReset()
  })

  // ── createWorkspace ──────────────────────────────────────────────────

  describe("createWorkspace", () => {
    it("returns WorkspaceInfo with correct capabilityId", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const info = await createWorkspace("resume-screening")
      expect(info.capabilityId).toBe("resume-screening")
    })

    it("generates a path matching the convention", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const info = await createWorkspace("resume-screening")
      expect(info.path).toMatch(/^~\/SevenHROps\/workspaces\/resume-screening_\d{8}_/)
    })

    it("creates 4 subdirectories (01_inputs ~ 04_reports)", async () => {
      mockInvoke.mockResolvedValue(undefined)
      await createWorkspace("resume-screening")

      const writeCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === "write_file",
      )
      const paths = writeCalls.map((call) => (call[1] as { path: string }).path)

      expect(paths.some((p) => p.includes("01_inputs"))).toBe(true)
      expect(paths.some((p) => p.includes("02_processed"))).toBe(true)
      expect(paths.some((p) => p.includes("03_outputs"))).toBe(true)
      expect(paths.some((p) => p.includes("04_reports"))).toBe(true)
    })

    it("writes .workspace.json metadata", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const info = await createWorkspace("resume-screening")

      const metaCall = mockInvoke.mock.calls.find(
        (call) =>
          call[0] === "write_file" &&
          (call[1] as { path: string }).path.endsWith(".workspace.json") &&
          (call[1] as { content: string }).content.includes(info.id),
      )
      expect(metaCall).toBeDefined()
    })

    it("uses toolRegistry.invoke (no direct Tauri invoke)", async () => {
      mockInvoke.mockResolvedValue(undefined)
      await createWorkspace("test-cap")
      expect(mockInvoke).toHaveBeenCalled()
    })
  })

  // ── listWorkspaces ───────────────────────────────────────────────────

  describe("listWorkspaces", () => {
    it("returns empty array when directory listing fails", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("dir not found"))
      const result = await listWorkspaces()
      expect(result).toEqual([])
    })

    it("returns empty array when no workspace.json files found", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([])
      const result = await listWorkspaces()
      expect(result).toEqual([])
    })

    it("parses workspace info from .workspace.json", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ path: workspaceInfo.path }])
        .mockResolvedValueOnce(JSON.stringify(workspaceInfo))

      const result = await listWorkspaces()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("ws1")
    })
  })

  // ── getWorkspace ─────────────────────────────────────────────────────

  describe("getWorkspace", () => {
    it("returns null when workspace not found", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([])
      const result = await getWorkspace("non-existent")
      expect(result).toBeNull()
    })
  })

  // ── addInputFile ─────────────────────────────────────────────────────

  describe("addInputFile", () => {
    it("writes a file into the workspace 01_inputs directory", async () => {
      mockWorkspaceLookup()
      mockInvoke.mockResolvedValueOnce(undefined) // addInputFile: write_file

      await addInputFile("ws1", "resume.txt", "hello")

      expect(mockInvoke).toHaveBeenLastCalledWith(
        "write_file",
        {
          path: `${workspaceInfo.path}/01_inputs/resume.txt`,
          content: "hello",
        },
        { sessionId: "workspace-manager", source: "builtin" },
      )
    })

    it("uses the provided sessionId when writing", async () => {
      mockWorkspaceLookup()
      mockInvoke.mockResolvedValueOnce(undefined)

      await addInputFile("ws1", "resume.txt", "hello", "session-123")

      expect(mockInvoke).toHaveBeenLastCalledWith(
        "write_file",
        expect.objectContaining({ path: `${workspaceInfo.path}/01_inputs/resume.txt` }),
        { sessionId: "session-123", source: "builtin" },
      )
    })

    it("throws WorkspaceNotFoundError when the workspace cannot be resolved", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([])

      await expect(addInputFile("missing", "resume.txt", "hello")).rejects.toBeInstanceOf(
        WorkspaceNotFoundError,
      )
    })
  })

  // ── importInputFiles ─────────────────────────────────────────────────

  describe("importInputFiles", () => {
    it("copies source files into the workspace 01_inputs directory", async () => {
      mockWorkspaceLookup()
      mockInvoke
        .mockResolvedValueOnce({ is_file: true, is_dir: false, size: 1024 }) // source stat_file
        .mockRejectedValueOnce(new Error("not found")) // target stat_file
        .mockResolvedValueOnce(undefined) // copy_file

      const result = await importInputFiles("ws1", ["/tmp/resume.pdf"])

      expect(result.successCount).toBe(1)
      expect(result.failureCount).toBe(0)
      expect(result.successes[0]).toEqual({
        sourcePath: "/tmp/resume.pdf",
        targetPath: `${workspaceInfo.path}/01_inputs/resume.pdf`,
        fileName: "resume.pdf",
        size: 1024,
      })
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "copy_file",
        {
          fromPath: "/tmp/resume.pdf",
          toPath: `${workspaceInfo.path}/01_inputs/resume.pdf`,
        },
        { sessionId: "workspace-manager", source: "builtin" },
      )
    })

    it("normalizes Windows-style source paths before deriving file names", async () => {
      mockWorkspaceLookup()
      mockInvoke
        .mockResolvedValueOnce({ is_file: true, is_dir: false, size: 512 })
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce(undefined)

      await importInputFiles("ws1", ["C:\\Temp\\resume.docx"], "session-456")

      expect(mockInvoke).toHaveBeenLastCalledWith(
        "copy_file",
        expect.objectContaining({
          fromPath: "C:\\Temp\\resume.docx",
          toPath: `${workspaceInfo.path}/01_inputs/resume.docx`,
        }),
        { sessionId: "session-456", source: "builtin" },
      )
    })

    it("does not overwrite an existing input file with the same name", async () => {
      mockWorkspaceLookup()
      mockInvoke
        .mockResolvedValueOnce({ is_file: true, is_dir: false, size: 1 }) // source stat
        .mockResolvedValueOnce({ is_file: true, is_dir: false, size: 99 }) // target exists
        .mockRejectedValueOnce(new Error("not found")) // target (1) missing
        .mockResolvedValueOnce(undefined) // copy

      const result = await importInputFiles("ws1", ["/tmp/resume.pdf"])

      expect(result.successes[0].fileName).toBe("resume (1).pdf")
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "copy_file",
        expect.objectContaining({
          toPath: `${workspaceInfo.path}/01_inputs/resume (1).pdf`,
        }),
        { sessionId: "workspace-manager", source: "builtin" },
      )
    })

    it("imports multiple files and preserves each successful result", async () => {
      mockWorkspaceLookup()
      mockInvoke
        .mockResolvedValueOnce({ is_file: true, is_dir: false, size: 1 })
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce({ to_path: `${workspaceInfo.path}/01_inputs/a.txt`, size: 1 })
        .mockResolvedValueOnce({ is_file: true, is_dir: false, size: 2 })
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce({ to_path: `${workspaceInfo.path}/01_inputs/b.pdf`, size: 2 })

      const result = await importInputFiles("ws1", ["/tmp/a.txt", "/tmp/b.pdf"])

      expect(result.successCount).toBe(2)
      expect(result.failureCount).toBe(0)
      expect(result.successes.map((item) => item.fileName)).toEqual(["a.txt", "b.pdf"])
    })

    it("returns read-denied failures with displayable messages", async () => {
      mockWorkspaceLookup()
      mockInvoke.mockRejectedValueOnce(new Error('{"code":"SANDBOX_DENY_READ","message":"Denied"}'))

      const result = await importInputFiles("ws1", ["/private/resume.pdf"])

      expect(result.successCount).toBe(0)
      expect(result.failureCount).toBe(1)
      expect(result.failures[0]).toMatchObject({
        sourcePath: "/private/resume.pdf",
        code: "READ_DENIED",
      })
    })

    it("returns a directory-not-supported failure for directory inputs", async () => {
      mockWorkspaceLookup()
      mockInvoke.mockResolvedValueOnce({ is_file: false, is_dir: true, size: 0 })

      const result = await importInputFiles("ws1", ["/tmp/folder"])

      expect(result.successCount).toBe(0)
      expect(result.failureCount).toBe(1)
      expect(result.failures[0]).toMatchObject({
        sourcePath: "/tmp/folder",
        code: "DIRECTORY_NOT_SUPPORTED",
      })
    })

    it("returns a failure when the source path cannot be statted", async () => {
      mockWorkspaceLookup()
      mockInvoke.mockRejectedValueOnce(new Error("No such file or directory"))

      const result = await importInputFiles("ws1", ["/tmp/missing.pdf"])

      expect(result.successCount).toBe(0)
      expect(result.failureCount).toBe(1)
      expect(result.failures[0].code).toBe("FILE_NOT_FOUND")
    })
  })

  // ── listFiles ────────────────────────────────────────────────────────

  describe("listFiles", () => {
    it("returns empty array when workspace not found", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([])
      const result = await listFiles("non-existent")
      expect(result).toEqual([])
    })

    it("returns file nodes from directory listing", async () => {
      mockWorkspaceLookup()
      mockInvoke.mockResolvedValueOnce([
        { path: `${workspaceInfo.path}/01_inputs/resume.pdf`, type: "file" },
      ])

      const result = await listFiles("ws1")
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("resume.pdf")
      expect(result[0].type).toBe("file")
    })

    it("recursively reads subdirectories so 01_inputs files appear under their parent", async () => {
      mockWorkspaceLookup()
      // depth 0: workspace root → directories only (real shape from fs_list_dir)
      mockInvoke.mockResolvedValueOnce([
        { name: "01_inputs", path: `${workspaceInfo.path}/01_inputs`, is_dir: true },
        { name: "02_processed", path: `${workspaceInfo.path}/02_processed`, is_dir: true },
        { name: ".workspace.json", path: `${workspaceInfo.path}/.workspace.json`, is_dir: false },
      ])
      // depth 1: 01_inputs → contains resume.pdf and a placeholder
      mockInvoke.mockResolvedValueOnce([
        { name: "resume.pdf", path: `${workspaceInfo.path}/01_inputs/resume.pdf`, is_dir: false },
        { name: ".gitkeep", path: `${workspaceInfo.path}/01_inputs/.gitkeep`, is_dir: false },
      ])
      // depth 1: 02_processed → empty
      mockInvoke.mockResolvedValueOnce([])

      const result = await listFiles("ws1")

      // .workspace.json should be filtered, leaving 2 dirs
      expect(result).toHaveLength(2)
      expect(result.map((n) => n.name)).toEqual(["01_inputs", "02_processed"])

      const inputs = result.find((n) => n.name === "01_inputs")
      expect(inputs?.type).toBe("directory")
      // .gitkeep should be filtered, only resume.pdf remains
      expect(inputs?.children).toHaveLength(1)
      expect(inputs?.children?.[0]).toMatchObject({
        name: "resume.pdf",
        type: "file",
      })
    })
  })
})
