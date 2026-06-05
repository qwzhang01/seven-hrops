import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { bootstrapPlatform } from "./platform/bootstrap";
import { loadRuntimeConfig } from "./platform/runtimeConfig";
import { useAIStore } from "./stores/aiStore";
import { PlatformBootError } from "./components/PlatformBootError";
import { setupWecomListener } from "./services/orchestratorBridge";
import { runMigrations } from "./services/migration";

const rootElement = document.getElementById("root") as HTMLElement;
const root = ReactDOM.createRoot(rootElement);

// Render a loading placeholder immediately so the user sees something
// while bootstrapPlatform() initialises the Effect runtime + manifests.
root.render(
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "var(--color-bg-base, #0f0f0f)",
      color: "var(--color-text-secondary, #888)",
      fontSize: 14,
      fontFamily: "system-ui, sans-serif",
      letterSpacing: "0.04em",
    }}
  >
    Loading…
  </div>,
);

const tryBoot = async (): Promise<void> => {
  // Pull the (possibly persisted) user model config from zustand BEFORE
  // bootstrap, so the runtime is built with the correct provider/key
  // from the very first call. aiStore is hydrated synchronously by
  // zustand-persist, so getState() here already reflects what the user
  // configured last session.
  const modelConfig = useAIStore.getState().modelConfig;
  const runtimeConfig = loadRuntimeConfig(modelConfig);

  await bootstrapPlatform({ runtimeConfig });

  // Task 6.4: Register wecom-inbound Tauri event listener (no-op in browser dev).
  void setupWecomListener();

  // Phase 7.1: Run data migrations (localStorage → SQLite)
  await runMigrations();

  // Mark the store as connected once bootstrap succeeds. This used to
  // be aiStore's own initializeRuntime job; now bootstrap is the
  // single source of truth and aiStore just reflects its outcome.
  useAIStore.getState().setConnectionStatus("connected");

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

const renderBootstrapFailure = (error: unknown): void => {
  // eslint-disable-next-line no-console
  console.error("[bootstrap] platform foundation failed to load:", error);
  useAIStore.getState().setConnectionStatus("disconnected");
  root.render(
    <PlatformBootError
      error={error}
      onRetry={() => {
        // Render an empty placeholder while we retry so the UI doesn't
        // freeze on the previous error message.
        root.render(<div style={{ padding: 32 }}>正在重试…</div>);
        void tryBoot().catch(renderBootstrapFailure);
      }}
    />,
  );
};

void tryBoot().catch(renderBootstrapFailure);
