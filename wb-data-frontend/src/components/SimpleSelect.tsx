import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
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
        onChange,
        className,
    } = props;

    // Map menuPlacement to SelectContent side
    const side = menuPlacement === 'auto' ? 'bottom' : menuPlacement;

    return (
        <Select 
            value={value} 
            onValueChange={onChange} 
            disabled={disabled}
        >
            <SelectTrigger 
                id={id} 
                className={className}
            >
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent side={side} align="start">
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
