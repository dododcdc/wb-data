import { useCallback } from 'react';
import type { FlowDraftSession } from './flowDraftController';
import type { OpenFlowDocumentOptions } from './useFlowEditingSession';

export interface UseOfflineWorkbenchNavigationParams {
    groupId: number | null;
    draftSession: FlowDraftSession | null;
    isDirty: boolean;
    openFlowDocumentFromSession: (path: string, options?: OpenFlowDocumentOptions) => Promise<boolean>;
    flushDraft: () => Promise<boolean>;
}

// 自动保存模型下，切换任务不再弹「未保存的更改」拦截：
// 切换前对当前草稿做 best-effort 强制 flush；flush 失败也不阻断
// （recovery snapshot 会保留本地修改，回来后自动保存会重试）。
export function useOfflineWorkbenchNavigation(params: UseOfflineWorkbenchNavigationParams) {
    const {
        groupId,
        draftSession,
        isDirty,
        openFlowDocumentFromSession,
        flushDraft,
    } = params;

    const openFlowDocument = useCallback(async (pathValue: string, options?: OpenFlowDocumentOptions) => {
        if (!groupId) return false;
        const normalizedPath = pathValue.trim();
        if (!normalizedPath) {
            return false;
        }

        const isSwitchingFlow = Boolean(draftSession && draftSession.path !== normalizedPath);
        if (isSwitchingFlow && isDirty && !options?.force && !options?.canLeaveDirty) {
            await flushDraft();
        }

        return openFlowDocumentFromSession(normalizedPath, {
            ...options,
            canLeaveDirty: true,
        });
    }, [draftSession, flushDraft, groupId, isDirty, openFlowDocumentFromSession]);

    return { openFlowDocument };
}
