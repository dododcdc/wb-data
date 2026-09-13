import {
    Braces,
    GitCommitHorizontal,
    History,
    LoaderCircle,
    Play,
    Save,
    Settings2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { FlowParameterBinding } from '../../api/offline';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { isExecuteButtonDisabled } from './executionToolbarState';

interface OfflineCanvasToolbarProps {
    activeFlowPath: string | null;
    canWrite: boolean;
    canConfigureParameters: boolean;
    parameterBindingStatus?: FlowParameterBinding['status'] | null;
    timezone?: string | null;
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
    onOpenParameters: () => void;
    onExecute: () => void;
    onOpenExecutions: () => void;
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
    canConfigureParameters,
    parameterBindingStatus,
    timezone,
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
    onOpenParameters,
    onExecute,
    onOpenExecutions,
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
                label="保存任务"
                disabled={editDisabled || !dirty || saving}
                onClick={onSave}
            >
                <span className="relative flex">
                    {saving ? <LoaderCircle size={16} className="offline-spin" /> : <Save size={16} />}
                    {dirty && <span className="offline-toolbar-dot" />}
                </span>
            </ToolbarButton>

            <ToolbarButton
                label="提交当前任务"
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
                label="参数"
                disabled={editDisabled || !canConfigureParameters}
                onClick={onOpenParameters}
            >
                <span className="relative flex">
                    <Braces size={16} />
                    {parameterBindingStatus ? (
                        <span
                            className={`offline-toolbar-binding-dot is-${parameterBindingStatus.toLowerCase()}`}
                            aria-hidden="true"
                        />
                    ) : null}
                </span>
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

            {timezone ? (
                <div className="offline-canvas-toolbar-meta">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="offline-canvas-timezone-badge">
                                {timezone}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent className="tooltip-content" side="bottom">
                            运行时区: {timezone}
                        </TooltipContent>
                    </Tooltip>
                </div>
            ) : null}
        </header>
    );
}
