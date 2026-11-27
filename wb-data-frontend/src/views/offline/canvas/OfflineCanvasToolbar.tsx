import {
    ArrowUpRight,
    Braces,
    Check,
    CircleAlert,
    GitCommitHorizontal,
    GitPullRequest,
    Globe,
    History,
    ListOrdered,
    LoaderCircle,
    Play,
    Settings2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { GitSyncConfig } from '../../../api/gitSettings';
import type { OwnerStatus } from '../../../api/groupSettings';
import type { FlowParameterBinding } from '../../../api/offline';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { isExecuteButtonDisabled } from '../execution/executionToolbarState';
import { OfflineDeploymentBadge } from '../version/OfflineDeploymentBadge';
import { getTimezoneOffset } from '../schedule/ScheduleUtils';
import type { CanvasMode } from '../version/useOnlineFlowSnapshot';
import { OwnerCell } from '../../../components/owner/OwnerCell';

interface OfflineCanvasToolbarProps {
    activeFlowPath: string | null;
    groupId: number | null;
    branch: string | null;
    canvasMode?: CanvasMode;
    onCanvasModeChange?: (mode: CanvasMode) => void;
    deploymentConfig?: GitSyncConfig | null;
    hasOnlineDocument?: boolean;
    canWrite: boolean;
    canConfigureParameters: boolean;
    parameterBindingStatus?: FlowParameterBinding['status'] | null;
    timezone?: string | null;
    nodeCount: number;
    selectedNodeCount: number;
    dirty: boolean;
    commitDirty: boolean;
    flowAhead?: boolean;
    committing: boolean;
    pushingFlow?: boolean;
    draftSaveState: 'idle' | 'saving' | 'saved' | 'error';
    draftSavedAt: number | null;
    draftSaveError: string | null;
    onSelectAll: (selected: boolean) => void;
    onCommit: () => void;
    onPushFlow?: () => void;
    onOpenSchedule: () => void;
    onOpenDependencies: () => void;
    onOpenParameters: () => void;
    onExecute: () => void;
    onOpenExecutions: () => void;
    onOpenVersions: () => void;
    ownerUserId?: number | null;
    ownerName?: string | null;
    ownerUsername?: string | null;
    ownerStatus?: OwnerStatus | null;
    canTransferOwner?: boolean;
    onTransferOwner?: () => void;
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
    groupId,
    branch,
    canvasMode = 'dev',
    onCanvasModeChange,
    deploymentConfig,
    hasOnlineDocument = false,
    canWrite,
    canConfigureParameters,
    parameterBindingStatus,
    timezone,
    nodeCount,
    selectedNodeCount,
    dirty,
    commitDirty,
    flowAhead = false,
    committing,
    pushingFlow = false,
    draftSaveState,
    draftSavedAt,
    draftSaveError,
    onSelectAll,
    onCommit,
    onPushFlow,
    onOpenSchedule,
    onOpenDependencies,
    onOpenParameters,
    onExecute,
    onOpenExecutions,
    onOpenVersions,
    ownerUserId,
    ownerName,
    ownerUsername,
    ownerStatus,
    canTransferOwner = false,
    onTransferOwner,
}: OfflineCanvasToolbarProps) {
    const active = activeFlowPath !== null;
    const isOnlineMode = canvasMode === 'online';
    const editDisabled = !active || !canWrite;
    const hasDraftStatus = !isOnlineMode && (
        draftSaveState === 'saving'
        || draftSaveState === 'error'
        || dirty
        || Boolean(draftSaveState === 'saved' && draftSavedAt)
    );
    const timezoneOffset = timezone ? getTimezoneOffset(timezone) : '';
    const timezoneTooltip = timezone
        ? `任务运行时区：${timezone}${timezoneOffset && timezoneOffset !== timezone ? ` (${timezoneOffset})` : ''}`
        : '';

    const hasOwner = ownerUserId != null || Boolean(ownerName) || Boolean(ownerUsername);

    return (
        <header className="offline-canvas-toolbar">
            <div className="offline-mode-tabs" role="tablist" aria-label="画布视图模式">
                <button
                    type="button"
                    role="tab"
                    aria-selected={!isOnlineMode}
                    className={`offline-mode-tab ${!isOnlineMode ? 'is-active' : ''}`}
                    onClick={() => onCanvasModeChange?.('dev')}
                >
                    开发模式
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={isOnlineMode}
                    className={`offline-mode-tab ${isOnlineMode ? 'is-active' : ''}`}
                    onClick={() => onCanvasModeChange?.('online')}
                >
                    线上模式
                </button>
            </div>

            <span className="offline-toolbar-divider" aria-hidden="true" />

            {!isOnlineMode ? (
                <label className="offline-canvas-toolbar-selectall">
                    <input
                        type="checkbox"
                        checked={nodeCount > 0 && selectedNodeCount === nodeCount}
                        onChange={(event) => onSelectAll(event.target.checked)}
                        disabled={nodeCount === 0}
                    />
                    全选
                </label>
            ) : null}

            {!isOnlineMode ? (
                <ToolbarButton
                    label="提交当前任务"
                    disabled={editDisabled || !(dirty || commitDirty) || committing || pushingFlow}
                    onClick={onCommit}
                >
                    <span className="relative flex">
                        <GitCommitHorizontal size={16} />
                        {(dirty || commitDirty) && <span className="offline-toolbar-dot" />}
                    </span>
                </ToolbarButton>
            ) : null}

            {!isOnlineMode && onPushFlow ? (
                <ToolbarButton
                    label="推送当前任务"
                    disabled={editDisabled || !flowAhead || committing || pushingFlow}
                    onClick={onPushFlow}
                >
                    {pushingFlow ? (
                        <LoaderCircle size={16} className="offline-spin" />
                    ) : (
                        <span className="relative flex">
                            <ArrowUpRight size={16} />
                            {flowAhead && <span className="offline-toolbar-dot" />}
                        </span>
                    )}
                </ToolbarButton>
            ) : null}

            <ToolbarButton
                label="调度"
                disabled={isOnlineMode ? (!active || !hasOnlineDocument) : editDisabled}
                onClick={onOpenSchedule}
            >
                <Settings2 size={16} />
            </ToolbarButton>

            <ToolbarButton
                label="依赖"
                disabled={isOnlineMode ? (!active || !hasOnlineDocument) : !active}
                onClick={onOpenDependencies}
            >
                <GitPullRequest size={16} />
            </ToolbarButton>

            <ToolbarButton
                label="参数"
                disabled={isOnlineMode ? (!active || !hasOnlineDocument) : (editDisabled || !canConfigureParameters)}
                onClick={onOpenParameters}
            >
                <span className="relative flex">
                    <Braces size={16} />
                    {!isOnlineMode && parameterBindingStatus ? (
                        <span
                            className={`offline-toolbar-binding-dot is-${parameterBindingStatus.toLowerCase()}`}
                            aria-hidden="true"
                        />
                    ) : null}
                </span>
            </ToolbarButton>

            {!isOnlineMode ? (
                <ToolbarButton
                    label="执行"
                    disabled={isExecuteButtonDisabled({ activeFlowPath, canWrite })}
                    onClick={onExecute}
                >
                    <Play size={16} />
                </ToolbarButton>
            ) : null}

            <ToolbarButton label="版本" disabled={!active} onClick={onOpenVersions}>
                <ListOrdered size={16} />
            </ToolbarButton>

            <ToolbarButton label="执行结果" disabled={!active} onClick={onOpenExecutions}>
                <History size={16} />
            </ToolbarButton>

            {(hasDraftStatus || timezone || branch || isOnlineMode || hasOwner) ? (
                <div className="offline-canvas-toolbar-meta">
                    <OfflineDeploymentBadge groupId={groupId} branch={branch} config={deploymentConfig} />
                    {isOnlineMode ? (
                        <span className="offline-readonly-pill">线上快照 · 只读</span>
                    ) : (
                        <DraftSaveIndicator
                            state={draftSaveState}
                            savedAt={draftSavedAt}
                            error={draftSaveError}
                            dirty={dirty}
                        />
                    )}
                    {((isOnlineMode || hasDraftStatus) && timezone) ? (
                        <span className="offline-canvas-meta-sep" aria-hidden="true" />
                    ) : null}
                    {timezone ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="offline-canvas-timezone-badge">
                                    <Globe size={13} className="offline-canvas-timezone-icon" aria-hidden="true" />
                                    <span className="offline-canvas-timezone-text">{timezone}</span>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="tooltip-content" side="bottom" align="end" collisionPadding={12}>
                                {timezoneTooltip}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    {hasOwner ? (
                        <>
                            {(isOnlineMode || hasDraftStatus || timezone) ? (
                                <span className="offline-canvas-meta-sep" aria-hidden="true" />
                            ) : null}
                            {!isOnlineMode && canTransferOwner && onTransferOwner ? (
                                <button
                                    type="button"
                                    className="offline-canvas-owner-button"
                                    onClick={onTransferOwner}
                                    title="点击转移当前离线任务负责人"
                                    aria-label="转移任务负责人"
                                >
                                    <OwnerCell
                                        name={ownerName}
                                        username={ownerUsername}
                                        status={ownerStatus}
                                    />
                                </button>
                            ) : (
                                <span className="offline-canvas-owner-readonly">
                                    <OwnerCell
                                        name={ownerName}
                                        username={ownerUsername}
                                        status={ownerStatus}
                                    />
                                </span>
                            )}
                        </>
                    ) : null}
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
                <LoaderCircle size={13} className="offline-spin" aria-hidden="true" />
                <span>保存中</span>
            </span>
        );
    }
    if (state === 'error') {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="offline-canvas-save-indicator is-error" role="status">
                        <CircleAlert size={13} aria-hidden="true" />
                        <span>保存失败</span>
                    </span>
                </TooltipTrigger>
                <TooltipContent className="tooltip-content tooltip-content-wrap" side="bottom" align="end" collisionPadding={12}>
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
                <Check size={13} aria-hidden="true" />
                <span>已保存 {hh}:{mm}</span>
            </span>
        );
    }
    return null;
}
