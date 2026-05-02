import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';

export interface DataSourceOption extends SearchSelectOption {
    type?: string;
}

type DataSourceSelectProps = {
    options: DataSourceOption[];
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string, option: DataSourceOption | null) => void;
    onInputChange?: (value: string) => void;
    loading?: boolean;
    loadingMore?: boolean;
    value?: string;
    selectedOption?: DataSourceOption | null;
    hasMore?: boolean;
    onLoadMore?: () => void;
    onOpenChange?: (open: boolean) => void;
    virtualize?: boolean;
    theme?: 'light' | 'dark';
};

export function DataSourceSelect(props: DataSourceSelectProps) {
    return (
        <SearchSelect<DataSourceOption>
            {...props}
            renderItem={(item) => (
                <div className="flex items-center gap-2 overflow-hidden">
                    {item.type && (
                        <span className={`type-badge ${item.type.toLowerCase()} shrink-0`}>
                            {item.type.toUpperCase()}
                        </span>
                    )}
                    <span className="truncate">{item.label}</span>
                </div>
            )}
        />
    );
}
