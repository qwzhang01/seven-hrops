import { useEffect } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { useCapabilityStore } from '@/stores/capabilityStore';
import { useSessionStore } from '@/stores/sessionStore';
import { initPerformanceMonitor } from '@/utils/performanceMonitor';
import { WorkspacePage } from '@/pages/WorkspacePage';

/**
 * App — root component.
 *
 * Responsibilities:
 *   - One-time initialization (email accounts, capabilities, sessions)
 *   - Set default capability to 'assistant' (智能助手)
 *   - Render WorkspacePage as the sole UI entry point
 *
 * DB initialization is now handled on the Rust side
 * inside `tauri::Builder::setup()` (see `src-tauri/src/db/connection.rs`).
 */
function App() {
  useEffect(() => {
    initPerformanceMonitor();

    const init = async () => {
      try {
        await useEmailStore.getState().loadAccounts();
        
        // Load capabilities
        useCapabilityStore.getState().loadCapabilities();
        
        // Phase 6.4: Set default capability to 'assistant' (智能助手)
        // Only set if no capability was previously active (persisted state)
        const { activeCapabilityId, activateCapability } = useCapabilityStore.getState();
        if (!activeCapabilityId) {
          // Default to assistant capability
          activateCapability('assistant');
        }
        
        // Load sessions for the session list
        await useSessionStore.getState().refreshSessionList();
        
        console.info('[App] Initialized successfully');
      } catch (err) {
        console.warn('[App] Initialization warning:', err);
      }
    };
    init();
  }, []);

  return <WorkspacePage />;
}

export default App;
