import * as React from "react"
import {
    Combobox,
    ComboboxInput,
    ComboboxTrigger,
    ComboboxContent,
    ComboboxItem,
    ComboboxEmpty,
} from './combobox';
import { Search, ChevronDown, Loader2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, useState, type CompositionEvent, type UIEventHandler } from 'react';
import { cn } from '@/lib/utils';

export interface SearchSelectOption {
    label: string;
    value: string;
    secondaryLabel?: string;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
    raw?: any;
}

export interface SearchSelectProps<T extends SearchSelectOption> {
    options: T[];
    value?: string;
    selectedOption?: T | null;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    loadingMore?: boolean;
    hasMore?: boolean;
    emptyText?: string;
    loadingText?: string;
    loadingMoreText?: string;
    loadMoreText?: string;
    virtualize?: boolean;
    virtualItemSize?: number;
    theme?: 'light' | 'dark';
    className?: string;
    triggerClassName?: string;
    onChange?: (value: string, option: T | null) => void;
    onInputChange?: (value: string) => void;
    onLoadMore?: () => void;
    onOpenChange?: (open: boolean) => void;
    renderItem?: (option: T) => React.ReactNode;
}

export function SearchSelect<T extends SearchSelectOption>(props: SearchSelectProps<T>) {
    const {
        options,
        value,
        selectedOption,
        placeholder = '搜索...',
        disabled,
        loading,
        loadingMore,
        hasMore,
        emptyText = '未找到匹配项',
        loadingText = '加载中...',
        loadingMoreText = '加载更多...',
        loadMoreText = '继续滚动加载更多',
        virtualize = false,
        virtualItemSize = 36,
        theme = 'light',
        className,
        triggerClassName,
        onChange,
        onInputChange,
        onLoadMore,
        onOpenChange,
        renderItem,
    } = props;

    const isComposingRef = useRef(false);
    const skipNextInputRef = useRef(false);
    const [inputValue, setInputValue] = useState('');
    const [open, setOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

    const resolvedValue = options.find(opt => opt.value === value) || selectedOption || null;

    const handleScrollElementRef = useCallback((node: HTMLDivElement | null) => {
        if (scrollRef.current === node) return;
        scrollRef.current = node;
        setScrollElement(node);
    }, []);

    useEffect(() => {
        if (!open) {
            setInputValue(resolvedValue?.label ?? '');
        }
    }, [open, resolvedValue]);

    const handleValueChange = (newOption: T | null) => {
        if (newOption) {
            setInputValue(newOption.label);
            onChange?.(newOption.value, newOption);
        } else {
            setInputValue('');
            onChange?.('', null);
        }
    };

    const handleInputChangeInternal = (nextValue: string, details?: { reason?: string }) => {
        if (skipNextInputRef.current) {
            skipNextInputRef.current = false;
            return;
        }
        if (isComposingRef.current) return;
        
        // Filter out internal changes that aren't user typing
        if (details?.reason && !['input-change', 'input-clear', 'input-paste'].includes(details.reason)) {
            return;
        }

        setInputValue(nextValue);
        onInputChange?.(nextValue);
    };

    const handleOpenChangeInternal = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setInputValue(resolvedValue?.label ?? '');
            onInputChange?.('');
        }
        onOpenChange?.(nextOpen);
    };

    const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
        if (!onLoadMore || !hasMore || loading || loadingMore) return;
        const target = event.currentTarget;
        const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
        if (nearBottom) onLoadMore();
    };

    const virtualizer = useVirtualizer({
        count: options.length,
        getScrollElement: () => scrollElement,
        estimateSize: () => virtualItemSize,
        overscan: 6,
    });

    return (
        <Combobox<T>
            value={resolvedValue}
            onValueChange={handleValueChange}
            onInputValueChange={handleInputChangeInternal}
            inputValue={inputValue}
            onOpenChange={handleOpenChangeInternal}
            disabled={disabled}
            itemToStringLabel={(item) => item?.label ?? ''}
            itemToStringValue={(item) => item?.value ?? ''}
            isItemEqualToValue={(item, val) => item.value === val.value}
        >
            <div className={cn(
                "relative flex items-center h-9 bg-background border border-input rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-shadow",
                theme === 'dark' && "dark",
                className
            )}>
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
                <ComboboxInput 
                    placeholder={placeholder}
                    className={cn(
                        "h-full w-full pl-9 pr-8 bg-transparent text-sm border-0 focus-visible:ring-0 shadow-none outline-none",
                        triggerClassName
                    )}
                    onCompositionStart={() => { isComposingRef.current = true }}
                    onCompositionEnd={(e) => {
                        isComposingRef.current = false;
                        skipNextInputRef.current = true;
                        setTimeout(() => { skipNextInputRef.current = false }, 0);
                        const val = e.currentTarget.value;
                        setInputValue(val);
                        onInputChange?.(val);
                    }}
                />
                <ComboboxTrigger className="absolute right-0 top-0 bottom-0 w-8 border-l border-transparent flex items-center justify-center hover:bg-muted/50 transition-colors">
                    <ChevronDown size={14} className="text-muted-foreground" />
                </ComboboxTrigger>
            </div>
            
            <ComboboxContent
                sideOffset={4}
                align="start"
                className="w-[var(--anchor-width)] max-h-[300px]"
                onScroll={handleScroll}
                ref={handleScrollElementRef}
            >
                {loading ? (
                    <div className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                        <Loader2 className="animate-spin size-4" />
                        <span>{loadingText}</span>
                    </div>
                ) : options.length === 0 ? (
                    <ComboboxEmpty>{emptyText}</ComboboxEmpty>
                ) : (
                    <div className="p-1">
                        {virtualize ? (
                            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                                {virtualizer.getVirtualItems().map((virtualRow) => {
                                    const item = options[virtualRow.index];
                                    return (
                                        <div
                                            key={item.value}
                                            className="absolute left-0 top-0 w-full"
                                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                                        >
                                            <ComboboxItem value={item}>
                                                {renderItem ? renderItem(item) : (
                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                        {item.icon}
                                                        {item.badge}
                                                        <span className="truncate">{item.label}</span>
                                                        {item.secondaryLabel && (
                                                            <span className="text-muted-foreground text-xs truncate">
                                                                {item.secondaryLabel}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </ComboboxItem>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            options.map((item) => (
                                <ComboboxItem key={item.value} value={item}>
                                    {renderItem ? renderItem(item) : (
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            {item.icon}
                                            {item.badge}
                                            <span className="truncate">{item.label}</span>
                                            {item.secondaryLabel && (
                                                <span className="text-muted-foreground text-xs truncate">
                                                    {item.secondaryLabel}
                                                </span>
                                            )}
                                        </div>
                                    )}
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
    );
}
