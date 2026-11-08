import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert } from 'lucide-react';

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
import './OfflineVersionHistoryDrawer.css';

interface OfflineVersionHistoryDrawerProps {
    groupId: number;
    path: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCompare: (base: VersionSelection, target: VersionSelection) => void;
}

export function OfflineVersionHistoryDrawer({ groupId, path, open, onOpenChange, onCompare }: OfflineVersionHistoryDrawerProps) {
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [selectedVersions, setSelectedVersions] = useState<VersionSelection[]>([]);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<OfflineFlowVersionHistoryResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!open) return;
        setLoading(true);
        setError(null);
        try {
            const response = await getOfflineFlowVersions(groupId, path, { onlineOnly, page, size: 50 });
            setData(response);
        } catch {
            setError('版本历史读取失败，请重试');
        } finally {
            setLoading(false);
        }
    }, [groupId, onlineOnly, open, page, path]);

    useEffect(() => {
        void load();
    }, [load]);

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
    const currentOnline = useMemo(() => {
        for (const item of data?.items ?? []) {
            const publication = item.publications.find((candidate) => candidate.currentOnline);
            if (publication) {
                return { revision: publication.afterSha, label: `线上 v${publication.onlineVersion} · ${publication.afterSha.slice(0, 7)}` };
            }
        }
        return null;
    }, [data]);

    const toggleSelection = (selection: VersionSelection) => {
        setSelectedVersions((current) => {
            if (current.some((item) => item.revision === selection.revision && item.label === selection.label)) {
                return current.filter((item) => !(item.revision === selection.revision && item.label === selection.label));
            }
            return [...current, selection].slice(-2);
        });
    };

    const compareSelected = () => {
        if (selectedVersions.length !== 2) return;
        const indexed = selectedVersions.map((selection) => ({
            selection,
            index: data?.items.findIndex((item) => item.revision === selection.revision || item.publications.some((publication) => publication.afterSha === selection.revision)) ?? -1,
        }));
        indexed.sort((left, right) => {
            if (left.selection.revision === 'WORKTREE') return 1;
            if (right.selection.revision === 'WORKTREE') return -1;
            return right.index - left.index;
        });
        onCompare(indexed[0].selection, indexed[1].selection);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent fullScreen className="offline-version-history-drawer">
                <DialogHeader>
                    <DialogTitle>版本历史</DialogTitle>
                    <DialogDescription>分支 {data?.branch ?? '—'} · 开发版本、提交版本与线上版本</DialogDescription>
                </DialogHeader>

                <div className="offline-version-history-filter">
                    <label>
                        <input
                            type="checkbox"
                            checked={onlineOnly}
                            onChange={(event) => {
                                setOnlineOnly(event.target.checked);
                                setPage(1);
                            }}
                        />
                        只看线上版本
                    </label>
                    {data ? <span>{data.total} 个提交</span> : null}
                </div>

                <div className="offline-version-history-list">
                    {loading ? (
                        <div className="offline-version-history-skeleton" aria-hidden="true">
                            <span /><span /><span />
                        </div>
                    ) : null}
                    {error ? (
                        <div className="offline-version-history-error" role="alert">
                            <CircleAlert size={16} />
                            <span>{error}</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>重试</Button>
                        </div>
                    ) : null}
                    {!loading && !error && data?.items.length === 0 ? (
                        <p className="offline-version-history-empty">当前筛选下没有版本记录</p>
                    ) : null}
                    {data?.items.map((item) => (
                        <VersionRow
                            key={item.revision}
                            item={item}
                            selectedVersions={selectedVersions}
                            onToggle={toggleSelection}
                            onCompareDevelopment={() => onCompare(
                                { revision: item.revision, label: item.message || item.revision.slice(0, 7) },
                                { revision: 'WORKTREE', label: '开发版本' },
                            )}
                        />
                    ))}
                </div>

                <div className="offline-version-history-actions">
                    {currentOnline ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onCompare(currentOnline, { revision: 'WORKTREE', label: '开发版本' })}>
                            与当前线上对比
                        </Button>
                    ) : null}
                    <Button type="button" size="sm" disabled={selectedVersions.length !== 2} onClick={compareSelected}>
                        对比所选{selectedVersions.length ? `（${selectedVersions.length}/2）` : ''}
                    </Button>
                </div>

                {data && data.total > data.size ? (
                    <div className="offline-version-history-pagination">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={page <= 1 || loading}
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                        >
                            <ChevronLeft size={14} />上一页
                        </Button>
                        <span>{page} / {totalPages}</span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={page >= totalPages || loading}
                            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                        >
                            下一页<ChevronRight size={14} />
                        </Button>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

interface VersionRowProps {
    item: OfflineFlowVersionItem;
    selectedVersions: VersionSelection[];
    onToggle: (selection: VersionSelection) => void;
    onCompareDevelopment: () => void;
}

function VersionRow({ item, selectedVersions, onToggle, onCompareDevelopment }: VersionRowProps) {
    const selected = (revision: string) => selectedVersions.some((selection) => selection.revision === revision);
    if (item.kind === 'DEVELOPMENT') {
        return (
            <article className="offline-version-row is-development">
                <input
                    type="checkbox"
                    aria-label="选择开发版本"
                    checked={selected('WORKTREE')}
                    onChange={() => onToggle({ revision: 'WORKTREE', label: '开发版本' })}
                />
                <div className="offline-version-row-main">
                    <strong>开发版本（工作区）</strong>
                    <span>{item.dirty ? '有未提交修改' : '工作区干净'}</span>
                </div>
            </article>
        );
    }
    return (
        <article className="offline-version-row">
            <input
                type="checkbox"
                aria-label={`选择提交 ${item.revision.slice(0, 7)}`}
                checked={selected(item.revision)}
                onChange={() => onToggle({ revision: item.revision, label: item.message || item.revision.slice(0, 7) })}
            />
            <div className="offline-version-row-main">
                <div className="offline-version-row-title">
                    <code>{item.revision.slice(0, 7)}</code>
                    <strong>{item.message || '无提交说明'}</strong>
                </div>
                <div className="offline-version-row-meta">
                    <span>{item.authorName || '未知作者'}</span>
                    <time>{formatTime(item.committedAt)}</time>
                </div>
                <div className="offline-version-row-actions">
                    <button type="button" onClick={onCompareDevelopment}>与开发版本对比</button>
                </div>
                {item.publications.length ? (
                    <div className="offline-version-badges">
                        {item.publications.map((publication) => (
                            <PublicationBadge
                                key={publication.publishRecordId}
                                publication={publication}
                                selected={selected(publication.afterSha)}
                                onToggle={() => onToggle({
                                    revision: publication.afterSha,
                                    label: `线上 v${publication.onlineVersion} · ${publication.afterSha.slice(0, 7)}`,
                                })}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

interface PublicationBadgeProps {
    publication: OfflineFlowPublicationItem;
    selected: boolean;
    onToggle: () => void;
}

function PublicationBadge({ publication, selected, onToggle }: PublicationBadgeProps) {
    const failed = publication.status === 'FAILED';
    const unknown = publication.status === 'UNKNOWN';
    return (
        <button
            type="button"
            aria-pressed={selected}
            className={`offline-version-publication ${failed || unknown ? 'is-warning' : ''} ${selected ? 'is-selected' : ''}`}
            onClick={onToggle}
        >
            <span>线上 v{publication.onlineVersion}</span>
            {publication.currentOnline ? <strong>当前线上</strong> : null}
            {failed ? <strong>未生效</strong> : null}
            {unknown ? <strong>状态未知</strong> : null}
        </button>
    );
}

function formatTime(value: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}
