import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import yaml from "@modyfi/vite-plugin-yaml";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), yaml()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Phase B: legacy `@modelcontextprotocol/sdk` polyfills removed —
      // platform tools now go through `toolRegistry.invoke` + Tauri commands,
      // so cross-spawn / node:process / node:stream are no longer required.
    },
  },
  // Vitest configuration
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["src/**/*.integration.test.ts", "node_modules/**"],
    css: true,
    // Coverage thresholds — see doc/agent-architecture/18-测试策略.md §3.3.
    // Provider `v8` requires `@vitest/coverage-v8` (devDependency).
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/platform/**/*.ts"],
      exclude: [
        "src/platform/**/*.test.ts",
        "src/platform/__tests__/**",
        "src/platform/manifests/**",
      ],
      // Per-file thresholds. Files not listed here fall under the default
      // "lines / functions" thresholds set as a soft floor.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
        "src/platform/manifestSchema.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
        },
        "src/platform/manifestValidator.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
        },
        "src/platform/capabilityRegistry.ts": {
          lines: 90,
          functions: 90,
          statements: 90,
        },
        "src/platform/toolRegistry.ts": {
          lines: 90,
          functions: 90,
          statements: 90,
        },
        "src/platform/agentLoader.ts": {
          lines: 85,
          functions: 85,
          statements: 85,
        },
        "src/platform/skillLoader.ts": {
          lines: 85,
          functions: 85,
          statements: 85,
        },
      },
    },
  },
  // Phase B: Exclude Node.js-only MCP transport modules from the browser bundle.
  // `StdioClientTransport` (from @modelcontextprotocol/sdk/client/stdio) depends
  // on `node:stream` / `node:process` / `cross-spawn` which are not available in
  // the browser. In Tauri, local MCP server connections are managed on the Rust
  // side; the browser bundle only needs the HTTP/SSE transports.
  build: {
    rollupOptions: {
      external: [
        "@modelcontextprotocol/sdk/client/stdio.js",
        "@modelcontextprotocol/sdk/client/stdio",
        "cross-spawn",
        "node:stream",
        "node:process",
      ],
    },
  },
  optimizeDeps: {
    // Exclude Node.js-only modules from esbuild pre-bundling (dev mode).
    // `build.rollupOptions.external` only covers production builds;
    // `optimizeDeps.exclude` is required to prevent dev-mode crashes.
    exclude: [
      "@modelcontextprotocol/sdk/client/stdio",
      "@modelcontextprotocol/sdk/client/stdio.js",
      "cross-spawn",
      "which",
    ],
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5200,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 9001,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
