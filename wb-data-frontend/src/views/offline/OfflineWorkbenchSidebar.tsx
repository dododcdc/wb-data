import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeftRight,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronRight,
    FileCode2,
    FolderOpen,
    FolderPlus,
    GitBranch,
    GitCommitHorizontal,
    LoaderCircle,
    LocateFixed,
    Plus,
    RefreshCcw,
    Search,
    X,
} from 'lucide-react';

import type { AssetOwnerSummary, OwnerStatus } from '../../api/groupSettings';
import type {
    BranchItem,
    OfflineRepoTreeNode,
    OfflineRepoTreeResponse,
} from '../../api/offline';
import { SimpleSelect } from '../../components/SimpleSelect';
import { formatOwnerDisplay } from '../../components/owner/ownerUtils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { OfflineRepoTree, type OfflineRepoTreeHandle } from './repo/OfflineRepoTree';
import { SCHEDULE_BADGE_SPRITE, renderScheduleBadge } from './repo/offlineTreeBadges';
import { flowApiPathToTreePath, indexNodesByTreePath } from './repo/repoTreePaths';
import type { BranchDirtyState } from './repo/useOfflineRepositoryWorkflow';

interface BranchControls {
    label: string;
    canSwitch: boolean;
    menuOpen: boolean;
    tooltipOpen: boolean;
    loading: boolean;
    switching: boolean;
    branches: BranchItem[];
    dirtyState: BranchDirtyState | null;
    onToggleMenu: () => void;
    onMenuOpenChange: (open: boolean) => void;
    onTooltipOpenChange: (open: boolean) => void;
    onSwitch: (branchName: string) => void;
}

interface RepositoryControls {
    available: boolean;
    loading: boolean;
    committing: boolean;
    pushLoading: boolean;
    canCommit: boolean;
    canPush: boolean;
    dirty: boolean;
    ahead: boolean;
    onRefresh: () => void;
    onOpenCommit: () => void;
    onOpenPush: () => void;
}

interface CreationControls {
    canWrite: boolean;
    menuOpen: boolean;
    onMenuOpenChange: (open: boolean) => void;
    onOpenNewFlow: () => void;
    onOpenNewFolder: () => void;
}

interface TreeControls {
    data: OfflineRepoTreeResponse | null;
    loading: boolean;
    flowLoading: boolean;
    activeFlowPath: string | null;
    canWrite: boolean;
    currentUserId?: number | null;
    ownerSummaries?: AssetOwnerSummary[];
    canBulkTransferOwner?: boolean;
    onOpenBulkTransferOwner?: (initialFromOwnerUserId: number | null) => void;
    onOpenFlow: (path: string) => void;
    onContextMenu: (node: OfflineRepoTreeNode, position: { x: number; y: number }) => void;
    onMoveNode: (sourceTreePath: string, newTreePath: string) => Promise<void>;
}

const OWNER_FILTER_ALL = 'ALL';
const OWNER_FILTER_MINE = 'MINE';
const OWNER_FILTER_UNASSIGNED = 'UNASSIGNED';

function parseSelectedOwnerUserId(filter: string, currentUserId: number | null | undefined): number | null {
    if (filter === OWNER_FILTER_MINE) return currentUserId ?? null;
    if (filter.startsWith('USER:')) {
        const parsed = Number(filter.slice(5));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function matchesOwnerFilter(
    node: OfflineRepoTreeNode,
    filter: string,
    currentUserId: number | null | undefined,
): boolean {
    if (filter === OWNER_FILTER_ALL) return true;
    if (filter === OWNER_FILTER_MINE) {
        return currentUserId != null && node.ownerUserId === currentUserId;
    }
    if (filter === OWNER_FILTER_UNASSIGNED) {
        return node.ownerUserId == null;
    }
    if (filter.startsWith('USER:')) {
        const targetId = Number(filter.slice(5));
        return node.ownerUserId === targetId;
    }
    return true;
}

function filterTreeByOwner(
    node: OfflineRepoTreeNode,
    filter: string,
    currentUserId: number | null | undefined,
    isRoot = true,
): OfflineRepoTreeNode | null {
    if (filter === OWNER_FILTER_ALL) return node;
    if (node.kind === 'FLOW') {
        return matchesOwnerFilter(node, filter, currentUserId) ? node : null;
    }
    const nextChildren = (node.children ?? [])
        .map((child) => filterTreeByOwner(child, filter, currentUserId, false))
        .filter((child): child is OfflineRepoTreeNode => child !== null);
    if (!isRoot && nextChildren.length === 0) {
        return null;
    }
    return {
        ...node,
        children: nextChildren,
    };
}

function collectFlowOwners(
    node: OfflineRepoTreeNode | null | undefined,
    summaries: AssetOwnerSummary[] = [],
): { owners: AssetOwnerSummary[]; hasUnassigned: boolean; totalFlows: number } {
    const byId = new Map<number, AssetOwnerSummary>();
    let hasUnassigned = false;
    let totalFlows = 0;

    for (const item of summaries) {
        if (item.userId != null) {
            byId.set(item.userId, { ...item });
        }
    }

    const walk = (curr: OfflineRepoTreeNode) => {
        if (curr.kind === 'FLOW') {
            totalFlows += 1;
            if (curr.ownerUserId == null) {
                hasUnassigned = true;
            } else if (!byId.has(curr.ownerUserId)) {
                byId.set(curr.ownerUserId, {
                    userId: curr.ownerUserId,
                    displayName: curr.ownerName ?? null,
                    username: curr.ownerUsername ?? null,
                    status: (curr.ownerStatus as OwnerStatus | null | undefined) ?? 'ACTIVE',
                    count: 1,
                });
            }
            return;
        }
        curr.children?.forEach(walk);
    };
    if (node) walk(node);

    const owners = Array.from(byId.values()).sort((a, b) => {
        const nameA = a.displayName || a.username || '';
        const nameB = b.displayName || b.username || '';
        return nameA.localeCompare(nameB, 'zh-CN');
    });
    return { owners, hasUnassigned, totalFlows };
}

function collectFlowPaths(node: OfflineRepoTreeNode | null | undefined): Set<string> {
    const paths = new Set<string>();
    const walk = (curr: OfflineRepoTreeNode) => {
        if (curr.kind === 'FLOW') {
            paths.add(curr.path);
            return;
        }
        curr.children?.forEach(walk);
    };
    if (node) walk(node);
    return paths;
}

interface OfflineWorkbenchSidebarProps {
    isGroupAdmin: boolean;
    branch: BranchControls;
    repository: RepositoryControls;
    creation: CreationControls;
    tree: TreeControls;
}

function formatFlowPathDisplayName(flowPath: string) {
    const normalized = flowPath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const flowYamlIndex = segments.lastIndexOf('flow.yaml');
    if (flowYamlIndex > 0) {
        return segments[flowYamlIndex - 1];
    }
    return segments[segments.length - 1] ?? flowPath;
}

function GitPushIcon({ dirty }: { dirty: boolean }) {
    return (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
            <ArrowUpRight size={16} />
            {dirty && <span className="offline-toolbar-dot" />}
        </span>
    );
}

export function OfflineWorkbenchSidebar({
    isGroupAdmin,
    branch,
    repository,
    creation,
    tree,
}: OfflineWorkbenchSidebarProps) {
    const branchSwitcherRef = useRef<HTMLDivElement>(null);
    const treeHandleRef = useRef<OfflineRepoTreeHandle>(null);
    const isSearchComposingRef = useRef(false);
    const [treeVisible, setTreeVisible] = useState(true);
    const [treeSearch, setTreeSearch] = useState('');
    const branchMenuOpen = branch.menuOpen;
    const setBranchMenuOpen = branch.onMenuOpenChange;
    const currentBranch = useMemo(
        () => branch.branches.find((item) => item.current)
            ?? branch.branches.find((item) => item.name === branch.label)
            ?? null,
        [branch.branches, branch.label],
    );
    const switchableBranches = useMemo(
        () => branch.branches.filter((item) => !item.current && item.name !== branch.label),
        [branch.branches, branch.label],
    );
    const [ownerFilter, setOwnerFilter] = useState<string>(OWNER_FILTER_ALL);

    const ownerCollection = useMemo(
        () => collectFlowOwners(tree.data?.root, tree.ownerSummaries),
        [tree.data?.root, tree.ownerSummaries],
    );
    const ownerFilterOptions = useMemo(() => {
        const opts: Array<{ value: string; label: string }> = [
            { value: OWNER_FILTER_ALL, label: '全部负责人' },
        ];
        if (tree.currentUserId != null) {
            opts.push({ value: OWNER_FILTER_MINE, label: '我负责的' });
        }
        for (const item of ownerCollection.owners) {
            if (item.userId == null) continue;
            const display = formatOwnerDisplay(item.displayName, item.username);
            opts.push({
                value: `USER:${item.userId}`,
                label: item.count > 0 ? `${display} (${item.count})` : display,
            });
        }
        if (ownerCollection.hasUnassigned) {
            opts.push({ value: OWNER_FILTER_UNASSIGNED, label: '未指定负责人' });
        }
        return opts;
    }, [ownerCollection.hasUnassigned, ownerCollection.owners, tree.currentUserId]);

    const filteredRoot = useMemo(() => {
        if (!tree.data) return null;
        return filterTreeByOwner(tree.data.root, ownerFilter, tree.currentUserId) ?? {
            ...tree.data.root,
            children: [],
        };
    }, [ownerFilter, tree.currentUserId, tree.data]);

    const filteredRecentFlowPaths = useMemo(() => {
        const recent = tree.data?.recentFlowPaths ?? [];
        if (ownerFilter === OWNER_FILTER_ALL) return recent;
        const allowed = collectFlowPaths(filteredRoot);
        return recent.filter((p) => allowed.has(p));
    }, [filteredRoot, ownerFilter, tree.data]);

    const treeNodeIndex = useMemo(
        () => (tree.data ? indexNodesByTreePath(tree.data.root, tree.data.recentFlowPaths) : null),
        [tree.data],
    );

    useEffect(() => {
        setTreeVisible(true);
    }, [tree.data?.groupId]);

    useEffect(() => {
        isSearchComposingRef.current = false;
        setTreeSearch('');
        setOwnerFilter(OWNER_FILTER_ALL);
        treeHandleRef.current?.setSearch(null);
    }, [tree.data?.groupId, branch.label]);

    const applyTreeSearch = (nextValue: string) => {
        const trimmed = nextValue.trim();
        if (trimmed && !treeVisible) {
            setTreeVisible(true);
        }
        treeHandleRef.current?.setSearch(trimmed || null);
    };

    useEffect(() => {
        if (!branchMenuOpen) return;

        const handleMouseDown = (event: globalThis.MouseEvent) => {
            const target = event.target;
            if (target instanceof Node && branchSwitcherRef.current?.contains(target)) {
                return;
            }
            setBranchMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setBranchMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [branchMenuOpen, setBranchMenuOpen]);

    const busy = repository.loading || tree.loading || tree.flowLoading;
    const canLocateActiveFlow = Boolean(
        repository.available
        && !busy
        && !branch.switching
        && tree.activeFlowPath
        && treeNodeIndex?.has(flowApiPathToTreePath(tree.activeFlowPath)),
    );
    const handleRootToggle = () => {
        if (treeVisible) {
            setTreeVisible(false);
            return;
        }
        setTreeVisible(true);
    };
    const handleLocateActiveFlow = () => {
        if (!tree.activeFlowPath) return;
        const activePath = tree.activeFlowPath;
        if (!treeVisible) {
            setTreeVisible(true);
            requestAnimationFrame(() => treeHandleRef.current?.revealFlow(activePath));
            return;
        }
        treeHandleRef.current?.revealFlow(activePath);
    };

    return (
        <aside className="offline-rail h-full">
            <div className="offline-rail-toolbar">
                <div className="offline-branch-switcher" ref={branchSwitcherRef}>
                    {branch.canSwitch ? (
                        <Tooltip open={branch.menuOpen ? false : branch.tooltipOpen} onOpenChange={branch.onTooltipOpenChange}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="offline-branch-selector offline-branch-selector-button"
                                    aria-label={`切换分支，当前 ${branch.label}`}
                                    aria-expanded={branch.menuOpen}
                                    onClick={branch.onToggleMenu}
                                    disabled={repository.loading || tree.loading || branch.switching}
                                >
                                    {branch.switching ? (
                                        <LoaderCircle size={13} className="offline-branch-selector-icon offline-spin" aria-hidden="true" />
                                    ) : (
                                        <GitBranch size={13} className="offline-branch-selector-icon" aria-hidden="true" />
                                    )}
                                    <span className="offline-branch-selector-value">{branch.label}</span>
                                    <ChevronDown size={12} className={`offline-branch-badge-caret ${branch.menuOpen ? 'is-open' : ''}`} aria-hidden="true" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">当前分支：{branch.label}</TooltipContent>
                        </Tooltip>
                    ) : (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="offline-branch-selector offline-branch-selector-readonly">
                                    <GitBranch size={13} className="offline-branch-selector-icon" aria-hidden="true" />
                                    <span className="offline-branch-selector-value">{branch.label}</span>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">
                                当前分支：{branch.label}。只有项目组管理员可以切换分支
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {branch.canSwitch ? (
                        <div className={`offline-branch-menu ${branch.menuOpen ? 'open' : ''}`} role="dialog" aria-label="切换分支" aria-hidden={!branch.menuOpen}>
                            <div className="offline-branch-menu-inner">
                                <div className="offline-branch-menu-surface">
                                    {branch.dirtyState ? (
                                        <div className="offline-branch-dirty-warning">
                                            <AlertTriangle size={14} />
                                            <div>
                                                <strong>还有已保存但未提交的任务</strong>
                                                {branch.dirtyState.changedFlowDetails.length > 0 ? (
                                                    <ul>
                                                        {branch.dirtyState.changedFlowDetails.slice(0, 5).map((flow) => (
                                                            <li key={flow.path}>
                                                                {formatFlowPathDisplayName(flow.path)}
                                                                {flow.status === 'DELETED' ? <span>已删除</span> : null}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p>当前仓库有已保存但未提交的改动。</p>
                                                )}
                                                {branch.dirtyState.otherFileCount > 0 ? (
                                                    <p>还有 {branch.dirtyState.otherFileCount} 个仓库文件未提交。</p>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    className="offline-branch-dirty-action"
                                                    aria-label="打开提交仓库改动"
                                                    onClick={() => {
                                                        branch.onMenuOpenChange(false);
                                                        repository.onOpenCommit();
                                                    }}
                                                >
                                                    提交仓库改动
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}

                                    {branch.loading ? (
                                        <div className="offline-branch-menu-empty" role="status">
                                            <LoaderCircle size={14} className="offline-spin" aria-hidden="true" />
                                            <span className="sr-only">正在加载分支</span>
                                        </div>
                                    ) : (
                                        <div className="offline-branch-list" aria-label="可切换分支">
                                            {currentBranch ? (
                                                <div className="offline-branch-row is-current" title={currentBranch.name}>
                                                    <GitBranch size={13} className="offline-branch-row-icon" aria-hidden="true" />
                                                    <span className="offline-branch-row-name">{currentBranch.name}</span>
                                                    <Check size={13} className="offline-branch-row-check" aria-hidden="true" />
                                                </div>
                                            ) : null}
                                            {switchableBranches.map((item) => (
                                                <button
                                                    key={item.name}
                                                    type="button"
                                                    className="offline-branch-row"
                                                    aria-label={`切换到 ${item.name}`}
                                                    title={item.name}
                                                    onClick={() => branch.onSwitch(item.name)}
                                                    disabled={branch.switching}
                                                >
                                                    <GitBranch size={13} className="offline-branch-row-icon" aria-hidden="true" />
                                                    <span className="offline-branch-row-name">{item.name}</span>
                                                </button>
                                            ))}
                                            {switchableBranches.length === 0 ? (
                                                <div className="offline-branch-menu-empty" role="note" aria-label="暂无其他可切换分支">
                                                    暂无其他可切换分支
                                                </div>
                                            ) : null}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="offline-rail-toolbar-actions">
                    {creation.canWrite ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="offline-rail-toolbar-btn-wrapper">
                                    <button
                                        type="button"
                                        className="offline-rail-toolbar-btn"
                                        aria-label="新建"
                                        onClick={() => creation.onMenuOpenChange(!creation.menuOpen)}
                                        disabled={!repository.available || busy}
                                    >
                                        <Plus size={14} />
                                    </button>
                                    {creation.menuOpen ? (
                                        <div className="offline-new-item-menu animate-in fade-in zoom-in-95" onMouseLeave={() => creation.onMenuOpenChange(false)}>
                                            <button type="button" className="offline-new-item-menu-item" onClick={creation.onOpenNewFlow}>
                                                <FileCode2 size={13} />新建任务
                                            </button>
                                            <button type="button" className="offline-new-item-menu-item" onClick={creation.onOpenNewFolder}>
                                                <FolderPlus size={13} />新建文件夹
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">新建</TooltipContent>
                        </Tooltip>
                    ) : null}

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                className="offline-rail-toolbar-btn"
                                aria-label="定位当前任务"
                                onClick={handleLocateActiveFlow}
                                disabled={!canLocateActiveFlow}
                            >
                                <LocateFixed size={14} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent className="tooltip-content" side="bottom">定位当前任务</TooltipContent>
                    </Tooltip>

                    {creation.canWrite ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="offline-rail-toolbar-btn"
                                    aria-label="刷新"
                                    onClick={repository.onRefresh}
                                    disabled={!repository.available || busy}
                                >
                                    {repository.loading || tree.loading ? <LoaderCircle size={14} className="offline-spin" /> : <RefreshCcw size={14} />}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">刷新</TooltipContent>
                        </Tooltip>
                    ) : null}

                    {creation.canWrite && isGroupAdmin ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="offline-rail-toolbar-btn"
                                    aria-label="提交仓库改动"
                                    onClick={repository.onOpenCommit}
                                    disabled={!repository.canCommit || repository.committing || repository.loading || tree.loading}
                                >
                                    <span className="relative flex">
                                        <GitCommitHorizontal size={14} />
                                        {repository.dirty && <span className="offline-toolbar-dot" />}
                                    </span>
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">提交仓库改动</TooltipContent>
                        </Tooltip>
                    ) : null}

                    {creation.canWrite && isGroupAdmin ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="offline-rail-toolbar-btn"
                                    aria-label="推送"
                                    onClick={repository.onOpenPush}
                                    disabled={!repository.canPush || repository.pushLoading || repository.loading || tree.loading}
                                >
                                    {repository.pushLoading ? <LoaderCircle size={14} className="offline-spin" /> : <GitPushIcon dirty={repository.ahead} />}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">推送</TooltipContent>
                        </Tooltip>
                    ) : null}
                </div>
            </div>

            <section className="offline-rail-panel offline-rail-panel-grow">
                {tree.loading && !tree.data ? (
                    <div className="offline-rail-empty" role="status">
                        <span className="sr-only">正在加载项目树</span>
                        <div className="offline-rail-tree-skeleton" aria-hidden="true">
                            <span className="skeleton-line offline-rail-tree-skeleton-row" />
                            <span className="skeleton-line offline-rail-tree-skeleton-row is-indented" />
                            <span className="skeleton-line offline-rail-tree-skeleton-row is-indented" />
                            <span className="skeleton-line offline-rail-tree-skeleton-row" />
                        </div>
                    </div>
                ) : !tree.data?.root ? (
                    <div className="offline-rail-empty">
                        当前仓库还没有可打开的任务。
                    </div>
                ) : (
                    <div className="offline-tree-shell">
                        <div className="offline-tree-search">
                            <Search size={13} className="offline-tree-search-icon" aria-hidden="true" />
                            <input
                                type="search"
                                className="offline-tree-search-input"
                                aria-label="筛选任务"
                                placeholder="筛选任务..."
                                value={treeSearch}
                                onCompositionStart={() => {
                                    isSearchComposingRef.current = true;
                                }}
                                onCompositionEnd={(event) => {
                                    isSearchComposingRef.current = false;
                                    const next = event.currentTarget.value;
                                    setTreeSearch(next);
                                    applyTreeSearch(next);
                                }}
                                onChange={(event) => {
                                    const next = event.target.value;
                                    setTreeSearch(next);
                                    if (!isSearchComposingRef.current) {
                                        applyTreeSearch(next);
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape' && treeSearch) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setTreeSearch('');
                                        applyTreeSearch('');
                                    }
                                }}
                            />
                            {treeSearch ? (
                                <button
                                    type="button"
                                    className="offline-tree-search-clear"
                                    aria-label="清空任务筛选"
                                    onClick={() => {
                                        setTreeSearch('');
                                        applyTreeSearch('');
                                    }}
                                >
                                    <X size={12} aria-hidden="true" />
                                </button>
                            ) : null}
                        </div>
                        <div className="offline-tree-owner-row">
                            <SimpleSelect
                                id="offline-tree-owner-filter"
                                className="offline-tree-owner-select"
                                value={ownerFilter}
                                options={ownerFilterOptions}
                                onChange={(nextValue) => {
                                    setOwnerFilter(nextValue);
                                    if (nextValue !== OWNER_FILTER_ALL && !treeVisible) {
                                        setTreeVisible(true);
                                    }
                                }}
                                ariaLabel="按负责人筛选任务"
                                placeholder="全部负责人"
                            />
                            {tree.canBulkTransferOwner && tree.onOpenBulkTransferOwner ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="offline-tree-owner-transfer-btn"
                                            aria-label="按负责人批量转移"
                                            disabled={ownerCollection.owners.length === 0}
                                            onClick={() => {
                                                tree.onOpenBulkTransferOwner?.(
                                                    parseSelectedOwnerUserId(ownerFilter, tree.currentUserId),
                                                );
                                            }}
                                        >
                                            <ArrowLeftRight size={13} aria-hidden="true" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        按负责人批量转移任务
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            className={`offline-tree-root-label${treeVisible ? '' : ' is-collapsed'}`}
                            title={tree.data.root.name}
                            onClick={handleRootToggle}
                            onContextMenu={(event) => {
                                event.preventDefault();
                                if (creation.canWrite) tree.onContextMenu(tree.data!.root, { x: event.clientX, y: event.clientY });
                            }}
                        >
                            <span className={`offline-tree-row-caret${treeVisible ? ' is-expanded' : ''}`}>
                                <ChevronRight size={14} />
                            </span>
                            <span className="offline-tree-row-icon"><FolderOpen size={15} /></span>
                            <span className="offline-tree-row-label">{tree.data.root.name}</span>
                        </button>
                        <div hidden={!treeVisible} style={{ flex: 1, minHeight: 0 }}>
                            {ownerFilter !== OWNER_FILTER_ALL && (filteredRoot?.children?.length ?? 0) === 0 ? (
                                <div className="offline-tree-owner-empty">当前负责人筛选下暂无任务</div>
                            ) : (
                                <OfflineRepoTree
                                    key={`${tree.data.groupId}:${branch.label}:${ownerFilter}`}
                                    ref={treeHandleRef}
                                    className="offline-repo-tree"
                                    root={filteredRoot ?? tree.data.root}
                                    recentFlowPaths={filteredRecentFlowPaths}
                                    dataKey={`${tree.data.groupId}:${branch.label}:${ownerFilter}`}
                                    selectedTreePath={tree.activeFlowPath ? flowApiPathToTreePath(tree.activeFlowPath) : null}
                                    canWrite={tree.canWrite && !busy && !branch.switching}
                                    iconSpriteSheet={SCHEDULE_BADGE_SPRITE}
                                    noSearchMatchesText="没有匹配的任务"
                                    renderBadge={renderScheduleBadge}
                                    onOpenFlow={tree.onOpenFlow}
                                    onMoveNode={tree.onMoveNode}
                                    onContextMenu={(treePath, position) => {
                                        const node = treeNodeIndex?.get(treePath);
                                        if (node && (node.kind === 'FLOW' || creation.canWrite)) {
                                            tree.onContextMenu(node, position);
                                        }
                                    }}
                                />
                            )}
                        </div>
                    </div>
                )}
            </section>
        </aside>
    );
}
