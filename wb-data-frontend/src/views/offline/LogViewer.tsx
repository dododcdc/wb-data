// wb-data-frontend/src/views/offline/LogViewer.tsx
import { useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { OfflineExecutionLogEntry } from '../../api/offline';
import { formatTime } from './formatUtils';

interface LogViewerItem {
    timestamp: string;
    level: string;
    taskId: string;
    message: string;
    index: number;
}

interface LogViewerProps {
    logs: OfflineExecutionLogEntry[];
    selectedTaskId: string;
    activeLevels: Set<string>;
    searchQuery: string;
    onAtBottomChange: (atBottom: boolean) => void;
}

function highlightMatches(text: string, query: string) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
        regex.test(part) ? `<mark class="log-highlight">${part}</mark>` : part
    ).join('');
}

export interface LogViewerHandle {
    scrollToBottom: () => void;
}

const LogViewer = forwardRef<LogViewerHandle, LogViewerProps>(function LogViewer(
    { logs, selectedTaskId, activeLevels, searchQuery, onAtBottomChange },
    ref,
) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const filtered = useMemo(() => {
        return logs
            .map((entry, index) => ({
                timestamp: entry.timestamp ?? '',
                level: entry.level ?? 'INFO',
                taskId: entry.taskId ?? 'flow',
                message: entry.message ?? '',
                index,
            }))
            .filter((item) => {
                if (activeLevels.size > 0 && !activeLevels.has(item.level)) return false;
                if (searchQuery) {
                    const q = searchQuery.toLowerCase();
                    const haystack = `${item.timestamp} ${item.level} ${item.taskId} ${item.message}`.toLowerCase();
                    if (!haystack.includes(q)) return false;
                }
                return true;
            });
    }, [logs, activeLevels, searchQuery]);

    const handleAtBottomStateChange = useCallback(
        (atBottom: boolean) => {
            onAtBottomChange(atBottom);
        },
        [onAtBottomChange],
    );

    const scrollToBottom = useCallback(() => {
        if (filtered.length > 0) {
            virtuosoRef.current?.scrollToIndex({ index: filtered.length - 1, behavior: 'smooth' });
        }
    }, [filtered.length]);

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

    const renderItem = useCallback(
        (_index: number, item: LogViewerItem) => {
            return (
                <div className="log-line">
                    <span className="log-line-time">{formatTime(item.timestamp) || '—'}</span>
                    <span className={`log-line-level is-${item.level.toLowerCase()}`}>{item.level}</span>
                    <p
                        className="log-line-msg"
                        dangerouslySetInnerHTML={{
                            __html: searchQuery ? highlightMatches(item.message, searchQuery) : item.message,
                        }}
                    />
                </div>
            );
        },
        [searchQuery],
    );

    if (logs.length === 0 && !searchQuery) {
        return <div className="log-viewer-empty">暂无日志</div>;
    }

    if (filtered.length === 0 && logs.length > 0) {
        return <div className="log-viewer-empty">没有匹配当前过滤条件的日志。</div>;
    }

    return (
        <div className="log-viewer">
            <Virtuoso
                ref={virtuosoRef}
                style={{ height: '100%' }}
                data={filtered}
                itemContent={renderItem}
                followOutput="smooth"
                atBottomStateChange={handleAtBottomStateChange}
            />
        </div>
    );
});

export default LogViewer;
