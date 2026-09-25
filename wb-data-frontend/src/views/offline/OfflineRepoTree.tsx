import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    type CSSProperties,
} from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import type {
    FileTreeDirectoryHandle,
    FileTreeRowDecoration,
    FileTreeVisibleRow,
} from '@pierre/trees';

import type { OfflineRepoTreeNode } from '../../api/offline';
import {
    flattenRepoTreePaths,
    flowApiPathToTreePath,
    indexNodesByTreePath,
    isDirectoryTreePath,
    moveTreePath,
    treePathToFlowApiPath,
} from './repoTreePaths';

export interface OfflineRepoTreeHandle {
    expandAll: () => void;
}

interface OfflineRepoTreeCallbacks {
    onOpenFlow: (apiPath: string) => void;
    onMoveNode: (sourceTreePath: string, newTreePath: string) => void;
    onContextMenu: (treePath: string, position: { x: number; y: number }) => void;
    renderBadge?: (node: OfflineRepoTreeNode) => FileTreeRowDecoration | null;
}

interface OfflineRepoTreeProps extends OfflineRepoTreeCallbacks {
    root: OfflineRepoTreeNode;
    /** 变化时视为切换了仓库：重置并全部展开 */
    dataKey: string | number | null;
    activeFlowPath: string | null;
    canWrite: boolean;
    className?: string;
    /** 注入 shadow DOM 的自定义 SVG sprite（行徽标符号） */
    iconSpriteSheet?: string;
}

const HOST_THEME_STYLE = {
    '--trees-theme-sidebar-bg': 'transparent',
    '--trees-theme-sidebar-fg': 'var(--color-text-secondary)',
    '--trees-theme-sidebar-border': 'transparent',
    '--trees-theme-list-hover-bg': 'rgba(217, 119, 87, 0.08)',
    '--trees-theme-list-active-selection-bg': 'rgba(217, 119, 87, 0.12)',
    '--trees-theme-list-active-selection-fg': 'var(--color-text-primary)',
    '--trees-theme-focus-ring': 'rgba(217, 119, 87, 0.4)',
    '--trees-theme-scrollbar-thumb': 'var(--color-border)',
    fontSize: '0.84rem',
} as CSSProperties;

function directoryPaths(paths: readonly string[]): string[] {
    return paths.filter(isDirectoryTreePath);
}

export const OfflineRepoTree = forwardRef<OfflineRepoTreeHandle, OfflineRepoTreeProps>(
    function OfflineRepoTree(props, ref) {
        const {
            root,
            dataKey,
            activeFlowPath,
            canWrite,
            className,
            iconSpriteSheet,
        } = props;

        const callbacksRef = useRef(props);
        callbacksRef.current = props;

        const paths = useMemo(() => flattenRepoTreePaths(root), [root]);
        const nodeIndex = useMemo(() => indexNodesByTreePath(root), [root]);
        const nodeIndexRef = useRef(nodeIndex);
        nodeIndexRef.current = nodeIndex;
        const canWriteRef = useRef(canWrite);
        canWriteRef.current = canWrite;

        const { model } = useFileTree({
            paths: [],
            sort: 'default',
            icons: iconSpriteSheet ? { spriteSheet: iconSpriteSheet } : undefined,
            dragAndDrop: {
                canDrag: () => canWriteRef.current,
                canDrop: (event) => event.draggedPaths.every((dragged) => {
                    const targetDir = event.target.directoryPath;
                    if (targetDir === null) return true;
                    if (targetDir === dragged) return false;
                    return !(isDirectoryTreePath(dragged) && targetDir.startsWith(dragged));
                }),
                onDropComplete: (event) => {
                    event.draggedPaths.forEach((dragged) => {
                        const next = moveTreePath(dragged, event.target.directoryPath);
                        if (next !== dragged) {
                            callbacksRef.current.onMoveNode(dragged, next);
                        }
                    });
                },
            },
            onSelectionChange: (selected) => {
                const flowPath = selected.find((path) => !isDirectoryTreePath(path));
                if (flowPath) {
                    callbacksRef.current.onOpenFlow(treePathToFlowApiPath(flowPath));
                }
            },
            renderRowDecoration: ({ item }) => {
                const node = nodeIndexRef.current.get(item.path);
                if (!node || node.kind !== 'FLOW') return null;
                return callbacksRef.current.renderBadge?.(node) ?? null;
            },
            composition: {
                contextMenu: {
                    enabled: true,
                    triggerMode: 'right-click',
                    onOpen: (item, context) => {
                        callbacksRef.current.onContextMenu(item.path, {
                            x: context.anchorRect.x,
                            y: context.anchorRect.y,
                        });
                    },
                },
            },
        });

        const lastDataKeyRef = useRef<typeof dataKey>(undefined);
        useEffect(() => {
            const isSameScope = lastDataKeyRef.current === dataKey;
            lastDataKeyRef.current = dataKey;
            let expanded: string[];
            if (isSameScope) {
                const visible = model.getVisibleRows(0, model.getVisibleCount());
                expanded = visible
                    .filter((row: FileTreeVisibleRow) => row.kind === 'directory' && row.isExpanded)
                    .map((row) => row.path)
                    .filter((path) => paths.includes(path));
            } else {
                expanded = directoryPaths(paths);
            }
            model.resetPaths(paths, { initialExpandedPaths: expanded });
        }, [model, paths, dataKey]);

        useEffect(() => {
            const target = activeFlowPath ? flowApiPathToTreePath(activeFlowPath) : null;
            model.getSelectedPaths().forEach((selected) => {
                if (selected !== target) model.getItem(selected)?.deselect();
            });
            if (!target) return;
            const item = model.getItem(target);
            if (!item) return;
            if (!item.isSelected()) item.select();
            model.scrollToPath(target, { offset: 'nearest' });
        }, [model, activeFlowPath, paths]);

        useImperativeHandle(ref, () => ({
            expandAll: () => {
                directoryPaths(paths).forEach((path) => {
                    (model.getItem(path) as FileTreeDirectoryHandle | null)?.expand();
                });
            },
        }), [model, paths]);

        return (
            <FileTree
                model={model}
                className={className}
                style={HOST_THEME_STYLE}
                renderContextMenu={() => null}
            />
        );
    },
);
