import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type CaptionProps, type DateRange } from 'react-day-picker';
import { zhCN } from 'date-fns/locale';

import { Button } from '../../components/ui/button';
import {
    formatLocalDateTime,
    getBrowserTimeZoneName,
    parseLocalDateTime,
} from '../../lib/dateTime';
import 'react-day-picker/dist/style.css';
import './OperationsTimeFilter.css';

export interface OperationsTimeFilterProps {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
}

type FilterMode = 'quick' | 'custom';

const PRESETS = [
    { label: '最近 1 小时', milliseconds: 60 * 60 * 1000 },
    { label: '最近 6 小时', milliseconds: 6 * 60 * 60 * 1000 },
    { label: '最近 24 小时', milliseconds: 24 * 60 * 60 * 1000 },
    { label: '最近 7 天', milliseconds: 7 * 24 * 60 * 60 * 1000 },
    { label: '最近 30 天', milliseconds: 30 * 24 * 60 * 60 * 1000 },
];

const MONTHS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);

function MonthCaption({ displayMonth, id }: CaptionProps) {
    return (
        <div id={id} className="operations-time-filter__month-caption">
            {displayMonth.getFullYear()}年{displayMonth.getMonth() + 1}月
        </div>
    );
}

function withDate(source: Date, date: Date) {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        source.getHours(),
        source.getMinutes(),
        source.getSeconds(),
    );
}

function dateText(date: Date) {
    return formatLocalDateTime(date).slice(0, 10);
}

function timeText(date: Date) {
    return formatLocalDateTime(date).slice(11);
}

function appliedDates(from: string, to: string) {
    const start = parseLocalDateTime(from);
    const end = parseLocalDateTime(to);
    if (start && end && start.getTime() <= end.getTime()) return { start, end };

    const endFallback = new Date(Date.now());
    return {
        start: new Date(endFallback.getTime() - 24 * 60 * 60 * 1000),
        end: endFallback,
    };
}

function useNarrowViewport() {
    const query = '(max-width: 720px)';
    const [narrow, setNarrow] = React.useState(() => (
        typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia(query).matches
    ));

    React.useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const media = window.matchMedia(query);
        const handleChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
        setNarrow(media.matches);
        media.addEventListener('change', handleChange);
        return () => media.removeEventListener('change', handleChange);
    }, []);

    return narrow;
}

export function OperationsTimeFilter({ from, to, onChange }: OperationsTimeFilterProps) {
    const titleId = React.useId();
    const narrowViewport = useNarrowViewport();
    const [open, setOpen] = React.useState(false);
    const [mode, setMode] = React.useState<FilterMode>('quick');
    const [draftStart, setDraftStart] = React.useState<Date | null>(null);
    const [draftEnd, setDraftEnd] = React.useState<Date | null>(null);
    const [activePreset, setActivePreset] = React.useState<string | null>(null);
    const [visibleMonth, setVisibleMonth] = React.useState(() => new Date());
    const [selectingEnd, setSelectingEnd] = React.useState(false);
    const [startDateText, setStartDateText] = React.useState('');
    const [startTimeText, setStartTimeText] = React.useState('');
    const [endDateText, setEndDateText] = React.useState('');
    const [endTimeText, setEndTimeText] = React.useState('');

    const initializeDraft = React.useCallback(() => {
        const applied = appliedDates(from, to);
        setDraftStart(applied.start);
        setDraftEnd(applied.end);
        setMode('quick');
        setActivePreset(null);
        setVisibleMonth(new Date(applied.start.getFullYear(), applied.start.getMonth(), 1));
        setSelectingEnd(false);
        setStartDateText(dateText(applied.start));
        setStartTimeText(timeText(applied.start));
        setEndDateText(dateText(applied.end));
        setEndTimeText(timeText(applied.end));
    }, [from, to]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) initializeDraft();
        setOpen(nextOpen);
    };

    const selectPreset = (label: string, milliseconds: number) => {
        const end = new Date(Date.now());
        const start = new Date(end.getTime() - milliseconds);
        setDraftStart(start);
        setDraftEnd(end);
        setStartDateText(dateText(start));
        setStartTimeText(timeText(start));
        setEndDateText(dateText(end));
        setEndTimeText(timeText(end));
        setActivePreset(label);
    };

    const validationMessage = !draftStart
        ? '请输入有效的开始时间'
        : !draftEnd
            ? '请输入有效的结束时间'
            : draftStart.getTime() > draftEnd.getTime()
                ? '开始时间不能晚于结束时间'
                : null;

    const handleApply = () => {
        if (validationMessage || !draftStart || !draftEnd) return;
        onChange(formatLocalDateTime(draftStart), formatLocalDateTime(draftEnd));
        setOpen(false);
    };

    const updateStart = (nextDateText: string, nextTimeText: string) => {
        setStartDateText(nextDateText);
        setStartTimeText(nextTimeText);
        const next = parseLocalDateTime(`${nextDateText} ${nextTimeText}`);
        setDraftStart(next);
        if (next) setVisibleMonth(new Date(next.getFullYear(), next.getMonth(), 1));
        setActivePreset(null);
    };

    const updateEnd = (nextDateText: string, nextTimeText: string) => {
        setEndDateText(nextDateText);
        setEndTimeText(nextTimeText);
        setDraftEnd(parseLocalDateTime(`${nextDateText} ${nextTimeText}`));
        setActivePreset(null);
    };

    const handleDayClick = (day: Date) => {
        setActivePreset(null);
        if (!selectingEnd || !draftStart) {
            const timeSource = draftStart ?? new Date(day.getFullYear(), day.getMonth(), day.getDate());
            const nextStart = withDate(timeSource, day);
            setDraftStart(nextStart);
            setDraftEnd(null);
            setStartDateText(dateText(nextStart));
            setStartTimeText(timeText(nextStart));
            setEndDateText('');
            setEndTimeText('');
            setSelectingEnd(true);
            return;
        }

        const nextEnd = withDate(draftEnd ?? draftStart, day);
        if (nextEnd.getTime() < draftStart.getTime()) {
            const reorderedEnd = withDate(draftEnd ?? draftStart, draftStart);
            setDraftEnd(reorderedEnd);
            setDraftStart(nextEnd);
            setStartDateText(dateText(nextEnd));
            setStartTimeText(timeText(nextEnd));
            setEndDateText(dateText(reorderedEnd));
            setEndTimeText(timeText(reorderedEnd));
        } else {
            setDraftEnd(nextEnd);
            setEndDateText(dateText(nextEnd));
            setEndTimeText(timeText(nextEnd));
        }
        setSelectingEnd(false);
    };

    const selectedRange: DateRange | undefined = draftStart
        ? { from: draftStart, to: draftEnd ?? undefined }
        : undefined;
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: currentYear - 1999 }, (_, index) => 2000 + index);

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
            <PopoverPrimitive.Trigger
                className="operations-time-filter__trigger"
                aria-label={`时间范围 ${from} 至 ${to}`}
            >
                <CalendarRange size={16} aria-hidden="true" />
                <span>{from}</span>
                <span aria-hidden="true">→</span>
                <span>{to}</span>
            </PopoverPrimitive.Trigger>

            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Positioner align="end" sideOffset={8} className="z-[1200]">
                    <PopoverPrimitive.Popup
                        className="operations-time-filter__popup"
                        aria-labelledby={titleId}
                    >
                        <header className="operations-time-filter__header">
                            <div>
                                <h2 id={titleId}>时间范围</h2>
                                <p>浏览器时区：{getBrowserTimeZoneName()}</p>
                            </div>
                            <div className="operations-time-filter__tabs" role="tablist" aria-label="时间范围模式">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={mode === 'quick'}
                                    onClick={() => setMode('quick')}
                                >
                                    快捷范围
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={mode === 'custom'}
                                    onClick={() => setMode('custom')}
                                >
                                    自定义范围
                                </button>
                            </div>
                        </header>

                        <div className="operations-time-filter__content">
                            {mode === 'quick' ? (
                                <div className="operations-time-filter__presets">
                                    {PRESETS.map((preset) => (
                                        <button
                                            type="button"
                                            key={preset.label}
                                            aria-pressed={activePreset === preset.label}
                                            onClick={() => selectPreset(preset.label, preset.milliseconds)}
                                        >
                                            <span>{preset.label}</span>
                                            <span aria-hidden="true">{preset.label.replace('最近 ', '')}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="operations-time-filter__custom">
                                    <div className="operations-time-filter__exact-fields">
                                        <div className="operations-time-filter__exact-row">
                                            <span>开始</span>
                                            <input
                                                type="text"
                                                aria-label="开始日期"
                                                inputMode="numeric"
                                                placeholder="yyyy-MM-dd"
                                                value={startDateText}
                                                onChange={(event) => updateStart(event.target.value, startTimeText)}
                                            />
                                            <input
                                                type="text"
                                                aria-label="开始时间"
                                                inputMode="numeric"
                                                placeholder="HH:mm:ss"
                                                value={startTimeText}
                                                onChange={(event) => updateStart(startDateText, event.target.value)}
                                            />
                                        </div>
                                        <div className="operations-time-filter__exact-row">
                                            <span>结束</span>
                                            <input
                                                type="text"
                                                aria-label="结束日期"
                                                inputMode="numeric"
                                                placeholder="yyyy-MM-dd"
                                                value={endDateText}
                                                onChange={(event) => updateEnd(event.target.value, endTimeText)}
                                            />
                                            <input
                                                type="text"
                                                aria-label="结束时间"
                                                inputMode="numeric"
                                                placeholder="HH:mm:ss"
                                                value={endTimeText}
                                                onChange={(event) => updateEnd(endDateText, event.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="operations-time-filter__calendar-toolbar">
                                        <button
                                            type="button"
                                            aria-label="上一个月"
                                            onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                                        >
                                            <ChevronLeft size={17} />
                                        </button>
                                        <select
                                            aria-label="年份"
                                            value={visibleMonth.getFullYear()}
                                            onChange={(event) => setVisibleMonth(new Date(Number(event.target.value), visibleMonth.getMonth(), 1))}
                                        >
                                            {years.map((year) => <option key={year} value={year}>{year}年</option>)}
                                        </select>
                                        <select
                                            aria-label="月份"
                                            value={visibleMonth.getMonth()}
                                            onChange={(event) => setVisibleMonth(new Date(visibleMonth.getFullYear(), Number(event.target.value), 1))}
                                        >
                                            {MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
                                        </select>
                                        <button
                                            type="button"
                                            aria-label="下一个月"
                                            onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                                        >
                                            <ChevronRight size={17} />
                                        </button>
                                    </div>
                                    <DayPicker
                                        mode="range"
                                        locale={zhCN}
                                        month={visibleMonth}
                                        numberOfMonths={narrowViewport ? 1 : 2}
                                        selected={selectedRange}
                                        fixedWeeks
                                        showOutsideDays
                                        disableNavigation
                                        onDayClick={handleDayClick}
                                        components={{ Caption: MonthCaption }}
                                    />
                                </div>
                            )}
                        </div>

                        {mode === 'quick' ? (
                            <div className="operations-time-filter__selection" aria-label="待应用时间范围">
                                <div
                                    className="operations-time-filter__selection-range"
                                    role="group"
                                    aria-label="开始和结束时间"
                                >
                                    <span>{draftStart ? formatLocalDateTime(draftStart) : '请选择开始时间'}</span>
                                    <span aria-hidden="true">→</span>
                                    <span>{draftEnd ? formatLocalDateTime(draftEnd) : '请选择结束时间'}</span>
                                </div>
                            </div>
                        ) : null}

                        <footer className="operations-time-filter__footer">
                            {validationMessage ? (
                                <p className="operations-time-filter__error" role="alert">{validationMessage}</p>
                            ) : <span />}
                            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
                            <Button type="button" disabled={Boolean(validationMessage)} onClick={handleApply}>应用</Button>
                        </footer>
                    </PopoverPrimitive.Popup>
                </PopoverPrimitive.Positioner>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
