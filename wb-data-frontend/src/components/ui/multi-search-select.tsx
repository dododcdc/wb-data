import { Loader2, Search, X, ChevronDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
} from './combobox';
import type { SearchSelectOption } from './search-select';

export interface MultiSearchSelectProps<T extends SearchSelectOption> {
    options: T[];
    values: string[];
    selectedOptions?: T[];
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    emptyText?: string;
    loadingText?: string;
    className?: string;
    triggerClassName?: string;
    onChange?: (values: string[], options: T[]) => void;
    onInputChange?: (value: string) => void;
}

export function MultiSearchSelect<T extends SearchSelectOption>(props: MultiSearchSelectProps<T>) {
    const {
        options,
        values,
        selectedOptions,
        placeholder = '搜索...',
        disabled,
        loading,
        emptyText = '未找到匹配项',
        loadingText = '加载中...',
        className,
        triggerClassName,
        onChange,
        onInputChange,
    } = props;

    const isComposingRef = useRef(false);
    const [inputValue, setInputValue] = useState('');
    const [open, setOpen] = useState(false);

    const optionLookup = useMemo(() => {
        const entries = new Map<string, T>();
        (selectedOptions ?? []).forEach((option) => {
            entries.set(option.value, option);
        });
        options.forEach((option) => {
            entries.set(option.value, option);
        });
        return entries;
    }, [options, selectedOptions]);

    const resolvedSelectedOptions = useMemo(
        () => values.map((value) => optionLookup.get(value)).filter(Boolean) as T[],
        [optionLookup, values],
    );

    const availableOptions = useMemo(
        () => options.filter((option) => !values.includes(option.value)),
        [options, values],
    );

    const emitChange = (nextValues: string[]) => {
        const nextOptions = nextValues
            .map((value) => optionLookup.get(value))
            .filter(Boolean) as T[];
        onChange?.(nextValues, nextOptions);
    };

    const handleInputChange = (nextValue: string, details?: { reason?: string }) => {
        if (isComposingRef.current) return;
        if (details?.reason === 'option-select') return;

        setInputValue(nextValue);
        if (!disabled) {
            setOpen(true);
        }
        onInputChange?.(nextValue);
    };

    const handleValueChange = (nextValue: string | null) => {
        if (!nextValue || values.includes(nextValue)) return;

        emitChange([...values, nextValue]);
        setInputValue('');
        onInputChange?.('');
        setOpen(true);
    };

    return (
        <div className="space-y-2">
            {resolvedSelectedOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                    {resolvedSelectedOptions.map((option) => (
                        <div
                            key={option.value}
                            className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm text-foreground"
                        >
                            <span className="truncate">{option.label}</span>
                            <button
                                type="button"
                                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                aria-label={`移除 ${option.label}`}
                                disabled={disabled}
                                onClick={() => emitChange(values.filter((value) => value !== option.value))}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}

                    <button
                        type="button"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="清空全部已选成员"
                        disabled={disabled}
                        onClick={() => emitChange([])}
                    >
                        清空全部
                    </button>
                </div>
            ) : null}

            <Combobox
                open={disabled ? false : open}
                inputValue={inputValue}
                onOpenChange={setOpen}
                onInputValueChange={handleInputChange}
                onValueChange={handleValueChange}
                disabled={disabled}
            >
                <div
                    className={cn(
                        'relative flex items-center !h-[38px] !bg-transparent overflow-hidden rounded-md border border-input transition-shadow focus-within:ring-1 focus-within:ring-ring',
                        className,
                    )}
                >
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <ComboboxInput
                        placeholder={placeholder}
                        className={cn(
                            '!m-0 !h-full w-full !border-0 !bg-transparent !pl-9 !pr-8 text-sm !shadow-none outline-none focus-visible:ring-0',
                            triggerClassName,
                        )}
                        onFocus={() => setOpen(true)}
                        onClick={() => setOpen(true)}
                        onCompositionStart={() => {
                            isComposingRef.current = true;
                        }}
                        onCompositionEnd={(event) => {
                            isComposingRef.current = false;
                            const nextValue = event.currentTarget.value;
                            setInputValue(nextValue);
                            onInputChange?.(nextValue);
                        }}
                    />
                    <ComboboxTrigger className="absolute right-0 top-0 bottom-0 flex w-8 items-center justify-center border-l border-transparent transition-colors hover:bg-muted/50">
                        <ChevronDown size={14} className="text-muted-foreground" />
                    </ComboboxTrigger>
                </div>

                <ComboboxContent sideOffset={4} align="start" className="w-[var(--anchor-width)] max-h-[300px]">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>{loadingText}</span>
                        </div>
                    ) : availableOptions.length === 0 ? (
                        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
                    ) : (
                        <div className="p-1">
                            {availableOptions.map((option) => (
                                <ComboboxItem key={option.value} value={option.value}>
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        {option.icon}
                                        {option.badge}
                                        <span className="truncate">{option.label}</span>
                                        {option.secondaryLabel ? (
                                            <span className="truncate text-xs text-muted-foreground">
                                                {option.secondaryLabel}
                                            </span>
                                        ) : null}
                                    </div>
                                </ComboboxItem>
                            ))}
                        </div>
                    )}
                </ComboboxContent>
            </Combobox>
        </div>
    );
}
