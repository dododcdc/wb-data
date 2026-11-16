import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeftRight,
    CheckCircle2,
    Clock,
    GitBranch,
    GitCommitHorizontal,
    History,
    RotateCcw,
    Tag,
    X,
} from 'lucide-react';
import {
    getOfflineFlowVersions,
    type OfflineFlowPublicationItem,
    type OfflineFlowVersionHistoryResponse,
    type OfflineFlowVersionItem,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import type { VersionSelection } from './OfflineVersionCompareDialog';
import {
    buildCommitVersionSelection,
    buildPublicationVersionSelection,
    buildWorktreeVersionSelection,
    formatFlowDisplayName,
    formatRevisionTag,
    formatVersionTime,
} from './versionComparePresentation';
import './OfflineVersionHistoryDrawer.css';

const PAGE_SIZE = 50;

interface OfflineVersionHistoryDrawerProps {
    groupId: number;
    path: string;
    open: boolean;
    canWrite?: boolean;
    onOpenChange: (open: boolean) => void;
    onCompare: (base: VersionSelection, target: VersionSelection) => void;
    onRollback?: (selection: VersionSelection) => void;
}

function orderVersionPair(first: VersionSelection, second: VersionSelection): [VersionSelection, VersionSelection] {
    if (first.revision === 'WORKTREE' && second.revision !== 'WORKTREE') {
        return [second, first];
    }
    if (second.revision === 'WORKTREE' && first.revision !== 'WORKTREE') {
        return [first, second];
    }
    const firstTime = first.committedAt ? Date.parse(first.committedAt) : Number.NaN;
    const secondTime = second.committedAt ? Date.parse(second.committedAt) : Number.NaN;
    if (!Number.isNaN(firstTime) && !Number.isNaN(secondTime) && firstTime !== secondTime) {
        return firstTime < secondTime ? [first, second] : [second, first];
    }
    if (first.orderIndex != null && second.orderIndex != null && first.orderIndex !== second.orderIndex) {
        return first.orderIndex > second.orderIndex ? [first, second] : [second, first];
    }
    return [first, second];
}

export function OfflineVersionHistoryDrawer({
    groupId,
    path,
    open,
    canWrite = false,
    onOpenChange,
    onCompare,
    onRollback,
}: OfflineVersionHistoryDrawerProps) {
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [selectedVersions, setSelectedVersions] = useState<VersionSelection[]>([]);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<OfflineFlowVersionHistoryResponse | null>(null);
    const [cachedDevItem, setCachedDevItem] = useState<OfflineFlowVersionItem | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestSeqRef = useRef(0);

    // Reset drawer state when switching tasks
    useEffect(() => {
        setOnlineOnly(false);
        setSelectedVersions([]);
        setPage(1);
        setData(null);
        setCachedDevItem(null);
        setError(null);
    }, [groupId, path]);

    // Clear ephemeral selection and error when closing the drawer
    useEffect(() => {
        if (!open) {
            setSelectedVersions([]);
            setCachedDevItem(null);
            setError(null);
        }
    }, [open]);

    const load = useCallback(async () => {
        if (!open) return;
        const seq = ++requestSeqRef.current;
        setLoading(true);
        setError(null);
        try {
            const response = await getOfflineFlowVersions(groupId, path, { onlineOnly, page, size: PAGE_SIZE });
            if (seq === requestSeqRef.current) {
                setData(response);
                const liveDevItem = response.items.find((item) => item.kind === 'DEVELOPMENT');
                if (liveDevItem) {
                    setCachedDevItem(liveDevItem);
                }
            }
        } catch (err) {
            if (seq === requestSeqRef.current) {
                setError(err instanceof Error ? err.message : '加载版本历史失败');
            }
        } finally {
            if (seq === requestSeqRef.current) {
                setLoading(false);
            }
        }
    }, [groupId, path, onlineOnly, page, open]);

    useEffect(() => {
        void load();
    }, [load]);

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

    const currentOnline = useMemo<VersionSelection | null>(() => {
        const items = data?.items ?? [];
        for (let idx = 0; idx < items.length; idx += 1) {
            const item = items[idx];
            const publication = item.publications.find((candidate) => candidate.currentOnline);
            if (publication) {
                return buildPublicationVersionSelection(item, publication, (page - 1) * PAGE_SIZE + idx);
            }
        }
        return null;
    }, [data, page]);

    const worktreeSelection = useMemo(() => {
        const devItem = data?.items.find((item) => item.kind === 'DEVELOPMENT') ?? cachedDevItem ?? undefined;
        return buildWorktreeVersionSelection(devItem);
    }, [cachedDevItem, data]);

    const toggleSelection = (selection: VersionSelection) => {
        setSelectedVersions((current) => {
            const exists = current.some((item) => item.revision === selection.revision && item.label === selection.label);
            if (exists) {
                return current.filter((item) => !(item.revision === selection.revision && item.label === selection.label));
            }
            if (current.length >= 2) {
                return [current[1], selection];
            }
            return [...current, selection];
        });
    };

    const orderedPair = useMemo<[VersionSelection, VersionSelection] | null>(() => {
        if (selectedVersions.length !== 2) return null;
        return orderVersionPair(selectedVersions[0], selectedVersions[1]);
    }, [selectedVersions]);

    const sameRevisionSelected = Boolean(
        orderedPair && orderedPair[0].revision === orderedPair[1].revision,
    );

    const compareSelected = () => {
        if (!orderedPair) return;
        onCompare(orderedPair[0], orderedPair[1]);
    };

    const flowShortName = formatFlowDisplayName(path);

    const hasItems = (data?.items.length ?? 0) > 0;
    const countLabel = onlineOnly ? '个线上版本' : '条历史记录';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent fullScreen className="offline-version-history-drawer">
                <DialogHeader>
                    <div className="offline-version-history-title-row">
                        <div className="offline-version-history-title-group">
                            <DialogTitle>
                                <History size={16} className="offline-version-title-icon" aria-hidden="true" />
                                版本历史 · {flowShortName}
                            </DialogTitle>
                            <DialogDescription className="sr-only">
                                查看提交、线上发布与当前工作区记录，并进行结构与节点差异对比
                            </DialogDescription>
                        </div>
                        {data?.branch ? (
                            <span className="offline-version-branch" title={`Git 分支 ${data.branch}`}>
                                <GitBranch size={12} aria-hidden="true" />
                                {data.branch}
                            </span>
                        ) : null}
                    </div>
                </DialogHeader>

                <div className="offline-version-history-toolbar">
                    <label className="offline-version-filter-toggle">
                        <input
                            type="checkbox"
                            checked={onlineOnly}
                            onChange={(event) => {
                                setOnlineOnly(event.target.checked);
                                setPage(1);
                            }}
                        />
                        <span>只看线上版本</span>
                    </label>
                    <div className="offline-version-toolbar-right">
                        {loading && hasItems ? <span className="offline-version-syncing">刷新中…</span> : null}
                        {data ? (
                            <span className="offline-version-count">
                                {data.total} {countLabel}
                            </span>
                        ) : null}
                    </div>
                </div>

                {error ? (
                    <div className="offline-version-history-error" role="alert">
                        <div className="offline-version-history-error-body">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <span>{error}</span>
                        </div>
                        <button type="button" className="offline-version-retry-btn" onClick={() => void load()}>
                            <RotateCcw size={12} aria-hidden="true" />
                            重试
                        </button>
                    </div>
                ) : null}

                <div className={`offline-version-history-list ${loading && hasItems ? 'is-refreshing' : ''}`}>
                    {loading && !hasItems ? (
                        <div className="offline-version-skeletons" aria-label="正在加载版本列表">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="offline-version-skeleton" />
                            ))}
                        </div>
                    ) : null}

                    {!loading && !error && data && !hasItems ? (
                        <div className="offline-version-empty">
                            <GitCommitHorizontal size={24} className="offline-version-empty-icon" aria-hidden="true" />
                            <p className="offline-version-empty-title">
                                {onlineOnly ? '暂无线上发布版本' : '暂无 Git 提交记录'}
                            </p>
                            <p className="offline-version-empty-hint">
                                {onlineOnly
                                    ? '取消“只看线上版本”可查看本地提交和工作区草稿'
                                    : '完成首次保存并提交后，可在此对比历史演进差异'}
                            </p>
                        </div>
                    ) : null}

                    {data?.items.map((item, idx) => {
                        const globalOrderIndex = (page - 1) * PAGE_SIZE + idx;
                        const nextItem = data.items[idx + 1];
                        const previousCommit = nextItem?.kind === 'COMMIT' ? nextItem : null;
                        const previousOrderIndex = globalOrderIndex + 1;
                        return (
                            <VersionRow
                                key={item.revision}
                                item={item}
                                orderIndex={globalOrderIndex}
                                selectedVersions={selectedVersions}
                                onToggle={toggleSelection}
                                onCompareDevelopment={() => onCompare(
                                    buildCommitVersionSelection(item, globalOrderIndex),
                                    worktreeSelection,
                                )}
                                onComparePrevious={previousCommit ? () => onCompare(
                                    buildCommitVersionSelection(previousCommit, previousOrderIndex),
                                    buildCommitVersionSelection(item, globalOrderIndex),
                                ) : null}
                                onRollback={canWrite && onRollback ? onRollback : undefined}
                            />
                        );
                    })}
                </div>

                <div className="offline-version-history-footer">
                    {orderedPair ? (
                        <div className="offline-version-pair-preview">
                            <span className="offline-version-pair-pill">
                                <strong>基准</strong>
                                <code>{formatRevisionTag(orderedPair[0].revision)}</code>
                            </span>
                            <ArrowLeftRight size={12} className="offline-version-pair-arrow" aria-hidden="true" />
                            <span className="offline-version-pair-pill">
                                <strong>对比</strong>
                                <code>{formatRevisionTag(orderedPair[1].revision)}</code>
                            </span>
                            {sameRevisionSelected ? (
                                <span className="offline-version-same-warning" role="status">
                                    <AlertTriangle size={12} aria-hidden="true" />
                                    同一提交（内容一致）
                                </span>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="offline-version-history-actions">
                        <div className="offline-version-selection-meta">
                            <span className="offline-version-history-selection" aria-live="polite">
                                {selectedVersions.length === 0 ? '选择两个版本进行对比' : `已选 ${selectedVersions.length}/2 个版本`}
                            </span>
                            {selectedVersions.length > 0 ? (
                                <button
                                    type="button"
                                    className="offline-version-clear-btn"
                                    onClick={() => setSelectedVersions([])}
                                >
                                    <X size={12} aria-hidden="true" />
                                    清空
                                </button>
                            ) : null}
                        </div>

                        <div className="offline-version-action-buttons">
                            {currentOnline ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onCompare(currentOnline, worktreeSelection)}
                                >
                                    与当前线上对比
                                </Button>
                            ) : null}
                            <Button type="button" size="sm" disabled={selectedVersions.length !== 2} onClick={compareSelected}>
                                对比所选
                            </Button>
                        </div>
                    </div>

                    {totalPages > 1 ? (
                        <div className="offline-version-history-pagination">
                            <Button type="button" variant="outline" size="xs" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                                上一页
                            </Button>
                            <span>第 {page} / {totalPages} 页</span>
                            <Button type="button" variant="outline" size="xs" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                                下一页
                            </Button>
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface VersionRowProps {
    item: OfflineFlowVersionItem;
    orderIndex: number;
    selectedVersions: VersionSelection[];
    onToggle: (selection: VersionSelection) => void;
    onCompareDevelopment: () => void;
    onComparePrevious: (() => void) | null;
    onRollback?: (selection: VersionSelection) => void;
}

function VersionRow({
    item,
    orderIndex,
    selectedVersions,
    onToggle,
    onCompareDevelopment,
    onComparePrevious,
    onRollback,
}: VersionRowProps) {
    const isSelected = (selection: VersionSelection) => selectedVersions.some((candidate) => (
        candidate.revision === selection.revision && candidate.label === selection.label
    ));

    if (item.kind === 'DEVELOPMENT') {
        const selection = buildWorktreeVersionSelection(item);
        const checked = isSelected(selection);
        return (
            <div className={`offline-version-row is-development ${checked ? 'is-selected' : ''}`}>
                <div className="offline-version-row-rail" aria-hidden="true">
                    <span className="offline-version-dot is-development" />
                </div>
                <div className="offline-version-row-card">
                    <div className="offline-version-row-main">
                        <label className="offline-version-check">
                            <input
                                type="checkbox"
                                checked={checked}
                                aria-label="选择开发版本"
                                onChange={() => onToggle(selection)}
                            />
                            <span className="offline-version-message">开发版本（工作区）</span>
                        </label>
                        <div className="offline-version-row-tags">
                            {item.dirty ? (
                                <span className="offline-version-dirty-pill">有未提交修改</span>
                            ) : (
                                <span className="offline-version-clean-pill">
                                    <CheckCircle2 size={11} aria-hidden="true" />
                                    工作区干净
                                </span>
                            )}
                            <code className="offline-version-sha">工作区</code>
                        </div>
                    </div>
                    <p className="offline-version-dev-hint">
                        包含画布与脚本当前保存的草稿状态，可直接与任意历史提交或线上版本对比
                    </p>
                </div>
            </div>
        );
    }

    const shortRev = item.revision.slice(0, 7);
    const commitSelection = buildCommitVersionSelection(item, orderIndex);
    const checked = isSelected(commitSelection);
    const hasCurrentOnline = item.publications.some((pub) => pub.currentOnline);

    return (
        <div className={`offline-version-row ${checked ? 'is-selected' : ''} ${hasCurrentOnline ? 'is-online' : ''}`}>
            <div className="offline-version-row-rail" aria-hidden="true">
                <span className={`offline-version-dot ${hasCurrentOnline ? 'is-online' : ''}`} />
            </div>
            <div className="offline-version-row-card">
                <div className="offline-version-row-main">
                    <label className="offline-version-check">
                        <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`选择提交 ${shortRev}`}
                            onChange={() => onToggle(commitSelection)}
                        />
                        <span className="offline-version-message">{item.message || '未填写提交说明'}</span>
                    </label>
                    <code className="offline-version-sha" title={item.revision}>{shortRev}</code>
                </div>

                <div className="offline-version-row-meta">
                    <div className="offline-version-author-time">
                        <span>{item.authorName || '未知作者'}</span>
                        <span className="offline-version-meta-separator" aria-hidden="true">·</span>
                        <time dateTime={item.committedAt ?? undefined} className="offline-version-time">
                            <Clock size={11} aria-hidden="true" />
                            {formatVersionTime(item.committedAt)}
                        </time>
                    </div>
                    <div className="offline-version-row-actions">
                        {onComparePrevious ? (
                            <button type="button" className="offline-version-quick-btn" onClick={onComparePrevious}>
                                与上一版对比
                            </button>
                        ) : null}
                        <button type="button" className="offline-version-quick-btn" onClick={onCompareDevelopment}>
                            与开发版本对比
                        </button>
                        {onRollback ? (
                            <button
                                type="button"
                                className="offline-version-quick-btn is-rollback"
                                onClick={() => onRollback(commitSelection)}
                            >
                                回滚到此版本
                            </button>
                        ) : null}
                    </div>
                </div>

                {item.publications.length ? (
                    <div className="offline-version-badges">
                        {item.publications.map((publication) => {
                            const publicationSelection = buildPublicationVersionSelection(item, publication, orderIndex);
                            return (
                                <PublicationBadge
                                    key={publication.publishRecordId}
                                    publication={publication}
                                    selected={isSelected(publicationSelection)}
                                    onSelect={() => onToggle(publicationSelection)}
                                />
                            );
                        })}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function PublicationBadge({
    publication,
    selected,
    onSelect,
}: {
    publication: OfflineFlowPublicationItem;
    selected: boolean;
    onSelect: () => void;
}) {
    const failed = publication.status !== 'SUCCESS';
    return (
        <button
            type="button"
            className={`offline-publication-badge ${publication.currentOnline ? 'is-current' : ''} ${failed ? 'is-failed' : ''} ${selected ? 'is-selected' : ''}`}
            aria-pressed={selected}
            onClick={onSelect}
        >
            <Tag size={11} aria-hidden="true" />
            <span>线上 v{publication.onlineVersion}</span>
            {publication.currentOnline ? <span className="offline-publication-tag">当前线上</span> : null}
            {failed ? <span className="offline-publication-tag is-failed">{publication.status}</span> : null}
        </button>
    );
}
