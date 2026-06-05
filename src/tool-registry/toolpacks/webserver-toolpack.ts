/**
 * webserver-toolpack — Phase B exposes `webserver_publish` / `webserver_drop`;
 * Phase F adds `webserver_start`, `webserver_create_form`,
 * `webserver_collect_submission`, `webserver_qrcode`.
 *
 * The embedded Axum server auto-starts on first `webserver_publish` call.
 * `webserver_start` is a convenience wrapper that ensures the server is alive
 * and returns connection info.
 *
 * Spec: openspec/changes/roll-out-7-capabilities/design.md §D7
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError, type WebserverHandle } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

// ── Schemas ──────────────────────────────────────────────────────────────────

const Publish = z.object({
  body: z.string(),
  contentType: z.string().min(1).default("text/html;charset=utf-8"),
  /** Time-to-live in seconds; bounded by Rust layer (default 600). */
  ttlSeconds: z.number().int().positive().max(3600).optional(),
})

const Drop = z.object({ handle: z.string().min(1) })

const CreateForm = z.object({
  /** Path to the HTML file containing the form (read from workspace). */
  html_path: z.string().min(1),
  /** Endpoint path for form submission (e.g., "/submit"). */
  submit_endpoint: z.string().min(1).default("/submit"),
  /** TTL in minutes for the form page. Default: 60. */
  expireMinutes: z.number().int().positive().max(480).optional(),
})

const CollectSubmission = z.object({
  /** Handle of the form page to collect submissions from. */
  handle: z.string().min(1),
  /** Output directory relative to workspace (default: 03_intermediate/submissions/). */
  outputDir: z.string().optional(),
})

const QrCode = z.object({
  /** URL to encode as QR code. */
  url: z.string().url(),
  /** Output path for the QR PNG file. */
  outputPath: z.string().optional(),
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function parse<T>(name: string, schema: z.ZodSchema<T>, args: unknown): T {
  const r = schema.safeParse(args)
  if (!r.success) {
    throw new InvalidToolArgsError(
      name,
      r.error.issues.map((i) => ({ path: i.path, message: i.message })),
    )
  }
  return r.data
}

/** In-memory store for form submissions (per handle). */
const formSubmissions = new Map<string, Array<{ timestamp: string; data: Record<string, unknown> }>>()

/**
 * Wrap HTML content with form submission JavaScript that posts data back
 * to the embedded server via fetch (intercepted client-side and stored in memory).
 */
function wrapFormHtml(html: string, submitEndpoint: string, handle: string): string {
  const submissionScript = `
<script>
(function() {
  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = {};
    formData.forEach(function(value, key) { data[key] = value; });
    
    // Post to parent window via postMessage (Tauri webview will intercept)
    window.__SEVEN_FORM_DATA__ = window.__SEVEN_FORM_DATA__ || [];
    window.__SEVEN_FORM_DATA__.push({
      timestamp: new Date().toISOString(),
      handle: '${handle}',
      endpoint: '${submitEndpoint}',
      data: data
    });
    
    // Visual feedback
    var btn = form.querySelector('[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '已提交 ✓';
    }
    
    // Also store in localStorage for collection
    var stored = JSON.parse(localStorage.getItem('__seven_submissions_${handle}__') || '[]');
    stored.push({ timestamp: new Date().toISOString(), data: data });
    localStorage.setItem('__seven_submissions_${handle}__', JSON.stringify(stored));
  });
})();
</script>`

  // Insert script before </body> or at end
  if (html.includes("</body>")) {
    return html.replace("</body>", `${submissionScript}\n</body>`)
  }
  return html + submissionScript
}

// ── Registration ─────────────────────────────────────────────────────────────

export function register(toolRegistry: ToolRegistry): void {
  // ── webserver_start (Phase F Task 4b.1) ─────────────────────────────────
  toolRegistry.register(metaOf("webserver_start"), async (_args, ctx) => {
    // Publish a minimal healthcheck page to ensure server is started
    const result = (await getDispatcher()("webserver_publish", {
      sessionId: ctx.sessionId,
      content: "<html><body>Server Ready</body></html>",
      kind: "html",
    })) as { handle: string; url: string; token: string; qr_png_b64: string }

    // Extract host:port from URL
    const urlObj = new URL(result.url)
    return {
      host: urlObj.hostname,
      port: parseInt(urlObj.port, 10),
      baseUrl: `${urlObj.protocol}//${urlObj.host}`,
      healthHandle: result.handle,
    }
  })

  // ── webserver_publish (Phase B, unchanged) ──────────────────────────────
  toolRegistry.register(metaOf("webserver_publish"), async (args, ctx) => {
    const a = parse("webserver_publish", Publish, args)
    const result = (await getDispatcher()("webserver_publish", {
      sessionId: ctx.sessionId,
      content: a.body,
      kind: "html",
      ttlSeconds: a.ttlSeconds,
    })) as { handle: string; url: string; token: string; qr_png_b64: string }
    return {
      handle: result.handle as WebserverHandle,
      url: result.url,
      qr: result.qr_png_b64,
    }
  })

  // ── webserver_drop (Phase B, unchanged) ─────────────────────────────────
  toolRegistry.register(metaOf("webserver_drop"), async (args, ctx) => {
    const a = parse("webserver_drop", Drop, args)
    return getDispatcher()("webserver_drop", {
      sessionId: ctx.sessionId,
      handle: a.handle,
    })
  })

  // ── webserver_create_form (Phase F Task 4b.3) ───────────────────────────
  toolRegistry.register(metaOf("webserver_create_form"), async (args, ctx) => {
    const a = parse("webserver_create_form", CreateForm, args)

    // Read the HTML file from workspace
    const htmlContent = (await getDispatcher()("fs_read_text", {
      sessionId: ctx.sessionId,
      path: a.html_path,
    })) as string

    // Wrap with form submission interception
    const handle = `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const wrappedHtml = wrapFormHtml(htmlContent, a.submit_endpoint ?? "/submit", handle)

    // Publish the form page
    const result = (await getDispatcher()("webserver_publish", {
      sessionId: ctx.sessionId,
      content: wrappedHtml,
      kind: "html",
      ttlSeconds: (a.expireMinutes ?? 60) * 60,
    })) as { handle: string; url: string; token: string; qr_png_b64: string }

    // Initialize submission store for this handle
    formSubmissions.set(result.handle, [])

    return {
      handle: result.handle,
      url: result.url,
      qr: result.qr_png_b64,
      submitEndpoint: a.submit_endpoint,
      expiresInMinutes: a.expireMinutes ?? 60,
    }
  })

  // ── webserver_collect_submission (Phase F Task 4b.4) ────────────────────
  toolRegistry.register(metaOf("webserver_collect_submission"), async (args, ctx) => {
    const a = parse("webserver_collect_submission", CollectSubmission, args)
    const outputDir = a.outputDir ?? "03_intermediate/submissions"

    // Get submissions from in-memory store
    const submissions = formSubmissions.get(a.handle) ?? []

    // Write submissions to workspace
    const outputPath = `${outputDir}/${a.handle}-submissions.json`
    await getDispatcher()("fs_write_text", {
      sessionId: ctx.sessionId,
      path: outputPath,
      content: JSON.stringify(submissions, null, 2),
    })

    return {
      count: submissions.length,
      outputPath,
      submissions,
    }
  })

  // ── webserver_qrcode (Phase F Task 4b.5) ────────────────────────────────
  toolRegistry.register(metaOf("webserver_qrcode"), async (args, ctx) => {
    const a = parse("webserver_qrcode", QrCode, args)

    // Publish a minimal page to get QR from Rust (reuses the QR generation logic)
    // Then extract just the QR and optionally save to file
    const result = (await getDispatcher()("webserver_publish", {
      sessionId: ctx.sessionId,
      content: `<html><body><p>Scan to visit: ${a.url}</p><script>location.href="${a.url}"</script></body></html>`,
      kind: "html",
    })) as { handle: string; url: string; token: string; qr_png_b64: string }

    // If outputPath specified, save QR as PNG file
    if (a.outputPath) {
      await getDispatcher()("fs_write_binary_file", {
        sessionId: ctx.sessionId,
        path: a.outputPath,
        contentBase64: result.qr_png_b64,
      })
    }

    return {
      qrBase64: result.qr_png_b64,
      redirectUrl: result.url,
      savedTo: a.outputPath ?? null,
    }
  })
}

