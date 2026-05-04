import { useMemo, useRef, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { formatTime } from './formatUtils';
import type { OfflineExecutionLogEntry } from '../../api/offline';

interface LogViewerProps {
    logs: OfflineExecutionLogEntry[];
    selectedTaskId: string | null;
    activeLevels: Set<string>;
    searchQuery: string;
    onAtBottomChange: (atBottom: boolean) => void;
}

function filterLogs(
    logs: OfflineExecutionLogEntry[],
    activeLevels: Set<string>,
    searchQuery: string,
): OfflineExecutionLogEntry[] {
    return logs.filter((entry) => {
        if (activeLevels.size > 0 && !activeLevels.has(entry.level ?? 'INFO')) return false;
        if (searchQuery && !(entry.message ?? '').toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });
}

export default function LogViewer({ logs, selectedTaskId, activeLevels, searchQuery, onAtBottomChange }: LogViewerProps) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const filteredLogs = useMemo(() => filterLogs(logs, activeLevels, searchQuery), [logs, activeLevels, searchQuery]);

    const isSingleNode = selectedTaskId !== null;

    const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
        onAtBottomChange(atBottom);
    }, [onAtBottomChange]);

    const scrollToBottom = useCallback(() => {
        virtuosoRef.current?.scrollToIndex({ index: filteredLogs.length - 1, behavior: 'smooth' });
    }, [filteredLogs.length]);

    if (filteredLogs.length === 0) {
        return (
            <div className="log-viewer-empty">
                {logs.length === 0 ? '当前节点暂无日志输出' : '没有匹配的日志'}
            </div>
        );
    }

    return (
        <div className="log-viewer">
            <Virtuoso
                ref={virtuosoRef}
                data={filteredLogs}
                followOutput="smooth"
                atBottomStateChange={handleAtBottomStateChange}
                itemContent={(_index, entry) => (
                    <div className="log-line">
                        <span className="log-line-time">{formatTime(entry.timestamp)}</span>
                        <strong className={`log-line-level is-${(entry.level ?? 'INFO').toLowerCase()}`}>{entry.level ?? 'INFO'}</strong>
                        {!isSingleNode && (
                            <em className="log-line-task">{entry.taskId ?? 'flow'}</em>
                        )}
                        <p className="log-line-msg">{entry.message ?? ''}</p>
                    </div>
                )}
            />
        </div>
    );
}
