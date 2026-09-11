import { useState } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { ChevronDownIcon, CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SelectOption = {
    label: string;
    value: string;
};

export type SimpleSelectProps = {
    options: SelectOption[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    id?: string;
    menuPlacement?: 'auto' | 'up' | 'down';
    menuContainer?: HTMLElement | null;
    onChange: (value: string) => void;
    className?: string;
    ariaLabel?: string;
};

export function SimpleSelect(props: SimpleSelectProps) {
    const {
        options,
        value,
        placeholder = '请选择',
        disabled = false,
        id,
        menuPlacement = 'auto',
        menuContainer,
        onChange,
        className,
        ariaLabel,
    } = props;

    const [open, setOpen] = useState(false);
    const side = menuPlacement === 'up' ? 'top' : 'bottom';
    const selectedOption = options.find((opt) => opt.value === value);

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
            <PopoverPrimitive.Trigger
                id={id}
                type="button"
                role="combobox"
                aria-expanded={open}
                disabled={disabled}
                aria-label={ariaLabel}
                data-slot="select-trigger"
                className={cn(
                    "flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-3 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
                    className
                )}
            >
                <span data-slot="select-value" className="flex flex-1 text-left truncate">
                    {selectedOption ? selectedOption.label : <span className="text-muted-foreground">{placeholder}</span>}
                </span>
                <ChevronDownIcon className="size-4 text-muted-foreground pointer-events-none shrink-0" />
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal container={menuContainer}>
                <PopoverPrimitive.Positioner
                    side={side}
                    sideOffset={4}
                    align="start"
                    className="pointer-events-auto isolate z-[2200]"
                >
                    <PopoverPrimitive.Popup
                        data-slot="select-content"
                        className="pointer-events-auto relative isolate z-[2200] max-h-64 w-[var(--anchor-width)] min-w-36 overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 p-1"
                    >
                        <div role="listbox" className="space-y-0.5">
                            {options.map((option) => {
                                const isSelected = option.value === value;
                                return (
                                    <div
                                        key={option.value}
                                        role="option"
                                        aria-selected={isSelected}
                                        data-slot="select-item"
                                        className={cn(
                                            "relative flex w-full cursor-pointer items-center justify-between rounded-md py-1.5 px-2 text-sm outline-hidden select-none transition-colors hover:bg-accent hover:text-accent-foreground",
                                            isSelected && "bg-accent/50 font-medium text-accent-foreground"
                                        )}
                                        onClick={() => {
                                            onChange(option.value);
                                            setOpen(false);
                                        }}
                                    >
                                        <span className="truncate">{option.label}</span>
                                        {isSelected && <CheckIcon className="size-4 text-primary shrink-0 ml-2" />}
                                    </div>
                                );
                            })}
                        </div>
                    </PopoverPrimitive.Popup>
                </PopoverPrimitive.Positioner>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
