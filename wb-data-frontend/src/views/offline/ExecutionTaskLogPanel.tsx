import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { getOfflineExecutionLogs, type OfflineExecutionLogEntry } from '../../api/offline';
import LogViewer, { type LogViewerHandle, type LogViewerItem } from '../../components/execution/LogViewer';
import { computeLogLevelCounts } from '../../components/execution/executionPresentation';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { useAuthStore } from '../../utils/auth';
import { getErrorMessage } from '../../utils/error';
import LogToolbar from './LogToolbar';

function toDisplayItems(logs: OfflineExecutionLogEntry[], activeLevels: Set<string>): LogViewerItem[] {
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
            return true;
        });
}

function computeMatchIndices(items: LogViewerItem[], query: string): number[] {
    if (!query) return [];
    const q = query.toLowerCase();
    const result: number[] = [];
    items.forEach((item, i) => {
        if (item.message.toLowerCase().includes(q)) {
            result.push(i);
        }
    });
    return result;
}

interface ExecutionTaskLogPanelProps {
    executionId: string;
    taskId: string;
    running: boolean;
    onBack: () => void;
}

export function ExecutionTaskLogPanel({
    executionId,
    taskId,
    running,
    onBack,
}: ExecutionTaskLogPanelProps) {
    const groupId = useAuthStore((state) => state.currentGroup?.id ?? null);
    const [logs, setLogs] = useState<OfflineExecutionLogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(true);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
    const logViewerRef = useRef<LogViewerHandle>(null);
    const logsBusy = useDelayedBusy(logsLoading);

    const fetchLogs = useCallback(async (silent = false) => {
        if (!groupId) return;
        if (!silent) {
            setLogsLoading(true);
            setLogsError(null);
        }
        try {
            const nextLogs = await getOfflineExecutionLogs(groupId, executionId, taskId);
            setLogs(nextLogs);
            setLogsError(null);
        } catch (error) {
            setLogsError(getErrorMessage(error, '暂时无法读取执行日志。'));
        } finally {
            if (!silent) setLogsLoading(false);
        }
    }, [executionId, groupId, taskId]);

    useEffect(() => {
        setLogs([]);
        setLogsError(null);
        setActiveLevels(new Set());
        setSearchQuery('');
        setCurrentMatchIndex(-1);
        setLogsLoading(true);
        void fetchLogs();
    }, [fetchLogs]);

    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => { void fetchLogs(true); }, 3000);
        return () => clearInterval(timer);
    }, [fetchLogs, running]);

    const handleToggleLevel = useCallback((level: string) => {
        setActiveLevels((prev) => {
            const next = new Set(prev);
            if (next.has(level)) {
                next.delete(level);
            } else {
                next.add(level);
                if (next.size === 3) return new Set();
            }
            return next;
        });
    }, []);

    const displayedItems = useMemo(
        () => toDisplayItems(logs, activeLevels),
        [logs, activeLevels],
    );

    const matchIndices = useMemo(
        () => computeMatchIndices(displayedItems, searchQuery),
        [displayedItems, searchQuery],
    );

    const currentMatchPosition = useMemo(
        () => (matchIndices.length > 0 && currentMatchIndex >= 0 ? matchIndices[currentMatchIndex] : -1),
        [matchIndices, currentMatchIndex],
    );

    const handleNextMatch = useCallback(() => {
        if (matchIndices.length === 0) return;
        const next = currentMatchIndex + 1 >= matchIndices.length ? 0 : currentMatchIndex + 1;
        setCurrentMatchIndex(next);
        logViewerRef.current?.scrollToIndex(matchIndices[next]);
    }, [matchIndices, currentMatchIndex]);

    const handlePrevMatch = useCallback(() => {
        if (matchIndices.length === 0) return;
        const prev = currentMatchIndex - 1 < 0 ? matchIndices.length - 1 : currentMatchIndex - 1;
        setCurrentMatchIndex(prev);
        logViewerRef.current?.scrollToIndex(matchIndices[prev]);
    }, [matchIndices, currentMatchIndex]);

    useEffect(() => {
        setCurrentMatchIndex(matchIndices.length > 0 ? 0 : -1);
    }, [matchIndices]);

    const levelCounts = useMemo(() => computeLogLevelCounts(logs), [logs]);

    return (
        <section className="offline-execution-log-panel" aria-label={`${taskId} 日志`}>
            <div className="offline-execution-log-header">
                <button type="button" className="offline-execution-log-back" onClick={onBack}>
                    <ArrowLeft size={14} />
                    返回执行详情
                </button>
                <strong className="offline-execution-log-task">{taskId}</strong>
            </div>
            <LogToolbar
                levelCounts={levelCounts}
                activeLevels={activeLevels}
                onToggleLevel={handleToggleLevel}
                onSearch={setSearchQuery}
                onScrollToBottom={() => logViewerRef.current?.scrollToBottom()}
                isAtBottom={isAtBottom}
                matchCount={matchIndices.length}
                currentMatchIndex={currentMatchIndex}
                onNextMatch={handleNextMatch}
                onPrevMatch={handlePrevMatch}
            />
            {logsBusy ? (
                <div className="log-viewer-loading">
                    <div className="log-viewer-skeleton">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div key={i} className="log-line-skeleton">
                                <span className="skeleton-block w-16" />
                                <span className="skeleton-block w-10" />
                                <span className="skeleton-block w-full" />
                            </div>
                        ))}
                    </div>
                </div>
            ) : logsError ? (
                <div className="log-viewer-error">
                    <p>{logsError}</p>
                    <button type="button" onClick={() => { void fetchLogs(); }}>重试</button>
                </div>
            ) : logsLoading && logs.length === 0 ? (
                <div className="offline-execution-log-pending" aria-hidden="true" />
            ) : (
                <LogViewer
                    ref={logViewerRef}
                    items={displayedItems}
                    searchQuery={searchQuery}
                    currentMatchPosition={currentMatchPosition}
                    onAtBottomChange={setIsAtBottom}
                />
            )}
        </section>
    );
}
