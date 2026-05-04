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
