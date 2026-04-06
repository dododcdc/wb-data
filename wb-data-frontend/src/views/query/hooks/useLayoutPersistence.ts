/**
 * Query 页面布局状态持久化 hook
 * 集中管理 sidebar、result panel 的 localStorage 读写
 */

import { useState, useCallback, useRef, useMemo } from 'react';

// ==================== 常量 ====================

export const SIDEBAR_DEFAULT_WIDTH_PX = 300;
export const SIDEBAR_MIN_WIDTH_PX = 250;
export const SIDEBAR_MAX_WIDTH_PX = 600;
export const QUERY_MAIN_MIN_WIDTH_PX = 600;
export const QUERY_MAIN_DEFAULT_WIDTH_PX = 1100;
export const QUERY_EDITOR_DEFAULT_HEIGHT_PX = 520;
export const QUERY_EDITOR_MIN_HEIGHT_PX = 220;
export const RESULT_PANEL_COLLAPSED_HEIGHT_PX = 44;
export const RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX = RESULT_PANEL_COLLAPSED_HEIGHT_PX;
export const RESULT_PANEL_DEFAULT_HEIGHT_PX = 320;
export const SIDEBAR_TOGGLE_TRANSITION_MS = 160;


// ==================== 工具函数 ====================

function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) {
    return SIDEBAR_DEFAULT_WIDTH_PX;
  }
  return Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, Math.round(width)));
}

function parseStoredSidebarWidth(rawWidth: unknown) {
  const width = Number(rawWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return clampSidebarWidth(width);
}

function parseStoredPositiveNumber(rawValue: unknown) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function getStoredSidebarCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return saved !== 'false'; // 默认隐藏
  } catch {
    return true;
  }
}

function getStoredSidebarExpandedWidth(): number {
  try {
    const savedWidth = localStorage.getItem(SIDEBAR_EXPANDED_WIDTH_STORAGE_KEY);
    if (savedWidth) {
      const parsedWidth = parseStoredSidebarWidth(savedWidth);
      if (parsedWidth !== null) {
        return parsedWidth;
      }
    }

    // 兼容旧格式
    const legacySizes = localStorage.getItem(LEGACY_SIDEBAR_SIZE_STORAGE_KEY);
    if (legacySizes) {
      const parsed = JSON.parse(legacySizes);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const parsedWidth = parseStoredSidebarWidth(parsed[0]);
        if (parsedWidth !== null) {
          return parsedWidth;
        }
      }
    }
  } catch {
    // Ignore
  }
  return SIDEBAR_DEFAULT_WIDTH_PX;
}

function getStoredResultCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(RESULT_PANEL_COLLAPSED_STORAGE_KEY);
    return saved !== 'false';
  } catch {
    return true;
  }
}

function getStoredResultAutoOpen(): boolean {
  try {
    const saved = localStorage.getItem(RESULT_PANEL_AUTO_OPEN_STORAGE_KEY);
    return saved !== 'false';
  } catch {
    return true;
  }
}

function getStoredResultExpandedHeight(): number {
  try {
    const savedHeight = localStorage.getItem(RESULT_PANEL_EXPANDED_HEIGHT_STORAGE_KEY);
    if (savedHeight) {
      const parsedHeight = parseStoredPositiveNumber(savedHeight);
      if (parsedHeight !== null) {
        return Math.max(RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX, parsedHeight);
      }
    }

    // 兼容旧格式
    const legacySizes = localStorage.getItem(LEGACY_EDITOR_SIZE_STORAGE_KEY);
    if (legacySizes) {
      const parsed = JSON.parse(legacySizes);
      if (Array.isArray(parsed) && parsed.length === 2) {
        const legacyHeight = Number(parsed[1]);
        if (Number.isFinite(legacyHeight) && legacyHeight >= RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX) {
          return Math.round(legacyHeight);
        }
      }
    }
  } catch {
    // Ignore
  }
  return RESULT_PANEL_DEFAULT_HEIGHT_PX;
}

// ==================== 尺寸计算 ====================

export function getHorizontalSizes(sidebarCollapsed: boolean, sidebarExpandedWidth: number, totalWidth?: number): [number, number] {
  const resolvedTotalWidth = Number.isFinite(totalWidth) && totalWidth && totalWidth > 0
    ? totalWidth
    : QUERY_MAIN_DEFAULT_WIDTH_PX;

  if (sidebarCollapsed) {
    return [0, resolvedTotalWidth];
  }

  const maxSidebarWidth = Math.max(0, resolvedTotalWidth - QUERY_MAIN_MIN_WIDTH_PX);
  const nextSidebarWidth = Math.min(clampSidebarWidth(sidebarExpandedWidth), maxSidebarWidth);
  const nextMainWidth = Math.max(QUERY_MAIN_MIN_WIDTH_PX, resolvedTotalWidth - nextSidebarWidth);

  return [nextSidebarWidth, nextMainWidth];
}

export function getVerticalSizes(resultCollapsed: boolean, resultExpandedHeight: number, totalHeight?: number): [number, number] {
  const resolvedTotalHeight = Number.isFinite(totalHeight) && totalHeight && totalHeight > 0
    ? totalHeight
    : QUERY_EDITOR_DEFAULT_HEIGHT_PX + RESULT_PANEL_DEFAULT_HEIGHT_PX;

  if (resultCollapsed) {
    return [
      Math.max(0, resolvedTotalHeight - RESULT_PANEL_COLLAPSED_HEIGHT_PX),
      RESULT_PANEL_COLLAPSED_HEIGHT_PX,
    ];
  }

  const maxResultHeight = Math.max(
    RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX,
    resolvedTotalHeight - QUERY_EDITOR_MIN_HEIGHT_PX,
  );
  const nextResultHeight = Math.min(
    Math.max(RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX, Math.round(resultExpandedHeight)),
    maxResultHeight,
  );
  const nextEditorHeight = Math.max(QUERY_EDITOR_MIN_HEIGHT_PX, resolvedTotalHeight - nextResultHeight);

  return [nextEditorHeight, nextResultHeight];
}

// ==================== Hook ====================

export interface UseLayoutPersistenceOptions {
  /** sidebar 默认宽度 */
  sidebarDefaultWidth?: number;
  /** result panel 默认高度 */
  resultDefaultHeight?: number;
}

export interface UseLayoutPersistenceReturn {
  // State
  sidebarCollapsed: boolean;
  sidebarExpandedWidth: number;
  sidebarTransitioning: boolean;
  resultCollapsed: boolean;
  resultExpandedHeight: number;
  resultAutoOpen: boolean;
  resultTransitioning: boolean;

  // Layout sizes (computed)
  horizontalSizes: [number, number];
  verticalSizes: [number, number];

  // Actions
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleResultPanel: () => void;
  setResultPanelState: (collapsed: boolean, options?: { manual?: boolean }) => void;
  setResultExpandedHeight: (height: number) => void;
}

export function useLayoutPersistence(options: UseLayoutPersistenceOptions = {}): UseLayoutPersistenceReturn {
  const { sidebarDefaultWidth = SIDEBAR_DEFAULT_WIDTH_PX, resultDefaultHeight = RESULT_PANEL_DEFAULT_HEIGHT_PX } = options;

  // State
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [sidebarExpandedWidth, setSidebarExpandedWidth] = useState(() => {
    const stored = getStoredSidebarExpandedWidth();
    return stored !== SIDEBAR_DEFAULT_WIDTH_PX ? stored : sidebarDefaultWidth;
  });
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false);
  const [resultCollapsed, setResultCollapsed] = useState(getStoredResultCollapsed);
  const [resultExpandedHeight, setResultExpandedHeightState] = useState(() => {
    const stored = getStoredResultExpandedHeight();
    return stored !== RESULT_PANEL_DEFAULT_HEIGHT_PX ? stored : resultDefaultHeight;
  });
  const [resultAutoOpen, setResultAutoOpen] = useState(getStoredResultAutoOpen);
  const [resultTransitioning, setResultTransitioning] = useState(false);

  // Refs for timers
  const sidebarTransitionTimerRef = useRef<number | null>(null);
  const resultTransitionTimerRef = useRef<number | null>(null);

  // Persist functions
  const persistSidebarCollapsed = useCallback((collapsed: boolean) => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // Ignore
    }
  }, []);

  const persistSidebarExpandedWidth = useCallback((width: number) => {
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_WIDTH_STORAGE_KEY, String(width));
      localStorage.removeItem(LEGACY_SIDEBAR_SIZE_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const persistResultCollapsed = useCallback((collapsed: boolean) => {
    try {
      localStorage.setItem(RESULT_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // Ignore
    }
  }, []);

  const persistResultExpandedHeight = useCallback((height: number) => {
    try {
      localStorage.setItem(RESULT_PANEL_EXPANDED_HEIGHT_STORAGE_KEY, String(height));
      localStorage.removeItem(LEGACY_EDITOR_SIZE_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const persistResultAutoOpen = useCallback((autoOpen: boolean) => {
    try {
      localStorage.setItem(RESULT_PANEL_AUTO_OPEN_STORAGE_KEY, String(autoOpen));
    } catch {
      // Ignore
    }
  }, []);

  // Transitions
  const startSidebarTransition = useCallback(() => {
    if (sidebarTransitionTimerRef.current !== null) {
      window.clearTimeout(sidebarTransitionTimerRef.current);
    }
    setSidebarTransitioning(true);
    sidebarTransitionTimerRef.current = window.setTimeout(() => {
      setSidebarTransitioning(false);
      sidebarTransitionTimerRef.current = null;
    }, SIDEBAR_TOGGLE_TRANSITION_MS + 40);
  }, []);

  const startResultTransition = useCallback(() => {
    if (resultTransitionTimerRef.current !== null) {
      window.clearTimeout(resultTransitionTimerRef.current);
    }
    setResultTransitioning(true);
    resultTransitionTimerRef.current = window.setTimeout(() => {
      setResultTransitioning(false);
      resultTransitionTimerRef.current = null;
    }, SIDEBAR_TOGGLE_TRANSITION_MS + 40);
  }, []);

  // Actions
  const toggleSidebar = useCallback(() => {
    startSidebarTransition();
    setSidebarCollapsed(prev => {
      const next = !prev;
      persistSidebarCollapsed(next);
      return next;
    });
  }, [persistSidebarCollapsed, startSidebarTransition]);

  const setSidebarWidth = useCallback((width: number) => {
    const clamped = clampSidebarWidth(width);
    setSidebarExpandedWidth(clamped);
    persistSidebarExpandedWidth(clamped);
  }, [persistSidebarExpandedWidth]);

  const setResultPanelState = useCallback((collapsed: boolean, { manual = false }: { manual?: boolean } = {}) => {
    setResultCollapsed(current => current === collapsed ? current : collapsed);
    persistResultCollapsed(collapsed);

    if (manual) {
      const nextAutoOpen = !collapsed;
      setResultAutoOpen(nextAutoOpen);
      persistResultAutoOpen(nextAutoOpen);
    }
  }, [persistResultCollapsed, persistResultAutoOpen]);

  const toggleResultPanel = useCallback(() => {
    startResultTransition();
    setResultPanelState(!resultCollapsed, { manual: true });
  }, [resultCollapsed, setResultPanelState, startResultTransition]);

  const handleSetResultExpandedHeight = useCallback((height: number) => {
    setResultExpandedHeightState(height);
    persistResultExpandedHeight(height);
  }, [persistResultExpandedHeight]);

  // Computed
  const horizontalSizes = useMemo(
    () => getHorizontalSizes(sidebarCollapsed, sidebarExpandedWidth),
    [sidebarCollapsed, sidebarExpandedWidth]
  );

  const verticalSizes = useMemo(
    () => getVerticalSizes(resultCollapsed, resultExpandedHeight),
    [resultCollapsed, resultExpandedHeight]
  );

  return {
    // State
    sidebarCollapsed,
    sidebarExpandedWidth,
    sidebarTransitioning,
    resultCollapsed,
    resultExpandedHeight,
    resultAutoOpen,
    resultTransitioning,

    // Layout sizes
    horizontalSizes,
    verticalSizes,

    // Actions
    toggleSidebar,
    setSidebarWidth,
    toggleResultPanel,
    setResultPanelState,
    setResultExpandedHeight: handleSetResultExpandedHeight,
  };
}
