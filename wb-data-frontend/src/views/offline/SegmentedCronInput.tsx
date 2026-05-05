import React, { useRef } from 'react';

interface SegmentedCronInputProps {
    value: string; // "0 2 * * *"
    onChange: (newValue: string) => void;
}

const LABELS = ['分', '时', '日', '月', '周'];

export const SegmentedCronInput: React.FC<SegmentedCronInputProps> = ({ value, onChange }) => {
    const parts = value.split(/\s+/).filter(Boolean);
    // Ensure we have exactly 5 parts
    while (parts.length < 5) parts.push('*');
    if (parts.length > 5) parts.splice(5);

    const inputRefs = [
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
    ];

    const handleInputChange = (index: number, val: string) => {
        const newParts = [...parts];
        // If user enters a number or *, then auto-focus next if it's a "complete" part
        // Simple heuristic: if length reaches 2 or it's a single digit followed by space (though space is hard to detect in some inputs)
        newParts[index] = val || '*';
        onChange(newParts.join(' '));

        // Auto focus next
        if (val.length >= 2 && index < 4) {
            inputRefs[index + 1].current?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !parts[index] && index > 0) {
            inputRefs[index - 1].current?.focus();
        }
    };

    return (
        <div className="offline-segmented-cron">
            {parts.map((part, i) => (
                <div key={i} className="offline-segmented-cron-unit">
                    <input
                        ref={inputRefs[i]}
                        type="text"
                        value={part === '*' ? '' : part}
                        placeholder="*"
                        onChange={(e) => handleInputChange(i, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(i, e)}
                        className="offline-segmented-cron-input"
                    />
                    <span className="offline-segmented-cron-label">{LABELS[i]}</span>
                </div>
            ))}
        </div>
    );
};
