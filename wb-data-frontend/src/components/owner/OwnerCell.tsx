import type { OwnerStatus } from '../../api/groupSettings';
import { formatOwnerDisplay } from './ownerUtils';
import './owner.css';

interface OwnerCellProps {
    name?: string | null;
    username?: string | null;
    status?: OwnerStatus | null;
    fallback?: string | null;
}

export function OwnerCell({ name, username, status, fallback }: OwnerCellProps) {
    const display = formatOwnerDisplay(name, username, fallback);
    const title = username && name && username !== name ? `${name} (@${username})` : display;
    const statusLabel = status === 'DISABLED' ? '已停用' : status === 'LEFT_GROUP' ? '已离组' : null;

    return (
        <span className="wb-owner-cell" title={title}>
            <span className="wb-owner-name">{display}</span>
            {statusLabel ? (
                <span className={`wb-owner-status-tag${status === 'DISABLED' ? ' is-disabled' : ''}`}>
                    {statusLabel}
                </span>
            ) : null}
        </span>
    );
}
