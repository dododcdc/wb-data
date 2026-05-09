import { useState } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from './ui/select';

type SelectOption = {
    label: string;
    value: string;
};

type SimpleSelectProps = {
    options: SelectOption[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    id?: string;
    menuPlacement?: 'auto' | 'up' | 'down';
    menuContainer?: HTMLElement | null;
    onChange: (value: string) => void;
    className?: string;
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
    } = props;

    const [open, setOpen] = useState(false);
    const side = menuPlacement === 'up' ? 'top' : 'bottom';

    const selectedOption = options.find((opt) => opt.value === value);

    return (
        <Select
            value={value}
            onValueChange={(nextValue) => {
                if (nextValue) {
                    onChange(nextValue);
                }
            }}
            open={open}
            onOpenChange={setOpen}
            disabled={disabled}
        >
            <SelectTrigger
                id={id}
                className={className}
            >
                <span data-slot="select-value" className="flex flex-1 text-left truncate">
                    {selectedOption ? selectedOption.label : <span className="text-muted-foreground">{placeholder}</span>}
                </span>
            </SelectTrigger>
            <SelectContent side={side} align="start" container={menuContainer}>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
