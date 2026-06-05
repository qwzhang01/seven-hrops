/**
 * Skill Sync Service — Task 2.8
 * Syncs skill favorite state across multiple browser tabs/windows
 * using BroadcastChannel API (same-origin, no server needed).
 */

const CHANNEL_NAME = 'seven-hrops-skill-sync';
const STORAGE_KEY = 'seven-hrops-skill-favorites';

type SyncMessage =
  | { type: 'TOGGLE_FAVORITE'; skillId: string; isFavorited: boolean }
  | { type: 'SYNC_REQUEST' }
  | { type: 'SYNC_RESPONSE'; favorites: Record<string, boolean> };

type FavoriteChangeHandler = (skillId: string, isFavorited: boolean) => void;

class SkillSyncService {
  private channel: BroadcastChannel | null = null;
  private handlers: Set<FavoriteChangeHandler> = new Set();
  private isSupported: boolean;

  constructor() {
    this.isSupported = typeof BroadcastChannel !== 'undefined';
  }

  /** Initialize the sync channel */
  init(): void {
    if (!this.isSupported) return;
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<SyncMessage>) => {
        this.handleMessage(event.data);
      };
      // Request current state from other tabs
      this.channel.postMessage({ type: 'SYNC_REQUEST' } satisfies SyncMessage);
    } catch {
      // BroadcastChannel may fail in some environments
    }
  }

  /** Destroy the sync channel */
  destroy(): void {
    this.channel?.close();
    this.channel = null;
    this.handlers.clear();
  }

  /** Broadcast a favorite toggle to other tabs */
  broadcastToggle(skillId: string, isFavorited: boolean): void {
    if (!this.channel) return;
    // Persist to localStorage for new tabs
    this.persistFavorite(skillId, isFavorited);
    this.channel.postMessage({
      type: 'TOGGLE_FAVORITE',
      skillId,
      isFavorited,
    } satisfies SyncMessage);
  }

  /** Subscribe to favorite changes from other tabs */
  onFavoriteChange(handler: FavoriteChangeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Load persisted favorites from localStorage */
  loadPersistedFavorites(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch { /* ignore */ }
    return {};
  }

  private persistFavorite(skillId: string, isFavorited: boolean): void {
    try {
      const current = this.loadPersistedFavorites();
      current[skillId] = isFavorited;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch { /* ignore */ }
  }

  private handleMessage(msg: SyncMessage): void {
    switch (msg.type) {
      case 'TOGGLE_FAVORITE':
        // Notify all handlers (workspaceStore will update its state)
        this.handlers.forEach((h) => h(msg.skillId, msg.isFavorited));
        this.persistFavorite(msg.skillId, msg.isFavorited);
        break;

      case 'SYNC_REQUEST':
        // Respond with current favorites
        if (this.channel) {
          const favorites = this.loadPersistedFavorites();
          this.channel.postMessage({
            type: 'SYNC_RESPONSE',
            favorites,
          } satisfies SyncMessage);
        }
        break;

      case 'SYNC_RESPONSE':
        // Apply received favorites to all handlers
        Object.entries(msg.favorites).forEach(([skillId, isFavorited]) => {
          this.handlers.forEach((h) => h(skillId, isFavorited));
        });
        break;
    }
  }
}

// Singleton instance
export const skillSyncService = new SkillSyncService();
