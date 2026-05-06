import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useFeedbackStore } from '../hooks/useOperationFeedback';
import './OperationFeedback.css';

const toneIcon = {
    success: CheckCircle2,
    error: AlertCircle,
    info: LoaderCircle,
} as const;

export function OperationFeedback() {
    const current = useFeedbackStore((s) => s.current);

    if (!current) return null;

    const Icon = toneIcon[current.tone];

    return (
        <section
            className={`ofb-toast is-${current.tone}`}
            role={current.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
        >
            <div className="ofb-main">
                <div className="ofb-icon" aria-hidden="true">
                    <Icon size={18} />
                </div>
                <div className="ofb-copy">
                    <strong>{current.title}</strong>
                    {current.detail && <p>{current.detail}</p>}
                </div>
            </div>
        </section>
    );
}
