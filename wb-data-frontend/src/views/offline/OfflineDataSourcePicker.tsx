import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type UIEvent } from 'react';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';
import type { NodeEditorDataSourceOption } from './useNodeEditorDataSources';

interface OfflineDataSourcePickerProps {
    options: NodeEditorDataSourceOption[];
    selectedOption: NodeEditorDataSourceOption | null;
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    placeholder?: string;
    emptyText?: string;
    onSearch: (keyword: string) => void;
    onLoadMore: () => void;
    onSelect: (option: NodeEditorDataSourceOption) => void;
}

export function OfflineDataSourcePicker({
    options,
    selectedOption,
    loading,
    loadingMore,
    hasMore,
    placeholder = '搜索并选择数据源...',
    emptyText = '未找到匹配的数据源',
    onSearch,
    onLoadMore,
    onSelect,
}: OfflineDataSourcePickerProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const isComposingRef = useRef(false);
    const [open, setOpen] = useState(false);
    const [searchValue, setSearchValue] = useState('');

    useEffect(() => {
        if (!open) {
            setSearchValue('');
            onSearch('');
            return;
        }

        const rafId = window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(rafId);
    }, [onSearch, open]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [open]);

    const selectedLabel = selectedOption?.label ?? '';
    const displayLabel = open ? searchValue : selectedLabel;
    const showPlaceholder = !displayLabel;

    const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const nextValue = event.target.value;
        setSearchValue(nextValue);
        if (!isComposingRef.current) {
            onSearch(nextValue);
        }
    }, [onSearch]);

    const handleCompositionStart = useCallback(() => {
        isComposingRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback((event: CompositionEvent<HTMLInputElement>) => {
        isComposingRef.current = false;
        const nextValue = event.currentTarget.value;
        setSearchValue(nextValue);
        onSearch(nextValue);
    }, [onSearch]);

    const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
        if (!hasMore || loading || loadingMore) {
            return;
        }
        const target = event.currentTarget;
        const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
        if (nearBottom) {
            onLoadMore();
        }
    }, [hasMore, loading, loadingMore, onLoadMore]);

    const handleOpen = useCallback(() => {
        setOpen(true);
    }, []);

    const optionItems = useMemo(() => options.map((option) => {
        const isSelected = selectedOption?.value === option.value;
        return (
            <button
                key={option.value}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                    onSelect(option);
                    setOpen(false);
                }}
            >
                {option.type ? (
                    <span className={`type-badge ${option.type.toLowerCase()} shrink-0`}>
                        {option.type.toUpperCase()}
                    </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? <Check size={14} className="shrink-0 text-gray-500" /> : null}
            </button>
        );
    }), [onSelect, options, selectedOption?.value]);

    return (
        <div ref={rootRef} className="relative">
            <div
                className="flex h-9 w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:border-gray-300"
                onClick={() => {
                    if (!open) {
                        handleOpen();
                    }
                }}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <Search size={14} className="shrink-0 text-gray-400" />
                {open ? (
                    <input
                        ref={inputRef}
                        value={searchValue}
                        onChange={handleInputChange}
                        onCompositionStart={handleCompositionStart}
                        onCompositionEnd={handleCompositionEnd}
                        onFocus={handleOpen}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                setOpen(false);
                            }
                        }}
                        placeholder={selectedLabel || placeholder}
                        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-gray-400"
                    />
                ) : (
                    <button
                        type="button"
                        className={`min-w-0 flex-1 truncate text-left ${showPlaceholder ? 'text-gray-400' : ''}`}
                        onClick={handleOpen}
                    >
                        {showPlaceholder ? placeholder : displayLabel}
                    </button>
                )}
                <ChevronDown size={14} className="shrink-0 text-gray-400" />
            </div>

            {open ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1105] rounded-md border border-gray-200 bg-white p-2 shadow-lg">
                    <div className="max-h-[280px] overflow-y-auto" onScroll={handleScroll} role="listbox">
                        {loading ? (
                            <div className="px-3 py-6 text-center text-sm text-gray-400">加载数据源...</div>
                        ) : optionItems.length === 0 ? (
                            <div className="px-3 py-6 text-center text-sm text-gray-400">{emptyText}</div>
                        ) : (
                            <div className="space-y-1">{optionItems}</div>
                        )}

                        {loadingMore ? (
                            <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-gray-400">
                                <Loader2 size={12} className="animate-spin" />
                                <span>加载更多...</span>
                            </div>
                        ) : hasMore ? (
                            <div className="px-3 py-2 text-center text-xs text-gray-400">继续滚动加载更多</div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
