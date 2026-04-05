/**
 * Query 页面键盘快捷键 hook
 * 统一的键盘事件处理
 */

import { useEffect } from 'react';

export interface UseKeyboardShortcutsOptions {
  /** 切换侧边栏 */
  onToggleSidebar?: () => void;
  /** 切换结果面板 */
  onToggleResultPanel?: () => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  const { onToggleSidebar, onToggleResultPanel } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + B: toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        onToggleSidebar?.();
        return;
      }

      // Cmd/Ctrl + J: toggle result panel
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onToggleResultPanel?.();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onToggleSidebar, onToggleResultPanel]);
}
