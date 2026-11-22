import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeftRight,
    GitCompare,
    RotateCcw,
} from 'lucide-react';
import { getDataSourceById, getDataSourcePage } from '../../../api/datasource';
import {
    getOfflineFlowSnapshot,
    getOfflineFlowVersions,
    type OfflineFlowNode,
    type OfflineFlowVersionItem,
    type OfflineFlowVersionSnapshot,
} from '../../../api/offline';
import { Button } from '../../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '../../../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip';
import { CompareVersionSelector } from './CompareVersionSelector';
import { countTotalSemanticChanges, diffFlowVersions, hasNodeChanges } from './flowVersionDiff';
import { OfflineNodeDiffDialog } from './OfflineNodeDiffDialog';
import { OfflineSemanticDiff, type SemanticTab } from './OfflineSemanticDiff';
import {
    formatFlowDisplayName,
    formatRevisionTag,
    formatVersionInlineText,
    isDevelopmentVersion,
    type VersionSelection,
} from './versionComparePresentation';
import './OfflineVersionCompareDialog.css';

export type { VersionSelection };

const VERSION_LIST_PAGE_SIZE = 50;

interface CachedVersionList {
    items: OfflineFlowVersionItem[];
    total: number;
    page: number;
}

interface OfflineVersionCompareDialogProps {
    groupId: number;
    path: string;
    base: VersionSelection;
    target: VersionSelection;
    open: boolean;
    canWrite?: boolean;
    onOpenChange: (open: boolean) => void;
    onBeforeLoadWorktree?: () => Promise<boolean>;
    onRollback?: (selection: VersionSelection) => void;
}

function collectReferencedDataSourceIds(snapshots: (OfflineFlowVersionSnapshot | null)[]): number[] {
    const ids = new Set<number>();
    for (const snapshot of snapshots) {
        if (!snapshot) continue;
        for (const stage of snapshot.document.stages ?? []) {
            for (const node of stage.nodes ?? []) {
                addNodeDataSourceIds(node, ids);
            }
        }
    }
    return [...ids];
}

function addNodeDataSourceIds(node: OfflineFlowNode, ids: Set<number>) {
    if (node.dataSourceId != null) {
        ids.add(node.dataSourceId);
    }
    if (node.transfer?.source?.dataSourceId != null) {
        ids.add(node.transfer.source.dataSourceId);
    }
    if (node.transfer?.target?.dataSourceId != null) {
        ids.add(node.transfer.target.dataSourceId);
    }
}

export function OfflineVersionCompareDialog({
    groupId,
    path,
    base,
    target,
    open,
    canWrite = false,
    onOpenChange,
    onBeforeLoadWorktree,
    onRollback,
}: OfflineVersionCompareDialogProps) {
    const [activePair, setActivePair] = useState<{ base: VersionSelection; target: VersionSelection }>({ base, target });
    const [syncedPropPair, setSyncedPropPair] = useState(() => ({
        baseRevision: base.revision,
        baseLabel: base.label,
        targetRevision: target.revision,
        targetLabel: target.label,
    }));
    const [baseSnapshot, setBaseSnapshot] = useState<OfflineFlowVersionSnapshot | null>(null);
    const [targetSnapshot, setTargetSnapshot] = useState<OfflineFlowVersionSnapshot | null>(null);
    const [dataSourceNames, setDataSourceNames] = useState<Record<number, string>>({});
    const [activeTab, setActiveTab] = useState<SemanticTab>('overview');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [selectedNodeTaskId, setSelectedNodeTaskId] = useState<string | null>(null);
    const [focusNodeRequest, setFocusNodeRequest] = useState<{ taskId: string; seq: number } | null>(null);
    const [dialogContentEl, setDialogContentEl] = useState<HTMLDivElement | null>(null);
    const [openSelectors, setOpenSelectors] = useState<{ base: boolean; target: boolean }>({
        base: false,
        target: false,
    });
    const [versionOnlineOnly, setVersionOnlineOnly] = useState(false);
    const [versionItems, setVersionItems] = useState<OfflineFlowVersionItem[]>([]);
    const [versionTotal, setVersionTotal] = useState(0);
    const [versionPage, setVersionPage] = useState(1);
    const [versionLoading, setVersionLoading] = useState(false);
    const [versionLoadingMore, setVersionLoadingMore] = useState(false);
    const [versionError, setVersionError] = useState<string | null>(null);
    const snapshotCacheRef = useRef<Map<string, OfflineFlowVersionSnapshot>>(new Map());
    const versionCacheRef = useRef<Map<boolean, CachedVersionList>>(new Map());
    const versionListSeqRef = useRef(0);
    const focusSeqRef = useRef(0);
    const requestSeqRef = useRef(0);
    const onBeforeLoadWorktreeRef = useRef(onBeforeLoadWorktree);
    onBeforeLoadWorktreeRef.current = onBeforeLoadWorktree;
    const lastReloadTokenRef = useRef(0);

    // Sync activePair synchronously during render when parent selects a new pair so the first effect never fetches a stale pair.
    if (
        syncedPropPair.baseRevision !== base.revision
        || syncedPropPair.baseLabel !== base.label
        || syncedPropPair.targetRevision !== target.revision
        || syncedPropPair.targetLabel !== target.label
    ) {
        setSyncedPropPair({
            baseRevision: base.revision,
            baseLabel: base.label,
            targetRevision: target.revision,
            targetLabel: target.label,
        });
        setActivePair({ base, target });
        setError(null);
    }

    // Clear volatile worktree cache and transient selection whenever dialog closes or task changes
    useEffect(() => {
        snapshotCacheRef.current.clear();
        versionCacheRef.current.clear();
        versionListSeqRef.current += 1;
        setBaseSnapshot(null);
        setTargetSnapshot(null);
        setDataSourceNames({});
        setSelectedNodeTaskId(null);
        setFocusNodeRequest(null);
        setOpenSelectors({ base: false, target: false });
        setVersionOnlineOnly(false);
        setVersionItems([]);
        setVersionTotal(0);
        setVersionPage(1);
        setVersionLoading(false);
        setVersionLoadingMore(false);
        setVersionError(null);
        setActiveTab('overview');
        setError(null);
    }, [groupId, path]);

    useEffect(() => {
        if (!open) {
            requestSeqRef.current += 1;
            versionListSeqRef.current += 1;
            versionCacheRef.current.clear();
            for (const key of snapshotCacheRef.current.keys()) {
                if (key.endsWith(':WORKTREE')) {
                    snapshotCacheRef.current.delete(key);
                }
            }
            setActivePair({ base, target });
            setBaseSnapshot(null);
            setTargetSnapshot(null);
            setLoading(false);
            setSelectedNodeTaskId(null);
            setFocusNodeRequest(null);
            setOpenSelectors({ base: false, target: false });
            setVersionOnlineOnly(false);
            setVersionItems([]);
            setVersionTotal(0);
            setVersionPage(1);
            setVersionLoading(false);
            setVersionLoadingMore(false);
            setVersionError(null);
            setActiveTab('overview');
            setError(null);
        }
    }, [base, open, target]);

    const fetchVersionList = useCallback(async (
        onlineOnly: boolean,
        page: number,
        append: boolean,
    ) => {
        const seq = ++versionListSeqRef.current;
        if (append) {
            setVersionLoadingMore(true);
        } else {
            setVersionLoading(true);
            setVersionError(null);
        }
        try {
            const response = await getOfflineFlowVersions(groupId, path, {
                onlineOnly,
                page,
                size: VERSION_LIST_PAGE_SIZE,
            });
            if (seq !== versionListSeqRef.current) return;
            const prevItems = append ? (versionCacheRef.current.get(onlineOnly)?.items ?? []) : [];
            const seenRevisions = new Set(prevItems.map((item) => item.revision));
            const nextItems = append
                ? [...prevItems, ...response.items.filter((item) => !seenRevisions.has(item.revision))]
                : response.items;
            const entry: CachedVersionList = {
                items: nextItems,
                total: response.total,
                page,
            };
            versionCacheRef.current.set(onlineOnly, entry);
            setVersionItems(entry.items);
            setVersionTotal(entry.total);
            setVersionPage(entry.page);
            setVersionError(null);
        } catch (err) {
            if (seq !== versionListSeqRef.current) return;
            if (!append) {
                setVersionError(err instanceof Error ? err.message : '加载可选版本失败');
            }
        } finally {
            if (seq === versionListSeqRef.current) {
                setVersionLoading(false);
                setVersionLoadingMore(false);
            }
        }
    }, [groupId, path]);

    const ensureVersionListLoaded = useCallback(() => {
        const cached = versionCacheRef.current.get(versionOnlineOnly);
        if (cached) {
            setVersionItems(cached.items);
            setVersionTotal(cached.total);
            setVersionPage(cached.page);
            setVersionError(null);
            return;
        }
        if (versionLoading) return;
        void fetchVersionList(versionOnlineOnly, 1, false);
    }, [fetchVersionList, versionLoading, versionOnlineOnly]);

    const handleToggleVersionOnlineOnly = (nextOnlineOnly: boolean) => {
        setVersionOnlineOnly(nextOnlineOnly);
        const cached = versionCacheRef.current.get(nextOnlineOnly);
        if (cached) {
            setVersionItems(cached.items);
            setVersionTotal(cached.total);
            setVersionPage(cached.page);
            setVersionError(null);
            return;
        }
        setVersionItems([]);
        setVersionTotal(0);
        setVersionPage(1);
        void fetchVersionList(nextOnlineOnly, 1, false);
    };

    const handleLoadMoreVersions = () => {
        if (versionLoadingMore || versionItems.length >= versionTotal) return;
        void fetchVersionList(versionOnlineOnly, versionPage + 1, true);
    };

    const handleRetryVersions = () => {
        versionCacheRef.current.delete(versionOnlineOnly);
        void fetchVersionList(versionOnlineOnly, 1, false);
    };

    const handleSelectSideVersion = (side: 'base' | 'target', selection: VersionSelection) => {
        setActivePair((current) => ({ ...current, [side]: selection }));
        setSelectedNodeTaskId(null);
        setFocusNodeRequest(null);
        setError(null);
    };

    const loadSnapshots = useCallback(async (forceRefresh = false) => {
        if (!open) return;
        const requestId = ++requestSeqRef.current;
        const baseRev = activePair.base.revision;
        const targetRev = activePair.target.revision;
        const makeCacheKey = (revision: string) => `${groupId}:${path}:${revision}`;

        const cachedBase = !forceRefresh && baseRev !== 'WORKTREE'
            ? snapshotCacheRef.current.get(makeCacheKey(baseRev))
            : undefined;
        const cachedTarget = !forceRefresh && targetRev !== 'WORKTREE'
            ? snapshotCacheRef.current.get(makeCacheKey(targetRev))
            : undefined;

        if (cachedBase && cachedTarget) {
            setBaseSnapshot(cachedBase);
            setTargetSnapshot(cachedTarget);
            setLoading(false);
            setError(null);
            return;
        }

        // Drop mismatched snapshots from prior comparisons while fetching the active pair.
        setBaseSnapshot((prev) => (!forceRefresh && prev?.revision === baseRev ? prev : cachedBase ?? null));
        setTargetSnapshot((prev) => (!forceRefresh && prev?.revision === targetRev ? prev : cachedTarget ?? null));
        setLoading(true);
        setError(null);
        try {
            if (baseRev === 'WORKTREE' || targetRev === 'WORKTREE') {
                const flushed = await onBeforeLoadWorktreeRef.current?.();
                if (requestSeqRef.current !== requestId) return;
                if (flushed === false) {
                    setError('工作区草稿保存失败，请先保存或解决冲突后重试');
                    return;
                }
            }
            const loadOne = async (revision: string) => {
                if (!forceRefresh && revision !== 'WORKTREE') {
                    const cached = snapshotCacheRef.current.get(makeCacheKey(revision));
                    if (cached) return cached;
                }
                const snapshot = await getOfflineFlowSnapshot(groupId, path, revision);
                if (revision !== 'WORKTREE') {
                    snapshotCacheRef.current.set(makeCacheKey(revision), snapshot);
                }
                return snapshot;
            };

            const [loadedBase, loadedTarget] = await Promise.all([
                loadOne(baseRev),
                baseRev === targetRev ? loadOne(baseRev) : loadOne(targetRev),
            ]);
            if (requestId !== requestSeqRef.current) return;
            setBaseSnapshot(loadedBase);
            setTargetSnapshot(loadedTarget);
        } catch (err) {
            if (requestId !== requestSeqRef.current) return;
            setError(err instanceof Error ? err.message : '加载版本快照失败');
        } finally {
            if (requestId === requestSeqRef.current) {
                setLoading(false);
            }
        }
    }, [activePair.base.revision, activePair.target.revision, groupId, open, path]);

    useEffect(() => {
        let cancelled = false;
        if (!open) return;
        const forceRefresh = reloadToken !== lastReloadTokenRef.current;
        lastReloadTokenRef.current = reloadToken;
        const run = async () => {
            if (cancelled) return;
            await loadSnapshots(forceRefresh);
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [loadSnapshots, open, reloadToken]);

    // Non-blocking lookup of friendly data source names for nodes and transfer endpoints
    useEffect(() => {
        if (!open || (!baseSnapshot && !targetSnapshot)) return;
        const referencedIds = collectReferencedDataSourceIds([baseSnapshot, targetSnapshot]);
        if (referencedIds.length === 0) return;

        let cancelled = false;
        void (async () => {
            try {
                const page = await getDataSourcePage({ groupId, page: 1, size: 200 });
                if (cancelled) return;
                const names: Record<number, string> = {};
                for (const item of page.records ?? []) {
                    names[item.id] = item.name;
                }
                const missingIds = referencedIds.filter((id) => names[id] == null);
                if (missingIds.length > 0) {
                    const extras = await Promise.all(
                        missingIds.map((id) => getDataSourceById(id, groupId).catch(() => null)),
                    );
                    if (cancelled) return;
                    for (const extra of extras) {
                        if (extra) {
                            names[extra.id] = extra.name;
                        }
                    }
                }
                setDataSourceNames(names);
            } catch {
                // Keep numeric IDs as fallback if data source lookup is unavailable
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [baseSnapshot, targetSnapshot, groupId, open]);

    const diff = useMemo(() => {
        if (!baseSnapshot || !targetSnapshot) return null;
        return diffFlowVersions(baseSnapshot, targetSnapshot);
    }, [baseSnapshot, targetSnapshot]);

    const changedNodes = useMemo(() => {
        if (!diff) return [];
        return diff.nodes.filter(hasNodeChanges);
    }, [diff]);

    const selectedNodeDiff = useMemo(() => {
        if (!diff || !selectedNodeTaskId) return null;
        return diff.nodes.find((node) => node.taskId === selectedNodeTaskId) ?? null;
    }, [diff, selectedNodeTaskId]);

    const handleSwapDirection = () => {
        setActivePair((current) => ({ base: current.target, target: current.base }));
        setBaseSnapshot(targetSnapshot);
        setTargetSnapshot(baseSnapshot);
    };

    const handleRetry = () => {
        snapshotCacheRef.current.clear();
        setReloadToken((n) => n + 1);
    };

    const handleFocusNodeOnCanvas = (taskId: string) => {
        setActiveTab('nodes');
        focusSeqRef.current += 1;
        setFocusNodeRequest({ taskId, seq: focusSeqRef.current });
    };

    const sameRevision = activePair.base.revision === activePair.target.revision;

    const flowShortName = formatFlowDisplayName(path);

    const tabs = useMemo(() => {
        if (!diff) return [];
        const nodeChangeCount = diff.summary.nodes + diff.edges.length;
        return [
            { id: 'overview' as const, label: '概览', badge: null },
            { id: 'nodes' as const, label: '节点', badge: nodeChangeCount },
            { id: 'schedule' as const, label: '调度', badge: diff.summary.schedule },
            { id: 'dependencies' as const, label: '依赖', badge: diff.summary.dependencies },
            { id: 'parameters' as const, label: '参数', badge: diff.summary.parameters },
        ];
    }, [diff]);

    const totalSemanticChanges = useMemo(() => (diff ? countTotalSemanticChanges(diff) : 0), [diff]);

    const hasOpenSelector = openSelectors.base || openSelectors.target;
    const hasMoreVersions = versionItems.length < versionTotal;

    return (
        <TooltipProvider delayDuration={150}>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    ref={setDialogContentEl}
                    fullScreen
                    className="offline-version-compare-dialog"
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        (event.currentTarget as HTMLElement | null)?.focus();
                    }}
                    onEscapeKeyDown={(event) => {
                        if (hasOpenSelector) {
                            event.preventDefault();
                        }
                    }}
                >
                    <DialogHeader>
                        <div className="offline-compare-header-top">
                            <div className="offline-compare-title-row">
                                <GitCompare size={18} className="offline-compare-title-icon" aria-hidden="true" />
                                <DialogTitle>版本对比 · {flowShortName}</DialogTitle>
                                {diff ? (
                                    <span className={`offline-compare-total-badge ${totalSemanticChanges === 0 ? 'is-clean' : ''}`}>
                                        {totalSemanticChanges === 0 ? '两版本无差异' : `${totalSemanticChanges} 项变更`}
                                    </span>
                                ) : null}
                            </div>
                            <DialogDescription className="sr-only">
                                对比 {flowShortName} 两个版本的结构与配置差异
                            </DialogDescription>
                        </div>

                    <div className="offline-compare-pair-bar">
                        <CompareVersionSelector
                            roleLabel="基准"
                            tone="base"
                            value={activePair.base}
                            peerValue={activePair.target}
                            items={versionItems}
                            onlineOnly={versionOnlineOnly}
                            loading={versionLoading}
                            loadingMore={versionLoadingMore}
                            error={versionError}
                            hasMore={hasMoreVersions}
                            portalContainer={dialogContentEl}
                            onRequestOpen={ensureVersionListLoaded}
                            onOpenChange={(nextOpen) => setOpenSelectors((curr) => ({ ...curr, base: nextOpen }))}
                            onToggleOnlineOnly={handleToggleVersionOnlineOnly}
                            onLoadMore={handleLoadMoreVersions}
                            onRetry={handleRetryVersions}
                            onSelect={(selection) => handleSelectSideVersion('base', selection)}
                        />
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="offline-compare-swap-btn"
                                    onClick={handleSwapDirection}
                                    disabled={loading || sameRevision}
                                    aria-label="交换方向"
                                >
                                    <ArrowLeftRight size={14} aria-hidden="true" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="z-[2200] px-2.5 py-1 text-xs">
                                交换基准与对比版本
                            </TooltipContent>
                        </Tooltip>
                        <CompareVersionSelector
                            roleLabel="对比"
                            tone="target"
                            value={activePair.target}
                            peerValue={activePair.base}
                            items={versionItems}
                            onlineOnly={versionOnlineOnly}
                            loading={versionLoading}
                            loadingMore={versionLoadingMore}
                            error={versionError}
                            hasMore={hasMoreVersions}
                            portalContainer={dialogContentEl}
                            onRequestOpen={ensureVersionListLoaded}
                            onOpenChange={(nextOpen) => setOpenSelectors((curr) => ({ ...curr, target: nextOpen }))}
                            onToggleOnlineOnly={handleToggleVersionOnlineOnly}
                            onLoadMore={handleLoadMoreVersions}
                            onRetry={handleRetryVersions}
                            onSelect={(selection) => handleSelectSideVersion('target', selection)}
                        />
                        {(() => {
                            if (!canWrite || !onRollback) return null;
                            const baseIsCommit = !isDevelopmentVersion(activePair.base);
                            const targetIsCommit = !isDevelopmentVersion(activePair.target);
                            const candidate = activePair.target.revision === 'WORKTREE' && baseIsCommit
                                ? activePair.base
                                : activePair.base.revision === 'WORKTREE' && targetIsCommit
                                    ? activePair.target
                                    : baseIsCommit
                                        ? activePair.base
                                        : targetIsCommit
                                            ? activePair.target
                                            : null;
                            if (!candidate) return null;
                            return (
                                <button
                                    type="button"
                                    className="offline-compare-rollback-btn"
                                    onClick={() => onRollback(candidate)}
                                >
                                    <RotateCcw size={13} aria-hidden="true" />
                                    <span>回滚到 {formatRevisionTag(candidate.revision)}</span>
                                </button>
                            );
                        })()}
                    </div>
                </DialogHeader>

                {sameRevision ? (
                    <div className="offline-compare-notice" role="status">
                        <AlertTriangle size={14} aria-hidden="true" />
                        <span>
                            当前“基准”与“对比”版本指向同一提交（<code>{formatRevisionTag(activePair.base.revision)}</code>），版本内容完全一致。
                        </span>
                    </div>
                ) : null}

                {error ? (
                    <div className="offline-compare-error" role="alert">
                        <div className="offline-compare-error-body">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <span>{error}</span>
                        </div>
                        <Button type="button" variant="outline" size="xs" onClick={handleRetry}>
                            <RotateCcw size={12} aria-hidden="true" />
                            重试
                        </Button>
                    </div>
                ) : null}

                {tabs.length > 0 ? (
                    <nav className="offline-compare-tabs" aria-label="对比维度切换">
                        {tabs.map((tab) => {
                            const active = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    aria-pressed={active}
                                    className={`offline-compare-tab ${active ? 'is-active' : ''}`}
                                    onClick={() => setActiveTab(tab.id)}
                                >
                                    <span>{tab.label}</span>
                                    {tab.badge !== null ? (
                                        <span className={`offline-compare-tab-badge ${tab.badge > 0 ? 'has-changes' : ''}`}>
                                            {tab.badge}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </nav>
                ) : null}

                {loading && (!baseSnapshot || !targetSnapshot) ? (
                    <div className="offline-compare-loading" aria-live="polite">
                        <div className="offline-compare-loading-card">
                            <div className="offline-compare-spinner" aria-hidden="true" />
                            <span>正在加载两个版本的完整快照与结构差异…</span>
                        </div>
                    </div>
                ) : null}

                {diff && baseSnapshot && targetSnapshot ? (
                    <div className={`offline-compare-workspace ${loading ? 'is-refreshing' : ''}`}>
                        <OfflineSemanticDiff
                            base={activePair.base}
                            target={activePair.target}
                            baseSnapshot={baseSnapshot}
                            targetSnapshot={targetSnapshot}
                            diff={diff}
                            activeTab={activeTab}
                            dataSourceNames={dataSourceNames}
                            focusNodeRequest={focusNodeRequest}
                            onChangeTab={setActiveTab}
                            onSelectNode={(nodeDiff) => setSelectedNodeTaskId(nodeDiff.taskId)}
                            onFocusNodeOnCanvas={handleFocusNodeOnCanvas}
                        />
                    </div>
                ) : null}

                {selectedNodeDiff ? (
                    <OfflineNodeDiffDialog
                        open={Boolean(selectedNodeDiff)}
                        nodeDiff={selectedNodeDiff}
                        baseLabel={formatVersionInlineText(activePair.base)}
                        targetLabel={formatVersionInlineText(activePair.target)}
                        changedNodes={changedNodes}
                        dataSourceNames={dataSourceNames}
                        onSelectNode={(node) => setSelectedNodeTaskId(node.taskId)}
                        onClose={() => setSelectedNodeTaskId(null)}
                    />
                ) : null}
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
}
