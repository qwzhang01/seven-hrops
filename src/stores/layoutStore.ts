import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NavItemId, ContentViewerTab } from '@/types/workspace';

// --- Constants ---
const DEFAULT_LEFT_PANEL_WIDTH = 240;
const MIN_PANEL_RATIO = 0.2; // 1/5 of total width

// --- State Interface ---
interface LayoutState {
  // Panel widths
  leftPanelWidth: number;
  contentViewerWidth: number;
  isLeftPanelCollapsed: boolean;
  isContentViewerHidden: boolean;

  // Navigation
  activeNavItem: NavItemId;

  // Content viewer tabs
  contentViewerTabs: ContentViewerTab[];
  activeContentTabId: string | null;

  // Actions — Panel widths
  setLeftPanelWidth: (width: number) => void;
  setContentViewerWidth: (width: number) => void;
  toggleLeftPanel: () => void;
  resetWidths: () => void;

  // Actions — Content viewer
  openContentViewer: (tab: ContentViewerTab, totalWidth: number) => void;
  closeContentViewer: () => void;
  showContentViewer: () => void;
  closeContentTab: (tabId: string) => void;
  setActiveContentTab: (tabId: string) => void;

  // Actions — Navigation
  setActiveNavItem: (item: NavItemId) => void;
}

// --- Store ---
export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      // Initial state
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      contentViewerWidth: 480,
      isLeftPanelCollapsed: false,
      isContentViewerHidden: false, // default: right panel open (contains file tree + preview)
      activeNavItem: null,
      contentViewerTabs: [],
      activeContentTabId: null,

      // --- Panel width actions ---
      setLeftPanelWidth: (width) => set({ leftPanelWidth: width }),

      setContentViewerWidth: (width) => set({ contentViewerWidth: width }),

      toggleLeftPanel: () =>
        set((state) => ({ isLeftPanelCollapsed: !state.isLeftPanelCollapsed })),

      resetWidths: () =>
        set({
          leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
          contentViewerWidth: 0,
          isContentViewerHidden: false,
        }),

      // --- Content viewer actions ---
      openContentViewer: (tab, totalWidth) => {
        set((state) => {
          const availableWidth = totalWidth - state.leftPanelWidth - 8;
          const newContentWidth = Math.floor(availableWidth * 0.5);
          const minWidth = Math.floor(totalWidth * MIN_PANEL_RATIO);
          const resolvedWidth = state.contentViewerWidth > 0
            ? state.contentViewerWidth
            : Math.max(newContentWidth, minWidth);

          // Tab already exists — just activate it
          const existingTab = state.contentViewerTabs.find((t) => t.id === tab.id);
          if (existingTab) {
            return {
              activeContentTabId: tab.id,
              isContentViewerHidden: false,
              contentViewerWidth: resolvedWidth,
            };
          }

          return {
            contentViewerTabs: [...state.contentViewerTabs, tab],
            activeContentTabId: tab.id,
            isContentViewerHidden: false,
            contentViewerWidth: resolvedWidth,
          };
        });
      },

      closeContentViewer: () =>
        set({ isContentViewerHidden: true }),

      showContentViewer: () =>
        set({ isContentViewerHidden: false }),

      closeContentTab: (tabId) => {
        set((state) => {
          const remaining = state.contentViewerTabs.filter((t) => t.id !== tabId);
          const newActiveId =
            state.activeContentTabId === tabId
              ? (remaining[remaining.length - 1]?.id ?? null)
              : state.activeContentTabId;
          const noTabsLeft = remaining.length === 0;
          return {
            contentViewerTabs: remaining,
            activeContentTabId: newActiveId,
            isContentViewerHidden: noTabsLeft ? true : state.isContentViewerHidden,
            contentViewerWidth: noTabsLeft ? 0 : state.contentViewerWidth,
          };
        });
      },

      setActiveContentTab: (tabId) => set({ activeContentTabId: tabId }),

      // --- Navigation actions ---
      setActiveNavItem: (item) => set({ activeNavItem: item }),
    }),
    {
      name: 'layout-store',
      partialize: (state) => ({
        leftPanelWidth: state.leftPanelWidth,
        contentViewerWidth: state.contentViewerWidth,
        isLeftPanelCollapsed: state.isLeftPanelCollapsed,
        isContentViewerHidden: state.isContentViewerHidden,
      }),
    }
  )
);
