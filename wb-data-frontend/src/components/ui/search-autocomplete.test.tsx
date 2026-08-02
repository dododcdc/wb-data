import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchAutocomplete } from './search-autocomplete';

const OPTIONS = [
    { label: 'mysql_source (MYSQL)', value: 'mysql' },
    { label: 'hive_target (HIVE)', value: 'hive' },
    { label: 'postgres_archive (POSTGRESQL)', value: 'postgres' },
];

afterEach(() => {
    cleanup();
});

describe('SearchAutocomplete', () => {
    it('filters the visible options while preserving the external search callback', async () => {
        const handleInputChange = vi.fn();

        render(
            <SearchAutocomplete
                options={OPTIONS}
                value="mysql"
                ariaLabel="选择数据源"
                onInputChange={handleInputChange}
            />,
        );

        const input = screen.getByRole('combobox', { name: '选择数据源' });
        fireEvent.click(screen.getByRole('button'));
        fireEvent.change(input, { target: { value: 'hive_target' } });

        expect(await screen.findByRole('option', { name: 'hive_target (HIVE)' })).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'postgres_archive (POSTGRESQL)' })).toBeNull();
        expect(handleInputChange).toHaveBeenLastCalledWith('hive_target');
    });

    it('visually highlights an option under the pointer', async () => {
        render(
            <SearchAutocomplete
                options={OPTIONS}
                value="mysql"
                ariaLabel="选择数据源"
            />,
        );

        fireEvent.click(screen.getByRole('button'));
        const option = await screen.findByRole('option', { name: 'hive_target (HIVE)' });
        fireEvent.mouseMove(option);

        expect(option.hasAttribute('data-highlighted')).toBe(true);
        expect(option.className).toContain('data-[highlighted]:bg-accent');
        expect(option.className).toContain('hover:bg-accent');
    });

    it('uses the trigger as the only search field and clears it when opened', async () => {
        const handleInputChange = vi.fn();

        render(
            <SearchAutocomplete
                options={OPTIONS}
                value="mysql"
                ariaLabel="选择数据源"
                clearInputOnOpen
                onInputChange={handleInputChange}
            />,
        );

        const selectedValue = screen.getByRole('combobox', { name: '选择数据源' });
        expect(selectedValue).toHaveProperty('value', 'mysql_source (MYSQL)');

        fireEvent.click(screen.getByRole('button'));
        expect(selectedValue).toHaveProperty('value', '');
        expect(screen.queryByRole('searchbox')).toBeNull();

        fireEvent.change(selectedValue, { target: { value: 'hive_target' } });

        expect(selectedValue).toHaveProperty('value', 'hive_target');
        expect(await screen.findByRole('option', { name: 'hive_target (HIVE)' })).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'postgres_archive (POSTGRESQL)' })).toBeNull();
        expect(handleInputChange).toHaveBeenLastCalledWith('hive_target');
    });

    it('restores the selected value when closed without choosing an option', async () => {
        render(
            <SearchAutocomplete
                options={OPTIONS}
                value="mysql"
                ariaLabel="选择数据源"
                clearInputOnOpen
            />,
        );

        const selectedValue = screen.getByRole('combobox', { name: '选择数据源' });
        fireEvent.click(screen.getByRole('button'));
        fireEvent.change(selectedValue, { target: { value: 'hive' } });
        fireEvent.keyDown(selectedValue, { key: 'Escape' });

        expect(selectedValue).toHaveProperty('value', 'mysql_source (MYSQL)');
    });
});
