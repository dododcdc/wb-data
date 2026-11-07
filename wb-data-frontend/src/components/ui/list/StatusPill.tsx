import type { ReactNode } from 'react';

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusPillProps {
    tone: StatusTone;
    children: ReactNode;
    dot?: boolean;
}

export function StatusPill({ tone, children, dot = true }: StatusPillProps) {
    return (
        <span className={`wb-list-pill is-${tone}`}>
            {dot ? <span className="wb-list-pill-dot" aria-hidden="true" /> : null}
            {children}
        </span>
    );
}
