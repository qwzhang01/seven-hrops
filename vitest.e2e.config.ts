/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import yaml from "@modyfi/vite-plugin-yaml";
import path from "path";

/**
 * Vitest config for E2E tests.
 *
 * Picks up only files matching `tests/e2e/*.test.ts` and runs them in a
 * jsdom environment so E2E scenario tests have access to `window` and `document`.
 *
 * Run with:  pnpm test:e2e
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
    include: ["tests/e2e/**/*.test.ts"],
    exclude: ["node_modules/**"],
    css: true,
  },
});
