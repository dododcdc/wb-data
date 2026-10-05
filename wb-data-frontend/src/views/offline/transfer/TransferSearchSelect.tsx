import { useMemo } from 'react';

import {
    SearchAutocomplete,
    type SearchAutocompleteOption,
} from '../../../components/ui/search-autocomplete';

export interface TransferSearchSelectProps {
    ariaLabel: string;
    value: string;
    options: SearchAutocompleteOption[];
    placeholder: string;
    disabled?: boolean;
    loading?: boolean;
    loadingMore?: boolean;
    hasMore?: boolean;
    emptyText?: string;
    virtualize?: boolean;
    menuContainer?: HTMLElement | null;
    contentClassName?: string;
    onChange: (value: string) => void;
    onSearch?: (keyword: string) => void;
    onLoadMore?: () => void;
}

export function TransferSearchSelect({
    ariaLabel,
    value,
    options,
    placeholder,
    disabled,
    loading,
    loadingMore,
    hasMore,
    emptyText,
    virtualize,
    menuContainer,
    contentClassName,
    onChange,
    onSearch,
    onLoadMore,
}: TransferSearchSelectProps) {
    const selectedOption = useMemo(
        () => options.find((option) => option.value === value)
            ?? (value ? { label: value, value } : null),
        [options, value],
    );

    return (
        <SearchAutocomplete
            ariaLabel={ariaLabel}
            className="transfer-node-search-select"
            contentClassName={contentClassName}
            options={options}
            value={value || undefined}
            selectedOption={selectedOption}
            placeholder={placeholder}
            clearInputOnOpen
            disabled={disabled}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            emptyText={emptyText}
            virtualize={virtualize}
            virtualItemSize={32}
            menuContainer={menuContainer}
            onChange={(nextValue) => {
                onSearch?.('');
                onChange(nextValue);
            }}
            onInputChange={onSearch}
            onLoadMore={onLoadMore}
            onOpenChange={(open) => {
                if (!open) onSearch?.('');
            }}
        />
    );
}
