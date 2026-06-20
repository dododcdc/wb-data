import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { CalendarRange } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
    formatLocalDateTime,
    getBrowserTimeZoneName,
    parseLocalDateTime,
} from '../../lib/dateTime';

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

export function OperationsTimeFilter({ from, to, onChange }: OperationsTimeFilterProps) {
    const titleId = React.useId();
    const [open, setOpen] = React.useState(false);
    const [mode, setMode] = React.useState<FilterMode>('quick');
    const [draftStart, setDraftStart] = React.useState<Date | null>(null);
    const [draftEnd, setDraftEnd] = React.useState<Date | null>(null);
    const [activePreset, setActivePreset] = React.useState<string | null>(null);

    const initializeDraft = React.useCallback(() => {
        const applied = appliedDates(from, to);
        setDraftStart(applied.start);
        setDraftEnd(applied.end);
        setMode('quick');
        setActivePreset(null);
    }, [from, to]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) initializeDraft();
        setOpen(nextOpen);
    };

    const selectPreset = (label: string, milliseconds: number) => {
        const end = new Date(Date.now());
        setDraftStart(new Date(end.getTime() - milliseconds));
        setDraftEnd(end);
        setActivePreset(label);
    };

    const handleApply = () => {
        if (!draftStart || !draftEnd || draftStart.getTime() > draftEnd.getTime()) return;
        onChange(formatLocalDateTime(draftStart), formatLocalDateTime(draftEnd));
        setOpen(false);
    };

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
                                <div className="operations-time-filter__custom-placeholder" />
                            )}
                        </div>

                        <div className="operations-time-filter__selection" aria-label="待应用时间范围">
                            <span>{draftStart ? formatLocalDateTime(draftStart) : '请选择开始时间'}</span>
                            <span aria-hidden="true">→</span>
                            <span>{draftEnd ? formatLocalDateTime(draftEnd) : '请选择结束时间'}</span>
                        </div>

                        <footer className="operations-time-filter__footer">
                            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
                            <Button type="button" onClick={handleApply}>应用</Button>
                        </footer>
                    </PopoverPrimitive.Popup>
                </PopoverPrimitive.Positioner>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
