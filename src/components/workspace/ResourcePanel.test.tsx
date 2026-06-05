import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useLayoutStore } from "@/stores/layoutStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { ResourcePanel } from "./ResourcePanel"

describe("ResourcePanel", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      currentWorkspaceId: null,
      currentWorkspacePath: null,
      fileTree: [],
      workspaceList: [],
      sessionWorkspaceMap: {},
    })
  })

  // ── Task 8.3: session-workspace-binding empty state tests ──────────

  it("shows 'no workspace' empty state when currentWorkspaceId is null", () => {
    // currentWorkspaceId is null (session has no workspace)
    useWorkspaceStore.setState({ currentWorkspaceId: null, fileTree: [] })
    render(<ResourcePanel />)

    expect(screen.getByText("当前会话无需工作空间")).toBeInTheDocument()
    expect(screen.getByText("这是一个纯对话会话")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "刷新文件树" })).toBeDisabled()
  })

  it("shows 'no files yet' empty state when workspace exists but fileTree is empty", () => {
    // Has workspace but no files yet
    useWorkspaceStore.setState({ currentWorkspaceId: "ws1", fileTree: [] })
    render(<ResourcePanel />)

    expect(screen.getByText("暂无文件")).toBeInTheDocument()
    expect(screen.queryByText("当前会话无需工作空间")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "刷新文件树" })).not.toBeDisabled()
  })

  it("renders an empty state when fileTree is empty (legacy: no workspace)", () => {
    render(<ResourcePanel />)

    expect(screen.getByText("文件")).toBeInTheDocument()
    expect(screen.getByText("当前会话无需工作空间")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "刷新文件树" })).toBeDisabled()
  })

  it("renders files from workspaceStore", () => {
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws1",
      fileTree: [
        {
          name: "01_inputs",
          path: "/workspace/01_inputs",
          type: "directory",
          children: [
            {
              name: "resume.pdf",
              path: "/workspace/01_inputs/resume.pdf",
              type: "file",
            },
          ],
        },
      ],
    })

    render(<ResourcePanel />)

    expect(screen.getByText("01_inputs")).toBeInTheDocument()
    
    // Directory is collapsed by default, click to expand
    fireEvent.click(screen.getByText("01_inputs"))
    
    expect(screen.getByText("resume.pdf")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "刷新文件树" })).not.toBeDisabled()
  })

  it("switches from no-workspace state to file tree when workspace is set", () => {
    // Start with no workspace
    useWorkspaceStore.setState({ currentWorkspaceId: null, fileTree: [] })
    const { rerender } = render(<ResourcePanel />)
    expect(screen.getByText("当前会话无需工作空间")).toBeInTheDocument()

    // Switch to a workspace with files
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws1",
      fileTree: [{ name: "report.html", path: "/ws/report.html", type: "file" }],
    })
    rerender(<ResourcePanel />)

    expect(screen.queryByText("当前会话无需工作空间")).not.toBeInTheDocument()
    expect(screen.getByText("report.html")).toBeInTheDocument()
  })

  it("opens the content viewer when clicking a file", () => {
    const openContentViewer = vi.spyOn(useLayoutStore.getState(), "openContentViewer")
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws1",
      fileTree: [
        {
          name: "screening.html",
          path: "/workspace/04_reports/screening.html",
          type: "file",
        },
      ],
    })

    render(<ResourcePanel />)
    fireEvent.click(screen.getByText("screening.html"))

    expect(openContentViewer).toHaveBeenCalledWith({
      id: "output-/workspace/04_reports/screening.html",
      type: "output",
      title: "screening.html",
      outputId: "/workspace/04_reports/screening.html",
    }, window.innerWidth)
  })
})
