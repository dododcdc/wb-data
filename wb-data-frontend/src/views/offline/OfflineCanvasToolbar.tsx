import {
    Braces,
    Check,
    CircleAlert,
    GitCommitHorizontal,
    GitPullRequest,
    History,
    LoaderCircle,
    Play,
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
    commitDirty: boolean;
    committing: boolean;
    draftSaveState: 'idle' | 'saving' | 'saved' | 'error';
    draftSavedAt: number | null;
    draftSaveError: string | null;
    onSelectAll: (selected: boolean) => void;
    onCommit: () => void;
    onOpenSchedule: () => void;
    onOpenDependencies: () => void;
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
    commitDirty,
    committing,
    draftSaveState,
    draftSavedAt,
    draftSaveError,
    onSelectAll,
    onCommit,
    onOpenSchedule,
    onOpenDependencies,
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

            <ToolbarButton label="依赖" disabled={!active} onClick={onOpenDependencies}>
                <GitPullRequest size={16} />
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

            <DraftSaveIndicator
                state={draftSaveState}
                savedAt={draftSavedAt}
                error={draftSaveError}
                dirty={dirty}
            />

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

interface DraftSaveIndicatorProps {
    state: 'idle' | 'saving' | 'saved' | 'error';
    savedAt: number | null;
    error: string | null;
    dirty: boolean;
}

function DraftSaveIndicator({ state, savedAt, error, dirty }: DraftSaveIndicatorProps) {
    if (state === 'saving') {
        return (
            <span className="offline-canvas-save-indicator is-pending" role="status">
                <LoaderCircle size={14} className="offline-spin" />
                <span>保存中</span>
            </span>
        );
    }
    if (state === 'error') {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="offline-canvas-save-indicator is-error" role="status">
                        <CircleAlert size={14} />
                        <span>保存失败</span>
                    </span>
                </TooltipTrigger>
                <TooltipContent className="tooltip-content" side="bottom">
                    {error || '自动保存失败，继续编辑将自动重试'}
                </TooltipContent>
            </Tooltip>
        );
    }
    if (dirty) {
        return (
            <span className="offline-canvas-save-indicator is-pending" role="status">
                <span>待自动保存</span>
            </span>
        );
    }
    if (state === 'saved' && savedAt) {
        const time = new Date(savedAt);
        const hh = String(time.getHours()).padStart(2, '0');
        const mm = String(time.getMinutes()).padStart(2, '0');
        return (
            <span className="offline-canvas-save-indicator is-saved" role="status">
                <Check size={14} />
                <span>已保存 {hh}:{mm}</span>
            </span>
        );
    }
    return null;
}
