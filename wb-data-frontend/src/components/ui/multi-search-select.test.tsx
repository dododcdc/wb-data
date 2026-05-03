import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';

import { MultiSearchSelect } from './multi-search-select';
import type { SearchSelectOption } from './search-select';

const OPTIONS: SearchSelectOption[] = [
    { label: 'dev_alpha', value: '2' },
    { label: 'ga_alpha', value: '3' },
];

function ControlledMultiSearchSelect(props: {
    onChange?: (values: string[], options: SearchSelectOption[]) => void;
}) {
    const { onChange } = props;
    const [keyword, setKeyword] = useState('');
    const [values, setValues] = useState<string[]>([]);
    const [selectedOptions, setSelectedOptions] = useState<SearchSelectOption[]>([]);
    const visibleOptions = useMemo(
        () => OPTIONS.filter((option) => option.label.toLowerCase().includes(keyword.trim().toLowerCase())),
        [keyword],
    );

    return (
        <MultiSearchSelect
            options={visibleOptions}
            values={values}
            selectedOptions={selectedOptions}
            placeholder="搜索用户名"
            onInputChange={setKeyword}
            onChange={(nextValues, nextOptions) => {
                setValues(nextValues);
                setSelectedOptions(nextOptions);
                onChange?.(nextValues, nextOptions);
            }}
        />
    );
}

describe('MultiSearchSelect', () => {
    it('adds multiple users, supports remove-one, and clears all selections', async () => {
        const handleChange = vi.fn();

        render(<ControlledMultiSearchSelect onChange={handleChange} />);

        const input = screen.getByPlaceholderText('搜索用户名');

        fireEvent.click(input);
        fireEvent.change(input, { target: { value: 'dev' } });
        fireEvent.click(await screen.findByRole('option', { name: 'dev_alpha' }));

        expect(handleChange).toHaveBeenLastCalledWith(['2'], [{ label: 'dev_alpha', value: '2' }]);
        expect(screen.getByText('dev_alpha')).toBeTruthy();

        fireEvent.change(input, { target: { value: 'ga' } });
        expect(screen.getByText('dev_alpha')).toBeTruthy();
        fireEvent.click(await screen.findByRole('option', { name: 'ga_alpha' }));

        expect(handleChange).toHaveBeenLastCalledWith(
            ['2', '3'],
            [
                { label: 'dev_alpha', value: '2' },
                { label: 'ga_alpha', value: '3' },
            ],
        );
        expect(screen.getByRole('button', { name: '移除 ga_alpha', hidden: true })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '移除 dev_alpha', hidden: true }));
        expect(handleChange).toHaveBeenLastCalledWith(['3'], [{ label: 'ga_alpha', value: '3' }]);

        fireEvent.click(screen.getByRole('button', { name: '清空全部已选成员', hidden: true }));
        expect(handleChange).toHaveBeenLastCalledWith([], []);
        expect(screen.queryByRole('button', { name: '移除 ga_alpha', hidden: true })).toBeNull();
    });
});
