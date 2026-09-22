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
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../../components/ui/select';
import { type OfflineSchedulePeriod, type OfflineScheduleResponse } from '../../api/offline';
import {
    DEFAULT_PERIOD_PARTS,
    formatPreviewTime,
    parsePeriodPartsFromCron,
    type SchedulePeriodParts,
} from './ScheduleUtils';
import './ScheduleDialog.css';

interface ScheduleDialogProps {
    open: boolean;
    schedule: OfflineScheduleResponse | null;
    cron: string;
    period: OfflineSchedulePeriod;
    timezone: string;
    saving: boolean;
    flowId: string | null;
    hasRemote?: boolean;
    hasLocalOrUnpushedChanges?: boolean;
    periodChangeDisabled?: boolean;
    dependencyNotice?: ReactNode;
    onOpenChange: (open: boolean) => void;
    onPeriodChange: (period: OfflineSchedulePeriod, parts?: SchedulePeriodParts) => void;
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
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);
const WEEK_DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const WEEK_DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

function NumberSelect({ value, options, suffix, ariaLabel, disabled, popupContainer, formatLabel, onChange }: {
    value: number;
    options: number[];
    suffix?: string;
    ariaLabel: string;
    disabled?: boolean;
    popupContainer?: HTMLElement | null;
    formatLabel?: (value: number) => string;
    onChange: (value: number) => void;
}) {
    const labelOf = (v: number) => formatLabel ? formatLabel(v) : `${v}${suffix ?? ''}`;
    return (
        <Select
            value={String(value)}
            onValueChange={(next) => onChange(Number(next))}
            disabled={disabled}
        >
            <SelectTrigger aria-label={ariaLabel} className="offline-schedule-period-select">
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
        saving,
        flowId,
        hasRemote = true,
        hasLocalOrUnpushedChanges = false,
        periodChangeDisabled = false,
        dependencyNotice,
        onOpenChange,
        onPeriodChange,
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

    const cronInvalid = preview.type === 'error';
    const enabled = schedule?.enabled ?? false;
    // Allow turning OFF even with invalid cron; block turning ON.
    const switchDisabled = saving || (cronInvalid && !enabled);
    const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null);
    const [previewExpanded, setPreviewExpanded] = useState(false);
    const periodId = useId();
    const previewId = useId();

    useEffect(() => {
        if (!open) setPreviewExpanded(false);
    }, [open]);

    const handleToggle = () => {
        const next = !enabled;
        if (next && cronInvalid) return;
        onToggle(next);
    };

    const showNoRemoteAlert = !hasRemote;
    const showDriftAlert = hasLocalOrUnpushedChanges;

    // 存量非标准 cron：按“每天”展示编辑位，用户改动或选周期后才会标准化，之前禁止暂存
    const legacyCustom = period === 'CUSTOM';
    const effectivePeriod: Exclude<OfflineSchedulePeriod, 'CUSTOM'> = legacyCustom ? 'DAILY' : period;

    const periodParts = parsePeriodPartsFromCron(cron) ?? DEFAULT_PERIOD_PARTS;

    const updatePeriodParts = (patch: Partial<SchedulePeriodParts>) => {
        onPeriodChange(effectivePeriod, { ...periodParts, ...patch });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="offline-schedule-dialog-standard">
                <DialogHeader>
                    <DialogTitle>调度配置</DialogTitle>
                    <DialogDescription className="sr-only">
                        配置任务 {flowId || ''} 的调度频率和计划时间。
                    </DialogDescription>
                </DialogHeader>

                <div className="offline-schedule-body" ref={setPopupContainer}>
                    <fieldset className="offline-schedule-period-group" disabled={saving || periodChangeDisabled}>
                        <legend className="offline-schedule-field-label">调度频率</legend>
                        <div className="offline-schedule-period-options">
                            {PERIOD_OPTIONS.map((option) => (
                                <label key={option.value} className="offline-schedule-period-option">
                                    <input
                                        type="radio"
                                        name={periodId}
                                        value={option.value}
                                        checked={!legacyCustom && period === option.value}
                                        onChange={() => onPeriodChange(option.value)}
                                        className="sr-only"
                                    />
                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </div>
                        {legacyCustom ? (
                            <p className="offline-schedule-legacy-note">
                                当前调度为非标准 Cron 表达式（{cron}），选择调度频率并暂存后将覆盖为标准调度。
                            </p>
                        ) : null}
                    </fieldset>

                    {dependencyNotice}

                    <div className="offline-schedule-time-group">
                        <span className="offline-schedule-field-label">计划时间</span>
                        <div className="offline-schedule-period-fields">
                            {effectivePeriod === 'YEARLY' ? (
                                <NumberSelect
                                    value={periodParts.month}
                                    options={MONTH_OPTIONS}
                                    suffix="月"
                                    ariaLabel="月份"
                                    disabled={saving}
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
                                    disabled={saving}
                                    popupContainer={popupContainer}
                                    onChange={(dayOfMonth) => updatePeriodParts({ dayOfMonth })}
                                />
                            ) : null}
                            {effectivePeriod === 'WEEKLY' ? (
                                <NumberSelect
                                    value={periodParts.dayOfWeek}
                                    options={WEEK_DAY_OPTIONS}
                                    ariaLabel="星期几"
                                    disabled={saving}
                                    popupContainer={popupContainer}
                                    formatLabel={(v) => `周${WEEK_DAY_NAMES[v - 1] ?? v}`}
                                    onChange={(dayOfWeek) => updatePeriodParts({ dayOfWeek })}
                                />
                            ) : null}
                            {effectivePeriod !== 'HOURLY' ? (
                                <NumberSelect
                                    value={periodParts.hour}
                                    options={HOUR_OPTIONS}
                                    suffix="时"
                                    ariaLabel="小时"
                                    disabled={saving}
                                    popupContainer={popupContainer}
                                    onChange={(hour) => updatePeriodParts({ hour })}
                                />
                            ) : null}
                            <NumberSelect
                                value={periodParts.minute}
                                options={MINUTE_OPTIONS}
                                suffix="分"
                                ariaLabel="分钟"
                                disabled={saving}
                                popupContainer={popupContainer}
                                onChange={(minute) => updatePeriodParts({ minute })}
                            />
                        </div>
                        <p className="offline-schedule-timezone-note">任务时区：{timezone}</p>
                    </div>

                    <div className="offline-schedule-toggle-row">
                        <span className="offline-schedule-field-label">自动调度</span>
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
                    </div>

                    <section className="offline-schedule-preview" aria-labelledby={`${previewId}-heading`}>
                        <h3 id={`${previewId}-heading`} className="offline-schedule-preview-heading">按当前配置预览</h3>
                        {preview.type === 'error' ? (
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
                        <p>暂存后自动保存草稿，提交并推送、同步成功后生效</p>
                        {(showNoRemoteAlert || showDriftAlert) ? (
                            <p className="offline-schedule-publish-warning" role="status">
                                <AlertTriangle size={14} aria-hidden="true" />
                                <span>{showNoRemoteAlert
                                    ? '尚未配置 Git 远程，暂时无法发布调度'
                                    : '存在本地或未推送变更，线上配置可能不同'}</span>
                            </p>
                        ) : null}
                    </div>
                    <div className="offline-schedule-actions">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            取消
                        </Button>
                        <Button variant="default" onClick={onSave} disabled={saving || cronInvalid || legacyCustom}>
                            {saving ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {saving ? '正在暂存...' : '暂存配置'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
