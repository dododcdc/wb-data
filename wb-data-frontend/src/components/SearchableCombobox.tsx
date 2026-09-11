import * as React from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchableComboboxOption {
    value: string;
    label: string;
    subLabel?: string;
    badge?: string;
    count?: number | string;
    description?: string | null;
    keywords?: string[];
}

export interface SearchableComboboxProps {
    options: SearchableComboboxOption[];
    value?: string;
    placeholder?: string;
    emptyText?: string;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
    className?: string;
    menuContainer?: HTMLElement | null;
    onChange: (value: string, option?: SearchableComboboxOption) => void;
}

export function SearchableCombobox(props: SearchableComboboxProps) {
    const {
        options,
        value,
        placeholder = '选择或搜索要添加的参数组…',
        emptyText = '未找到匹配的参数组',
        disabled = false,
        id,
        ariaLabel,
        className,
        menuContainer,
        onChange,
    } = props;

    const [open, setOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [filterQuery, setFilterQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

    const isComposingRef = useRef(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    const updateCoords = useCallback(() => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setCoords({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
            });
        }
    }, []);

    // Filtered options based on confirmed search query (skips unconfirmed IME composition)
    const filteredOptions = useMemo(() => {
        const query = filterQuery.trim().toLowerCase();
        if (!query) return options;

        return options.filter((opt) => {
            if (opt.label.toLowerCase().includes(query)) return true;
            if (opt.value.toLowerCase().includes(query)) return true;
            if (opt.subLabel && opt.subLabel.toLowerCase().includes(query)) return true;
            if (opt.description && opt.description.toLowerCase().includes(query)) return true;
            if (opt.keywords && opt.keywords.some((kw) => kw.toLowerCase().includes(query))) return true;
            return false;
        });
    }, [options, filterQuery]);

    // Reset active index when filtered options change
    useEffect(() => {
        setActiveIndex(0);
    }, [filteredOptions.length, filterQuery]);

    // Scroll active item into view
    useEffect(() => {
        if (open && listRef.current) {
            const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
            if (activeEl && typeof activeEl.scrollIntoView === 'function') {
                activeEl.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [activeIndex, open]);

    // Outside click listener
    useEffect(() => {
        if (!open) return;

        updateCoords();

        const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (containerRef.current?.contains(target)) return;
            if (popupRef.current?.contains(target)) return;
            setOpen(false);
        };

        const handleResize = () => {
            updateCoords();
        };

        document.addEventListener('mousedown', handleOutsideClick);
        window.addEventListener('resize', handleResize);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            window.removeEventListener('resize', handleResize);
        };
    }, [open, updateCoords]);

    const handleSelect = (option: SearchableComboboxOption) => {
        onChange(option.value, option);
        setInputValue('');
        setFilterQuery('');
        setOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Never intercept keyboard actions during Chinese/IME composition
        if (isComposingRef.current || e.nativeEvent.isComposing) {
            return;
        }

        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredOptions.length > 0 && activeIndex >= 0 && activeIndex < filteredOptions.length) {
                    handleSelect(filteredOptions[activeIndex]);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setOpen(false);
                break;
        }
    };

    const maxPopupHeight = coords
        ? Math.min(220, Math.max(120, window.innerHeight - coords.top - 16))
        : 220;

    const popupContent = open && coords ? (
        <div
            ref={popupRef}
            data-slot="combobox-content"
            style={{
                position: 'fixed',
                top: `${coords.top}px`,
                left: `${coords.left}px`,
                width: `${coords.width}px`,
                maxHeight: `${maxPopupHeight}px`,
                zIndex: 2200,
            }}
            className="rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-border p-1 overflow-hidden flex flex-col pointer-events-auto"
            onWheel={(e) => e.stopPropagation()}
        >
            {/* Options List */}
            <div
                ref={listRef}
                role="listbox"
                className="flex-1 min-h-0 overflow-y-auto space-y-1 p-0.5 overscroll-contain"
                onWheel={(e) => e.stopPropagation()}
            >
                {filteredOptions.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                        {emptyText}
                    </div>
                ) : (
                    filteredOptions.map((option, idx) => {
                        const isSelected = option.value === value;
                        const isActive = idx === activeIndex;

                        return (
                            <div
                                key={option.value}
                                role="option"
                                aria-selected={isSelected}
                                data-slot="combobox-item"
                                className={cn(
                                    "relative flex flex-col gap-0.5 w-full cursor-pointer rounded-md py-1.5 px-2.5 text-xs outline-hidden select-none transition-colors",
                                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                                    isSelected && "font-medium"
                                )}
                                onMouseEnter={() => setActiveIndex(idx)}
                                onClick={() => handleSelect(option)}
                            >
                                {/* Line 1: Name + Badges */}
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="font-semibold text-foreground text-sm truncate">
                                            {option.label}
                                        </span>
                                        {option.badge ? (
                                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                                                {option.badge}
                                            </span>
                                        ) : null}
                                        {option.count != null ? (
                                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                                · {option.count} 个参数
                                            </span>
                                        ) : null}
                                    </div>
                                    {isSelected && (
                                        <Check className="size-3.5 text-primary shrink-0 ml-1" />
                                    )}
                                </div>

                                {/* Line 2: Monospace Code + Description */}
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground truncate">
                                    {option.subLabel ? (
                                        <code className="font-mono text-muted-foreground/80 bg-muted/60 px-1 py-0.2 rounded">
                                            {option.subLabel}
                                        </code>
                                    ) : null}
                                    {option.description ? (
                                        <span className="truncate">{option.description}</span>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer Status */}
            {filterQuery && filteredOptions.length > 0 ? (
                <div className="px-2 pt-1 border-t border-border/40 text-[10px] text-muted-foreground text-right shrink-0">
                    找到 {filteredOptions.length} 个匹配项
                </div>
            ) : null}
        </div>
    ) : null;

    return (
        <div className="relative w-full">
            <div
                ref={containerRef}
                className={cn(
                    "flex w-full items-center gap-2 rounded-lg border border-input bg-transparent py-1.5 pr-2 pl-3 text-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
                    disabled && "cursor-not-allowed opacity-50",
                    className
                )}
                onClick={() => {
                    if (!disabled) {
                        inputRef.current?.focus();
                        if (!open) setOpen(true);
                    }
                }}
            >
                <Search className="size-4 text-muted-foreground shrink-0 pointer-events-none" />
                <input
                    ref={inputRef}
                    id={id}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={ariaLabel}
                    disabled={disabled}
                    value={inputValue}
                    placeholder={placeholder}
                    className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
                    onChange={(e) => {
                        const next = e.target.value;
                        setInputValue(next);
                        if (!isComposingRef.current) {
                            setFilterQuery(next);
                        }
                        if (!open) setOpen(true);
                    }}
                    onCompositionStart={() => {
                        isComposingRef.current = true;
                    }}
                    onCompositionEnd={(e) => {
                        isComposingRef.current = false;
                        const finalVal = e.currentTarget.value;
                        setInputValue(finalVal);
                        setFilterQuery(finalVal);
                        if (!open) setOpen(true);
                    }}
                    onFocus={() => {
                        if (!open) setOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                />
                {inputValue ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setInputValue('');
                            setFilterQuery('');
                            inputRef.current?.focus();
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                        <X className="size-3.5" />
                    </button>
                ) : (
                    <button
                        type="button"
                        tabIndex={-1}
                        disabled={disabled}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!disabled) {
                                setOpen((prev) => {
                                    const next = !prev;
                                    if (next) inputRef.current?.focus();
                                    return next;
                                });
                            }
                        }}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground flex items-center justify-center cursor-pointer"
                    >
                        <ChevronDown
                            className={cn(
                                "size-4 text-muted-foreground pointer-events-none shrink-0 transition-transform duration-150",
                                open && "rotate-180"
                            )}
                        />
                    </button>
                )}
            </div>

            {popupContent && typeof document !== 'undefined' ? createPortal(popupContent, menuContainer || document.body) : null}
        </div>
    );
}
