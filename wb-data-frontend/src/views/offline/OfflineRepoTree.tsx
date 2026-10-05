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
import type { FileTree as FileTreeModel, FileTreeDirectoryHandle, FileTreeRowDecoration } from '@pierre/trees';

import type { OfflineRepoTreeNode } from '../../api/offline';
import {
    flattenRepoTreePaths,
    indexNodesByTreePath,
    isDirectoryTreePath,
    moveTreePath,
    treePathToFlowApiPath,
} from './repoTreePaths';

export interface OfflineRepoTreeHandle {
    expandAll: () => void;
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

function resetTreePaths(model: FileTreeModel, paths: string[], expandAll = false) {
    const search = model.isSearchOpen() ? model.getSearchValue() : null;
    model.setSearch(null);
    const directories = paths.filter(isDirectoryTreePath);
    const expanded = new Set(directories.filter((path) => expandAll
        || (model.getItem(path) as FileTreeDirectoryHandle | null)?.isExpanded()));
    model.resetPaths(paths, { initialExpandedPaths: [...expanded] });
    // Initial expansion also opens ancestors; restore explicitly collapsed parents afterward.
    directories.filter((path) => !expanded.has(path)).forEach((path) => {
        (model.getItem(path) as FileTreeDirectoryHandle | null)?.collapse();
    });
    model.setSearch(search);
}

export const OfflineRepoTree = forwardRef<OfflineRepoTreeHandle, OfflineRepoTreeProps>(
    function OfflineRepoTree(props, ref) {
        const {
            root, dataKey, selectedTreePath, canWrite, className, iconSpriteSheet,
            directoriesOnly = false, readonly = false,
        } = props;
        const callbacksRef = useRef(props);
        callbacksRef.current = props;
        const movingRef = useRef(false);
        const syncingSelectionRef = useRef(false);
        const [noSearchMatches, setNoSearchMatches] = useState(false);

        const paths = useMemo(() => {
            const all = flattenRepoTreePaths(root);
            return directoriesOnly ? all.filter(isDirectoryTreePath) : all;
        }, [root, directoriesOnly]);
        const pathsRef = useRef(paths);
        pathsRef.current = paths;
        const nodeIndex = useMemo(() => indexNodesByTreePath(root), [root]);
        const nodeIndexRef = useRef(nodeIndex);
        nodeIndexRef.current = nodeIndex;
        const canWriteRef = useRef(canWrite);
        canWriteRef.current = canWrite;

        const { model } = useFileTree({
            paths: [],
            sort: 'default',
            itemHeight: 30,
            flattenEmptyDirectories: false,
            icons: iconSpriteSheet ? { spriteSheet: iconSpriteSheet } : undefined,
            unsafeCSS: ROW_STYLES,
            fileTreeSearchMode: 'hide-non-matches',
            dragAndDrop: readonly ? false : {
                canDrag: (dragged) => canWriteRef.current && !movingRef.current && dragged.length === 1,
                canDrop: (event) => canWriteRef.current && !movingRef.current
                    && event.draggedPaths.length === 1 && event.draggedPaths.every((dragged) => {
                        const targetDir = event.target.directoryPath;
                        if (targetDir === dragged || (targetDir && isDirectoryTreePath(dragged) && targetDir.startsWith(dragged))) return false;
                        const next = moveTreePath(dragged, targetDir);
                        const basename = next.replace(/\/$/, '');
                        return next !== dragged && !nodeIndexRef.current.has(basename)
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
                if (syncingSelectionRef.current || movingRef.current || !first
                    || first === callbacksRef.current.selectedTreePath || !nodeIndexRef.current.has(first)) return;
                if (isDirectoryTreePath(first)) {
                    callbacksRef.current.onSelectDirectory?.(first);
                } else {
                    callbacksRef.current.onOpenFlow?.(treePathToFlowApiPath(first));
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
            lastDataKeyRef.current = dataKey;
            syncingSelectionRef.current = true;
            resetTreePaths(model, paths, !isSameScope);
            syncingSelectionRef.current = false;
            setNoSearchMatches(!!model.getSearchValue() && model.getSearchMatchingPaths().length === 0);
        }, [model, paths, dataKey]);

        useEffect(() => {
            syncingSelectionRef.current = true;
            model.getSelectedPaths().forEach((selected) => {
                if (selected !== selectedTreePath) model.getItem(selected)?.deselect();
            });
            if (selectedTreePath) {
                const item = model.getItem(selectedTreePath);
                if (item && !item.isSelected()) item.select();
                if (item) model.scrollToPath(selectedTreePath, { offset: 'nearest' });
            }
            syncingSelectionRef.current = false;
        }, [model, selectedTreePath, paths]);

        useImperativeHandle(ref, () => ({
            expandAll: () => {
                paths.filter(isDirectoryTreePath).forEach((path) => {
                    (model.getItem(path) as FileTreeDirectoryHandle | null)?.expand();
                });
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
