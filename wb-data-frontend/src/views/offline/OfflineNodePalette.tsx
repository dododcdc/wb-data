import { useCallback, useState } from 'react';
import { PanelRight, PanelRightClose } from 'lucide-react';

import type { OfflineFlowNodeKind } from '../../api/offline';
import { NodeKindIcon } from './nodeKindIcons';
import {
    OFFLINE_PALETTE_NODE_KINDS,
    getOfflineNodeKindClassName,
    getOfflineNodeKindDescription,
    getOfflineNodeKindLabel,
} from './offlineNodeKinds';

export const NODE_PALETTE_EXPANDED_STORAGE_KEY = 'wb-data.offline.node-palette-expanded';

interface OfflineNodePaletteProps {
    disabled: boolean;
}

function readExpandedPreference(): boolean {
    try {
        const stored = globalThis.localStorage?.getItem(NODE_PALETTE_EXPANDED_STORAGE_KEY);
        if (stored == null) {
            return true;
        }
        return stored !== 'false';
    } catch {
        return true;
    }
}

function writeExpandedPreference(expanded: boolean) {
    try {
        globalThis.localStorage?.setItem(NODE_PALETTE_EXPANDED_STORAGE_KEY, String(expanded));
    } catch {
        // Ignore quota / private-mode failures; the in-memory toggle still works.
    }
}

export function OfflineNodePalette({ disabled }: OfflineNodePaletteProps) {
    const [expanded, setExpanded] = useState(readExpandedPreference);

    const toggleExpanded = useCallback(() => {
        setExpanded((current) => {
            const next = !current;
            writeExpandedPreference(next);
            return next;
        });
    }, []);

    return (
        <aside
            className={`offline-node-palette${expanded ? '' : ' is-collapsed'}`}
            aria-label="节点抽屉"
        >
            <header className="offline-node-palette-header">
                {expanded ? (
                    <div>
                        <strong>节点</strong>
                        <p>拖到画布添加</p>
                    </div>
                ) : (
                    <span className="sr-only">节点</span>
                )}
                <button
                    type="button"
                    className="offline-node-palette-toggle"
                    aria-label={expanded ? '收起节点抽屉' : '展开节点抽屉'}
                    aria-expanded={expanded}
                    onClick={toggleExpanded}
                >
                    {expanded ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
                </button>
            </header>
            {expanded ? (
                <ul className="offline-node-palette-list">
                    {OFFLINE_PALETTE_NODE_KINDS.map((kind) => (
                        <PaletteItem key={kind} kind={kind} disabled={disabled} />
                    ))}
                </ul>
            ) : null}
        </aside>
    );
}

function PaletteItem({
    kind,
    disabled,
}: {
    kind: OfflineFlowNodeKind;
    disabled: boolean;
}) {
    const label = getOfflineNodeKindLabel(kind);

    return (
        <li>
            <div
                className={`offline-node-palette-item is-${getOfflineNodeKindClassName(kind)}${disabled ? ' is-disabled' : ''}`}
                draggable={!disabled}
                aria-label={`${label}，拖到画布添加`}
                aria-disabled={disabled}
                onDragStart={(event) => {
                    if (disabled) {
                        event.preventDefault();
                        return;
                    }
                    event.dataTransfer.setData('nodeKind', kind);
                    event.dataTransfer.effectAllowed = 'copy';
                }}
            >
                <span className="offline-node-palette-item-icon" aria-hidden="true">
                    <NodeKindIcon kind={kind} size={18} />
                </span>
                <span className="offline-node-palette-item-copy">
                    <strong>{label}</strong>
                    <em>{getOfflineNodeKindDescription(kind)}</em>
                </span>
            </div>
        </li>
    );
}
