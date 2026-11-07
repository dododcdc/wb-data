import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';

export interface RowActionItem {
    key: string;
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    tone?: 'default' | 'danger';
    disabled?: boolean;
    pending?: boolean;
}

interface RowActionsProps {
    items: RowActionItem[];
    maxVisible?: number;
    menuLabel?: string;
}

export function RowActions({ items, maxVisible = 2, menuLabel = '更多操作' }: RowActionsProps) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const visibleItems = items.slice(0, maxVisible);
    const overflowItems = items.slice(maxVisible);

    const closeMenu = (restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    };

    const openMenu = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const menuWidth = 156;
        const menuHeight = overflowItems.length * 36 + 8;
        const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
        const fitsBelow = rect.bottom + 4 + menuHeight <= window.innerHeight - 8;
        const top = fitsBelow ? rect.bottom + 4 : Math.max(8, rect.top - menuHeight - 4);
        setPosition({ top, left });
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
        };
        const handleViewportChange = () => setOpen(false);
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('scroll', handleViewportChange, true);
        window.addEventListener('resize', handleViewportChange);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('scroll', handleViewportChange, true);
            window.removeEventListener('resize', handleViewportChange);
        };
    }, [open]);

    const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu(true);
            return;
        }
        if (event.key === 'Tab') {
            setOpen(false);
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
        if (buttons.length === 0) return;
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? buttons.length - 1
                : event.key === 'ArrowDown'
                    ? (currentIndex + 1 + buttons.length) % buttons.length
                    : (currentIndex - 1 + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
    };

    return (
        <div className="wb-list-actions">
            {visibleItems.map((item) => {
                const Icon = item.pending ? Loader2 : item.icon;
                return (
                    <Tooltip key={item.key}>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                className={`wb-list-icon-btn${item.tone === 'danger' ? ' is-danger' : ''}`}
                                aria-label={item.label}
                                disabled={item.disabled || item.pending}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    item.onClick();
                                }}
                            >
                                <Icon size={16} className={item.pending ? 'wb-list-spin' : undefined} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{item.label}</TooltipContent>
                    </Tooltip>
                );
            })}
            {overflowItems.length > 0 ? (
                <>
                    <button
                        ref={triggerRef}
                        type="button"
                        className="wb-list-icon-btn"
                        aria-label={menuLabel}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-controls={open ? menuId : undefined}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (open) closeMenu();
                            else openMenu();
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                if (!open) openMenu();
                            }
                        }}
                    >
                        <MoreHorizontal size={16} />
                    </button>
                    {open ? createPortal(
                        <div
                            ref={menuRef}
                            id={menuId}
                            className="wb-list-menu"
                            role="menu"
                            aria-label={menuLabel}
                            style={position}
                            onKeyDown={handleMenuKeyDown}
                            onClick={(event) => event.stopPropagation()}
                        >
                            {overflowItems.map((item) => {
                                const Icon = item.pending ? Loader2 : item.icon;
                                return (
                                    <button
                                        key={item.key}
                                        type="button"
                                        role="menuitem"
                                        className={item.tone === 'danger' ? 'is-danger' : undefined}
                                        disabled={item.disabled || item.pending}
                                        onClick={() => {
                                            closeMenu(true);
                                            item.onClick();
                                        }}
                                    >
                                        <Icon size={15} className={item.pending ? 'wb-list-spin' : undefined} />
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>,
                        document.body,
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
