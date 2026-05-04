// wb-data-frontend/src/views/offline/ExecutionNodeTabs.tsx
import { useRef, useEffect, useMemo, useState } from 'react';
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

    const visibleTasks = useMemo(() => taskRuns.filter(isVisibleTask), [taskRuns]);

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
