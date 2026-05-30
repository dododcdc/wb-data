# Execution Log Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `ExecutionDetailPage` to make logs the absolute protagonist — strip chrome, replace sidebar with top tabs, add virtual scrolling, auto-refresh, and log level filtering.

**Architecture:** Five small components composed by `ExecutionDetailPage` which owns all state and data fetching. `react-virtuoso` handles virtual scrolling for large log volumes. Auto-refresh polls every 3s for running executions.

**Tech Stack:** React 18, TypeScript, react-virtuoso, React Router 6, existing Radix UI primitives

---

### Task 1: Extract shared format utilities

**Files:**
- Create: `wb-data-frontend/src/views/offline/formatUtils.ts`
- Modify: `wb-data-frontend/src/views/offline/ExecutionDetailPage.tsx:21-40`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:167-185`

- [ ] **Step 1: Create formatUtils.ts**

```typescript
// wb-data-frontend/src/views/offline/formatUtils.ts
export function formatDateTime(value: string | number | null | undefined) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatTime(value: string | number | null | undefined) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

export function formatDuration(start: string | null, end: string | null) {
    if (!start || !end) return '—';
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    if (durationMs < 0) return '—';
    const seconds = durationMs / 1000;
    return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
}

/** Live elapsed counter: returns MM:SS string from ms since start */
export function formatElapsed(startDate: string | null) {
    if (!startDate) return '00:00';
    const ms = Date.now() - new Date(startDate).getTime();
    if (ms < 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Replace inline format functions in ExecutionDetailPage.tsx**

Remove the local `formatDateTime` and `formatDuration` functions (lines 21-40), add import:
```typescript
import { formatDateTime, formatTime, formatDuration, formatElapsed } from './formatUtils';
```

- [ ] **Step 3: Remove duplicate format functions from OfflineWorkbench.tsx**

Find and replace the local `formatDateTime` and `formatDuration` functions (near line 167-185) with an import:
```typescript
import { formatDateTime, formatDuration } from './formatUtils';
```

Actually, check if those functions in OfflineWorkbench have different signatures or are used differently. If they differ, do not replace them — leave them for now and only extract the ExecutionDetailPage ones.

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/formatUtils.ts wb-data-frontend/src/views/offline/ExecutionDetailPage.tsx
git commit -m "refactor(offline): extract shared format utilities to formatUtils.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Install react-virtuoso

**Files:**
- Modify: `wb-data-frontend/package.json`

- [ ] **Step 1: Install react-virtuoso**

Run: `cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npm install react-virtuoso`
Expected: Package added to package.json and node_modules

- [ ] **Step 2: Verify import works**

Run: `cd /Users/wenbin/Projects/wb-data/wb-data-frontend && node -e "require('react-virtuoso')"`
Expected: Prints module exports, no errors

- [ ] **Step 3: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/package.json wb-data-frontend/package-lock.json
git commit -m "chore: install react-virtuoso for log virtual scrolling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Create TopBar component

**Files:**
- Create: `wb-data-frontend/src/views/offline/ExecutionTopBar.tsx`

- [ ] **Step 1: Create ExecutionTopBar.tsx**

```typescript
// wb-data-frontend/src/views/offline/ExecutionTopBar.tsx
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { getExecutionPresentation, getExecutionStatusLabel } from './executionPresentation';
import { formatElapsed } from './formatUtils';
import { useEffect, useState } from 'react';

interface ExecutionTopBarProps {
    flowPath: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    onBack: () => void;
}

function ExecutionStatusDisplay({ status, startDate, endDate }: {
    status: string;
    startDate: string | null;
    endDate: string | null;
}) {
    const presentation = getExecutionPresentation(status);
    const [elapsed, setElapsed] = useState('00:00');

    useEffect(() => {
        if (presentation.animated && startDate) {
            setElapsed(formatElapsed(startDate));
            const timer = setInterval(() => setElapsed(formatElapsed(startDate)), 1000);
            return () => clearInterval(timer);
        }
    }, [presentation.animated, startDate]);

    const dotClass = `offline-execution-dot is-${presentation.dotTone}`;
    const label = getExecutionStatusLabel(status);

    if (presentation.animated) {
        return (
            <span className="execution-topbar-status">
                <span className={dotClass} aria-hidden="true" />
                <span className="execution-topbar-status-text is-running">{label}</span>
                <span className="execution-topbar-elapsed">{elapsed}</span>
            </span>
        );
    }

    const startTime = startDate ? new Date(startDate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const endTime = endDate ? new Date(endDate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

    return (
        <span className="execution-topbar-status">
            <span className={dotClass} aria-hidden="true" />
            <span className={`execution-topbar-status-text is-${presentation.progressTone}`}>{label}</span>
            {startTime && endTime && (
                <span className="execution-topbar-range">{startTime} → {endTime}</span>
            )}
        </span>
    );
}

export default function ExecutionTopBar({ flowPath, status, startDate, endDate, onBack }: ExecutionTopBarProps) {
    return (
        <header className="execution-topbar">
            <Button type="button" variant="ghost" size="sm" className="execution-topbar-back" onClick={onBack}>
                <ArrowLeft size={16} />
            </Button>
            <span className="execution-topbar-flow-name">{flowPath}</span>
            <ExecutionStatusDisplay status={status} startDate={startDate} endDate={endDate} />
        </header>
    );
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/ExecutionTopBar.tsx
git commit -m "feat(offline): add ExecutionTopBar component for log page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Create NodeTabs component

**Files:**
- Create: `wb-data-frontend/src/views/offline/ExecutionNodeTabs.tsx`

- [ ] **Step 1: Create ExecutionNodeTabs.tsx**

```typescript
// wb-data-frontend/src/views/offline/ExecutionNodeTabs.tsx
import { useRef, useEffect, useState } from 'react';
import { getTaskStatusIcon } from './executionPresentation';
import type { OfflineExecutionTaskRun } from '../../api/offline';

interface ExecutionNodeTabsProps {
    taskRuns: OfflineExecutionTaskRun[];
    selectedTaskId: string | null;
    onSelect: (taskId: string | null) => void;
}

/** Filter internal tasks that should not appear as tabs */
function isVisibleTask(task: OfflineExecutionTaskRun) {
    return !task.taskId.startsWith('parallel_') && task.taskId !== 'flow_dag';
}

export default function ExecutionNodeTabs({ taskRuns, selectedTaskId, onSelect }: ExecutionNodeTabsProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLeftFade, setShowLeftFade] = useState(false);
    const [showRightFade, setShowRightFade] = useState(false);

    const visibleTasks = taskRuns.filter(isVisibleTask);

    const updateFadeIndicators = () => {
        const el = scrollRef.current;
        if (!el) return;
        setShowLeftFade(el.scrollLeft > 2);
        setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };

    useEffect(() => {
        updateFadeIndicators();
    }, [visibleTasks]);

    return (
        <div className="execution-nodetabs-wrapper">
            {showLeftFade && <div className="execution-nodetabs-fade is-left" />}
            <div className="execution-nodetabs" ref={scrollRef} onScroll={updateFadeIndicators}>
                <button
                    type="button"
                    className={`execution-nodetab${selectedTaskId === null ? ' is-active' : ''}`}
                    onClick={() => onSelect(null)}
                >
                    <span className="execution-nodetab-label">全部日志</span>
                </button>
                {visibleTasks.map((task) => {
                    const StatusIcon = getTaskStatusIcon(task.status);
                    return (
                        <button
                            key={task.taskId}
                            type="button"
                            className={`execution-nodetab${selectedTaskId === task.taskId ? ' is-active' : ''}`}
                            onClick={() => onSelect(task.taskId)}
                        >
                            <StatusIcon size={12} className={`execution-nodetab-icon is-${task.status.toLowerCase()}`} />
                            <span className="execution-nodetab-label">{task.taskId}</span>
                        </button>
                    );
                })}
            </div>
            {showRightFade && <div className="execution-nodetabs-fade is-right" />}
        </div>
    );
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/ExecutionNodeTabs.tsx
git commit -m "feat(offline): add ExecutionNodeTabs component for log page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Create LogToolbar component

**Files:**
- Create: `wb-data-frontend/src/views/offline/LogToolbar.tsx`

- [ ] **Step 1: Create LogToolbar.tsx**

```typescript
// wb-data-frontend/src/views/offline/LogToolbar.tsx
import { useState } from 'react';
import { Search, ArrowDown } from 'lucide-react';

interface LogToolbarProps {
    levelCounts: { ERROR: number; WARN: number; INFO: number };
    activeLevels: Set<string>;
    onToggleLevel: (level: string) => void;
    onSearch: (query: string) => void;
    onScrollToBottom: () => void;
    isAtBottom: boolean;
}

const LEVELS = ['ERROR', 'WARN', 'INFO'] as const;

export default function LogToolbar({
    levelCounts,
    activeLevels,
    onToggleLevel,
    onSearch,
    onScrollToBottom,
    isAtBottom,
}: LogToolbarProps) {
    const [searchValue, setSearchValue] = useState('');

    const handleSearch = () => {
        onSearch(searchValue.trim());
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    };

    return (
        <div className="log-toolbar">
            <div className="log-toolbar-levels">
                {LEVELS.map((level) => {
                    const count = levelCounts[level] ?? 0;
                    const active = activeLevels.size === 0 || activeLevels.has(level);
                    return (
                        <button
                            key={level}
                            type="button"
                            className={`log-toolbar-chip is-${level.toLowerCase()}${!active ? ' is-dimmed' : ''}`}
                            onClick={() => onToggleLevel(level)}
                        >
                            {level}:{count}
                        </button>
                    );
                })}
            </div>
            <div className="log-toolbar-right">
                <div className="log-toolbar-search">
                    <input
                        type="text"
                        placeholder="搜索日志..."
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="log-toolbar-search-input"
                    />
                    <button type="button" className="log-toolbar-search-btn" onClick={handleSearch}>
                        <Search size={14} />
                    </button>
                </div>
                {!isAtBottom && (
                    <button type="button" className="log-toolbar-scroll-btn" onClick={onScrollToBottom} title="滚动到最新">
                        <ArrowDown size={14} />
                    </button>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/LogToolbar.tsx
git commit -m "feat(offline): add LogToolbar component for log page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Create LogViewer component with react-virtuoso

**Files:**
- Create: `wb-data-frontend/src/views/offline/LogViewer.tsx`

- [ ] **Step 1: Create LogViewer.tsx**

```typescript
// wb-data-frontend/src/views/offline/LogViewer.tsx
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

    // Expose scrollToBottom via ref
    // Note: the parent achieves this by controlling atBottom state, not via imperative ref.
    // The LogToolbar's scroll-to-bottom button triggers onScrollToBottom prop,
    // which ExecutionDetailPage can handle by passing a new prop or using a ref.
    // For simplicity, we'll use a different approach — see Task 7.

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
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/LogViewer.tsx
git commit -m "feat(offline): add LogViewer component with react-virtuoso

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Rebuild ExecutionDetailPage

**Files:**
- Rewrite: `wb-data-frontend/src/views/offline/ExecutionDetailPage.tsx`
- Rewrite: `wb-data-frontend/src/views/offline/ExecutionDetailPage.css`

- [ ] **Step 1: Rewrite ExecutionDetailPage.tsx**

```typescript
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
import LogViewer from './LogViewer';
import './ExecutionDetailPage.css';

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
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
    const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [isAtBottom, setIsAtBottom] = useState(true);

    // Reset when execution changes
    useEffect(() => {
        setDetail(null);
        setDetailError(null);
        setLogs([]);
        setLogsError(null);
        setSelectedTaskId(initialTaskId);
        setActiveLevels(new Set());
        setSearchQuery('');
    }, [executionId, groupId, initialTaskId]);

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
    const fetchLogs = useCallback(async (taskId: string | null) => {
        if (!groupId || !executionId) return;
        let cancelled = false;
        setLogsLoading(true);
        setLogsError(null);
        void getOfflineExecutionLogs(groupId, executionId, taskId)
            .then((nextLogs) => { if (!cancelled) setLogs(nextLogs); })
            .catch((error) => { if (!cancelled) setLogsError(getErrorMessage(error, '暂时无法读取执行日志。')); })
            .finally(() => { if (!cancelled) setLogsLoading(false); });
        return () => { cancelled = true; };
    }, [executionId, groupId]);

    useEffect(() => {
        const cancel = fetchLogs(selectedTaskId);
        return () => { cancel?.then((fn) => fn?.()); };
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
        navigate('/offline');
    }, [navigate]);

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
                onScrollToBottom={() => setIsAtBottom(true)}
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
                    <button type="button" onClick={() => fetchLogs(selectedTaskId)}>重试</button>
                </div>
            ) : (
                <LogViewer
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
```

- [ ] **Step 2: Rewrite ExecutionDetailPage.css**

```css
.log-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #fbfaf7;
}

.log-page-empty {
    display: grid;
    place-items: center;
    min-height: 100vh;
    padding: 24px;
    color: var(--color-text-muted);
    text-align: center;
}

/* ── Top Bar ── */

.execution-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 12px;
    border-bottom: 1px solid var(--color-border);
    background: rgba(255, 255, 255, 0.88);
    backdrop-filter: blur(8px);
    flex-shrink: 0;
}

.execution-topbar-back {
    width: 28px;
    height: 28px;
    padding: 0;
    display: grid;
    place-items: center;
}

.execution-topbar-flow-name {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.execution-topbar-status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font-size: 0.78rem;
}

.execution-topbar-status-text.is-running { color: var(--color-info); }
.execution-topbar-status-text.is-success { color: var(--color-success); }
.execution-topbar-status-text.is-failed { color: var(--color-error); }
.execution-topbar-status-text.is-neutral { color: var(--color-text-primary); }

.execution-topbar-elapsed {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
}

.execution-topbar-range {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-text-muted);
}

/* Execution dot reused from offline-workbench */
.offline-execution-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
}
.offline-execution-dot.is-running { background: var(--color-info); }
.offline-execution-dot.is-success { background: var(--color-success); }
.offline-execution-dot.is-failed { background: var(--color-error); }
.offline-execution-dot.is-neutral { background: var(--color-text-muted); }

/* ── Node Tabs ── */

.execution-nodetabs-wrapper {
    position: relative;
    flex-shrink: 0;
    height: 32px;
    border-bottom: 1px solid var(--color-border);
    background: rgba(255, 255, 255, 0.72);
}

.execution-nodetabs {
    display: flex;
    align-items: stretch;
    height: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 8px;
    gap: 2px;
}

.execution-nodetabs::-webkit-scrollbar { display: none; }

.execution-nodetabs-fade {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    pointer-events: none;
    z-index: 1;
}

.execution-nodetabs-fade.is-left {
    left: 0;
    background: linear-gradient(to right, rgba(255,255,255,0.9), transparent);
}

.execution-nodetabs-fade.is-right {
    right: 0;
    background: linear-gradient(to left, rgba(255,255,255,0.9), transparent);
}

.execution-nodetab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    font-size: 0.76rem;
    color: var(--color-text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
}

.execution-nodetab:hover { color: var(--color-text-primary); }

.execution-nodetab.is-active {
    color: var(--color-info);
    border-bottom-color: var(--color-info);
}

.execution-nodetab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
}

.execution-nodetab-icon {
    flex-shrink: 0;
}

.execution-nodetab-icon.is-success { color: var(--color-success); }
.execution-nodetab-icon.is-failed { color: var(--color-error); }
.execution-nodetab-icon.is-running { color: var(--color-info); }

/* ── Toolbar ── */

.log-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 12px;
    border-bottom: 1px solid var(--color-border-subtle);
    background: rgba(255, 255, 255, 0.64);
    flex-shrink: 0;
    gap: 12px;
}

.log-toolbar-levels {
    display: flex;
    gap: 4px;
}

.log-toolbar-chip {
    padding: 1px 8px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
}

.log-toolbar-chip.is-error { color: var(--color-error); border-color: var(--color-error); }
.log-toolbar-chip.is-warn { color: #b45309; border-color: #b45309; }
.log-toolbar-chip.is-info { color: var(--color-text-muted); }

.log-toolbar-chip.is-dimmed { opacity: 0.3; }

.log-toolbar-right {
    display: flex;
    align-items: center;
    gap: 6px;
}

.log-toolbar-search {
    display: flex;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
    height: 24px;
    background: #fff;
}

.log-toolbar-search-input {
    width: 140px;
    height: 100%;
    padding: 0 8px;
    border: none;
    outline: none;
    font-size: 0.72rem;
    background: transparent;
}

.log-toolbar-search-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 100%;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--color-text-muted);
}

.log-toolbar-scroll-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    color: var(--color-text-muted);
}

/* ── Log Viewer ── */

.log-viewer {
    flex: 1;
    min-height: 0;
}

.log-viewer-empty {
    display: grid;
    place-items: center;
    flex: 1;
    min-height: 200px;
    color: var(--color-text-muted);
    font-size: 0.84rem;
}

.log-viewer-loading {
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

.log-viewer-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex: 1;
    min-height: 200px;
    color: var(--color-error);
    font-size: 0.84rem;
}

.log-viewer-error button {
    padding: 4px 16px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: #fff;
    font-size: 0.78rem;
    cursor: pointer;
}

.log-line {
    display: grid;
    grid-template-columns: 80px 52px minmax(0, 1fr);
    gap: 10px;
    align-items: flex-start;
    padding: 4px 12px;
    font-size: 0.74rem;
    line-height: 1.55;
    font-family: var(--font-mono);
    border-bottom: 1px solid rgba(0, 0, 0, 0.03);
}

/* 4-column mode: add taskId column */
.log-viewer:not(.is-single-node) .log-line {
    grid-template-columns: 80px 52px 100px minmax(0, 1fr);
}

.log-line-time {
    color: var(--color-text-muted);
    flex-shrink: 0;
}

.log-line-level {
    font-weight: 700;
    flex-shrink: 0;
}

.log-line-level.is-error { color: var(--color-error); }
.log-line-level.is-warn { color: #b45309; }
.log-line-level.is-info { color: var(--color-text-muted); }

.log-line-task {
    color: var(--color-text-muted);
    font-style: normal;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
}

.log-line-msg {
    margin: 0;
    color: var(--color-text-primary);
    word-break: break-all;
    white-space: pre-wrap;
}

/* ── Skeleton ── */

.log-viewer-skeleton {
    padding: 8px 12px;
}

.log-line-skeleton {
    display: flex;
    gap: 10px;
    align-items: center;
    height: 24px;
}

.skeleton-block {
    height: 12px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.06);
    animation: log-skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-block.w-16 { width: 64px; }
.skeleton-block.w-10 { width: 40px; }
.skeleton-block.w-full { flex: 1; }

@keyframes log-skeleton-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/ExecutionDetailPage.tsx wb-data-frontend/src/views/offline/ExecutionDetailPage.css
git commit -m "feat(offline): rebuild execution log page with virtual scrolling and compact layout

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Wire scroll-to-bottom through LogViewer ref

**Files:**
- Modify: `wb-data-frontend/src/views/offline/LogViewer.tsx`
- Modify: `wb-data-frontend/src/views/offline/ExecutionDetailPage.tsx`

- [ ] **Step 1: Update LogViewer to expose scrollToBottom via ref**

```typescript
// In LogViewer.tsx, add to imports:
import { forwardRef, useImperativeHandle } from 'react';

// Add exported ref handle type:
export interface LogViewerHandle {
    scrollToBottom: () => void;
}

// Change function signature to use forwardRef:
const LogViewer = forwardRef<LogViewerHandle, LogViewerProps>(function LogViewer(
    { logs, selectedTaskId, activeLevels, searchQuery, onAtBottomChange },
    ref,
) {
    // ... existing code ...

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

    // ... rest stays the same ...
});

export default LogViewer;
```

- [ ] **Step 2: Update ExecutionDetailPage to use the ref**

```typescript
// In ExecutionDetailPage.tsx, add import:
import { useRef } from 'react';
import LogViewer, { type LogViewerHandle } from './LogViewer';

// Add ref:
const logViewerRef = useRef<LogViewerHandle>(null);

// Update LogToolbar's onScrollToBottom:
onScrollToBottom={() => logViewerRef.current?.scrollToBottom()}

// Add ref to LogViewer:
<LogViewer
    ref={logViewerRef}
    logs={logs}
    // ... other props
/>
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/LogViewer.tsx wb-data-frontend/src/views/offline/ExecutionDetailPage.tsx
git commit -m "fix(offline): wire scroll-to-bottom through LogViewer ref

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Add log level filter chip active state styling

**Files:**
- Modify: `wb-data-frontend/src/views/offline/LogToolbar.tsx`
- Modify: `wb-data-frontend/src/views/offline/ExecutionDetailPage.css`

- [ ] **Step 1: Update chip classes to reflect active state**

In `LogToolbar.tsx`, update the chip rendering to include an active class:

```typescript
// Replace the chip className line:
className={`log-toolbar-chip is-${level.toLowerCase()}${active ? ' is-active' : ''}${!active ? ' is-dimmed' : ''}`}
```

Note: a chip is "active" when the level IS selected (activeLevels contains it). We invert the meaning — clicking a chip toggles it OFF, and dimmed chips have been deselected.

Wait, let's redesign this. The behavior should be:
- Initially: all chips are active (no filter), all levels shown
- Click ERROR: ERROR chip stays active, WARN/INFO dim → only ERROR shown
- Click ERROR again (while WARN/INFO dim): ERROR also dims → nothing shown (or reset to all?)
- Click WARN (while ERROR active + WARN/INFO dim): WARN becomes active → ERROR + WARN shown

Actually, the simpler mental model from the spec: clicking toggles that level's visibility. All chips start "on". Click to filter out. Click again to bring back.

```typescript
// Revised approach:
const isLevelVisible = activeLevels.size === 0 || activeLevels.has(level);
```

So `!isLevelVisible` means "dimmed". The chip shows the level IS being filtered out.

Let me revise the LogToolbar chip logic:

```typescript
// In the chip map:
const visible = activeLevels.size === 0 || activeLevels.has(level);
className={`log-toolbar-chip is-${level.toLowerCase()}${!visible ? ' is-dimmed' : ''}`}
```

- [ ] **Step 2: Add .is-active style for chips if needed**

The dimmed style already exists. If we want an "active/pressed" look, add:

```css
.log-toolbar-chip.is-active {
    background: currentColor;
    color: #fff;
}
```

But for simplicity, let's skip this — the dimmed/greyed state is enough visual feedback. Remove the active class from the plan.

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/LogToolbar.tsx
git commit -m "fix(offline): improve log level chip toggle behavior

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Start frontend dev server**

Run: `cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npm run dev`

- [ ] **Step 2: Test the log page in browser**

1. Open the app, navigate to offline development
2. Select a flow, click "执行结果"
3. Click a log entry (opens new tab with log page)
4. Verify:
   - Top bar shows flow name + status + timing
   - Node tabs are filtered (no flow_dag/parallel_*)
   - "全部日志" tab is selected by default
   - Log level chips show counts
   - Clicking a chip filters logs
   - Search filters logs on Enter
   - Clicking a node tab switches logs
   - Running execution shows live elapsed counter
   - Back button returns to offline workbench
   - Scroll performance is smooth with 1000+ lines

- [ ] **Step 3: Fix any issues found**

Address any visual or behavioral issues discovered during manual testing.

- [ ] **Step 4: Final commit if changes were made**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/
git commit -m "fix(offline): polish log page after manual testing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push all commits**

```bash
git push
```
