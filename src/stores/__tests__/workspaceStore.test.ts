import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWorkspaceStore } from "../workspaceStore"
import type { FileTreeNode, ImportInputFilesResult, WorkspaceInfo } from "@/types/workspace"

vi.mock("@/services/workspaceManager", () => ({
  createWorkspace: vi.fn(),
  importInputFiles: vi.fn(),
  listFiles: vi.fn(),
  listWorkspaces: vi.fn(),
}))

import {
  createWorkspace,
  importInputFiles,
  listFiles,
  listWorkspaces,
} from "@/services/workspaceManager"

const mockCreateWorkspace = vi.mocked(createWorkspace)
const mockImportInputFiles = vi.mocked(importInputFiles)
const mockListFiles = vi.mocked(listFiles)
const mockListWorkspaces = vi.mocked(listWorkspaces)

const workspace: WorkspaceInfo = {
  id: "ws1",
  name: "resume-screening_20260529_ws1",
  path: "~/SevenHROps/workspaces/resume-screening_20260529_ws1",
  capabilityId: "resume-screening",
  createdAt: 1780000000000,
}

const fileTree: FileTreeNode[] = [
  {
    name: "01_inputs",
    path: `${workspace.path}/01_inputs`,
    type: "directory",
    children: [
      {
        name: "resume.pdf",
        path: `${workspace.path}/01_inputs/resume.pdf`,
        type: "file",
      },
    ],
  },
]

describe("workspaceStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({
      currentWorkspaceId: null,
      currentWorkspacePath: null,
      fileTree: [],
      workspaceList: [],
      sessionWorkspaceMap: {},
    })
  })

  it("setCurrentWorkspace stores id/path and clears fileTree", () => {
    useWorkspaceStore.setState({ fileTree })

    useWorkspaceStore.getState().setCurrentWorkspace(workspace)

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws1")
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(workspace.path)
    expect(useWorkspaceStore.getState().fileTree).toEqual([])
  })

  it("setCurrentWorkspace accepts null to clear selection", () => {
    useWorkspaceStore.getState().setCurrentWorkspace(workspace)

    useWorkspaceStore.getState().setCurrentWorkspace(null)

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBeNull()
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBeNull()
    expect(useWorkspaceStore.getState().fileTree).toEqual([])
  })

  it("refreshFileTree loads nodes from workspaceManager", async () => {
    mockListFiles.mockResolvedValue(fileTree)

    await useWorkspaceStore.getState().refreshFileTree("ws1")

    expect(mockListFiles).toHaveBeenCalledWith("ws1")
    expect(useWorkspaceStore.getState().fileTree).toEqual(fileTree)
  })

  it("loadWorkspaces stores the workspace list", async () => {
    mockListWorkspaces.mockResolvedValue([workspace])

    await useWorkspaceStore.getState().loadWorkspaces()

    expect(useWorkspaceStore.getState().workspaceList).toEqual([workspace])
  })

  it("createWorkspace prepends the new workspace and selects it when none is active", async () => {
    mockCreateWorkspace.mockResolvedValue(workspace)

    const result = await useWorkspaceStore.getState().createWorkspace("resume-screening")

    expect(result).toBe(workspace)
    expect(useWorkspaceStore.getState().workspaceList).toEqual([workspace])
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws1")
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(workspace.path)
  })

  it("createWorkspace does not replace an existing current workspace", async () => {
    mockCreateWorkspace.mockResolvedValue(workspace)
    useWorkspaceStore.setState({
      currentWorkspaceId: "existing",
      currentWorkspacePath: "/existing",
    })

    await useWorkspaceStore.getState().createWorkspace("resume-screening")

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("existing")
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe("/existing")
  })

  it("importInputFiles reuses the current workspace and refreshes fileTree", async () => {
    const importResult: ImportInputFilesResult = {
      successes: [
        {
          sourcePath: "/tmp/resume.pdf",
          targetPath: `${workspace.path}/01_inputs/resume.pdf`,
          fileName: "resume.pdf",
          size: 1024,
        },
      ],
      failures: [],
      successCount: 1,
      failureCount: 0,
    }
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws1",
      currentWorkspacePath: workspace.path,
    })
    mockImportInputFiles.mockResolvedValue(importResult)
    mockListFiles.mockResolvedValue(fileTree)

    const result = await useWorkspaceStore.getState().importInputFiles(["/tmp/resume.pdf"], "resume-screening")

    expect(result).toBe(importResult)
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
    expect(mockImportInputFiles).toHaveBeenCalledWith("ws1", ["/tmp/resume.pdf"])
    expect(mockListFiles).toHaveBeenCalledWith("ws1")
    expect(useWorkspaceStore.getState().fileTree).toEqual(fileTree)
  })

  it("importInputFiles creates a workspace when no workspace is active", async () => {
    const importResult: ImportInputFilesResult = {
      successes: [],
      failures: [],
      successCount: 0,
      failureCount: 0,
    }
    mockCreateWorkspace.mockResolvedValue(workspace)
    mockImportInputFiles.mockResolvedValue(importResult)
    mockListFiles.mockResolvedValue(fileTree)

    const result = await useWorkspaceStore.getState().importInputFiles(["/tmp/resume.pdf"], "resume-screening")

    expect(result).toBe(importResult)
    expect(mockCreateWorkspace).toHaveBeenCalledWith("resume-screening")
    expect(mockImportInputFiles).toHaveBeenCalledWith("ws1", ["/tmp/resume.pdf"])
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws1")
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(workspace.path)
    expect(useWorkspaceStore.getState().fileTree).toEqual(fileTree)
  })

  it("importInputFiles refreshes fileTree even when some files fail", async () => {
    const importResult: ImportInputFilesResult = {
      successes: [
        {
          sourcePath: "/tmp/a.txt",
          targetPath: `${workspace.path}/01_inputs/a.txt`,
          fileName: "a.txt",
        },
      ],
      failures: [
        {
          sourcePath: "/tmp/folder",
          fileName: "folder",
          code: "DIRECTORY_NOT_SUPPORTED",
          message: "暂不支持目录上传，请选择普通文件",
        },
      ],
      successCount: 1,
      failureCount: 1,
    }
    useWorkspaceStore.setState({ currentWorkspaceId: "ws1", currentWorkspacePath: workspace.path })
    mockImportInputFiles.mockResolvedValue(importResult)
    mockListFiles.mockResolvedValue(fileTree)

    const result = await useWorkspaceStore.getState().importInputFiles(["/tmp/a.txt", "/tmp/folder"], "resume-screening")

    expect(result).toBe(importResult)
    expect(mockListFiles).toHaveBeenCalledWith("ws1")
    expect(useWorkspaceStore.getState().fileTree).toEqual(fileTree)
  })

  it("setCurrentWorkspace clears fileTree when switching workspaces", () => {
    const otherWorkspace: WorkspaceInfo = {
      ...workspace,
      id: "ws2",
      path: "~/SevenHROps/workspaces/other_ws2",
    }
    useWorkspaceStore.setState({ fileTree })

    useWorkspaceStore.getState().setCurrentWorkspace(otherWorkspace)

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws2")
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(otherWorkspace.path)
    expect(useWorkspaceStore.getState().fileTree).toEqual([])
  })
})

// ─── Session-Workspace Binding ────────────────────────────────────────

describe("workspaceStore — session-workspace binding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({
      currentWorkspaceId: null,
      currentWorkspacePath: null,
      fileTree: [],
      workspaceList: [workspace],
      sessionWorkspaceMap: {},
    })
  })

  it("bindSession adds sessionId → workspaceId mapping", () => {
    useWorkspaceStore.getState().bindSession("s1", "ws1")
    expect(useWorkspaceStore.getState().sessionWorkspaceMap).toEqual({ s1: "ws1" })
  })

  it("bindSession can bind multiple sessions independently", () => {
    useWorkspaceStore.getState().bindSession("s1", "ws1")
    useWorkspaceStore.getState().bindSession("s2", "ws2")
    expect(useWorkspaceStore.getState().sessionWorkspaceMap).toEqual({ s1: "ws1", s2: "ws2" })
  })

  it("unbindSession removes the sessionId from the map", () => {
    useWorkspaceStore.setState({ sessionWorkspaceMap: { s1: "ws1", s2: "ws2" } })
    useWorkspaceStore.getState().unbindSession("s1")
    expect(useWorkspaceStore.getState().sessionWorkspaceMap).toEqual({ s2: "ws2" })
  })

  it("unbindSession is a no-op for unknown sessionId", () => {
    useWorkspaceStore.setState({ sessionWorkspaceMap: { s1: "ws1" } })
    useWorkspaceStore.getState().unbindSession("non-existent")
    expect(useWorkspaceStore.getState().sessionWorkspaceMap).toEqual({ s1: "ws1" })
  })

  it("getWorkspaceBySession returns the workspace when bound", () => {
    useWorkspaceStore.setState({
      sessionWorkspaceMap: { s1: "ws1" },
      workspaceList: [workspace],
    })
    const result = useWorkspaceStore.getState().getWorkspaceBySession("s1")
    expect(result).toBe(workspace)
  })

  it("getWorkspaceBySession returns undefined when session has no binding", () => {
    const result = useWorkspaceStore.getState().getWorkspaceBySession("s-unknown")
    expect(result).toBeUndefined()
  })

  it("getWorkspaceBySession returns undefined when workspaceId is not in workspaceList", () => {
    useWorkspaceStore.setState({
      sessionWorkspaceMap: { s1: "ws-deleted" },
      workspaceList: [],
    })
    const result = useWorkspaceStore.getState().getWorkspaceBySession("s1")
    expect(result).toBeUndefined()
  })

  it("switchToSession switches to the bound workspace and loads files", async () => {
    mockListFiles.mockResolvedValue(fileTree)
    useWorkspaceStore.setState({
      sessionWorkspaceMap: { s1: "ws1" },
      workspaceList: [workspace],
    })

    useWorkspaceStore.getState().switchToSession("s1")

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws1")
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(workspace.path)
    expect(useWorkspaceStore.getState().fileTree).toEqual([]) // cleared immediately

    // Wait for async refreshFileTree
    await vi.waitFor(() => {
      expect(mockListFiles).toHaveBeenCalledWith("ws1")
    })
  })

  it("switchToSession calls clearActive when session has no workspace", () => {
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws1",
      currentWorkspacePath: workspace.path,
      fileTree,
      sessionWorkspaceMap: {},
    })

    useWorkspaceStore.getState().switchToSession("s-no-workspace")

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBeNull()
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBeNull()
    expect(useWorkspaceStore.getState().fileTree).toEqual([])
  })

  it("clearActive resets currentWorkspaceId, currentWorkspacePath and fileTree", () => {
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws1",
      currentWorkspacePath: workspace.path,
      fileTree,
    })

    useWorkspaceStore.getState().clearActive()

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBeNull()
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBeNull()
    expect(useWorkspaceStore.getState().fileTree).toEqual([])
  })
})
