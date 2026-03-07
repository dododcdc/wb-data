import { Select, createListCollection } from '@ark-ui/react/select';
import { Portal } from '@ark-ui/react/portal';
import { ChevronDown, Check } from 'lucide-react';
import './DataSourceSelect.css';

interface Option {
    label: string;
    value: string;
}

type DataSourceSelectProps = {
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
} & (
        | { multiple: true; value: string[]; onChange: (value: string[]) => void }
        | { multiple?: false; value: string; onChange: (value: string) => void }
    );

export function DataSourceSelect(props: DataSourceSelectProps) {
    const { options, placeholder = 'Select...', disabled, multiple, value, onChange } = props;
    const collection = createListCollection({ items: options });

    const handleValueChange = (values: string[]) => {
        if (multiple) {
            (onChange as (v: string[]) => void)(values);
        } else {
            (onChange as (v: string) => void)(values[0] || '');
        }
    };

    const valueArray = Array.isArray(value) ? value : [value].filter(Boolean);
    const selectedOptions = options.filter(opt => valueArray.includes(opt.value));

    return (
        <Select.Root
            collection={collection}
            value={valueArray}
            onValueChange={(e) => handleValueChange(e.value)}
            multiple={multiple}
            disabled={disabled}
            className="ds-select-root"
            positioning={{ sameWidth: true, gutter: 4 }}
        >
            <Select.Control className="ds-select-control">
                <Select.Trigger className="ds-select-trigger">
                    <Select.ValueText placeholder={placeholder}>
                        {selectedOptions.length > 0 ? (
                            <div className="ds-select-value">
                                {selectedOptions.map(opt => (
                                    <span key={opt.value} className={`type-badge ${opt.value.toLowerCase()}`}>
                                        {opt.label}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </Select.ValueText>
                    <Select.Indicator className="ds-select-indicator">
                        <ChevronDown size={16} />
                    </Select.Indicator>
                </Select.Trigger>
            </Select.Control>
            <Portal>
                <Select.Positioner className="ds-select-positioner">
                    <Select.Content className="ds-select-content">
                        <Select.ItemGroup>
                            {options.map((item) => (
                                <Select.Item key={item.value} item={item} className="ds-select-item">
                                    <div className="ds-select-item-copy">
                                        <span className={`type-badge ${item.value.toLowerCase()}`}>{item.label}</span>
                                    </div>
                                    <Select.ItemIndicator className="ds-select-item-indicator">
                                        <Check size={16} />
                                    </Select.ItemIndicator>
                                </Select.Item>
                            ))}
                        </Select.ItemGroup>
                    </Select.Content>
                </Select.Positioner>
            </Portal>
            <Select.HiddenSelect />
        </Select.Root>
    );
}
