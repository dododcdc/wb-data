import { useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { formatTime } from '../../lib/dateTime';
import './LogViewer.css';

export interface LogViewerItem {
    timestamp: string;
    level: string;
    taskId: string;
    message: string;
    index: number;
}

interface LogViewerProps {
    items: LogViewerItem[];
    searchQuery: string;
    currentMatchPosition: number;
    onAtBottomChange?: (atBottom: boolean) => void;
}

function renderHighlightedMessage(text: string, query: string, isCurrent: boolean): ReactNode {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return text;

    const lowerText = text.toLowerCase();
    const lowerQuery = normalizedQuery.toLowerCase();
    const parts: ReactNode[] = [];
    let cursor = 0;
    let next = lowerText.indexOf(lowerQuery);

    while (next !== -1) {
        if (next > cursor) {
            parts.push(text.slice(cursor, next));
        }
        const end = next + normalizedQuery.length;
        parts.push(
            <mark key={`${next}-${end}`} className={isCurrent ? 'log-highlight-current' : 'log-highlight'}>
                {text.slice(next, end)}
            </mark>,
        );
        cursor = end;
        next = lowerText.indexOf(lowerQuery, cursor);
    }

    if (cursor < text.length) {
        parts.push(text.slice(cursor));
    }
    return parts;
}

export interface LogViewerHandle {
    scrollToBottom: () => void;
    scrollToIndex: (index: number) => void;
}

const LogViewer = forwardRef<LogViewerHandle, LogViewerProps>(function LogViewer(
    { items, searchQuery, currentMatchPosition, onAtBottomChange },
    ref,
) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const handleAtBottomStateChange = useCallback(
        (atBottom: boolean) => {
            onAtBottomChange?.(atBottom);
        },
        [onAtBottomChange],
    );

    const scrollToBottom = useCallback(() => {
        if (items.length > 0) {
            virtuosoRef.current?.scrollToIndex({ index: items.length - 1, behavior: 'smooth' });
        }
    }, [items.length]);

    const scrollToIndex = useCallback((index: number) => {
        virtuosoRef.current?.scrollToIndex({ index, behavior: 'smooth', align: 'center' });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom, scrollToIndex }), [scrollToBottom, scrollToIndex]);

    const renderItem = useCallback(
        (_index: number, item: LogViewerItem) => {
            const isCurrentMatch = _index === currentMatchPosition;
            return (
                <div className="log-line">
                    <span className="log-line-time">{formatTime(item.timestamp) || '—'}</span>
                    <span className={`log-line-level is-${item.level.toLowerCase()}`}>{item.level}</span>
                    <span className="log-line-task" title={item.taskId}>{item.taskId}</span>
                    <p className="log-line-msg">{renderHighlightedMessage(item.message, searchQuery, isCurrentMatch)}</p>
                </div>
            );
        },
        [searchQuery, currentMatchPosition],
    );

    if (items.length === 0) {
        return <div className="log-viewer-empty">暂无日志</div>;
    }

    return (
        <div className="log-viewer">
            <Virtuoso
                ref={virtuosoRef}
                style={{ height: '100%' }}
                data={items}
                itemContent={renderItem}
                followOutput="smooth"
                atBottomStateChange={handleAtBottomStateChange}
            />
        </div>
    );
});

export default LogViewer;
