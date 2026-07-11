import {
    Database,
    FileCode2,
    GitCommitHorizontal,
    History,
    LoaderCircle,
    Play,
    Save,
    Settings2,
    TerminalSquare,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { OfflineFlowNodeKind } from '../../api/offline';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { isExecuteButtonDisabled } from './executionToolbarState';

interface OfflineCanvasToolbarProps {
    activeFlowPath: string | null;
    canWrite: boolean;
    nodeCount: number;
    selectedNodeCount: number;
    dirty: boolean;
    saving: boolean;
    commitDirty: boolean;
    committing: boolean;
    onSelectAll: (selected: boolean) => void;
    onSave: () => void;
    onCommit: () => void;
    onOpenSchedule: () => void;
    onExecute: () => void;
    onOpenExecutions: () => void;
    onAddNode: (kind: OfflineFlowNodeKind) => void;
}

interface ToolbarButtonProps {
    label: string;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}

function ToolbarButton({ label, disabled, onClick, children }: ToolbarButtonProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className="offline-canvas-toolbar-btn"
                    disabled={disabled}
                    onClick={onClick}
                    aria-label={label}
                >
                    {children}
                </button>
            </TooltipTrigger>
            <TooltipContent className="tooltip-content" side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

export function OfflineCanvasToolbar({
    activeFlowPath,
    canWrite,
    nodeCount,
    selectedNodeCount,
    dirty,
    saving,
    commitDirty,
    committing,
    onSelectAll,
    onSave,
    onCommit,
    onOpenSchedule,
    onExecute,
    onOpenExecutions,
    onAddNode,
}: OfflineCanvasToolbarProps) {
    const active = activeFlowPath !== null;
    const editDisabled = !active || !canWrite;

    return (
        <header className="offline-canvas-toolbar">
            <label className="offline-canvas-toolbar-selectall">
                <input
                    type="checkbox"
                    checked={nodeCount > 0 && selectedNodeCount === nodeCount}
                    onChange={(event) => onSelectAll(event.target.checked)}
                    disabled={nodeCount === 0}
                />
                全选
            </label>

            <ToolbarButton
                label="保存"
                disabled={editDisabled || !dirty || saving}
                onClick={onSave}
            >
                <span className="relative flex">
                    {saving ? <LoaderCircle size={16} className="offline-spin" /> : <Save size={16} />}
                    {dirty && <span className="offline-toolbar-dot" />}
                </span>
            </ToolbarButton>

            <ToolbarButton
                label="提交当前 Flow"
                disabled={editDisabled || !(dirty || commitDirty) || committing}
                onClick={onCommit}
            >
                <span className="relative flex">
                    <GitCommitHorizontal size={16} />
                    {(dirty || commitDirty) && <span className="offline-toolbar-dot" />}
                </span>
            </ToolbarButton>

            <ToolbarButton label="调度" disabled={editDisabled} onClick={onOpenSchedule}>
                <Settings2 size={16} />
            </ToolbarButton>

            <ToolbarButton
                label="执行"
                disabled={isExecuteButtonDisabled({ activeFlowPath, canWrite })}
                onClick={onExecute}
            >
                <Play size={16} />
            </ToolbarButton>

            <ToolbarButton label="执行结果" disabled={!active} onClick={onOpenExecutions}>
                <History size={16} />
            </ToolbarButton>

            <span className="offline-toolbar-divider" />

            <ToolbarButton label="添加 SQL 节点" disabled={editDisabled} onClick={() => onAddNode('SQL')}>
                <FileCode2 size={16} />
            </ToolbarButton>

            <ToolbarButton label="添加 HiveSQL 节点" disabled={editDisabled} onClick={() => onAddNode('HIVE_SQL')}>
                <Database size={16} />
            </ToolbarButton>

            <ToolbarButton label="添加 Shell 节点" disabled={editDisabled} onClick={() => onAddNode('SHELL')}>
                <TerminalSquare size={16} />
            </ToolbarButton>
        </header>
    );
}
