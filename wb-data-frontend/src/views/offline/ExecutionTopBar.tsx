// wb-data-frontend/src/views/offline/ExecutionTopBar.tsx
import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getExecutionPresentation, getExecutionStatusLabel } from './executionPresentation';
import { formatDateTime, formatElapsed } from './formatUtils';

interface ExecutionTopBarProps {
    flowPath: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    onBack: () => void;
}

export default function ExecutionTopBar({ flowPath, status, startDate, endDate, onBack }: ExecutionTopBarProps) {
    const presentation = getExecutionPresentation(status);
    const statusLabel = getExecutionStatusLabel(status);
    const elapsed = useMemo(() => formatElapsed(startDate, endDate), [startDate, endDate]);
    const dateRange = useMemo(() => {
        const from = formatDateTime(startDate);
        const to = endDate ? formatDateTime(endDate) : '至今';
        return `${from} — ${to}`;
    }, [startDate, endDate]);

    return (
        <div className="execution-topbar">
            <button type="button" className="execution-topbar-back" onClick={onBack}>
                <ArrowLeft size={14} />
            </button>
            <span className="execution-topbar-flow-name">{flowPath}</span>
            <div className="execution-topbar-status">
                <span className={`offline-execution-dot is-${presentation.dotTone}`} />
                <span className={`execution-topbar-status-text is-${presentation.progressTone}`}>
                    {statusLabel}
                </span>
                {elapsed && <span className="execution-topbar-elapsed">{elapsed}</span>}
                <span className="execution-topbar-range">{dateRange}</span>
            </div>
        </div>
    );
}
