import { useEffect, useState, type ComponentProps } from 'react';
import {
    getOfflineDependents,
    type OfflineDependentItem,
    type OfflineFlowDependencySettings,
    type OfflineSchedulePeriod,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import { getErrorMessage } from '../../utils/error';
import { ScheduleDialog } from './ScheduleDialog';
import { DEFAULT_PERIOD_PARTS, parsePeriodPartsFromCron } from './ScheduleUtils';

export type DependencyAwareScheduleDialogProps = ComponentProps<typeof ScheduleDialog> & {
    groupId: number | null;
    path: string | null;
    dependencyConfig?: OfflineFlowDependencySettings;
    savedPeriod?: OfflineSchedulePeriod | null;
};

const PERIOD_LABELS: Record<OfflineSchedulePeriod, string> = {
    HOURLY: '每小时',
    DAILY: '每天',
    WEEKLY: '每周',
    MONTHLY: '每月',
    YEARLY: '每年',
    CUSTOM: '自定义',
};

export function DependencyAwareScheduleDialog(props: DependencyAwareScheduleDialogProps) {
    const { groupId, path, dependencyConfig, savedPeriod, ...dialogProps } = props;
    // No background workbench reads. A new open/target starts a fresh check and
    // destroys the previous request's state, including after closing/reopening.
    if (!props.open) return <ScheduleDialog {...dialogProps} />;
    return (
        <OpenScheduleDialog
            key={JSON.stringify([groupId, path])}
            {...dialogProps}
            groupId={groupId}
            path={path}
            dependencyConfig={dependencyConfig}
            savedPeriod={savedPeriod}
        />
    );
}

function OpenScheduleDialog({
    groupId,
    path,
    dependencyConfig,
    savedPeriod,
    ...props
}: DependencyAwareScheduleDialogProps) {
    const [dependents, setDependents] = useState<OfflineDependentItem[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [blocked, setBlocked] = useState(false);
    const [openingPeriod] = useState(props.period);
    // Downstreams protect the persisted frequency; new upstreams belong to the current draft.
    const protectedPeriod = dependents?.length === 0 ? openingPeriod : savedPeriod ?? openingPeriod;
    const hasTarget = groupId !== null && Boolean(path);
    const hasUpstream = Boolean(dependencyConfig?.dependencies.length);
    const loading = hasTarget && dependents === null && loadError === null;
    const periodChangeDisabled = !hasTarget || dependents === null || hasUpstream || dependents.length > 0;
    const periodMismatch = periodChangeDisabled && props.period !== protectedPeriod;

    useEffect(() => {
        if (groupId === null || !path) return;
        let active = true;
        getOfflineDependents(groupId, path).then(
            (items) => { if (active) setDependents(items); },
            (error: unknown) => {
                if (active) setLoadError(getErrorMessage(error, '请检查网络后重试'));
            },
        );
        return () => { active = false; };
    }, [groupId, path, attempt]);

    const retry = () => {
        setDependents(null);
        setLoadError(null);
        setBlocked(false);
        setAttempt((value) => value + 1);
    };
    const guardStaging = (action: () => void) => {
        // Both Save and Toggle stage the parent's current period. Never replace
        // the draft here: refusing the action preserves all other edits.
        if (periodMismatch) {
            setBlocked(true);
            return;
        }
        setBlocked(false);
        action();
    };

    const isQuietReady = !loading && hasTarget && !loadError && !hasUpstream && dependents?.length === 0 && !periodMismatch && !blocked;
    const hasLockNotice = Boolean(hasUpstream || (dependents && dependents.length > 0));
    const hasAlert = Boolean(!hasTarget || loadError || periodMismatch || blocked);

    const dependencyNotice = (
        <section
            aria-label="调度依赖检查"
            aria-busy={loading}
            className={[
                'offline-schedule-dependency-notice',
                isQuietReady ? 'is-ready' : '',
                hasLockNotice ? 'is-locked' : '',
                hasAlert ? 'is-alert' : '',
            ].filter(Boolean).join(' ')}
        >
            {loading ? (
                <div aria-hidden="true" className="offline-schedule-dependency-skeleton">
                    <div className="offline-schedule-skeleton-line is-wide" />
                    <div className="offline-schedule-skeleton-line is-narrow" />
                </div>
            ) : null}
            {!hasTarget ? <p className="offline-schedule-dependency-alert-text">无法确认当前任务，暂不能修改调度频率。请关闭后重新打开。</p> : null}
            {loadError ? (
                <div className="offline-schedule-dependency-action-row">
                    <p role="alert" className="offline-schedule-dependency-alert-text">下游依赖读取失败：{loadError}。暂不能修改频率，仍可调整同频率的计划时间。</p>
                    <Button type="button" variant="outline" size="sm" onClick={retry}>重试</Button>
                </div>
            ) : null}
            {hasUpstream ? <p className="offline-schedule-dependency-text">本任务存在前置依赖。修改调度频率前，请先解除本任务的前置依赖；仍可调整同频率的计划时间。</p> : null}
            {dependents && dependents.length > 0 ? (
                <div className="offline-schedule-dependents-block">
                    <p className="offline-schedule-dependency-text">以下下游任务依赖本任务，请先在下游任务中解除依赖，再修改调度频率。仍可调整同频率的计划时间。</p>
                    <details open={dependents.length <= 3} className="offline-schedule-dependents-details">
                        <summary className="offline-schedule-dependents-summary">
                            下游任务（{dependents.length}）
                        </summary>
                        <ul
                            aria-label="下游任务"
                            tabIndex={0}
                            className="offline-schedule-dependents-list"
                            style={{ maxHeight: 128 }}
                        >
                            {dependents.map((item) => (
                                <li key={JSON.stringify([item.groupId, item.flowId, item.path])} className="offline-schedule-dependent-item">
                                    <span className="offline-schedule-dependent-name">{item.groupName || `项目组 ${item.groupId}`} / {item.flowId}</span>
                                    <span className="offline-schedule-dependent-path">{item.path}</span>
                                </li>
                            ))}
                        </ul>
                    </details>
                </div>
            ) : null}
            {dependents?.length === 0 && !hasUpstream ? <p className="offline-schedule-dependency-ready-text">未发现下游依赖，可调整调度频率和计划时间。</p> : null}
            {periodMismatch ? (
                <div className="offline-schedule-dependency-action-row">
                    <p role="alert" className="offline-schedule-dependency-alert-text">当前草稿频率与受保护频率「{PERIOD_LABELS[protectedPeriod]}」不同，暂不能暂存或切换自动调度。其他编辑已保留；请先恢复频率，或解除依赖后重新打开。</p>
                    {protectedPeriod !== 'CUSTOM' ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={props.saving}
                            onClick={() => {
                                props.onPeriodChange(protectedPeriod, parsePeriodPartsFromCron(props.cron) ?? DEFAULT_PERIOD_PARTS);
                                setBlocked(false);
                            }}
                        >
                            恢复为{PERIOD_LABELS[protectedPeriod]}
                        </Button>
                    ) : null}
                </div>
            ) : blocked ? <p role="alert" className="offline-schedule-dependency-alert-text">当前暂不能修改调度频率，仍可调整同频率的计划时间。其他编辑已保留。</p> : null}
        </section>
    );

    const dialogProps: ComponentProps<typeof ScheduleDialog> = {
        ...props,
        periodChangeDisabled,
        dependencyNotice,
        onPeriodChange: (nextPeriod, parts) => {
            if (periodChangeDisabled && nextPeriod !== protectedPeriod) {
                // A draft may already differ from persisted state on opening.
                // Keep time edits available without allowing another frequency.
                if (nextPeriod !== props.period || !parts) {
                    setBlocked(true);
                    return;
                }
            }
            setBlocked(false);
            if (parts) props.onPeriodChange(nextPeriod, parts);
            else props.onPeriodChange(nextPeriod);
        },
        onSave: () => guardStaging(props.onSave),
        onToggle: (enabled) => guardStaging(() => props.onToggle(enabled)),
    };
    return <ScheduleDialog {...dialogProps} />;
}
