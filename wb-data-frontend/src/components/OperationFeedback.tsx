import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { useFeedbackStore } from '../hooks/useOperationFeedback';
import './OperationFeedback.css';

const toneIcon = {
    success: CheckCircle2,
    error: AlertCircle,
    info: LoaderCircle,
} as const;

export function OperationFeedback() {
    const current = useFeedbackStore((s) => s.current);
    const dismiss = useFeedbackStore((s) => s.dismiss);

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
                    <Icon size={16} />
                </div>
                <div className="ofb-copy">
                    <strong>{current.title}</strong>
                    <p>{current.detail}</p>
                </div>
            </div>
            <button
                className="ofb-close"
                onClick={dismiss}
                type="button"
                aria-label="关闭操作反馈"
            >
                <X size={16} />
            </button>
        </section>
    );
}
