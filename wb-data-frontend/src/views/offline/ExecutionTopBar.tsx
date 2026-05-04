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

/** Extract a human-readable flow name from a path like "_flows/jack/twt/flow.yaml" → "twt" */
function getFlowDisplayName(flowPath: string) {
    const segments = flowPath.replace(/\\/g, '/').split('/');
    for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        if (seg && !seg.startsWith('_') && seg !== 'flow.yaml') {
            return seg;
        }
    }
    const flowIndex = segments.indexOf('flow.yaml');
    if (flowIndex > 0) return segments[flowIndex - 1];
    return segments[segments.length - 1] || flowPath;
}

export default function ExecutionTopBar({ flowPath, status, startDate, endDate, onBack }: ExecutionTopBarProps) {
    const presentation = getExecutionPresentation(status);
    const statusLabel = getExecutionStatusLabel(status);
    const displayName = getFlowDisplayName(flowPath);
    const elapsed = useMemo(() => formatElapsed(startDate, endDate), [startDate, endDate]);
    const dateRange = useMemo(() => {
        const from = formatDateTime(startDate);
        const to = endDate ? formatDateTime(endDate) : '至今';
        return `${from} — ${to}`;
    }, [startDate, endDate]);

    return (
        <div className="execution-topbar">
            <button type="button" className="execution-topbar-flow-link" onClick={onBack}>
                <ArrowLeft size={12} />
                <span>{displayName}</span>
            </button>
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
