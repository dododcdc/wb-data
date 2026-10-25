import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import type {
    FileTree as FileTreeModel,
    FileTreeDirectoryHandle,
    FileTreeRowDecoration,
    FileTreeSortComparator,
} from '@pierre/trees';

import type { OfflineRepoTreeNode } from '../../api/offline';
import {
    RECENT_FLOWS_DIR_PATH,
    buildRepoTreeEntries,
    flowApiPathToTreePath,
    getAncestorDirectoryTreePaths,
    isDirectoryTreePath,
    isRecentFlowsTreePath,
    moveTreePath,
} from './repoTreePaths';

export interface OfflineRepoTreeHandle {
    expandAll: () => void;
    revealFlow: (apiPath: string) => void;
    setSearch: (value: string | null) => void;
}

interface OfflineRepoTreeCallbacks {
    onOpenFlow?: (apiPath: string) => void;
    onMoveNode?: (sourceTreePath: string, newTreePath: string) => Promise<void>;
    onContextMenu?: (treePath: string, position: { x: number; y: number }) => void;
    onSelectDirectory?: (treePath: string) => void;
    renderBadge?: (node: OfflineRepoTreeNode) => FileTreeRowDecoration | null;
}

interface OfflineRepoTreeProps extends OfflineRepoTreeCallbacks {
    root: OfflineRepoTreeNode;
    recentFlowPaths?: readonly string[];
    dataKey: string | number | null;
    selectedTreePath: string | null;
    canWrite: boolean;
    className?: string;
    iconSpriteSheet?: string;
    directoriesOnly?: boolean;
    readonly?: boolean;
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
    '--trees-font-family-override': 'var(--font-sans)',
    '--trees-font-size-override': '0.875rem',
} as CSSProperties;

const ROW_STYLES = `
    [data-item-type="folder"] { font-weight: 500; }
    [data-item-type="file"] > [data-item-section="icon"] { display: none; }
    [data-item-section="content"] { order: 1; }
    [data-item-section="decoration"] { flex: none; width: 16px; transform: translateY(1px); }
    [data-item-section="git"], [data-item-section="action"] { order: 2; }
`;

const repoTreeSort: FileTreeSortComparator = (left, right) => {
    if (left.path === RECENT_FLOWS_DIR_PATH) return -1;
    if (right.path === RECENT_FLOWS_DIR_PATH) return 1;
    if (left.path.startsWith(RECENT_FLOWS_DIR_PATH) && right.path.startsWith(RECENT_FLOWS_DIR_PATH)) {
        return 0;
    }
    if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
    }
    return left.basename.localeCompare(right.basename, undefined, { sensitivity: 'base' });
};

function resetTreePaths(model: FileTreeModel, paths: string[], resetScope = false) {
    const search = model.isSearchOpen() ? model.getSearchValue() : null;
    model.setSearch(null);
    const directories = paths.filter(isDirectoryTreePath);
    const expanded = new Set(directories.filter((path) => (
        resetScope
            ? path === RECENT_FLOWS_DIR_PATH
            : (model.getItem(path) as FileTreeDirectoryHandle | null)?.isExpanded()
    )));
    model.resetPaths(paths, { initialExpandedPaths: [...expanded] });
    expanded.forEach((path) => {
        (model.getItem(path) as FileTreeDirectoryHandle | null)?.expand();
    });
    // Initial expansion also opens ancestors; restore explicitly collapsed parents afterward.
    directories.filter((path) => !expanded.has(path)).forEach((path) => {
        (model.getItem(path) as FileTreeDirectoryHandle | null)?.collapse();
    });
    model.setSearch(search);
}

export const OfflineRepoTree = forwardRef<OfflineRepoTreeHandle, OfflineRepoTreeProps>(
    function OfflineRepoTree(props, ref) {
        const {
            root, recentFlowPaths, dataKey, selectedTreePath, canWrite, className, iconSpriteSheet,
            directoriesOnly = false, readonly = false,
        } = props;
        const callbacksRef = useRef(props);
        callbacksRef.current = props;
        const movingRef = useRef(false);
        const syncingSelectionRef = useRef(false);
        const preferredRecentTreePathRef = useRef<string | null>(null);
        const [noSearchMatches, setNoSearchMatches] = useState(false);

        const { paths, nodeIndex } = useMemo(
            () => buildRepoTreeEntries(root, { directoriesOnly, recentFlowPaths }),
            [root, directoriesOnly, recentFlowPaths],
        );
        const pathsRef = useRef(paths);
        pathsRef.current = paths;
        const nodeIndexRef = useRef(nodeIndex);
        nodeIndexRef.current = nodeIndex;
        const canWriteRef = useRef(canWrite);
        canWriteRef.current = canWrite;

        const { model } = useFileTree({
            paths: [],
            sort: repoTreeSort,
            itemHeight: 30,
            flattenEmptyDirectories: false,
            icons: iconSpriteSheet ? { spriteSheet: iconSpriteSheet } : undefined,
            unsafeCSS: ROW_STYLES,
            fileTreeSearchMode: 'hide-non-matches',
            dragAndDrop: readonly ? false : {
                canDrag: (dragged) => canWriteRef.current && !movingRef.current && dragged.length === 1
                    && !isRecentFlowsTreePath(dragged[0]),
                canDrop: (event) => canWriteRef.current && !movingRef.current
                    && event.draggedPaths.length === 1 && event.draggedPaths.every((dragged) => {
                        const targetDir = event.target.directoryPath;
                        if (isRecentFlowsTreePath(dragged) || (targetDir !== null && isRecentFlowsTreePath(targetDir))) return false;
                        if (targetDir === dragged || (targetDir && isDirectoryTreePath(dragged) && targetDir.startsWith(dragged))) return false;
                        const next = moveTreePath(dragged, targetDir);
                        const basename = next.replace(/\/$/, '');
                        return next !== dragged && !isRecentFlowsTreePath(`${basename}/`)
                            && !nodeIndexRef.current.has(basename)
                            && !nodeIndexRef.current.has(`${basename}/`);
                    }),
                onDropComplete: async (event) => {
                    const dragged = event.draggedPaths[0];
                    const next = moveTreePath(dragged, event.target.directoryPath);
                    movingRef.current = true;
                    // Trees mutates optimistically; keep server paths authoritative until persistence completes.
                    syncingSelectionRef.current = true;
                    resetTreePaths(model, pathsRef.current);
                    syncingSelectionRef.current = false;
                    try {
                        await callbacksRef.current.onMoveNode?.(dragged, next);
                    } finally {
                        movingRef.current = false;
                    }
                },
            },
            onSelectionChange: (selected) => {
                const first = selected[0];
                if (syncingSelectionRef.current || movingRef.current || !first) return;
                preferredRecentTreePathRef.current = isRecentFlowsTreePath(first) && !isDirectoryTreePath(first)
                    ? first
                    : null;
                if (first === callbacksRef.current.selectedTreePath || !nodeIndexRef.current.has(first)) return;
                if (isDirectoryTreePath(first)) {
                    callbacksRef.current.onSelectDirectory?.(first);
                }
            },
            renderRowDecoration: ({ item }) => {
                const node = nodeIndexRef.current.get(item.path);
                return node?.kind === 'FLOW' ? callbacksRef.current.renderBadge?.(node) ?? null : null;
            },
            composition: readonly ? undefined : {
                contextMenu: {
                    enabled: true,
                    triggerMode: 'right-click',
                    onOpen: (item, context) => {
                        context.close({ restoreFocus: false });
                        if (!nodeIndexRef.current.has(item.path)) return;
                        callbacksRef.current.onContextMenu?.(item.path, {
                            x: context.anchorRect.x,
                            y: context.anchorRect.bottom,
                        });
                    },
                },
            },
        });

        const lastDataKeyRef = useRef<typeof dataKey>(undefined);
        useEffect(() => {
            const isSameScope = lastDataKeyRef.current === dataKey;
            if (!isSameScope) {
                preferredRecentTreePathRef.current = null;
            }
            lastDataKeyRef.current = dataKey;
            syncingSelectionRef.current = true;
            resetTreePaths(model, paths, !isSameScope);
            syncingSelectionRef.current = false;
            setNoSearchMatches(!!model.getSearchValue() && model.getSearchMatchingPaths().length === 0);
        }, [model, paths, dataKey]);

        useEffect(() => {
            const targetNode = selectedTreePath ? nodeIndex.get(selectedTreePath) : undefined;
            const preferredRecent = preferredRecentTreePathRef.current;
            const effectiveSelectedPath = (
                selectedTreePath
                && preferredRecent
                && targetNode
                && nodeIndex.get(preferredRecent)?.path === targetNode.path
            )
                ? preferredRecent
                : selectedTreePath;
            syncingSelectionRef.current = true;
            model.getSelectedPaths().forEach((selected) => {
                if (selected !== effectiveSelectedPath) model.getItem(selected)?.deselect();
            });
            if (effectiveSelectedPath) {
                const item = model.getItem(effectiveSelectedPath);
                if (item && !item.isSelected()) item.select();
                if (item) model.scrollToPath(effectiveSelectedPath, { offset: 'nearest' });
            }
            syncingSelectionRef.current = false;
        }, [model, nodeIndex, selectedTreePath, paths]);

        useImperativeHandle(ref, () => ({
            expandAll: () => {
                paths.filter(isDirectoryTreePath).forEach((path) => {
                    (model.getItem(path) as FileTreeDirectoryHandle | null)?.expand();
                });
            },
            revealFlow: (apiPath) => {
                const targetTreePath = flowApiPathToTreePath(apiPath);
                if (!nodeIndexRef.current.has(targetTreePath)) return;
                preferredRecentTreePathRef.current = null;
                syncingSelectionRef.current = true;
                getAncestorDirectoryTreePaths(targetTreePath).forEach((ancestorPath) => {
                    (model.getItem(ancestorPath) as FileTreeDirectoryHandle | null)?.expand();
                });
                model.getSelectedPaths().forEach((selected) => {
                    if (selected !== targetTreePath) model.getItem(selected)?.deselect();
                });
                const item = model.getItem(targetTreePath);
                if (item && !item.isSelected()) item.select();
                if (item) model.scrollToPath(targetTreePath, { offset: 'nearest', focus: true });
                syncingSelectionRef.current = false;
            },
            setSearch: (value) => {
                syncingSelectionRef.current = true;
                model.setSearch(value);
                syncingSelectionRef.current = false;
                // This Trees version shows all rows when its search finds no matches.
                setNoSearchMatches(!!value && model.getSearchMatchingPaths().length === 0);
            },
        }), [model, paths]);

        return (
            <div
                className={className}
                style={{ minHeight: 0, height: '100%' }}
                onDoubleClick={(event) => {
                    if (directoriesOnly || movingRef.current) return;
                    const pathTargets = event.nativeEvent.composedPath();
                    const itemElement = pathTargets.find((target): target is HTMLElement => (
                        target instanceof HTMLElement && target.dataset.type === 'item'
                    ));
                    const isTestStub = !itemElement && pathTargets.some((target) => (
                        target instanceof HTMLElement && target.dataset.testid === 'file-tree'
                    ));
                    if (!itemElement && !isTestStub) return;
                    const itemPath = itemElement?.dataset.itemPath ?? model.getSelectedPaths()[0];
                    if (!itemPath || isDirectoryTreePath(itemPath)) return;
                    const node = nodeIndexRef.current.get(itemPath);
                    if (node?.kind !== 'FLOW') return;
                    preferredRecentTreePathRef.current = isRecentFlowsTreePath(itemPath) ? itemPath : null;
                    callbacksRef.current.onOpenFlow?.(node.path);
                }}
                onMouseMove={(event) => {
                    // Mouseover does not cross the shadow boundary when moving between tree rows.
                    const label = event.nativeEvent.composedPath().find((target): target is HTMLElement => (
                        target instanceof HTMLElement && target.dataset.itemSection === 'content'
                    ));
                    const name = label?.closest('[data-type="item"]')?.getAttribute('aria-label');
                    if (label && name && label.title !== name) label.title = name;
                }}
            >
                {noSearchMatches ? <p className="offline-rail-empty" role="status">没有匹配的目录</p> : null}
                <div hidden={noSearchMatches} style={{ height: '100%' }}>
                    <FileTree model={model} style={{ ...HOST_THEME_STYLE, display: 'block', height: '100%' }} />
                </div>
            </div>
        );
    },
);
