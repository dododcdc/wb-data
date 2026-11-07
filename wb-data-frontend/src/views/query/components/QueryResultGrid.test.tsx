import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../../api/query';
import { QueryResultGrid } from './QueryResultGrid';

const longText = 'abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz';
const result: QueryResult = {
    columns: [
        { name: 'id', type: 'INT', size: 11, nullable: false, remarks: '', primaryKey: true },
        { name: 'note', type: 'VARCHAR', size: 255, nullable: true, remarks: '', primaryKey: false },
    ],
    rows: [
        { id: 1, note: longText },
        { id: 2, note: null },
    ],
    executionTimeMs: 12,
    message: '',
    truncated: false,
    rowLimit: 1000,
};

describe('QueryResultGrid', () => {
    it('renders dynamic columns, types and values with full text available on hover', () => {
        const { container } = render(<QueryResultGrid result={result} />);

        expect(screen.getByRole('table', { name: 'SQL 查询结果' })).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'id INT' })).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'note VARCHAR' })).toBeTruthy();
        expect(screen.getByText('1')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByTitle(longText)).toBeTruthy();
        expect(container.querySelector('.wb-query-data-grid')).toBeTruthy();
        expect(container.querySelector('.wb-list-cell-truncate')).toBeTruthy();
        expect(container.querySelector('.wb-list-pagination')).toBeNull();
    });
});
