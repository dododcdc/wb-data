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
import { useCallback, useEffect, useRef, useState, type UIEventHandler } from 'react';
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
        value: propValue,
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
    const [inputValue, setInputValue] = useState('');
    const [open, setOpen] = useState(false);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

    // Track the current value as a simple string ID for maximum stability
    const activeValue = propValue || selectedOption?.value || '';

    // Synchronize inputValue with the selected option only when not open or when selectedOption changes
    useEffect(() => {
        if (!open) {
            const currentLabel = selectedOption?.label || options.find(o => o.value === propValue)?.label || '';
            setInputValue(currentLabel);
        }
    }, [open, selectedOption, propValue, options]);

    const handleValueChange = (newValue: string | null) => {
        if (!newValue) {
            onChange?.('', null);
            return;
        }
        // Find the full option object corresponding to the string ID
        const option = options.find(o => o.value === newValue) || (selectedOption?.value === newValue ? selectedOption : null);
        if (option) {
            setInputValue(option.label);
            onChange?.(option.value, option);
        }
    };

    const handleInputChangeInternal = (nextValue: string, details?: { reason?: string }) => {
        if (isComposingRef.current) return;
        
        // Only trigger search when the user is actually typing
        if (details?.reason === 'input-change' || details?.reason === 'input-clear' || !details?.reason) {
            setInputValue(nextValue);
            onInputChange?.(nextValue);
        } else if (details?.reason === 'option-select') {
            // When an option is selected, the combobox will update the input value automatically
            setInputValue(nextValue);
        }
    };

    const handleOpenChangeInternal = (nextOpen: boolean) => {
        setOpen(nextOpen);
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
        <Combobox<string>
            value={activeValue}
            onValueChange={handleValueChange}
            onInputValueChange={handleInputChangeInternal}
            inputValue={inputValue}
            onOpenChange={handleOpenChangeInternal}
            disabled={disabled}
        >
            <div className={cn(
                "relative flex items-center !h-[38px] !bg-transparent border border-input rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-shadow",
                theme === 'dark' && "dark",
                className
            )}>
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
                <ComboboxInput 
                    placeholder={placeholder}
                    className={cn(
                        "!h-full w-full !pl-9 !pr-8 !m-0 !bg-transparent text-sm !border-0 focus-visible:ring-0 !shadow-none outline-none",
                        triggerClassName
                    )}
                    onCompositionStart={() => { isComposingRef.current = true }}
                    onCompositionEnd={(e) => {
                        isComposingRef.current = false;
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
                ref={setScrollElement}
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
                                            <ComboboxItem value={item.value}>
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
                                <ComboboxItem key={item.value} value={item.value}>
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
