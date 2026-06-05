/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import yaml from "@modyfi/vite-plugin-yaml";
import path from "path";

/**
 * Vitest config for integration tests.
 *
 * Picks up only files matching `*.integration.test.ts` and runs them in a
 * jsdom environment so platform-foundation integration tests have access
 * to `window` and `document`. Unit tests continue to use the Vitest config
 * embedded in `vite.config.ts`.
 *
 * Run with:  pnpm test:integration
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
    include: ["src/**/*.integration.test.ts"],
    css: true,
  },
});
