import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type CaptionProps, type DateRange } from 'react-day-picker';
import { zhCN } from 'date-fns/locale';

import {
    formatLocalDateTime,
    formatRangeDuration,
    getBrowserTimeZoneName,
    getUtcOffsetLabel,
    parseLocalDateTime,
    validateLocalRange,
} from '../lib/dateTime';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import 'react-day-picker/dist/style.css';
import './TimeRangePicker.css';

export interface TimeRangePickerProps {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
    className?: string;
}

type TimeParts = {
    hour: string;
    minute: string;
    second: string;
};

type TimePartKey = keyof TimeParts;

const START_OF_DAY: TimeParts = { hour: '00', minute: '00', second: '00' };
const END_OF_DAY: TimeParts = { hour: '23', minute: '59', second: '59' };
const MONTH_LABELS = Array.from({ length: 12 }, (_, month) => `${month + 1}月`);

function timePartsFromDate(date: Date): TimeParts {
    return {
        hour: String(date.getHours()).padStart(2, '0'),
        minute: String(date.getMinutes()).padStart(2, '0'),
        second: String(date.getSeconds()).padStart(2, '0'),
    };
}

function normalizeSegment(value: string, max: number) {
    const parsed = Number.parseInt(value, 10);
    const normalized = Number.isNaN(parsed) ? 0 : Math.min(max, Math.max(0, parsed));
    return String(normalized).padStart(2, '0');
}

function timePartsComplete(parts: TimeParts) {
    return Object.values(parts).every((value) => /^\d{1,2}$/.test(value));
}

function dateWithTime(date: Date, parts: TimeParts) {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        Number.parseInt(parts.hour, 10) || 0,
        Number.parseInt(parts.minute, 10) || 0,
        Number.parseInt(parts.second, 10) || 0,
    );
}

function CalendarCaption({ displayMonth }: CaptionProps) {
    return (
        <div className="time-range-picker__month-caption">
            {displayMonth.getFullYear()}年{displayMonth.getMonth() + 1}月
        </div>
    );
}

function useCompactCalendar() {
    const query = '(max-width: 760px)';
    const [compact, setCompact] = React.useState(() => (
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query).matches
            : false
    ));

    React.useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const media = window.matchMedia(query);
        const handleChange = (event: MediaQueryListEvent) => setCompact(event.matches);
        setCompact(media.matches);
        media.addEventListener('change', handleChange);
        return () => media.removeEventListener('change', handleChange);
    }, []);

    return compact;
}

function TimeInput({
    label,
    value,
    onChange,
}: {
    label: '开始' | '结束';
    value: TimeParts;
    onChange: (key: TimePartKey, value: string) => void;
}) {
    const fields: Array<{ key: TimePartKey; label: string; max: number }> = [
        { key: 'hour', label: '小时', max: 23 },
        { key: 'minute', label: '分钟', max: 59 },
        { key: 'second', label: '秒数', max: 59 },
    ];

    return (
        <fieldset className="time-range-picker__time-fieldset">
            <legend>{label}时间</legend>
            <div className="time-range-picker__time-input" aria-label={`${label}时间`}>
                {fields.map((field, index) => (
                    <React.Fragment key={field.key}>
                        {index > 0 && <span aria-hidden="true">:</span>}
                        <input
                            aria-label={`${label}${field.label}`}
                            className="time-range-picker__time-segment"
                            inputMode="numeric"
                            maxLength={2}
                            value={value[field.key]}
                            onChange={(event) => {
                                const next = event.target.value.replace(/\D/g, '').slice(0, 2);
                                onChange(field.key, next);
                            }}
                            onBlur={(event) => onChange(field.key, normalizeSegment(event.target.value, field.max))}
                            onKeyDown={(event) => {
                                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                                event.preventDefault();
                                const current = Number.parseInt(value[field.key], 10) || 0;
                                const delta = event.key === 'ArrowUp' ? 1 : -1;
                                onChange(field.key, normalizeSegment(String(current + delta), field.max));
                            }}
                            onWheel={(event) => event.preventDefault()}
                        />
                    </React.Fragment>
                ))}
            </div>
        </fieldset>
    );
}

export function TimeRangePicker({ from, to, onChange, className }: TimeRangePickerProps) {
    const compact = useCompactCalendar();
    const [isOpen, setIsOpen] = React.useState(false);
    const [range, setRange] = React.useState<DateRange>();
    const [month, setMonth] = React.useState(() => new Date());
    const [startTime, setStartTime] = React.useState<TimeParts>(START_OF_DAY);
    const [endTime, setEndTime] = React.useState<TimeParts>(END_OF_DAY);
    const [selectingEnd, setSelectingEnd] = React.useState(false);
    const [activePreset, setActivePreset] = React.useState<number | null>(null);
    const browserTimeZone = getBrowserTimeZoneName();
    const appliedStart = React.useMemo(() => parseLocalDateTime(from), [from]);
    const appliedEnd = React.useMemo(() => parseLocalDateTime(to), [to]);
    const appliedValid = Boolean(appliedStart && appliedEnd && appliedStart.getTime() <= appliedEnd.getTime());

    const initializeDraft = React.useCallback(() => {
        const now = new Date(Date.now());
        const fallbackStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const start = appliedValid ? appliedStart! : fallbackStart;
        const end = appliedValid ? appliedEnd! : now;
        setRange({ from: start, to: end });
        setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
        setStartTime(timePartsFromDate(start));
        setEndTime(timePartsFromDate(end));
        setSelectingEnd(false);
        setActivePreset(null);
    }, [appliedEnd, appliedStart, appliedValid]);

    const handleOpenChange = (open: boolean) => {
        if (open) initializeDraft();
        setIsOpen(open);
    };

    const draftStart = range?.from && timePartsComplete(startTime) ? dateWithTime(range.from, startTime) : null;
    const draftEnd = range?.to && timePartsComplete(endTime) ? dateWithTime(range.to, endTime) : null;
    const draftFromText = draftStart ? formatLocalDateTime(draftStart) : '';
    const draftToText = draftEnd ? formatLocalDateTime(draftEnd) : '';
    const validationMessage = !range?.from
        ? '请选择开始日期'
        : !range.to
            ? '请选择结束日期'
            : !timePartsComplete(startTime) || !timePartsComplete(endTime)
                ? '请输入完整时间'
                : validateLocalRange(draftFromText, draftToText);
    const startOffset = draftStart ? getUtcOffsetLabel(draftStart) : null;
    const endOffset = draftEnd ? getUtcOffsetLabel(draftEnd) : null;
    const offsetSummary = startOffset && endOffset && startOffset !== endOffset
        ? `开始 ${startOffset} · 结束 ${endOffset}`
        : startOffset ?? endOffset ?? '';

    const handlePreset = (hours: number) => {
        const end = new Date(Date.now());
        const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
        setRange({ from: start, to: end });
        setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
        setStartTime(timePartsFromDate(start));
        setEndTime(timePartsFromDate(end));
        setSelectingEnd(false);
        setActivePreset(hours);
    };

    const handleDayClick = (day: Date) => {
        setActivePreset(null);
        if (!selectingEnd || !range?.from) {
            setRange({ from: day, to: undefined });
            setStartTime(START_OF_DAY);
            setEndTime(END_OF_DAY);
            setSelectingEnd(true);
            return;
        }

        const first = range.from;
        setRange(day.getTime() < first.getTime()
            ? { from: day, to: first }
            : { from: first, to: day });
        setSelectingEnd(false);
    };

    const updateTime = (
        setter: React.Dispatch<React.SetStateAction<TimeParts>>,
        key: TimePartKey,
        value: string,
    ) => {
        setActivePreset(null);
        setter((current) => ({ ...current, [key]: value }));
    };

    const handleApply = () => {
        if (validationMessage || !draftStart || !draftEnd) return;
        onChange(formatLocalDateTime(draftStart), formatLocalDateTime(draftEnd));
        setIsOpen(false);
    };

    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: currentYear - 1998 }, (_, index) => 2000 + index);
    const triggerLabel = appliedValid
        ? `时间范围，开始 ${from}，结束 ${to}，浏览器时区 ${browserTimeZone}`
        : `时间范围无效，浏览器时区 ${browserTimeZone}`;

    return (
        <PopoverPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverPrimitive.Trigger
                className={cn('time-range-picker__trigger', className)}
                aria-label={triggerLabel}
            >
                <CalendarRange size={16} aria-hidden="true" />
                {appliedValid ? (
                    <span className="time-range-picker__trigger-values">
                        <span><b>开始</b> {from}</span>
                        <span className="time-range-picker__trigger-arrow" aria-hidden="true">→</span>
                        <span><b>结束</b> {to}</span>
                    </span>
                ) : (
                    <span>时间范围无效</span>
                )}
            </PopoverPrimitive.Trigger>

            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Positioner align="end" sideOffset={8} className="z-[1200]">
                    <PopoverPrimitive.Popup className="time-range-picker__popup">
                        <header className="time-range-picker__header">
                            <div>
                                <h2>选择时间范围</h2>
                                <p>浏览器时区：{browserTimeZone}{offsetSummary ? `（${offsetSummary}）` : ''}</p>
                            </div>
                        </header>

                        <div className="time-range-picker__body">
                            <aside className="time-range-picker__presets" aria-label="快捷范围">
                                <span>快捷范围</span>
                                {[24, 24 * 7, 24 * 30].map((hours) => {
                                    const label = hours === 24 ? '最近 24 小时' : hours === 24 * 7 ? '最近 7 天' : '最近 30 天';
                                    return (
                                        <Button
                                            key={hours}
                                            type="button"
                                            variant="ghost"
                                            className="time-range-picker__preset"
                                            aria-pressed={activePreset === hours}
                                            onClick={() => handlePreset(hours)}
                                        >
                                            {label}
                                        </Button>
                                    );
                                })}
                            </aside>

                            <div className="time-range-picker__main">
                                <div className="time-range-picker__toolbar">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="上一个月"
                                        onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                                    >
                                        <ChevronLeft />
                                    </Button>
                                    <select
                                        aria-label="年份"
                                        value={month.getFullYear()}
                                        onChange={(event) => setMonth(new Date(Number(event.target.value), month.getMonth(), 1))}
                                    >
                                        {years.map((year) => <option key={year} value={year}>{year}年</option>)}
                                    </select>
                                    <select
                                        aria-label="月份"
                                        value={month.getMonth()}
                                        onChange={(event) => setMonth(new Date(month.getFullYear(), Number(event.target.value), 1))}
                                    >
                                        {MONTH_LABELS.map((label, index) => <option key={label} value={index}>{label}</option>)}
                                    </select>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            const today = new Date();
                                            setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                                        }}
                                    >
                                        今天
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="下一个月"
                                        onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                                    >
                                        <ChevronRight />
                                    </Button>
                                </div>

                                <div className="time-range-picker__calendar">
                                    <DayPicker
                                        mode="range"
                                        locale={zhCN}
                                        month={month}
                                        selected={range}
                                        numberOfMonths={compact ? 1 : 2}
                                        fixedWeeks
                                        showOutsideDays
                                        disableNavigation
                                        onDayClick={handleDayClick}
                                        components={{ Caption: CalendarCaption }}
                                    />
                                </div>

                                <div className="time-range-picker__times">
                                    <TimeInput
                                        label="开始"
                                        value={startTime}
                                        onChange={(key, value) => updateTime(setStartTime, key, value)}
                                    />
                                    <TimeInput
                                        label="结束"
                                        value={endTime}
                                        onChange={(key, value) => updateTime(setEndTime, key, value)}
                                    />
                                </div>

                                <section className="time-range-picker__summary" aria-label="已选时间范围">
                                    <div className="time-range-picker__summary-title">
                                        <span>已选时间范围</span>
                                        <span>{offsetSummary}</span>
                                    </div>
                                    <dl>
                                        <div><dt>开始时间</dt><dd>{draftFromText || '请选择开始日期'}</dd></div>
                                        <div><dt>结束时间</dt><dd>{range?.to ? draftToText : '请选择结束日期'}</dd></div>
                                        {draftStart && draftEnd && !validationMessage && (
                                            <div><dt>时间跨度</dt><dd>{formatRangeDuration(draftStart, draftEnd)}</dd></div>
                                        )}
                                    </dl>
                                    {validationMessage && !validationMessage.startsWith('请选择') && (
                                        <p className="time-range-picker__error" aria-live="polite">{validationMessage}</p>
                                    )}
                                </section>

                                <footer className="time-range-picker__footer">
                                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>取消</Button>
                                    <Button type="button" disabled={Boolean(validationMessage)} onClick={handleApply}>应用</Button>
                                </footer>
                            </div>
                        </div>
                    </PopoverPrimitive.Popup>
                </PopoverPrimitive.Positioner>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
