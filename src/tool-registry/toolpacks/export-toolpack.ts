/**
 * export-toolpack — Phase B exposes `export_to_html`; Phase E adds `export_to_word`;
 * Phase F adds `export_to_pptx`.
 *
 * `export_to_html`: thin wrapper that delegates to `fs_write_text`.
 * `export_to_word`: calls the `export_docx` Tauri command (docx-rs backend).
 * `export_to_pptx`: generates PPTX via pptxgenjs (TS-side), writes binary via dispatcher.
 *
 * Spec: openspec/changes/phase-b-platform-foundation/specs/mcp-toolpacks/spec.md
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

const ExportHtml = z.object({
  path: z.string().min(1),
  html: z.string(),
})

const ExportWord = z.object({
  path: z.string().min(1),
  content: z.string(),
})

const SlideSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  notes: z.string().optional(),
})

const ExportPptx = z.object({
  path: z.string().min(1),
  slides: z.array(SlideSchema).min(1),
  theme: z.object({
    primaryColor: z.string().optional(),
    fontFamily: z.string().optional(),
  }).optional(),
})

/** Phase F: Maximum slides allowed per PPTX generation. */
const MAX_SLIDES = 50

export function register(toolRegistry: ToolRegistry): void {
  // ── export_to_html ────────────────────────────────────────────────────────
  toolRegistry.register(metaOf("export_to_html"), async (args, ctx) => {
    const r = ExportHtml.safeParse(args)
    if (!r.success) {
      throw new InvalidToolArgsError(
        "export_to_html",
        r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      )
    }
    return getDispatcher()("fs_write_text", {
      sessionId: ctx.sessionId,
      path: r.data.path,
      content: r.data.html,
    })
  })

  // ── export_to_word ────────────────────────────────────────────────────────
  toolRegistry.register(metaOf("export_to_word"), async (args, ctx) => {
    const r = ExportWord.safeParse(args)
    if (!r.success) {
      throw new InvalidToolArgsError(
        "export_to_word",
        r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      )
    }
    return getDispatcher()("export_docx", {
      sessionId: ctx.sessionId,
      path: r.data.path,
      content: r.data.content,
    })
  })

  // ── export_to_pptx (Phase F Task 3.2-3.3) ────────────────────────────────
  toolRegistry.register(metaOf("export_to_pptx"), async (args, ctx) => {
    const r = ExportPptx.safeParse(args)
    if (!r.success) {
      throw new InvalidToolArgsError(
        "export_to_pptx",
        r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      )
    }

    // Task 3.3: MAX_SLIDES_EXCEEDED check
    if (r.data.slides.length > MAX_SLIDES) {
      throw new Error(
        `MAX_SLIDES_EXCEEDED: requested ${r.data.slides.length} slides, maximum is ${MAX_SLIDES}`,
      )
    }

    // Dynamic import to avoid bundling pptxgenjs when not used
    const PptxGenJS = (await import("pptxgenjs")).default
    const pptx = new PptxGenJS()

    // Apply theme if provided
    if (r.data.theme?.fontFamily) {
      pptx.layout = "LAYOUT_WIDE"
    }

    for (const slide of r.data.slides) {
      const s = pptx.addSlide()
      if (slide.title) {
        s.addText(slide.title, {
          x: 0.5,
          y: 0.5,
          w: "90%",
          fontSize: 24,
          bold: true,
          color: r.data.theme?.primaryColor?.replace("#", "") ?? "363636",
        })
      }
      if (slide.body) {
        s.addText(slide.body, {
          x: 0.5,
          y: 1.5,
          w: "90%",
          h: "70%",
          fontSize: 14,
          color: "666666",
          valign: "top",
        })
      }
      if (slide.notes) {
        s.addNotes(slide.notes)
      }
    }

    // Generate as base64 and write via dispatcher
    const base64 = (await pptx.write({ outputType: "base64" })) as string
    return getDispatcher()("fs_write_binary_file", {
      sessionId: ctx.sessionId,
      path: r.data.path,
      contentBase64: base64,
    })
  })
}
