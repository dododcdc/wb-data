import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { DayPicker, type CaptionProps } from 'react-day-picker';
import { zhCN } from 'date-fns/locale';

import { Button } from './button';
import { formatLocalDateTime, parseLocalDateTime } from '../../lib/dateTime';
import 'react-day-picker/dist/style.css';
import './DateTimePicker.css';

export interface DateTimePickerProps {
    value: string; // e.g. "2026-08-18T10:00" or "2026-08-18 10:00:00"
    timezone?: string | null;
    disabled?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    align?: 'start' | 'center' | 'end';
    side?: 'bottom' | 'top' | 'left' | 'right';
    sideOffset?: number;
    container?: HTMLElement | null;
    onChange: (value: string) => void;
}

const PRESETS = [
    {
        label: '今天 00:00',
        compute: () => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
        },
    },
    {
        label: '昨天 00:00',
        compute: () => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            d.setHours(0, 0, 0, 0);
            return d;
        },
    },
    {
        label: '前天 00:00',
        compute: () => {
            const d = new Date();
            d.setDate(d.getDate() - 2);
            d.setHours(0, 0, 0, 0);
            return d;
        },
    },
    {
        label: '当前整点',
        compute: () => {
            const d = new Date();
            d.setMinutes(0, 0, 0);
            return d;
        },
    },
];

function MonthCaption({ displayMonth, id }: CaptionProps) {
    return (
        <div id={id} className="datetime-picker__month-caption">
            {displayMonth.getFullYear()}年{displayMonth.getMonth() + 1}月
        </div>
    );
}

function parseDateValue(value: string): Date {
    if (!value) return new Date();
    const parsed = parseLocalDateTime(value);
    if (parsed && !isNaN(parsed.getTime())) return parsed;
    const fallback = new Date(value);
    if (!isNaN(fallback.getTime())) return fallback;
    return new Date();
}

function padZero(n: number): string {
    return String(n).padStart(2, '0');
}

export function DateTimePicker({
    value,
    timezone,
    disabled = false,
    placeholder = '选择计划时间',
    ariaLabel,
    align = 'start',
    side = 'bottom',
    sideOffset = 4,
    container,
    onChange,
}: DateTimePickerProps) {
    const [open, setOpen] = React.useState(false);
    const selectedDate = React.useMemo(() => (value ? parseDateValue(value) : null), [value]);

    const [draftDate, setDraftDate] = React.useState<Date>(() => selectedDate ?? new Date());
    const [hours, setHours] = React.useState(() => padZero(selectedDate ? selectedDate.getHours() : 0));
    const [minutes, setMinutes] = React.useState(() => padZero(selectedDate ? selectedDate.getMinutes() : 0));

    React.useEffect(() => {
        if (open && selectedDate) {
            setDraftDate(selectedDate);
            setHours(padZero(selectedDate.getHours()));
            setMinutes(padZero(selectedDate.getMinutes()));
        }
    }, [open, selectedDate]);

    const handleApply = () => {
        const h = Math.min(23, Math.max(0, parseInt(hours, 10) || 0));
        const m = Math.min(59, Math.max(0, parseInt(minutes, 10) || 0));
        const result = new Date(draftDate);
        result.setHours(h, m, 0, 0);
        // Format to "YYYY-MM-DDTHH:mm"
        const year = result.getFullYear();
        const month = padZero(result.getMonth() + 1);
        const day = padZero(result.getDate());
        const formatted = `${year}-${month}-${day}T${padZero(h)}:${padZero(m)}`;
        onChange(formatted);
        setOpen(false);
    };

    const handlePreset = (preset: typeof PRESETS[number]) => {
        const d = preset.compute();
        setDraftDate(d);
        setHours(padZero(d.getHours()));
        setMinutes(padZero(d.getMinutes()));
        const year = d.getFullYear();
        const month = padZero(d.getMonth() + 1);
        const day = padZero(d.getDate());
        const formatted = `${year}-${month}-${day}T${padZero(d.getHours())}:${padZero(d.getMinutes())}`;
        onChange(formatted);
        setOpen(false);
    };

    const displayFormatted = React.useMemo(() => {
        if (!value) return '';
        const d = parseDateValue(value);
        return `${formatLocalDateTime(d).slice(0, 16).replace('T', ' ')}`;
    }, [value]);

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
            <PopoverPrimitive.Trigger
                type="button"
                className="datetime-picker__trigger"
                disabled={disabled}
                aria-label={ariaLabel || placeholder || '选择计划时间'}
            >
                <div className="datetime-picker__trigger-left">
                    <Calendar size={15} className="datetime-picker__trigger-icon" />
                    <span className={displayFormatted ? 'datetime-picker__value' : 'datetime-picker__placeholder'}>
                        {displayFormatted || placeholder}
                    </span>
                </div>
                {timezone ? (
                    <span className="datetime-picker__timezone-badge">{timezone}</span>
                ) : null}
            </PopoverPrimitive.Trigger>

            <PopoverPrimitive.Portal container={container}>
                <PopoverPrimitive.Positioner
                    side={side}
                    align={align}
                    sideOffset={sideOffset}
                    className="pointer-events-auto isolate z-[2200] datetime-picker__positioner"
                >
                    <PopoverPrimitive.Popup className="datetime-picker__popup">
                        <div className="datetime-picker__body">
                            <div className="datetime-picker__presets">
                                <div className="datetime-picker__preset-header">常用预设</div>
                                <div className="datetime-picker__preset-list">
                                    {PRESETS.map((preset) => (
                                        <button
                                            key={preset.label}
                                            type="button"
                                            className="datetime-picker__preset-btn"
                                            onClick={() => handlePreset(preset)}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="datetime-picker__calendar-col">
                                <DayPicker
                                    mode="single"
                                    selected={draftDate}
                                    onSelect={(date) => {
                                        if (date) setDraftDate(date);
                                    }}
                                    locale={zhCN}
                                    components={{
                                        Caption: MonthCaption,
                                        IconLeft: () => <ChevronLeft size={16} />,
                                        IconRight: () => <ChevronRight size={16} />,
                                    }}
                                />

                                <div className="datetime-picker__time-row">
                                    <div className="datetime-picker__time-label">
                                        <Clock size={14} />
                                        <span>时间 (时:分)</span>
                                    </div>
                                    <div className="datetime-picker__time-inputs">
                                        <input
                                            type="number"
                                            min={0}
                                            max={23}
                                            className="datetime-picker__time-input"
                                            value={hours}
                                            onChange={(e) => setHours(e.target.value.slice(0, 2))}
                                        />
                                        <span>:</span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={59}
                                            className="datetime-picker__time-input"
                                            value={minutes}
                                            onChange={(e) => setMinutes(e.target.value.slice(0, 2))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="datetime-picker__footer">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setOpen(false)}
                            >
                                取消
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={handleApply}
                            >
                                确定
                            </Button>
                        </div>
                    </PopoverPrimitive.Popup>
                </PopoverPrimitive.Positioner>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
