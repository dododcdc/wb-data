import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getOfflineRepoTree, type OfflineFlowDocument, type OfflineRepoTreeResponse } from '../../../api/offline';
import { useAuthStore } from '../../../utils/auth';
import { indexNodesByTreePath, prependRecentFlowPath, updateRepoTreeFlowStatus } from './repoTreePaths';

interface UseOfflineRepoTreeParams {
    groupId: number | null;
    savedDocument?: OfflineFlowDocument;
    showError: (error: unknown, title: string, fallbackDetail?: string) => void;
}

export function useOfflineRepoTree({
    groupId,
    savedDocument,
    showError,
}: UseOfflineRepoTreeParams) {
    const [repoTree, setRepoTree] = useState<OfflineRepoTreeResponse | null>(null);
    const [treeLoading, setTreeLoading] = useState(false);
    const treeRequestGeneration = useRef(0);

    useEffect(() => {
        const unsubscribe = useAuthStore.subscribe((state, previous) => {
            if (state.currentGroup?.id === previous.currentGroup?.id && state.token === previous.token) return;
            treeRequestGeneration.current += 1;
            setRepoTree(null);
            setTreeLoading(false);
        });
        return () => {
            unsubscribe();
            treeRequestGeneration.current += 1;
        };
    }, []);

    useEffect(() => {
        if (!savedDocument || savedDocument.groupId !== groupId) return;
        setRepoTree((current) => {
            if (!current || current.groupId !== groupId) return current;
            const root = updateRepoTreeFlowStatus(current.root, savedDocument);
            const recentFlowPaths = prependRecentFlowPath(current.recentFlowPaths, savedDocument.path);
            return root === current.root && recentFlowPaths === current.recentFlowPaths
                ? current
                : { ...current, root, recentFlowPaths };
        });
    }, [groupId, savedDocument]);

    const refreshRepoTree = useCallback(async () => {
        const snapshot = useAuthStore.getState();
        if (!groupId || snapshot.currentGroup?.id !== groupId) return;
        const generation = ++treeRequestGeneration.current;
        const isCurrent = () => {
            const state = useAuthStore.getState();
            return treeRequestGeneration.current === generation
                && state.currentGroup?.id === groupId && state.token === snapshot.token;
        };
        setTreeLoading(true);
        try {
            const nextTree = await getOfflineRepoTree(groupId);
            if (isCurrent()) setRepoTree(nextTree);
        } catch (error) {
            if (!isCurrent()) return;
            showError(error, '项目树读取失败', '');
        } finally {
            if (isCurrent()) setTreeLoading(false);
        }
    }, [groupId, showError]);

    const repoTreeNodeIndex = useMemo(
        () => (repoTree ? indexNodesByTreePath(repoTree.root, repoTree.recentFlowPaths) : null),
        [repoTree],
    );

    const resolveTreeNode = useCallback(
        (treePath: string) => repoTreeNodeIndex?.get(treePath) ?? null,
        [repoTreeNodeIndex],
    );

    return {
        repoTree,
        treeLoading,
        refreshRepoTree,
        resolveTreeNode,
    };
}
