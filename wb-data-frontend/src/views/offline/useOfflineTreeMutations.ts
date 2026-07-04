import { useCallback, useState, type MouseEvent } from 'react';
import {
    createOfflineFolder,
    deleteOfflineFlow,
    deleteOfflineFolder,
    renameOfflineFlow,
    renameOfflineFolder,
    saveOfflineFlowDocument,
    type OfflineRepoTreeNode,
} from '../../api/offline';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../utils/error';
import { clearDeletedFolderDraftState } from './deletedFolderDraftState';
import type { FlowDraftSession } from './flowDraftController';
import {
    moveFolderRecoverySnapshots,
    moveRecoverySnapshot,
    removeFolderRecoverySnapshots,
    removeRecoverySnapshot,
} from './recoverySnapshotStore';

interface UseOfflineTreeMutationsParams {
    groupId: number | null;
    activeFlowPath: string | null;
    draftSession: FlowDraftSession | null;
    refreshRepoTree: () => Promise<void>;
    openFlowDocument: (path: string) => Promise<boolean>;
    leaveCurrentFlow: (session: FlowDraftSession) => void;
    setActiveFlowPath: (path: string | null) => void;
    setDraftSession: (session: FlowDraftSession | null) => void;
    showFeedback: (payload: FeedbackPayload) => void;
}

export function useOfflineTreeMutations({
    groupId,
    activeFlowPath,
    draftSession,
    refreshRepoTree,
    openFlowDocument,
    leaveCurrentFlow,
    setActiveFlowPath,
    setDraftSession,
    showFeedback,
}: UseOfflineTreeMutationsParams) {
    const [newFlowDialogOpen, setNewFlowDialogOpen] = useState(false);
    const [newFlowName, setNewFlowName] = useState('');
    const [newFlowCreating, setNewFlowCreating] = useState(false);
    const [newFlowParentPath, setNewFlowParentPath] = useState('');
    const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderCreating, setNewFolderCreating] = useState(false);
    const [newFolderParentPath, setNewFolderParentPath] = useState('');
    const [newItemMenuOpen, setNewItemMenuOpen] = useState(false);
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [contextMenuNode, setContextMenuNode] = useState<OfflineRepoTreeNode | null>(null);
    const [deleteFlowDialogOpen, setDeleteFlowDialogOpen] = useState(false);
    const [deleteFlowName, setDeleteFlowName] = useState('');
    const [deleteFlowPath, setDeleteFlowPath] = useState('');
    const [deleteFlowLoading, setDeleteFlowLoading] = useState(false);
    const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
    const [deleteFolderName, setDeleteFolderName] = useState('');
    const [deleteFolderPath, setDeleteFolderPath] = useState('');
    const [deleteFolderLoading, setDeleteFolderLoading] = useState(false);
    const [renameFlowDialogOpen, setRenameFlowDialogOpen] = useState(false);
    const [renameFlowName, setRenameFlowName] = useState('');
    const [renameFlowOriginalName, setRenameFlowOriginalName] = useState('');
    const [renameFlowPath, setRenameFlowPath] = useState('');
    const [renameFlowLoading, setRenameFlowLoading] = useState(false);
    const [renameFolderDialogOpen, setRenameFolderDialogOpen] = useState(false);
    const [renameFolderName, setRenameFolderName] = useState('');
    const [renameFolderOriginalName, setRenameFolderOriginalName] = useState('');
    const [renameFolderPath, setRenameFolderPath] = useState('');
    const [renameFolderLoading, setRenameFolderLoading] = useState(false);

    const handleCreateFlow = useCallback(async () => {
        if (!groupId || !newFlowName.trim()) return;
        const name = newFlowName.trim();
        const parentPathClean = newFlowParentPath.replace(/^_flows\/?/, '');
        const parentPath = parentPathClean ? `${parentPathClean}/${name}` : name;
        const path = `_flows/${parentPath}/flow.yaml`;
        setNewFlowCreating(true);
        try {
            await saveOfflineFlowDocument({
                groupId,
                path,
                documentHash: '',
                documentUpdatedAt: 0,
                stages: [],
                edges: [],
                layout: {},
            });
            setNewFlowDialogOpen(false);
            setNewFlowName('');
            setNewFlowParentPath('');
            showFeedback({ tone: 'success', title: 'Flow 创建成功', detail: '' });
            await refreshRepoTree();
            await openFlowDocument(path);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '创建 Flow 失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setNewFlowCreating(false);
        }
    }, [groupId, newFlowName, newFlowParentPath, openFlowDocument, refreshRepoTree, showFeedback]);

    const handleCreateFolder = useCallback(async () => {
        if (!groupId || !newFolderName.trim()) return;
        const name = newFolderName.trim();
        const parentPath = newFolderParentPath ? `${newFolderParentPath}/${name}` : name;
        const folderPath = `_flows/${parentPath}`;
        setNewFolderCreating(true);
        try {
            await createOfflineFolder(groupId, folderPath);
            setNewFolderDialogOpen(false);
            setNewFolderName('');
            setNewFolderParentPath('');
            showFeedback({ tone: 'success', title: '文件夹创建成功', detail: '' });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '创建文件夹失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setNewFolderCreating(false);
        }
    }, [groupId, newFolderName, newFolderParentPath, refreshRepoTree, showFeedback]);

    const handleDeleteFlow = useCallback(async () => {
        if (!groupId || !deleteFlowPath) return;
        setDeleteFlowLoading(true);
        try {
            await deleteOfflineFlow(groupId, deleteFlowPath);
            setDeleteFlowDialogOpen(false);
            removeRecoverySnapshot(groupId, deleteFlowPath);
            if (activeFlowPath === deleteFlowPath) {
                setActiveFlowPath(null);
                setDraftSession(null);
            }
            showFeedback({ tone: 'success', title: 'Flow 已删除', detail: '' });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '删除 Flow 失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setDeleteFlowLoading(false);
        }
    }, [activeFlowPath, deleteFlowPath, groupId, refreshRepoTree, setActiveFlowPath, setDraftSession, showFeedback]);

    const handleRenameFlow = useCallback(async () => {
        if (!groupId || !renameFlowPath || !renameFlowName.trim()) return;
        const newName = renameFlowName.trim();
        setRenameFlowLoading(true);
        try {
            await renameOfflineFlow(groupId, renameFlowPath, newName);
            setRenameFlowDialogOpen(false);
            const oldPath = renameFlowPath;
            const parts = oldPath.split('/');
            const newPath = parts.length >= 2 ? `_flows/${newName}/flow.yaml` : oldPath;
            if (draftSession?.path === oldPath) {
                leaveCurrentFlow(draftSession);
                setDraftSession(null);
            }
            moveRecoverySnapshot(groupId, oldPath, newPath);
            if (activeFlowPath === oldPath) {
                setActiveFlowPath(newPath);
            }
            showFeedback({ tone: 'success', title: 'Flow 已重命名', detail: `${renameFlowOriginalName} → ${newName}` });
            await refreshRepoTree();
            if (activeFlowPath === newPath || activeFlowPath === oldPath) {
                await openFlowDocument(newPath !== oldPath ? newPath : oldPath);
            }
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '重命名 Flow 失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setRenameFlowLoading(false);
        }
    }, [
        activeFlowPath,
        draftSession,
        groupId,
        leaveCurrentFlow,
        openFlowDocument,
        refreshRepoTree,
        renameFlowName,
        renameFlowOriginalName,
        renameFlowPath,
        setActiveFlowPath,
        setDraftSession,
        showFeedback,
    ]);

    const handleDeleteFolder = useCallback(async () => {
        if (!groupId || !deleteFolderPath) return;
        setDeleteFolderLoading(true);
        try {
            await deleteOfflineFolder(groupId, deleteFolderPath);
            setDeleteFolderDialogOpen(false);
            removeFolderRecoverySnapshots(groupId, deleteFolderPath);
            const nextState = clearDeletedFolderDraftState({
                activeFlowPath,
                deleteFolderPath,
                draftSession,
                leaveCurrentFlow,
            });
            setActiveFlowPath(nextState.activeFlowPath);
            setDraftSession(nextState.draftSession);
            showFeedback({ tone: 'success', title: '文件夹已删除', detail: '' });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '删除文件夹失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setDeleteFolderLoading(false);
        }
    }, [activeFlowPath, deleteFolderPath, draftSession, groupId, leaveCurrentFlow, refreshRepoTree, setActiveFlowPath, setDraftSession, showFeedback]);

    const handleRenameFolder = useCallback(async () => {
        if (!groupId || !renameFolderPath || !renameFolderName.trim()) return;
        const newName = renameFolderName.trim();
        setRenameFolderLoading(true);
        try {
            await renameOfflineFolder(groupId, renameFolderPath, newName);
            setRenameFolderDialogOpen(false);

            const oldPath = renameFolderPath;
            const parts = oldPath.split('/');
            parts[parts.length - 1] = newName;
            const newPath = parts.join('/');
            if (draftSession?.path && draftSession.path.startsWith(`${oldPath}/`)) {
                leaveCurrentFlow(draftSession);
                setDraftSession(null);
            }
            moveFolderRecoverySnapshots(groupId, oldPath, newPath);

            if (activeFlowPath && activeFlowPath.startsWith(`${oldPath}/`)) {
                const refreshedPath = activeFlowPath.replace(oldPath, newPath);
                setActiveFlowPath(refreshedPath);
                await openFlowDocument(refreshedPath);
            }

            showFeedback({ tone: 'success', title: '文件夹已重命名', detail: `${renameFolderOriginalName} → ${newName}` });
            await refreshRepoTree();
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '重命名文件夹失败',
                detail: getErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setRenameFolderLoading(false);
        }
    }, [
        activeFlowPath,
        draftSession,
        groupId,
        leaveCurrentFlow,
        openFlowDocument,
        refreshRepoTree,
        renameFolderName,
        renameFolderOriginalName,
        renameFolderPath,
        setActiveFlowPath,
        setDraftSession,
        showFeedback,
    ]);

    const handleContextMenu = useCallback((event: MouseEvent, node: OfflineRepoTreeNode) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
        setContextMenuNode(node);
        setContextMenuOpen(true);
    }, []);

    const openNewFlowDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        const relativePath = node.path.replace(/^_flows\/?/, '');
        setNewFlowParentPath(relativePath);
        setNewFlowName('');
        setNewFlowDialogOpen(true);
    }, []);

    const openNewFolderDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        const relativePath = node.path.replace(/^_flows\/?/, '');
        setNewFolderParentPath(relativePath);
        setNewFolderName('');
        setNewFolderDialogOpen(true);
    }, []);

    const openDeleteFlowDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        setDeleteFlowPath(node.path);
        const parts = node.path.split('/');
        setDeleteFlowName(parts.length >= 2 ? parts[1] : node.name);
        setDeleteFlowDialogOpen(true);
    }, []);

    const openDeleteFolderDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        setDeleteFolderPath(node.path);
        setDeleteFolderName(node.name);
        setDeleteFolderDialogOpen(true);
    }, []);

    const openRenameFlowDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        setRenameFlowPath(node.path);
        const parts = node.path.split('/');
        const originalName = parts.length >= 2 ? parts[1] : node.name;
        setRenameFlowOriginalName(originalName);
        setRenameFlowName(originalName);
        setRenameFlowDialogOpen(true);
    }, []);

    const openRenameFolderDialogFromContext = useCallback((node: OfflineRepoTreeNode) => {
        setContextMenuOpen(false);
        setRenameFolderPath(node.path);
        setRenameFolderOriginalName(node.name);
        setRenameFolderName(node.name);
        setRenameFolderDialogOpen(true);
    }, []);

    const openRootNewFlowDialog = useCallback(() => {
        setNewFlowParentPath('');
        setNewFlowName('');
        setNewFlowDialogOpen(true);
    }, []);

    return {
        newFlowDialogOpen,
        setNewFlowDialogOpen,
        newFlowName,
        setNewFlowName,
        newFlowCreating,
        newFlowParentPath,
        setNewFlowParentPath,
        newFolderDialogOpen,
        setNewFolderDialogOpen,
        newFolderName,
        setNewFolderName,
        newFolderCreating,
        newFolderParentPath,
        setNewFolderParentPath,
        newItemMenuOpen,
        setNewItemMenuOpen,
        contextMenuOpen,
        setContextMenuOpen,
        contextMenuPosition,
        contextMenuNode,
        deleteFlowDialogOpen,
        setDeleteFlowDialogOpen,
        deleteFlowName,
        deleteFlowPath,
        deleteFlowLoading,
        deleteFolderDialogOpen,
        setDeleteFolderDialogOpen,
        deleteFolderName,
        deleteFolderPath,
        deleteFolderLoading,
        renameFlowDialogOpen,
        setRenameFlowDialogOpen,
        renameFlowName,
        setRenameFlowName,
        renameFlowOriginalName,
        renameFlowPath,
        renameFlowLoading,
        renameFolderDialogOpen,
        setRenameFolderDialogOpen,
        renameFolderName,
        setRenameFolderName,
        renameFolderOriginalName,
        renameFolderPath,
        renameFolderLoading,
        handleCreateFlow,
        handleCreateFolder,
        handleDeleteFlow,
        handleRenameFlow,
        handleDeleteFolder,
        handleRenameFolder,
        handleContextMenu,
        openNewFlowDialogFromContext,
        openNewFolderDialogFromContext,
        openDeleteFlowDialogFromContext,
        openDeleteFolderDialogFromContext,
        openRenameFlowDialogFromContext,
        openRenameFolderDialogFromContext,
        openRootNewFlowDialog,
    };
}
