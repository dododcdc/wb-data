import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
    AlertTriangle,
    ArrowUpRight,
    ChevronRight,
    FileCode2,
    FolderOpen,
    FolderPlus,
    GitBranch,
    GitCommitHorizontal,
    LoaderCircle,
    Plus,
    RefreshCcw,
} from 'lucide-react';

import type {
    BranchItem,
    OfflineRepoTreeNode,
    OfflineRepoTreeResponse,
} from '../../api/offline';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import type { BranchDirtyState } from './useOfflineRepositoryWorkflow';

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
    onOpenFlow: (path: string) => void;
    onContextMenu: (event: MouseEvent, node: OfflineRepoTreeNode) => void;
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

function collectTreeDirectoryIds(node: OfflineRepoTreeNode): string[] {
    return node.children.flatMap((child) => {
        if (child.kind !== 'DIRECTORY') {
            return [];
        }
        return [child.id, ...collectTreeDirectoryIds(child)];
    });
}

interface RepoTreeBranchProps {
    node: OfflineRepoTreeNode;
    depth: number;
    activeFlowPath: string | null;
    expandedIds: string[];
    onToggle: (nodeId: string) => void;
    onOpenFlow: (path: string) => void;
    onContextMenu: (event: MouseEvent, node: OfflineRepoTreeNode) => void;
}

function RepoTreeBranch(props: RepoTreeBranchProps) {
    const { node, depth, activeFlowPath, expandedIds, onToggle, onOpenFlow, onContextMenu } = props;
    const hasChildren = node.children.length > 0;
    const expanded = expandedIds.includes(node.id);
    const indentStyle = { paddingLeft: `${depth * 14}px` };

    if (node.kind === 'FLOW') {
        return (
            <button
                type="button"
                className={`offline-tree-row is-flow${node.path === activeFlowPath ? ' is-active' : ''}`}
                style={indentStyle}
                onClick={() => onOpenFlow(node.path)}
                onContextMenu={(event) => onContextMenu(event, node)}
            >
                <span className="offline-tree-row-icon"><FileCode2 size={14} /></span>
                <span className="offline-tree-row-label">{node.name}</span>
            </button>
        );
    }

    return (
        <div className="offline-tree-branch">
            <button
                type="button"
                className={`offline-tree-row is-directory${expanded ? ' is-expanded' : ''}`}
                style={indentStyle}
                onClick={() => onToggle(node.id)}
                onContextMenu={(event) => onContextMenu(event, node)}
            >
                {hasChildren ? (
                    <span className={`offline-tree-row-caret${expanded ? ' is-expanded' : ''}`}>
                        <ChevronRight size={14} />
                    </span>
                ) : (
                    <span className="offline-tree-row-spacer" />
                )}
                <span className="offline-tree-row-icon"><FolderOpen size={14} /></span>
                <span className="offline-tree-row-label">{node.name}</span>
            </button>
            {hasChildren && expanded ? (
                <div className="offline-tree-children">
                    {node.children.map((child) => (
                        <RepoTreeBranch
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            activeFlowPath={activeFlowPath}
                            expandedIds={expandedIds}
                            onToggle={onToggle}
                            onOpenFlow={onOpenFlow}
                            onContextMenu={onContextMenu}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
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
    const [expandedTreeIds, setExpandedTreeIds] = useState<string[]>([]);
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

    useEffect(() => {
        if (!tree.data) {
            setExpandedTreeIds([]);
            return;
        }
        setExpandedTreeIds([tree.data.root.id, ...collectTreeDirectoryIds(tree.data.root)]);
    }, [tree.data]);

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
    const toggleTree = (nodeId: string) => {
        setExpandedTreeIds((current) => current.includes(nodeId)
            ? current.filter((item) => item !== nodeId)
            : [...current, nodeId]);
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
                                    <GitBranch size={14} />
                                    <span className="offline-branch-selector-value">{branch.label}</span>
                                    <ChevronRight size={12} className={`offline-branch-badge-caret ${branch.menuOpen ? 'is-open' : ''}`} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom">当前分支：{branch.label}</TooltipContent>
                        </Tooltip>
                    ) : (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="offline-branch-selector offline-branch-selector-readonly">
                                    <GitBranch size={14} />
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
                                                <strong>还有已保存但未提交的 Flow</strong>
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
                                        <div className="offline-branch-menu-empty">
                                            <LoaderCircle size={14} className="offline-spin" />
                                            正在加载分支...
                                        </div>
                                    ) : (
                                        <div className="offline-branch-list" aria-label="可切换分支">
                                            {currentBranch ? (
                                                <div className="offline-branch-row is-current" title={currentBranch.name}>
                                                    <div><strong>{currentBranch.name}</strong></div>
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
                                                    <div><strong>{item.name}</strong></div>
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

                {creation.canWrite ? (
                    <div className="offline-rail-toolbar-actions">
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
                                                <FileCode2 size={13} />新建 Flow
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

                        {isGroupAdmin ? (
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

                        {isGroupAdmin ? (
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
                ) : null}
            </div>

            <section className="offline-rail-panel offline-rail-panel-grow">
                {tree.loading ? (
                    <div className="offline-rail-empty">正在加载项目树…</div>
                ) : !tree.data?.root.children.length ? (
                    <div className="offline-rail-empty">
                        {tree.data ? '当前仓库还没有可打开的 Flow。\n点击上方"新建"创建第一个 Flow。' : '当前仓库还没有可打开的 Flow。'}
                    </div>
                ) : (
                    <div className="offline-tree-shell">
                        <div className="offline-tree-root">
                            <button
                                type="button"
                                className={`offline-tree-root-label${expandedTreeIds.length === 0 ? ' is-collapsed' : ''}`}
                                onClick={() => {
                                    const allIds = [tree.data!.root.id, ...collectTreeDirectoryIds(tree.data!.root)];
                                    setExpandedTreeIds((current) => current.length > 0 ? [] : allIds);
                                }}
                                onContextMenu={(event) => tree.onContextMenu(event, tree.data!.root)}
                            >
                                <span className={`offline-tree-row-caret${expandedTreeIds.length > 0 ? ' is-expanded' : ''}`}>
                                    <ChevronRight size={14} />
                                </span>
                                <span className="offline-tree-row-icon"><FolderOpen size={15} /></span>
                                <span>{tree.data.root.name}</span>
                            </button>
                            {expandedTreeIds.length > 0 ? (
                                <div className="offline-tree-children">
                                    {tree.data.root.children.map((child) => (
                                        <RepoTreeBranch
                                            key={child.id}
                                            node={child}
                                            depth={1}
                                            activeFlowPath={tree.activeFlowPath}
                                            expandedIds={expandedTreeIds}
                                            onToggle={toggleTree}
                                            onOpenFlow={tree.onOpenFlow}
                                            onContextMenu={tree.onContextMenu}
                                        />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}
            </section>
        </aside>
    );
}
