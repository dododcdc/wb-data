// wb-data-frontend/src/views/offline/ExecutionDetailPage.tsx
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    getOfflineExecution,
    getOfflineExecutionLogs,
    type OfflineExecutionDetail,
    type OfflineExecutionLogEntry,
} from '../../api/offline';
import { useAuthStore } from '../../utils/auth';
import { getErrorMessage } from '../../utils/error';
import { isRunningStatus } from './executionPresentation';
import ExecutionTopBar from './ExecutionTopBar';
import ExecutionNodeTabs from './ExecutionNodeTabs';
import LogToolbar from './LogToolbar';
import LogViewer, { type LogViewerHandle } from './LogViewer';
import './ExecutionDetailPage.css';

function getFirstVisibleTaskId(taskRuns: { taskId: string }[]) {
    return taskRuns.find(t => !t.taskId.startsWith('parallel_') && t.taskId !== 'flow_dag')?.taskId ?? '';
}

function computeLevelCounts(logs: OfflineExecutionLogEntry[]) {
    const counts = { ERROR: 0, WARN: 0, INFO: 0 };
    for (const entry of logs) {
        const level = entry.level ?? 'INFO';
        if (level in counts) {
            counts[level as keyof typeof counts]++;
        }
    }
    return counts;
}


export default function ExecutionDetailPage() {
    const navigate = useNavigate();
    const { executionId } = useParams<{ executionId: string }>();
    const [searchParams] = useSearchParams();
    const initialTaskId = searchParams.get('taskId');
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const groupId = currentGroup?.id ?? null;

    const [detail, setDetail] = useState<OfflineExecutionDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [logs, setLogs] = useState<OfflineExecutionLogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [selectedTaskId, setSelectedTaskId] = useState<string>(initialTaskId ?? '');
    const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [isAtBottom, setIsAtBottom] = useState(true);
    const logViewerRef = useRef<LogViewerHandle>(null);

    // Reset when execution changes
    useEffect(() => {
        setDetail(null);
        setDetailError(null);
        setLogs([]);
        setLogsError(null);
        setSelectedTaskId(initialTaskId ?? '');
        setActiveLevels(new Set());
        setSearchQuery('');
    }, [executionId, groupId, initialTaskId]);

    // Default to first visible node when no initial taskId and detail loads
    useEffect(() => {
        if (detail && !selectedTaskId && !initialTaskId) {
            const firstId = getFirstVisibleTaskId(detail.taskRuns);
            if (firstId) setSelectedTaskId(firstId);
        }
    }, [detail, selectedTaskId, initialTaskId]);

    // Fetch execution detail
    useEffect(() => {
        if (!groupId || !executionId) return;
        let cancelled = false;
        setDetailLoading(true);
        setDetailError(null);
        void getOfflineExecution(groupId, executionId)
            .then((nextDetail) => { if (!cancelled) setDetail(nextDetail); })
            .catch((error) => { if (!cancelled) setDetailError(getErrorMessage(error, '暂时无法读取执行详情。')); })
            .finally(() => { if (!cancelled) setDetailLoading(false); });
        return () => { cancelled = true; };
    }, [executionId, groupId]);

    // Fetch logs (refetched on tab change)
    const fetchLogs = useCallback(async (taskId: string) => {
        if (!groupId || !executionId) return;
        setLogsLoading(true);
        setLogsError(null);
        try {
            const nextLogs = await getOfflineExecutionLogs(groupId, executionId, taskId || null);
            setLogs(nextLogs);
        } catch (error) {
            setLogsError(getErrorMessage(error, '暂时无法读取执行日志。'));
        } finally {
            setLogsLoading(false);
        }
    }, [executionId, groupId]);

    useEffect(() => {
        if (selectedTaskId) void fetchLogs(selectedTaskId);
    }, [fetchLogs, selectedTaskId]);

    // Auto-refresh for running executions
    useEffect(() => {
        if (!detail || !isRunningStatus(detail.status)) return;
        const timer = setInterval(() => { void fetchLogs(selectedTaskId); }, 3000);
        return () => clearInterval(timer);
    }, [detail, fetchLogs, selectedTaskId]);

    const handleToggleLevel = useCallback((level: string) => {
        setActiveLevels((prev) => {
            const next = new Set(prev);
            if (next.has(level)) {
                next.delete(level);
            } else {
                next.add(level);
                // If all levels are now selected, clear the filter
                if (next.size === 3) return new Set();
            }
            return next;
        });
    }, []);

    const handleBack = useCallback(() => {
        const flowPath = detail?.flowPath;
        if (flowPath) {
            navigate(`/offline?flowPath=${encodeURIComponent(flowPath)}`);
        } else {
            navigate('/offline');
        }
    }, [navigate, detail?.flowPath]);

    const levelCounts = useMemo(() => computeLevelCounts(logs), [logs]);

    if (!groupId || !executionId) {
        return <div className="log-page-empty">缺少执行上下文，无法读取详情。</div>;
    }

    if (detailLoading) {
        return <div className="log-page-empty">正在读取执行详情...</div>;
    }

    if (detailError) {
        return <div className="log-page-empty">{detailError}</div>;
    }

    if (!detail) {
        return <div className="log-page-empty">未找到这条执行记录。</div>;
    }

    return (
        <div className="log-page">
            <ExecutionTopBar
                flowPath={detail.flowPath}
                status={detail.status}
                startDate={detail.startDate ?? detail.createdAt}
                endDate={detail.endDate}
                onBack={handleBack}
            />
            <ExecutionNodeTabs
                taskRuns={detail.taskRuns}
                selectedTaskId={selectedTaskId}
                onSelect={setSelectedTaskId}
            />
            <LogToolbar
                levelCounts={levelCounts}
                activeLevels={activeLevels}
                onToggleLevel={handleToggleLevel}
                onSearch={setSearchQuery}
                onScrollToBottom={() => logViewerRef.current?.scrollToBottom()}
                isAtBottom={isAtBottom}
            />
            {logsLoading ? (
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
                    <button type="button" onClick={() => { void fetchLogs(selectedTaskId); }}>重试</button>
                </div>
            ) : (
                <LogViewer
                    ref={logViewerRef}
                    logs={logs}
                    selectedTaskId={selectedTaskId}
                    activeLevels={activeLevels}
                    searchQuery={searchQuery}
                    onAtBottomChange={setIsAtBottom}
                />
            )}
        </div>
    );
}
