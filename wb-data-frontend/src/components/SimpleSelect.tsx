import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './SimpleSelect.css';

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
    onChange: (value: string) => void;
};

export function SimpleSelect(props: SimpleSelectProps) {
    const {
        options,
        value,
        placeholder = '请选择',
        disabled = false,
        id,
        onChange,
    } = props;

    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const selectedOption = useMemo(
        () => options.find((option) => option.value === value) ?? null,
        [options, value],
    );

    useEffect(() => {
        if (!open) {
            return;
        }

        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open]);

    return (
        <div
            ref={rootRef}
            className={`simple-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
        >
            <button
                id={id}
                type="button"
                className={`simple-select-trigger ${selectedOption ? '' : 'is-placeholder'}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            >
                <span className="simple-select-label">
                    {selectedOption?.label ?? placeholder}
                </span>
                <ChevronDown size={16} className="simple-select-icon" />
            </button>

            {open ? (
                <div className="simple-select-menu" role="listbox" aria-labelledby={id}>
                    {options.map((option) => {
                        const selected = option.value === value;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                className={`simple-select-option ${selected ? 'is-selected' : ''}`}
                                role="option"
                                aria-selected={selected}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                            >
                                <span>{option.label}</span>
                                {selected ? <Check size={16} /> : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
