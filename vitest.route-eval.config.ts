/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import yaml from "@modyfi/vite-plugin-yaml";
import path from "path";

/**
 * Vitest config for route evaluation tests (@network).
 *
 * These tests call the real LLM to evaluate assistant routing accuracy.
 * They are excluded from the default `pnpm test` run and must be
 * triggered explicitly with `pnpm test:route-eval`.
 *
 * Requires a valid LLM API key in the environment.
 * CI: runs nightly (not on every PR).
 *
 * Run with:  pnpm test:route-eval
 */
export default defineConfig({
  plugins: [react(), yaml()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "cross-spawn": path.resolve(
        __dirname,
        "./src/agent-runtime/polyfills/cross-spawn.ts",
      ),
      "node:process": path.resolve(
        __dirname,
        "./src/agent-runtime/polyfills/node-process.ts",
      ),
      "node:stream": path.resolve(
        __dirname,
        "./src/agent-runtime/polyfills/node-stream.ts",
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["tests/route-eval/**/*.test.ts"],
    // Long timeout for LLM calls
    testTimeout: 120_000,
    css: false,
  },
});
