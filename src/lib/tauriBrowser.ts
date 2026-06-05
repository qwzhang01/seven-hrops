import { invoke } from '@tauri-apps/api/core';

interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Type-safe wrapper around Tauri IPC commands for the native browser WebView.
 * All methods are no-ops when the WebView does not exist (idempotent on Rust side).
 */
export const tauriBrowser = {
  /**
   * Create (or re-use) the native browser WebView at the given logical-pixel rect.
   * If the WebView already exists, navigates to the new URL and shows it.
   */
  open(url: string, rect: BrowserRect): Promise<void> {
    return invoke('open_browser_webview', {
      url,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  },

  /** Navigate the existing WebView to a new URL. */
  navigate(url: string): Promise<void> {
    return invoke('navigate_browser', { url });
  },

  /** Reload the current page. */
  reload(): Promise<void> {
    return invoke('reload_browser_webview');
  },

  /** Resize and reposition the WebView to match a new rect (logical pixels). */
  resize(rect: BrowserRect): Promise<void> {
    return invoke('resize_browser_webview', {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  },

  /** Hide the WebView (page state preserved). */
  hide(): Promise<void> {
    return invoke('hide_browser_webview');
  },

  /** Show the WebView. */
  show(): Promise<void> {
    return invoke('show_browser_webview');
  },

  /** Destroy the WebView and release resources. */
  close(): Promise<void> {
    return invoke('close_browser_webview');
  },
};
