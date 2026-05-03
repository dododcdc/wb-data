import { Loader2, Search, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { cn } from '@/lib/utils';

import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
} from './combobox';
import type { SearchAutocompleteOption } from './search-autocomplete';

export interface MultiSearchAutocompleteProps<T extends SearchAutocompleteOption> {
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
    loadingMore?: boolean;
    loadingMoreText?: string;
    hasMore?: boolean;
    loadMoreText?: string;
    onLoadMore?: () => void;
    virtualize?: boolean;
    virtualItemSize?: number;
}

export function MultiSearchAutocomplete<T extends SearchAutocompleteOption>(props: MultiSearchAutocompleteProps<T>) {
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
        loadingMore,
        loadingMoreText = '加载更多...',
        hasMore,
        loadMoreText = '继续滚动加载更多',
        onLoadMore,
        virtualize = false,
        virtualItemSize = 36,
    } = props;

    const isComposingRef = useRef(false);
    const [inputValue, setInputValue] = useState('');
    const [open, setOpen] = useState(false);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const hasQuery = inputValue.trim().length > 0;

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
            setOpen(nextValue.trim().length > 0);
        }
        onInputChange?.(nextValue);
    };

    const handleValueChange = (nextValue: string | null) => {
        if (!nextValue || values.includes(nextValue)) return;

        emitChange([...values, nextValue]);
        setInputValue('');
        onInputChange?.('');
        setOpen(false);
    };

    const handleScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
        if (!onLoadMore || !hasMore || loading || loadingMore) return;
        const target = event.currentTarget;
        const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
        if (nearBottom) onLoadMore();
    };

    const virtualizer = useVirtualizer({
        count: availableOptions.length,
        getScrollElement: () => scrollElement,
        estimateSize: () => virtualItemSize,
        overscan: 6,
    });

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
                value={null}
                open={disabled ? false : open && hasQuery}
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
                            '!m-0 !h-full w-full !border-0 !bg-transparent !pl-9 !pr-3 text-sm !shadow-none outline-none focus-visible:ring-0',
                            triggerClassName,
                        )}
                        onFocus={(event) => {
                            if (event.currentTarget.value.trim().length > 0) {
                                setOpen(true);
                            }
                        }}
                        onClick={(event) => {
                            if (event.currentTarget.value.trim().length > 0) {
                                setOpen(true);
                            }
                        }}
                        onCompositionStart={() => {
                            isComposingRef.current = true;
                        }}
                        onCompositionEnd={(event) => {
                            isComposingRef.current = false;
                            const nextValue = event.currentTarget.value;
                            setInputValue(nextValue);
                            setOpen(nextValue.trim().length > 0);
                            onInputChange?.(nextValue);
                        }}
                    />
                </div>

                <ComboboxContent 
                    sideOffset={4} 
                    align="start" 
                    className="w-[var(--anchor-width)] max-h-[300px]"
                    onScroll={handleScroll}
                    ref={setScrollElement}
                >
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>{loadingText}</span>
                        </div>
                    ) : availableOptions.length === 0 ? (
                        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
                    ) : (
                        <div className="p-1">
                            {virtualize && virtualizer ? (
                                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                                    {virtualizer.getVirtualItems().map((virtualRow) => {
                                        const option = availableOptions[virtualRow.index];
                                        return (
                                            <div
                                                key={option.value}
                                                className="absolute left-0 top-0 w-full"
                                                style={{ transform: `translateY(${virtualRow.start}px)` }}
                                            >
                                                <ComboboxItem value={option.value}>
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
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                availableOptions.map((option) => (
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
                                ))
                            )}
                            {loadingMore && (
                                <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground border-t border-border/50 mt-1">
                                    <Loader2 className="animate-spin" size={12} />
                                    <span>{loadingMoreText}</span>
                                </div>
                            )}
                            {!loadingMore && hasMore && (
                                <div className="px-3 py-2 text-xs text-muted-foreground text-center opacity-70">
                                    {loadMoreText}
                                </div>
                            )}
                        </div>
                    )}
                </ComboboxContent>
            </Combobox>
        </div>
    );
}
