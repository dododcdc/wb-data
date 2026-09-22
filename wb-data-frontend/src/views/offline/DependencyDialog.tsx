import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
    getOfflineDependents,
    searchOfflineDependencyCandidates,
    type OfflineDependencyCandidate,
    type OfflineDependentItem,
    type OfflineFlowDependencyRef,
    type OfflineFlowDependencySettings,
    type OfflineFlowDocument,
    type OfflineSchedulePeriod,
} from '../../api/offline';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import { inferPeriodFromCron, isValidCronExpression, parsePeriodPartsFromCron } from './ScheduleUtils';
import './ScheduleDialog.css';
import './DependencyDialog.css';

interface DependencyDialogProps {
    groupId: number;
    document: OfflineFlowDocument;
    onClose: () => void;
    onStage: (config: OfflineFlowDependencySettings) => void;
    canWrite?: boolean;
}

type LoadState =
    | { status: 'loading' | 'error' }
    | { status: 'ready'; candidates: OfflineDependencyCandidate[]; dependents: OfflineDependentItem[] };

const MAX_DEPENDENCIES = 20;
const PERIOD_LABELS: Record<OfflineSchedulePeriod, string> = {
    HOURLY: '每小时',
    DAILY: '每天',
    WEEKLY: '每周',
    MONTHLY: '每月',
    YEARLY: '每年',
    CUSTOM: '非标准频率',
};
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function refKey(ref: OfflineFlowDependencyRef) {
    return `${ref.groupId}:${ref.flowId}`;
}

function groupLabel(item: { groupName: string | null; groupId: number }) {
    return item.groupName || `项目组 ${item.groupId}`;
}

function directoryLabel(path: string) {
    return path.replace(/^_flows\//, '').replace(/\/?flow\.ya?ml$/, '');
}

function standardPeriod(period: OfflineSchedulePeriod | null | undefined): period is Exclude<OfflineSchedulePeriod, 'CUSTOM'> {
    return period != null && period !== 'CUSTOM' && period in PERIOD_LABELS;
}

function scheduleSummary(schedule: {
    period: OfflineSchedulePeriod | null;
    cron: string | null;
    timezone: string | null;
    enabled: boolean;
} | null | undefined) {
    if (!schedule) return '未配置调度';
    const { period, cron, timezone, enabled } = schedule;
    const label = period ? PERIOD_LABELS[period] : '未配置标准频率';
    // Never fall back to the schedule editor's default time for missing or legacy cron.
    const parts = cron && standardPeriod(period) && inferPeriodFromCron(cron) === period
        && isValidCronExpression(cron, timezone || undefined)
        ? parsePeriodPartsFromCron(cron)
        : null;
    let time = '计划时间不可用';
    if (parts) {
        const clock = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
        switch (period) {
            case 'HOURLY': time = `${parts.minute} 分`; break;
            case 'DAILY': time = clock; break;
            case 'WEEKLY': time = `${WEEKDAY_LABELS[parts.dayOfWeek]} ${clock}`; break;
            case 'MONTHLY': time = `${parts.dayOfMonth} 日 ${clock}`; break;
            case 'YEARLY': time = `${parts.month} 月 ${parts.dayOfMonth} 日 ${clock}`; break;
        }
    }
    return [label, time, timezone, !enabled ? '调度已暂停' : null].filter(Boolean).join(' · ');
}

function unavailableReason(candidate: OfflineDependencyCandidate, groupId: number, document: OfflineFlowDocument) {
    if (candidate.groupId === groupId && candidate.flowId === document.flowId) return '不能依赖当前任务';
    if (!standardPeriod(document.schedule?.period)) return '当前任务未配置标准调度频率，请先配置调度';
    if (!candidate.hasSchedule || !standardPeriod(candidate.period)) return '未配置标准调度频率';
    if (candidate.period !== document.schedule?.period) return '与当前任务调度频率不同';
    if (candidate.groupId !== groupId && candidate.crossGroupDependency === 'DENY') return '该任务不允许跨项目组依赖';
    return null;
}

function CandidateMeta({ candidate }: { candidate: OfflineDependencyCandidate }) {
    return (
        <span className="offline-dependency-meta">
            {scheduleSummary(candidate.hasSchedule ? candidate : null)}
        </span>
    );
}

function TaskSummary({ candidate }: { candidate: OfflineDependencyCandidate }) {
    return (
        <div className="offline-dependency-task">
            <span className="offline-dependency-task-name">{candidate.flowId}</span>
            <CandidateMeta candidate={candidate} />
            <span className="offline-dependency-dir">{groupLabel(candidate)} / {directoryLabel(candidate.path)}</span>
        </div>
    );
}

// A task switch starts a fresh editing session and disposes all requests from the old task.
export function DependencyDialog(props: DependencyDialogProps) {
    return <DependencyDialogSession key={JSON.stringify([props.groupId, props.document.path, props.document.flowId])} {...props} />;
}

function DependencyDialogSession({ groupId, document, onClose, onStage, canWrite = true }: DependencyDialogProps) {
    const [settings, setSettings] = useState<OfflineFlowDependencySettings>(() => ({
        dependencies: Array.from(new Map((document.dependencyConfig?.dependencies ?? []).map(({ groupId, flowId }) => (
            [refKey({ groupId, flowId }), { groupId, flowId }]
        ))).values()),
        failurePolicy: document.dependencyConfig?.failurePolicy ?? 'CONTINUE',
        crossGroupDependency: document.dependencyConfig?.crossGroupDependency ?? 'ALLOW',
    }));
    const [load, setLoad] = useState<LoadState>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const [keyword, setKeyword] = useState('');
    const [filterQuery, setFilterQuery] = useState('');
    // Ref, not state: marking composition must not re-render, or React would
    // restore the controlled value mid-composition and destroy the IME session.
    const isComposingRef = useRef(false);
    const id = useId();
    const path = document.path;

    useEffect(() => {
        let active = true;
        // Fetch the complete visible set once. Search must not race with earlier keywords.
        Promise.all([
            searchOfflineDependencyCandidates(groupId, path),
            getOfflineDependents(groupId, path),
        ]).then(([candidates, dependents]) => {
            if (active) setLoad({ status: 'ready', candidates, dependents });
        }).catch(() => {
            if (active) setLoad({ status: 'error' });
        });
        return () => { active = false; };
    }, [groupId, path, attempt]);

    const candidatesByRef = useMemo(() => new Map(
        load.status === 'ready' ? load.candidates.map((candidate) => [refKey(candidate), candidate]) : [],
    ), [load]);
    const selectedKeys = new Set(settings.dependencies.map(refKey));
    const query = filterQuery.trim().toLocaleLowerCase();
    const candidates = Array.from(candidatesByRef.values()).filter((candidate) => (
        [candidate.flowId, candidate.path, groupLabel(candidate)].some((value) => value.toLocaleLowerCase().includes(query))
    ));
    const crossGroupDependents = load.status === 'ready'
        ? load.dependents.filter((dependent) => dependent.groupId !== groupId)
        : [];
    const allowCrossGroup = settings.crossGroupDependency === 'ALLOW';
    const crossGroupLocked = crossGroupDependents.length > 0;
    const atLimit = settings.dependencies.length >= MAX_DEPENDENCIES;
    const selectedItems = settings.dependencies.map((ref) => {
        const candidate = candidatesByRef.get(refKey(ref));
        const reason = load.status !== 'ready' ? null : candidate
            ? unavailableReason(candidate, groupId, document)
            : '任务不可见或已不存在，请移除后暂存';
        return { ref, candidate, reason };
    });
    const stageDisabled = !canWrite || load.status !== 'ready'
        || settings.dependencies.length > MAX_DEPENDENCIES
        || selectedItems.some((item) => item.reason != null)
        || (crossGroupLocked && !allowCrossGroup);

    const remove = (ref: OfflineFlowDependencyRef) => {
        if (!canWrite) return;
        setSettings((current) => ({
            ...current,
            dependencies: current.dependencies.filter((item) => refKey(item) !== refKey(ref)),
        }));
    };
    const add = (candidate: OfflineDependencyCandidate) => {
        if (!canWrite || load.status !== 'ready' || unavailableReason(candidate, groupId, document)) return;
        setSettings((current) => {
            if (current.dependencies.length >= MAX_DEPENDENCIES || current.dependencies.some((ref) => refKey(ref) === refKey(candidate))) return current;
            return { ...current, dependencies: [...current.dependencies, { groupId: candidate.groupId, flowId: candidate.flowId }] };
        });
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="offline-schedule-dialog-standard offline-dependency-dialog">
                <DialogHeader>
                    <DialogTitle>依赖配置</DialogTitle>
                    <DialogDescription className="offline-dependency-subtitle">
                        {document.flowId} · {scheduleSummary(document.schedule)}
                    </DialogDescription>
                </DialogHeader>

                <div className="offline-schedule-body offline-dependency-body">
                    {!canWrite ? <p className="offline-dependency-hint" role="note">当前为只读，无法修改依赖配置。</p> : null}

                    <section aria-labelledby={`${id}-selected`} className="offline-dependency-selected-section">
                        <div className="offline-dependency-section-heading">
                            <h3 id={`${id}-selected`} className="offline-schedule-field-label">前置任务</h3>
                            <span className="offline-dependency-count" aria-live="polite">{settings.dependencies.length} / {MAX_DEPENDENCIES}</span>
                        </div>
                        {settings.dependencies.length === 0 ? (
                            <p className="offline-dependency-empty">暂无前置任务</p>
                        ) : (
                            <ul className="offline-dependency-list offline-dependency-selected" aria-label="已选前置任务" tabIndex={0}>
                                {selectedItems.map(({ ref, candidate, reason }, index) => (
                                    <li key={refKey(ref)} className="offline-dependency-row">
                                        <div className="offline-dependency-row-content">
                                            {candidate ? <TaskSummary candidate={candidate} /> : (
                                                <div className="offline-dependency-task">
                                                    <span className="offline-dependency-task-name">{load.status === 'ready' ? '不可见前置任务' : '前置任务'} {index + 1}</span>
                                                    {load.status === 'error' ? <span className="offline-dependency-meta">任务信息暂不可用</span> : null}
                                                </div>
                                            )}
                                            {reason ? <p className="offline-dependency-invalid">{reason}</p> : null}
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            disabled={!canWrite}
                                            aria-label={candidate ? `移除 ${groupLabel(candidate)} / ${candidate.flowId}` : `移除前置任务 ${index + 1}`}
                                            onClick={() => remove(ref)}
                                        ><X size={14} aria-hidden="true" /></Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section aria-labelledby={`${id}-search-label`} aria-busy={load.status === 'loading'} className="offline-dependency-search-section">
                        <label id={`${id}-search-label`} htmlFor={`${id}-search`} className="sr-only">添加前置任务</label>
                        <div className="offline-dependency-search">
                            <Search size={15} aria-hidden="true" />
                            <input
                                id={`${id}-search`}
                                type="search"
                                placeholder="搜索并添加前置任务"
                                value={keyword}
                                onCompositionStart={() => { isComposingRef.current = true; }}
                                onCompositionEnd={(event) => {
                                    isComposingRef.current = false;
                                    const next = event.currentTarget.value;
                                    setKeyword(next);
                                    setFilterQuery(next);
                                }}
                                onChange={(event) => {
                                    const next = event.target.value;
                                    setKeyword(next);
                                    if (!isComposingRef.current) setFilterQuery(next);
                                }}
                                aria-controls={`${id}-candidates`}
                            />
                        </div>
                        {load.status === 'loading' ? (
                            <div aria-hidden="true" className="offline-dependency-skeleton">
                                <div className="h-3 w-3/4 rounded bg-muted" />
                                <div className="h-3 w-1/2 rounded bg-muted" />
                            </div>
                        ) : load.status === 'error' ? (
                            <div className="offline-dependency-load-error">
                                <p role="alert">候选任务加载失败，暂时无法暂存配置。</p>
                                <Button type="button" variant="outline" size="sm" onClick={() => {
                                    setLoad({ status: 'loading' });
                                    setAttempt((current) => current + 1);
                                }}>重试</Button>
                            </div>
                        ) : candidates.length === 0 ? (
                            <p className="offline-dependency-empty" role="status">{query ? '没有匹配的任务' : '暂无可依赖的任务'}</p>
                        ) : (
                            <ul id={`${id}-candidates`} className="offline-dependency-list offline-dependency-candidates" aria-label="候选任务" tabIndex={0}>
                                {candidates.map((candidate) => {
                                    const selected = selectedKeys.has(refKey(candidate));
                                    const reason = unavailableReason(candidate, groupId, document)
                                        ?? (!selected && atLimit ? '已达到 20 个前置任务上限' : null);
                                    return (
                                        <li key={refKey(candidate)} className="offline-dependency-row">
                                            <div className="offline-dependency-row-content">
                                                <TaskSummary candidate={candidate} />
                                                {reason ? <p className="offline-dependency-hint">{reason}</p> : null}
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                disabled={!canWrite || selected || reason != null}
                                                aria-label={`${selected ? '已添加' : '添加'} ${groupLabel(candidate)} / ${candidate.flowId}`}
                                                onClick={() => add(candidate)}
                                            >{selected ? '已添加' : '添加'}</Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>

                    <div className="offline-dependency-policies">
                        <fieldset className="offline-dependency-failure-policy" disabled={!canWrite}>
                            <span className="offline-schedule-field-label" id={`${id}-failure-label`}>上一期失败后</span>
                            <div className="offline-dependency-radio-options" role="radiogroup" aria-labelledby={`${id}-failure-label`}>
                                <label><input type="radio" name={`${id}-failure`} checked={settings.failurePolicy === 'CONTINUE'} onChange={() => setSettings((current) => ({ ...current, failurePolicy: 'CONTINUE' }))} />继续调度</label>
                                <label><input type="radio" name={`${id}-failure`} checked={settings.failurePolicy === 'PAUSE'} onChange={() => setSettings((current) => ({ ...current, failurePolicy: 'PAUSE' }))} />暂停后续调度</label>
                            </div>
                        </fieldset>
                        <div className="offline-schedule-toggle-row">
                            <span id={`${id}-cross-label`} className="offline-schedule-field-label">允许被其他项目组依赖</span>
                            <button
                                type="button"
                                role="switch"
                                aria-labelledby={`${id}-cross-label`}
                                aria-describedby={crossGroupLocked ? `${id}-cross-note` : undefined}
                                aria-checked={allowCrossGroup}
                                disabled={!canWrite || load.status !== 'ready' || (crossGroupLocked && allowCrossGroup)}
                                className="offline-switch offline-dependency-switch"
                                onClick={() => setSettings((current) => ({ ...current, crossGroupDependency: current.crossGroupDependency === 'ALLOW' ? 'DENY' : 'ALLOW' }))}
                            ><span className="offline-switch-thumb" aria-hidden="true" /></button>
                        </div>
                        {crossGroupLocked ? (
                            <div id={`${id}-cross-note`} className="offline-dependency-downstream">
                                <p>已有跨项目组下游依赖，请先解除以下依赖，再关闭开关：</p>
                                <ul aria-label="跨项目组下游任务">
                                    {crossGroupDependents.map((dependent) => <li key={refKey(dependent)}>{groupLabel(dependent)} / {dependent.flowId}</li>)}
                                </ul>
                            </div>
                        ) : null}
                    </div>
                </div>

                <DialogFooter className="offline-schedule-footer">
                    <p className="offline-schedule-publish-note">暂存后自动保存草稿；运行等待机制将在后续版本接入。</p>
                    <div className="offline-schedule-actions">
                        <Button type="button" variant="outline" onClick={onClose}>取消</Button>
                        <Button type="button" disabled={stageDisabled} onClick={() => {
                            if (stageDisabled) return;
                            onStage({
                                dependencies: settings.dependencies.map(({ groupId, flowId }) => ({ groupId, flowId })),
                                failurePolicy: settings.failurePolicy,
                                crossGroupDependency: settings.crossGroupDependency,
                            });
                            onClose();
                        }}>暂存配置</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
