import { useState } from 'react';
import { Combobox, createListCollection } from '@ark-ui/react/combobox';
import { Portal } from '@ark-ui/react/portal';
import { ChevronDown, Check, Search } from 'lucide-react';
import './DataSourceSelect.css';

interface Option {
    label: string;
    value: string;
    type?: string;
}

type DataSourceSelectProps = {
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    onInputChange?: (value: string) => void;
    loading?: boolean;
    theme?: 'light' | 'dark';
} & (
        | { multiple: true; value: string[]; onChange: (value: string[]) => void }
        | { multiple?: false; value: string; onChange: (value: string) => void }
    );

export function DataSourceSelect(props: DataSourceSelectProps) {
    const { options, placeholder = 'Search...', disabled, multiple, value, onChange, onInputChange, loading, theme = 'light' } = props;
    const [isComposing, setIsComposing] = useState(false);

    const collection = createListCollection({
        items: options,
        itemToString: (item) => item.label,
        itemToValue: (item) => item.value,
    });

    const handleValueChange = (values: string[]) => {
        if (multiple) {
            (onChange as (v: string[]) => void)(values);
        } else {
            (onChange as (v: string) => void)(values[0] || '');
        }
    };

    const valueArray = Array.isArray(value) ? value : [value].filter(Boolean);

    return (
        <Combobox.Root
            collection={collection}
            value={valueArray}
            onValueChange={(e) => handleValueChange(e.value)}
            onInputValueChange={(e) => {
                // Only trigger search if not composing (IME)
                if (!isComposing) {
                    onInputChange?.(e.inputValue);
                }
            }}
            multiple={multiple}
            disabled={disabled}
            className={`ds-select-root ${theme === 'dark' ? 'ds-dark' : ''}`}
            positioning={{ sameWidth: true, gutter: 4 }}
            openOnClick
        >
            <Combobox.Control className="ds-select-control">
                <div className="ds-combobox-input-wrapper">
                    <Search className="ds-search-icon" size={14} />
                    <Combobox.Input
                        className="ds-select-trigger ds-combobox-input"
                        placeholder={placeholder}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={(e) => {
                            setIsComposing(false);
                            // Explicitly trigger search with the final composed value
                            onInputChange?.(e.currentTarget.value);
                        }}
                    />
                    <Combobox.Trigger className="ds-combobox-toggle">
                        <ChevronDown size={14} />
                    </Combobox.Trigger>
                </div>
            </Combobox.Control>
            <Portal>
                <Combobox.Positioner className="ds-select-positioner">
                    <Combobox.Content className={`ds-select-content ${theme === 'dark' ? 'ds-dark' : ''}`}>
                        {loading ? (
                            <div className="ds-select-loading">加载中...</div>
                        ) : options.length === 0 ? (
                            <div className="ds-select-empty">未找到匹配项</div>
                        ) : (
                            <Combobox.ItemGroup>
                                {options.map((item) => (
                                    <Combobox.Item key={item.value} item={item} className="ds-select-item">
                                        <div className="ds-select-item-copy">
                                            <span className={item.type ? `type-badge ${item.type.toLowerCase()}` : 'ds-select-label-plain'}>
                                                {item.label}
                                            </span>
                                        </div>
                                        <Combobox.ItemIndicator className="ds-select-item-indicator">
                                            <Check size={14} />
                                        </Combobox.ItemIndicator>
                                    </Combobox.Item>
                                ))}
                            </Combobox.ItemGroup>
                        )}
                    </Combobox.Content>
                </Combobox.Positioner>
            </Portal>
        </Combobox.Root>
    );
}
