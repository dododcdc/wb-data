import { useCallback, useEffect, useState } from 'react';
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
import './OfflineVersionHistoryDrawer.css';

interface OfflineVersionHistoryDrawerProps {
    groupId: number;
    path: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function OfflineVersionHistoryDrawer({ groupId, path, open, onOpenChange }: OfflineVersionHistoryDrawerProps) {
    const [onlineOnly, setOnlineOnly] = useState(false);
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
                    {data?.items.map((item) => <VersionRow key={item.revision} item={item} />)}
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

function VersionRow({ item }: { item: OfflineFlowVersionItem }) {
    if (item.kind === 'DEVELOPMENT') {
        return (
            <article className="offline-version-row is-development">
                <div className="offline-version-row-main">
                    <strong>开发版本（工作区）</strong>
                    <span>{item.dirty ? '有未提交修改' : '工作区干净'}</span>
                </div>
            </article>
        );
    }
    return (
        <article className="offline-version-row">
            <div className="offline-version-row-main">
                <div className="offline-version-row-title">
                    <code>{item.revision.slice(0, 7)}</code>
                    <strong>{item.message || '无提交说明'}</strong>
                </div>
                <div className="offline-version-row-meta">
                    <span>{item.authorName || '未知作者'}</span>
                    <time>{formatTime(item.committedAt)}</time>
                </div>
                {item.publications.length ? (
                    <div className="offline-version-badges">
                        {item.publications.map((publication) => <PublicationBadge key={publication.publishRecordId} publication={publication} />)}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function PublicationBadge({ publication }: { publication: OfflineFlowPublicationItem }) {
    const failed = publication.status === 'FAILED';
    const unknown = publication.status === 'UNKNOWN';
    return (
        <span className={`offline-version-publication ${failed || unknown ? 'is-warning' : ''}`}>
            <span>线上 v{publication.onlineVersion}</span>
            {publication.currentOnline ? <strong>当前线上</strong> : null}
            {failed ? <strong>未生效</strong> : null}
            {unknown ? <strong>状态未知</strong> : null}
        </span>
    );
}

function formatTime(value: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}
