import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CronExpressionParser } from 'cron-parser';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../../../components/ui/select';
import { type OfflineSchedulePeriod, type OfflineScheduleResponse } from '../../../api/offline';
import {
    ALL_HOURS,
    DEFAULT_HOURLY_SPEC,
    DEFAULT_PERIOD_PARTS,
    expandHourlySpecHours,
    formatPreviewTime,
    inferPeriodFromCron,
    parsePeriodPartsFromCron,
    type HourlyScheduleMode,
    type HourlyScheduleSpec,
    type SchedulePeriodParts,
} from './ScheduleUtils';
import './ScheduleDialog.css';

interface ScheduleDialogProps {
    open: boolean;
    schedule: OfflineScheduleResponse | null;
    cron: string;
    period: OfflineSchedulePeriod;
    timezone: string;
    retryEnabled?: boolean;
    retryCount?: number;
    retryIntervalMinutes?: number;
    saving: boolean;
    flowId: string | null;
    readOnly?: boolean;
    readOnlyRevision?: string | null;
    hasRemote?: boolean;
    hasLocalOrUnpushedChanges?: boolean;
    periodChangeDisabled?: boolean;
    dependencyNotice?: ReactNode;
    onOpenChange: (open: boolean) => void;
    onPeriodChange: (period: OfflineSchedulePeriod, parts?: SchedulePeriodParts) => void;
    onRetryChange?: (patch: {
        retryEnabled?: boolean;
        retryCount?: number;
        retryIntervalMinutes?: number;
    }) => void;
    onSave: () => void;
    onToggle: (enabled: boolean) => void;
}

const PERIOD_OPTIONS: { value: OfflineSchedulePeriod; label: string }[] = [
    { value: 'HOURLY', label: '每小时' },
    { value: 'DAILY', label: '每天' },
    { value: 'WEEKLY', label: '每周' },
    { value: 'MONTHLY', label: '每月' },
    { value: 'YEARLY', label: '每年' },
];

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);
const HOUR_OPTIONS = ALL_HOURS;
const START_HOUR_OPTIONS = Array.from({ length: 23 }, (_, i) => i);
const BASE_HOURLY_STEP_OPTIONS = [1, 2, 3, 4, 6, 8, 12];
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);
const WEEK_DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const WEEK_DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const DEFAULT_CONTINUOUS_RANGE = { startHour: 0, endHour: 23, step: 1 };
const RETRY_COUNT_OPTIONS = [1, 2, 3, 4, 5];
const BASE_RETRY_INTERVAL_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30, 60];

function clampContinuousStep(startHour: number, endHour: number, step: number): number {
    if (step <= 1 || startHour + step <= endHour) {
        return Math.max(1, step);
    }
    const maxSpan = endHour - startHour;
    const candidate = [...BASE_HOURLY_STEP_OPTIONS].reverse().find((s) => s <= maxSpan && startHour + s <= endHour);
    return candidate ?? 1;
}

function pad2(hour: number): string {
    return String(hour).padStart(2, '0');
}

function NumberSelect({ value, options, suffix, ariaLabel, disabled, popupContainer, formatLabel, className, onChange }: {
    value: number;
    options: number[];
    suffix?: string;
    ariaLabel: string;
    disabled?: boolean;
    popupContainer?: HTMLElement | null;
    formatLabel?: (value: number) => string;
    className?: string;
    onChange: (value: number) => void;
}) {
    const labelOf = (v: number) => formatLabel ? formatLabel(v) : `${v}${suffix ?? ''}`;
    return (
        <Select
            value={String(value)}
            onValueChange={(next) => onChange(Number(next))}
            disabled={disabled}
        >
            <SelectTrigger
                aria-label={ariaLabel}
                className={['offline-schedule-period-select', className].filter(Boolean).join(' ')}
            >
                <SelectValue>{(value: string) => labelOf(Number(value))}</SelectValue>
            </SelectTrigger>
            <SelectContent container={popupContainer}>
                {options.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                        {labelOf(option)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function ScheduleDialog(props: ScheduleDialogProps) {
    const {
        open,
        schedule,
        cron,
        period,
        timezone,
        retryEnabled = false,
        retryCount = 3,
        retryIntervalMinutes = 5,
        saving,
        flowId,
        readOnly = false,
        readOnlyRevision = null,
        hasRemote = true,
        hasLocalOrUnpushedChanges = false,
        periodChangeDisabled = false,
        dependencyNotice,
        onOpenChange,
        onPeriodChange,
        onRetryChange,
        onSave,
        onToggle,
    } = props;

    const preview = useMemo(() => {
        const currentCron = cron || '0 2 * * *';
        try {
            const interval = CronExpressionParser.parse(currentCron, { tz: timezone || undefined });
            const times: string[] = [];
            for (let i = 0; i < 5; i++) {
                const nextRun = interval.next().toISOString();
                if (!nextRun) {
                    throw new Error('Invalid next run time');
                }
                times.push(nextRun);
            }
            return { type: 'ok' as const, times };
        } catch {
            return { type: 'error' as const };
        }
    }, [cron, timezone]);

    const legacyCustom = period === 'CUSTOM';
    const effectivePeriod: Exclude<OfflineSchedulePeriod, 'CUSTOM'> = legacyCustom ? 'DAILY' : period;
    const parsedParts = useMemo(
        () => (!legacyCustom && inferPeriodFromCron(cron) === effectivePeriod ? parsePeriodPartsFromCron(cron) : null),
        [cron, effectivePeriod, legacyCustom],
    );
    const periodParts = parsedParts ?? DEFAULT_PERIOD_PARTS;
    const parsedHourlySpec: HourlyScheduleSpec =
        effectivePeriod === 'HOURLY' ? (parsedParts?.hourly ?? DEFAULT_HOURLY_SPEC) : DEFAULT_HOURLY_SPEC;

    const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null);
    const [previewExpanded, setPreviewExpanded] = useState(false);
    const [hourlyModeOverride, setHourlyModeOverride] = useState<HourlyScheduleMode | null>(null);
    const [continuousDraft, setContinuousDraft] = useState(DEFAULT_CONTINUOUS_RANGE);
    const [discreteHoursDraft, setDiscreteHoursDraft] = useState<number[] | null>(null);
    const [discreteMinuteDraft, setDiscreteMinuteDraft] = useState<number | null>(null);
    const periodId = useId();
    const hourlyModeId = useId();
    const previewId = useId();
    const retrySwitchId = useId();

    useEffect(() => {
        if (!open) setPreviewExpanded(false);
    }, [open]);

    useEffect(() => {
        if (!open || effectivePeriod !== 'HOURLY') {
            setHourlyModeOverride(null);
            setContinuousDraft(DEFAULT_CONTINUOUS_RANGE);
            setDiscreteHoursDraft(null);
            setDiscreteMinuteDraft(null);
        }
    }, [open, effectivePeriod, flowId]);

    useEffect(() => {
        if (!open || effectivePeriod !== 'HOURLY') return;
        if (parsedHourlySpec.mode === 'CONTINUOUS') {
            setContinuousDraft({
                startHour: parsedHourlySpec.startHour,
                endHour: parsedHourlySpec.endHour,
                step: parsedHourlySpec.step,
            });
            setDiscreteHoursDraft((prev) =>
                hourlyModeOverride === 'DISCRETE' && prev !== null && prev.length === 24 ? ALL_HOURS : null,
            );
            if (hourlyModeOverride !== 'DISCRETE') {
                setDiscreteMinuteDraft(null);
            }
        } else {
            setDiscreteHoursDraft(parsedHourlySpec.hours);
            setDiscreteMinuteDraft(null);
        }
    }, [open, effectivePeriod, cron, parsedHourlySpec, hourlyModeOverride]);

    const hourlyMode: HourlyScheduleMode = hourlyModeOverride ?? parsedHourlySpec.mode;
    const currentMinute = discreteMinuteDraft ?? periodParts.minute;
    const discreteHours = discreteHoursDraft ?? (parsedHourlySpec.mode === 'DISCRETE' ? parsedHourlySpec.hours : []);
    const hourlyIncomplete = effectivePeriod === 'HOURLY' && hourlyMode === 'DISCRETE' && discreteHours.length < 2;

    const cronInvalid = preview.type === 'error';
    const enabled = schedule?.enabled ?? false;
    const effectiveDisabled = readOnly || saving;
    // Allow turning OFF even with invalid/incomplete cron; block turning ON.
    const switchDisabled = effectiveDisabled || ((cronInvalid || hourlyIncomplete) && !enabled);

    const handleToggle = () => {
        if (readOnly) return;
        const next = !enabled;
        if (next && (cronInvalid || hourlyIncomplete)) return;
        onToggle(next);
    };

    const effectiveRetryCount = retryCount >= 1 && retryCount <= 5 ? retryCount : 3;
    const effectiveRetryIntervalMinutes =
        retryIntervalMinutes >= 1 && retryIntervalMinutes <= 60 ? retryIntervalMinutes : 5;
    const retryIntervalOptions = useMemo(() => {
        if (BASE_RETRY_INTERVAL_OPTIONS.includes(effectiveRetryIntervalMinutes)) {
            return BASE_RETRY_INTERVAL_OPTIONS;
        }
        return [...BASE_RETRY_INTERVAL_OPTIONS, effectiveRetryIntervalMinutes].sort((a, b) => a - b);
    }, [effectiveRetryIntervalMinutes]);

    const handleRetryToggle = () => {
        if (effectiveDisabled || !onRetryChange) return;
        onRetryChange({
            retryEnabled: !retryEnabled,
            retryCount: effectiveRetryCount,
            retryIntervalMinutes: effectiveRetryIntervalMinutes,
        });
    };

    const showNoRemoteAlert = !readOnly && !hasRemote;
    const showDriftAlert = !readOnly && hasLocalOrUnpushedChanges;

    const emitContinuousHourly = (nextContinuous: { startHour: number; endHour: number; step: number }, minute = currentMinute) => {
        if (readOnly) return;
        setContinuousDraft(nextContinuous);
        setDiscreteMinuteDraft(null);
        setDiscreteHoursDraft(null);
        const hours = expandHourlySpecHours({ mode: 'CONTINUOUS', ...nextContinuous, hours: [] });
        onPeriodChange('HOURLY', {
            ...periodParts,
            minute,
            hourly: {
                mode: 'CONTINUOUS',
                startHour: nextContinuous.startHour,
                endHour: nextContinuous.endHour,
                step: nextContinuous.step,
                hours,
            },
        });
    };

    const emitDiscreteHourly = (nextHours: number[], minute = currentMinute) => {
        if (readOnly) return;
        const sorted = Array.from(new Set(nextHours)).sort((a, b) => a - b);
        setDiscreteHoursDraft(sorted);
        if (sorted.length < 2) {
            setDiscreteMinuteDraft(minute);
            return;
        }
        setDiscreteMinuteDraft(null);
        onPeriodChange('HOURLY', {
            ...periodParts,
            minute,
            hourly: {
                mode: 'DISCRETE',
                startHour: 0,
                endHour: 23,
                step: 1,
                hours: sorted,
            },
        });
    };

    const handleHourlyModeChange = (nextMode: HourlyScheduleMode) => {
        if (readOnly || nextMode === hourlyMode) return;
        setHourlyModeOverride(nextMode);
        if (nextMode === 'CONTINUOUS') {
            emitContinuousHourly(continuousDraft, currentMinute);
            return;
        }
        const isFullDay = continuousDraft.startHour === 0 && continuousDraft.endHour === 23 && continuousDraft.step === 1;
        if (isFullDay) {
            setDiscreteHoursDraft([]);
            setDiscreteMinuteDraft(currentMinute);
            return;
        }
        const expanded = expandHourlySpecHours({ mode: 'CONTINUOUS', ...continuousDraft, hours: [] });
        emitDiscreteHourly(expanded, currentMinute);
    };

    const handleStartHourChange = (nextStart: number) => {
        const clampedStart = Math.min(Math.max(nextStart, 0), 22);
        const nextEnd = Math.max(continuousDraft.endHour, clampedStart + 1);
        const nextStep = clampContinuousStep(clampedStart, nextEnd, continuousDraft.step);
        emitContinuousHourly({ startHour: clampedStart, endHour: nextEnd, step: nextStep });
    };

    const handleEndHourChange = (nextEnd: number) => {
        const clampedEnd = Math.min(Math.max(nextEnd, continuousDraft.startHour + 1), 23);
        const nextStep = clampContinuousStep(continuousDraft.startHour, clampedEnd, continuousDraft.step);
        emitContinuousHourly({ startHour: continuousDraft.startHour, endHour: clampedEnd, step: nextStep });
    };

    const handleStepChange = (nextStep: number) => {
        const clampedStep = clampContinuousStep(continuousDraft.startHour, continuousDraft.endHour, nextStep);
        emitContinuousHourly({ ...continuousDraft, step: clampedStep });
    };

    const handleHourlyMinuteChange = (nextMinute: number) => {
        if (readOnly) return;
        if (hourlyMode === 'DISCRETE') {
            if (discreteHours.length < 2) {
                setDiscreteMinuteDraft(nextMinute);
                return;
            }
            emitDiscreteHourly(discreteHours, nextMinute);
            return;
        }
        emitContinuousHourly(continuousDraft, nextMinute);
    };

    const handleToggleDiscreteHour = (hour: number) => {
        if (readOnly) return;
        const exists = discreteHours.includes(hour);
        const nextHours = exists
            ? discreteHours.filter((item) => item !== hour)
            : [...discreteHours, hour].sort((a, b) => a - b);
        emitDiscreteHourly(nextHours, currentMinute);
    };

    const handleClearDiscreteHours = () => {
        if (readOnly) return;
        setHourlyModeOverride('DISCRETE');
        setDiscreteMinuteDraft(currentMinute);
        setDiscreteHoursDraft([]);
    };

    const updatePeriodParts = (patch: Partial<SchedulePeriodParts>) => {
        if (readOnly) return;
        onPeriodChange(effectivePeriod, { ...periodParts, ...patch });
    };

    const continuousEndOptions = useMemo(
        () => HOUR_OPTIONS.filter((h) => h > continuousDraft.startHour),
        [continuousDraft.startHour],
    );

    const continuousStepOptions = useMemo(() => {
        const base = BASE_HOURLY_STEP_OPTIONS.includes(continuousDraft.step)
            ? BASE_HOURLY_STEP_OPTIONS
            : [...BASE_HOURLY_STEP_OPTIONS, continuousDraft.step].sort((a, b) => a - b);
        return base.filter((step) => step === 1 || continuousDraft.startHour + step <= continuousDraft.endHour);
    }, [continuousDraft.startHour, continuousDraft.endHour, continuousDraft.step]);

    const continuousExecutionCount = useMemo(
        () => expandHourlySpecHours({ mode: 'CONTINUOUS', ...continuousDraft, hours: [] }).length,
        [continuousDraft],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="offline-schedule-dialog-standard">
                <DialogHeader>
                    <div className="offline-dialog-title-row">
                        <DialogTitle>调度配置</DialogTitle>
                        {readOnly ? <span className="offline-readonly-pill">线上只读</span> : null}
                    </div>
                    <DialogDescription className="sr-only">
                        {readOnly
                            ? `查看任务 ${flowId || ''} 当前线上版本的调度频率和计划时间。`
                            : `配置任务 ${flowId || ''} 的调度频率和计划时间。`}
                    </DialogDescription>
                </DialogHeader>

                <div className="offline-schedule-body" ref={setPopupContainer}>
                    {readOnly && !schedule ? (
                        <p className="offline-schedule-readonly-empty" role="status">
                            当前线上版本未配置定时调度触发器（自动调度处于关闭状态）
                        </p>
                    ) : null}

                    <div className="offline-schedule-period-section">
                        <fieldset className="offline-schedule-period-group" disabled={effectiveDisabled || periodChangeDisabled}>
                            <legend className="offline-schedule-field-label">调度频率</legend>
                            <div className="offline-schedule-period-options">
                                {PERIOD_OPTIONS.map((option) => (
                                    <label key={option.value} className="offline-schedule-period-option">
                                        <input
                                            type="radio"
                                            name={periodId}
                                            value={option.value}
                                            checked={!legacyCustom && period === option.value}
                                            disabled={effectiveDisabled || periodChangeDisabled}
                                            onChange={() => {
                                                if (!readOnly) onPeriodChange(option.value);
                                            }}
                                            className="sr-only"
                                        />
                                        <span>{option.label}</span>
                                    </label>
                                ))}
                            </div>
                            {legacyCustom ? (
                                <p className="offline-schedule-legacy-note">
                                    {readOnly
                                        ? `当前线上调度为非标准 Cron 表达式（${cron}）。`
                                        : `当前调度为非标准 Cron 表达式（${cron}），选择调度频率并暂存后将覆盖为标准调度。`}
                                </p>
                            ) : null}
                        </fieldset>

                        {dependencyNotice}
                    </div>

                    <div className="offline-schedule-time-group">
                        <span className="offline-schedule-field-label offline-schedule-time-label">计划时间</span>
                        {effectivePeriod === 'HOURLY' ? (
                            <div className="offline-schedule-hourly-panel">
                                <fieldset
                                    className="offline-schedule-hourly-mode-group"
                                    disabled={effectiveDisabled}
                                >
                                    <legend className="sr-only">执行方式</legend>
                                    <div className="offline-schedule-hourly-mode-options">
                                        {([
                                            { value: 'CONTINUOUS', label: '连续时段' },
                                            { value: 'DISCRETE', label: '指定小时' },
                                        ] as const).map((option) => (
                                            <label key={option.value} className="offline-schedule-hourly-mode-option">
                                                <input
                                                    type="radio"
                                                    name={hourlyModeId}
                                                    value={option.value}
                                                    checked={hourlyMode === option.value}
                                                    disabled={effectiveDisabled}
                                                    onChange={() => handleHourlyModeChange(option.value)}
                                                    className="sr-only"
                                                />
                                                <span>{option.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>

                                {hourlyMode === 'CONTINUOUS' ? (
                                    <>
                                        <div className="offline-schedule-hourly-continuous-row">
                                            <span className="offline-schedule-hourly-range-sep">从</span>
                                            <NumberSelect
                                                value={continuousDraft.startHour}
                                                options={START_HOUR_OPTIONS}
                                                suffix="时"
                                                ariaLabel="开始小时"
                                                disabled={effectiveDisabled}
                                                popupContainer={popupContainer}
                                                className="offline-schedule-period-select--compact"
                                                onChange={handleStartHourChange}
                                            />
                                            <span className="offline-schedule-hourly-range-sep">至</span>
                                            <NumberSelect
                                                value={continuousDraft.endHour}
                                                options={continuousEndOptions}
                                                suffix="时"
                                                ariaLabel="结束小时"
                                                disabled={effectiveDisabled}
                                                popupContainer={popupContainer}
                                                className="offline-schedule-period-select--compact"
                                                onChange={handleEndHourChange}
                                            />
                                            <NumberSelect
                                                value={continuousDraft.step}
                                                options={continuousStepOptions}
                                                ariaLabel="步长"
                                                disabled={effectiveDisabled}
                                                popupContainer={popupContainer}
                                                formatLabel={(v) => `每 ${v} 小时`}
                                                className="offline-schedule-period-select--step"
                                                onChange={handleStepChange}
                                            />
                                            <NumberSelect
                                                value={currentMinute}
                                                options={MINUTE_OPTIONS}
                                                suffix="分"
                                                ariaLabel="分钟"
                                                disabled={effectiveDisabled}
                                                popupContainer={popupContainer}
                                                className="offline-schedule-period-select--compact"
                                                onChange={handleHourlyMinuteChange}
                                            />
                                        </div>
                                        <p className="offline-schedule-hourly-summary">
                                            每天 {pad2(continuousDraft.startHour)} 时至 {pad2(continuousDraft.endHour)} 时，
                                            {continuousDraft.step === 1 ? '每小时' : `每 ${continuousDraft.step} 小时`}
                                            在第 {currentMinute} 分执行（每天 {continuousExecutionCount} 次）
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <div className="offline-schedule-hourly-discrete-bar">
                                            <NumberSelect
                                                value={currentMinute}
                                                options={MINUTE_OPTIONS}
                                                suffix="分"
                                                ariaLabel="分钟"
                                                disabled={effectiveDisabled}
                                                popupContainer={popupContainer}
                                                className="offline-schedule-period-select--compact"
                                                onChange={handleHourlyMinuteChange}
                                            />
                                            <span className="offline-schedule-hourly-count">
                                                已选 {discreteHours.length} 个小时
                                            </span>
                                            {!readOnly && discreteHours.length > 0 ? (
                                                <button
                                                    type="button"
                                                    className="offline-schedule-hourly-clear"
                                                    disabled={effectiveDisabled}
                                                    onClick={handleClearDiscreteHours}
                                                >
                                                    清空
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="offline-schedule-hour-grid" role="group" aria-label="选择执行小时">
                                            {HOUR_OPTIONS.map((hour) => {
                                                const selected = discreteHours.includes(hour);
                                                return (
                                                    <button
                                                        key={hour}
                                                        type="button"
                                                        className="offline-schedule-hour-cell"
                                                        aria-label={`${hour}时`}
                                                        aria-pressed={selected}
                                                        disabled={effectiveDisabled}
                                                        onClick={() => handleToggleDiscreteHour(hour)}
                                                    >
                                                        {pad2(hour)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {hourlyIncomplete ? (
                                            <p className="offline-schedule-hourly-hint" role="alert">
                                                请至少选择 2 个执行小时；若每天仅执行 1 次，请选择「每天」调度。
                                            </p>
                                        ) : null}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="offline-schedule-period-fields">
                                {effectivePeriod === 'YEARLY' ? (
                                    <NumberSelect
                                        value={periodParts.month}
                                        options={MONTH_OPTIONS}
                                        suffix="月"
                                        ariaLabel="月份"
                                        disabled={effectiveDisabled}
                                        popupContainer={popupContainer}
                                        onChange={(month) => updatePeriodParts({ month })}
                                    />
                                ) : null}
                                {effectivePeriod === 'MONTHLY' || effectivePeriod === 'YEARLY' ? (
                                    <NumberSelect
                                        value={periodParts.dayOfMonth}
                                        options={DAY_OF_MONTH_OPTIONS}
                                        suffix="日"
                                        ariaLabel="第几日"
                                        disabled={effectiveDisabled}
                                        popupContainer={popupContainer}
                                        onChange={(dayOfMonth) => updatePeriodParts({ dayOfMonth })}
                                    />
                                ) : null}
                                {effectivePeriod === 'WEEKLY' ? (
                                    <NumberSelect
                                        value={periodParts.dayOfWeek}
                                        options={WEEK_DAY_OPTIONS}
                                        ariaLabel="星期几"
                                        disabled={effectiveDisabled}
                                        popupContainer={popupContainer}
                                        formatLabel={(v) => `周${WEEK_DAY_NAMES[v - 1] ?? v}`}
                                        onChange={(dayOfWeek) => updatePeriodParts({ dayOfWeek })}
                                    />
                                ) : null}
                                <NumberSelect
                                    value={periodParts.hour}
                                    options={HOUR_OPTIONS}
                                    suffix="时"
                                    ariaLabel="小时"
                                    disabled={effectiveDisabled}
                                    popupContainer={popupContainer}
                                    onChange={(hour) => updatePeriodParts({ hour })}
                                />
                                <NumberSelect
                                    value={periodParts.minute}
                                    options={MINUTE_OPTIONS}
                                    suffix="分"
                                    ariaLabel="分钟"
                                    disabled={effectiveDisabled}
                                    popupContainer={popupContainer}
                                    onChange={(minute) => updatePeriodParts({ minute })}
                                />
                            </div>
                        )}
                        <p className="offline-schedule-timezone-note">任务时区：{timezone}</p>
                    </div>

                    <div className="offline-schedule-toggle-row">
                        <span className="offline-schedule-field-label">自动调度</span>
                        <div className="offline-schedule-toggle-control">
                            <button
                                type="button"
                                role="switch"
                                aria-label="启用调度"
                                aria-checked={enabled}
                                disabled={switchDisabled}
                                onClick={handleToggle}
                                className="offline-switch"
                            >
                                <span className="offline-switch-thumb" aria-hidden="true" />
                            </button>
                            {readOnly ? (
                                <span className="offline-schedule-toggle-state">{enabled ? '已开启' : '已关闭'}</span>
                            ) : null}
                        </div>
                    </div>

                    <div className="offline-schedule-retry-section">
                        <div className="offline-schedule-toggle-row">
                            <label htmlFor={retrySwitchId} className="offline-schedule-field-label">失败自动重试</label>
                            <div className="offline-schedule-toggle-control">
                                <button
                                    id={retrySwitchId}
                                    type="button"
                                    role="switch"
                                    aria-label="开启失败自动重试"
                                    aria-checked={retryEnabled}
                                    disabled={effectiveDisabled}
                                    onClick={handleRetryToggle}
                                    className="offline-switch"
                                >
                                    <span className="offline-switch-thumb" aria-hidden="true" />
                                </button>
                                {readOnly ? (
                                    <span className="offline-schedule-toggle-state">{retryEnabled ? '已开启' : '已关闭'}</span>
                                ) : null}
                            </div>
                        </div>
                        {retryEnabled ? (
                            <div className="offline-schedule-retry-panel">
                                <div className="offline-schedule-retry-fields">
                                    <div className="offline-schedule-retry-field">
                                        <span className="offline-schedule-retry-field-label">重试次数</span>
                                        <NumberSelect
                                            value={effectiveRetryCount}
                                            options={RETRY_COUNT_OPTIONS}
                                            suffix=" 次"
                                            ariaLabel="重试次数"
                                            disabled={effectiveDisabled}
                                            popupContainer={popupContainer}
                                            className="offline-schedule-period-select--compact"
                                            onChange={(nextCount) => onRetryChange?.({ retryCount: nextCount })}
                                        />
                                    </div>
                                    <div className="offline-schedule-retry-field">
                                        <span className="offline-schedule-retry-field-label">重试间隔</span>
                                        <NumberSelect
                                            value={effectiveRetryIntervalMinutes}
                                            options={retryIntervalOptions}
                                            suffix=" 分钟"
                                            ariaLabel="重试间隔"
                                            disabled={effectiveDisabled}
                                            popupContainer={popupContainer}
                                            className="offline-schedule-period-select--step"
                                            onChange={(nextInterval) => onRetryChange?.({ retryIntervalMinutes: nextInterval })}
                                        />
                                    </div>
                                </div>
                                <p className="offline-schedule-retry-warning">
                                    失败后将自动重跑整个任务（从头执行全部节点，而非仅重跑失败节点及其下游），请确认任务支持重复执行（幂等）。
                                </p>
                                {effectivePeriod === 'HOURLY' && effectiveRetryCount * effectiveRetryIntervalMinutes >= 60 ? (
                                    <p className="offline-schedule-retry-hourly-note">
                                        提示：总重试等待时间可能跨越小时级调度周期，请结合任务耗时合理配置。
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    <section className="offline-schedule-preview" aria-labelledby={`${previewId}-heading`}>
                        <h3 id={`${previewId}-heading`} className="offline-schedule-preview-heading">按当前配置预览</h3>
                        {hourlyIncomplete ? (
                            <p className="offline-schedule-preview-empty">选择至少 2 个执行小时后预览计划时间</p>
                        ) : preview.type === 'error' ? (
                            <p className="offline-schedule-preview-error" role="alert">无效的 Cron 表达式</p>
                        ) : (
                            <>
                                <ol id={previewId} className="offline-schedule-preview-list">
                                    {preview.times.slice(0, previewExpanded ? 5 : 3).map((time) => (
                                        <li key={time} className="offline-schedule-preview-item">
                                            <time dateTime={time}>{formatPreviewTime(time, timezone)}</time>
                                        </li>
                                    ))}
                                </ol>
                                <button
                                    type="button"
                                    className="offline-schedule-preview-expand"
                                    aria-expanded={previewExpanded}
                                    aria-controls={previewId}
                                    onClick={() => setPreviewExpanded((expanded) => !expanded)}
                                >
                                    {previewExpanded ? '收起' : '展开更多'}
                                </button>
                            </>
                        )}
                    </section>
                </div>

                <DialogFooter className="offline-schedule-footer">
                    <div className="offline-schedule-publish-note">
                        {readOnly ? (
                            <p>
                                当前为已确认线上快照{readOnlyRevision ? `（${readOnlyRevision.slice(0, 7)}）` : ''}的只读视图，切换至开发模式后可修改
                            </p>
                        ) : (
                            <>
                                <p>暂存后自动保存草稿，提交并推送、同步成功后生效</p>
                                {(showNoRemoteAlert || showDriftAlert) ? (
                                    <p className="offline-schedule-publish-warning" role="status">
                                        <AlertTriangle size={14} aria-hidden="true" />
                                        <span>{showNoRemoteAlert
                                            ? '尚未配置 Git 远程，暂时无法发布调度'
                                            : '存在本地或未推送变更，线上配置可能不同'}</span>
                                    </p>
                                ) : null}
                            </>
                        )}
                    </div>
                    <div className="offline-schedule-actions">
                        {readOnly ? (
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                关闭
                            </Button>
                        ) : (
                            <>
                                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                                    取消
                                </Button>
                                <Button variant="default" onClick={onSave} disabled={saving || cronInvalid || legacyCustom || hourlyIncomplete}>
                                    {saving ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                                    {saving ? '正在暂存...' : '暂存配置'}
                                </Button>
                            </>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
