import {
    Combobox,
    ComboboxInput,
    ComboboxTrigger,
    ComboboxContent,
    ComboboxItem,
    ComboboxEmpty,
} from '@/components/ui/combobox';
import { Search, ChevronDown, Loader2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState, type CompositionEvent, type UIEventHandler } from 'react';

interface Option {
    label: string;
    value: string;
    type?: string;
    raw?: any;
}

type DataSourceSelectProps = {
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string, option?: Option) => void;
    onInputChange?: (value: string) => void;
    loading?: boolean;
    loadingMore?: boolean;
    value?: string;
    selectedOption?: Option | null;
    hasMore?: boolean;
    onLoadMore?: () => void;
    onOpenChange?: (open: boolean) => void;
    inputId?: string;
    ariaLabel?: string;
    ariaLabelledby?: string;
    virtualize?: boolean;
    virtualItemSize?: number;
    virtualOverscan?: number;
    theme?: 'light' | 'dark';
    multiple?: boolean;
    disableClientFilter?: boolean;
    emptyText?: string;
    loadingText?: string;
    loadingMoreText?: string;
    loadMoreText?: string;
};

export function DataSourceSelect(props: DataSourceSelectProps) {
    const {
        options,
        placeholder = '搜索...',
        disabled,
        value,
        selectedOption,
        onChange,
        onInputChange,
        loading,
        loadingMore,
        hasMore,
        onLoadMore,
        onOpenChange,
        inputId,
        ariaLabel,
        ariaLabelledby,
        virtualize = false,
        virtualItemSize = 32,
        virtualOverscan = 6,
        theme = 'light',
        disableClientFilter,
        emptyText = '未找到匹配项',
        loadingText = '加载中...',
        loadingMoreText = '加载更多...',
        loadMoreText = '继续滚动加载更多',
    } = props;

    const isComposingRef = useRef(false);
    const skipNextInputRef = useRef(false);
    const [inputValue, setInputValue] = useState('');
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

    const resolvedValue = options.find(opt => opt.value === value) || selectedOption || null;
    const shouldVirtualize = virtualize && options.length > 0;
    const virtualizer = useVirtualizer({
        count: options.length,
        getScrollElement: () => scrollElement,
        estimateSize: () => virtualItemSize,
        overscan: virtualOverscan,
    });
    const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];

    const handleScrollElementRef = (node: HTMLDivElement | null) => {
        scrollRef.current = node;
        setScrollElement(node);
    };

    useEffect(() => {
        if (resolvedValue) {
            setInputValue(resolvedValue.label);
            return;
        }
        setInputValue('');
    }, [resolvedValue?.value, resolvedValue?.label]);

    const handleValueChange = (newOption: Option | null) => {
        if (newOption) {
            setInputValue(newOption.label);
            if (onChange) {
                onChange(newOption.value, newOption);
            }
            return;
        }
        setInputValue('');
    };

    const handleInputValueChange = (nextValue: string, details?: { reason?: string }) => {
        if (skipNextInputRef.current) {
            skipNextInputRef.current = false;
            return;
        }
        if (isComposingRef.current) {
            return;
        }
        if (details?.reason && details.reason !== 'input-change' && details.reason !== 'input-clear' && details.reason !== 'input-paste') {
            return;
        }
        setInputValue(nextValue);
        onInputChange?.(nextValue);
    };

    const handleCompositionStart = () => {
        isComposingRef.current = true;
    };

    const handleCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
        isComposingRef.current = false;
        skipNextInputRef.current = true;
        setTimeout(() => {
            skipNextInputRef.current = false;
        }, 0);
        const nextValue = event.currentTarget.value;
        setInputValue(nextValue);
        onInputChange?.(nextValue);
    };

    const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
        if (!onLoadMore || !hasMore || loading || loadingMore) {
            return;
        }
        const target = event.currentTarget;
        const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
        if (nearBottom) {
            onLoadMore();
        }
    };

    return (
        <Combobox<Option>
            value={resolvedValue}
            onValueChange={handleValueChange}
            onInputValueChange={handleInputValueChange}
            inputValue={inputValue}
            onOpenChange={onOpenChange}
            disabled={disabled}
            itemToStringLabel={(item) => item ? item.label : ''}
            itemToStringValue={(item) => item ? item.value : ''}
            isItemEqualToValue={(item, val) => item.value === val.value}
            filter={disableClientFilter ? null : undefined}
        >
            <div className={`ds-select-root relative flex items-center h-[44px] bg-background border border-input rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-ring ${theme === 'dark' ? 'dark' : ''}`}>
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
                <ComboboxInput 
                    placeholder={placeholder}
                    className="h-full w-full pl-9 pr-8 bg-transparent text-sm border-0 focus-visible:ring-0 shadow-none outline-none"
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    id={inputId}
                    aria-label={ariaLabelledby ? undefined : (ariaLabel ?? placeholder)}
                    aria-labelledby={ariaLabelledby}
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
                    <div className="p-3 text-sm text-muted-foreground text-center">{loadingText}</div>
                ) : options.length === 0 ? (
                    <ComboboxEmpty>{emptyText}</ComboboxEmpty>
                ) : (
                    <>
                        {shouldVirtualize ? (
                            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                                {virtualItems.map((virtualRow) => {
                                    const item = options[virtualRow.index];
                                    return (
                                        <div
                                            key={item.value}
                                            className="absolute left-0 top-0 w-full"
                                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                                        >
                                            <ComboboxItem value={item}>
                                                {item.type && (
                                                    <span className={`type-badge ${item.type.toLowerCase()} mr-2`}>
                                                        {item.type.toUpperCase()}
                                                    </span>
                                                )}
                                                {item.label}
                                            </ComboboxItem>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            options.map((item) => (
                                <ComboboxItem key={item.value} value={item}>
                                    {item.type && (
                                        <span className={`type-badge ${item.type.toLowerCase()} mr-2`}>
                                            {item.type.toUpperCase()}
                                        </span>
                                    )}
                                    {item.label}
                                </ComboboxItem>
                            ))
                        )}
                        {loadingMore ? (
                            <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                                <Loader2 className="animate-spin" size={12} />
                                <span>{loadingMoreText}</span>
                            </div>
                        ) : hasMore ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                                {loadMoreText}
                            </div>
                        ) : null}
                    </>
                )}
            </ComboboxContent>
        </Combobox>
    );
}
