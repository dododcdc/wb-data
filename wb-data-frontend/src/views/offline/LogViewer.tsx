// wb-data-frontend/src/views/offline/LogViewer.tsx
import { useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { formatTime } from './formatUtils';

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
    onAtBottomChange: (atBottom: boolean) => void;
}

function highlightMatches(text: string, query: string, isCurrent: boolean) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    const cls = isCurrent ? 'log-highlight-current' : 'log-highlight';
    return parts.map((part) =>
        regex.test(part) ? `<mark class="${cls}">${part}</mark>` : part
    ).join('');
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
            onAtBottomChange(atBottom);
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
                    <p
                        className="log-line-msg"
                        dangerouslySetInnerHTML={{
                            __html: searchQuery ? highlightMatches(item.message, searchQuery, isCurrentMatch) : item.message,
                        }}
                    />
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
