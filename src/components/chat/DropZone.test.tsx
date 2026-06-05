import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { DropZone } from "./DropZone"

type DragDropPayload =
  | { type: "enter" }
  | { type: "over" }
  | { type: "leave" }
  | { type: "drop"; paths: string[] }

let dragDropHandler: ((event: { payload: DragDropPayload }) => void) | undefined
const dispose = vi.fn()

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn((handler: typeof dragDropHandler) => {
      dragDropHandler = handler
      return Promise.resolve(dispose)
    }),
  }),
}))

describe("DropZone", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dragDropHandler = undefined
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws1",
      currentWorkspacePath: "/workspace",
      fileTree: [],
      workspaceList: [],
    })
  })

  it("renders children", () => {
    render(
      <DropZone>
        <div>Chat content</div>
      </DropZone>,
    )

    expect(screen.getByText("Chat content")).toBeInTheDocument()
  })

  it("shows and hides drag overlay from Tauri drag events", async () => {
    render(
      <DropZone>
        <div>Chat content</div>
      </DropZone>,
    )

    await waitFor(() => expect(dragDropHandler).toBeDefined())

    act(() => {
      dragDropHandler?.({ payload: { type: "enter" } })
    })
    expect(screen.getByText("释放以上传文件")).toBeInTheDocument()

    act(() => {
      dragDropHandler?.({ payload: { type: "leave" } })
    })
    expect(screen.queryByText("释放以上传文件")).toBeNull()
  })

  it("imports dropped paths into the current workspace", async () => {
    const importInputFiles = vi.fn().mockResolvedValue({
      successes: [{ sourcePath: "/tmp/resume.pdf", targetPath: "/workspace/01_inputs/resume.pdf", fileName: "resume.pdf" }],
      failures: [],
      successCount: 1,
      failureCount: 0,
    })
    useWorkspaceStore.setState({ importInputFiles })

    render(
      <DropZone capabilityId="resume-screening">
        <div>Chat content</div>
      </DropZone>,
    )

    await waitFor(() => expect(dragDropHandler).toBeDefined())

    await act(async () => {
      dragDropHandler?.({ payload: { type: "drop", paths: ["/tmp/resume.pdf"] } })
    })

    await waitFor(() => {
      expect(importInputFiles).toHaveBeenCalledWith(["/tmp/resume.pdf"], "resume-screening")
      expect(screen.getByText("已导入 1 个文件到 01_inputs/")).toBeInTheDocument()
    })
  })

  it("passes capabilityId to workspaceStore when dropping files without current workspace", async () => {
    const importInputFiles = vi.fn().mockResolvedValue({
      successes: [{ sourcePath: "/tmp/resume.pdf", targetPath: "/workspace/new/01_inputs/resume.pdf", fileName: "resume.pdf" }],
      failures: [],
      successCount: 1,
      failureCount: 0,
    })
    useWorkspaceStore.setState({
      currentWorkspaceId: null,
      currentWorkspacePath: null,
      importInputFiles,
    })

    render(
      <DropZone capabilityId="resume-screening">
        <div>Chat content</div>
      </DropZone>,
    )

    await waitFor(() => expect(dragDropHandler).toBeDefined())

    await act(async () => {
      dragDropHandler?.({ payload: { type: "drop", paths: ["/tmp/resume.pdf"] } })
    })

    await waitFor(() => {
      expect(importInputFiles).toHaveBeenCalledWith(["/tmp/resume.pdf"], "resume-screening")
    })
  })

  it("shows an explicit error for empty dropped paths", async () => {
    render(
      <DropZone>
        <div>Chat content</div>
      </DropZone>,
    )

    await waitFor(() => expect(dragDropHandler).toBeDefined())

    await act(async () => {
      dragDropHandler?.({ payload: { type: "drop", paths: [] } })
    })

    expect(screen.getByRole("alert")).toHaveTextContent("没有收到可导入的文件路径")
  })

  it("shows a structured import failure message", async () => {
    const importInputFiles = vi.fn().mockResolvedValue({
      successes: [],
      failures: [
        {
          sourcePath: "/tmp/folder",
          fileName: "folder",
          code: "DIRECTORY_NOT_SUPPORTED",
          message: "暂不支持目录上传，请选择普通文件",
        },
      ],
      successCount: 0,
      failureCount: 1,
    })
    useWorkspaceStore.setState({ importInputFiles })

    render(
      <DropZone>
        <div>Chat content</div>
      </DropZone>,
    )

    await waitFor(() => expect(dragDropHandler).toBeDefined())

    await act(async () => {
      dragDropHandler?.({ payload: { type: "drop", paths: ["/tmp/folder"] } })
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("文件导入失败：暂不支持目录上传，请选择普通文件")
    })
  })
})
