import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    NODE_PALETTE_EXPANDED_STORAGE_KEY,
    OfflineNodePalette,
} from './OfflineNodePalette';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe('OfflineNodePalette', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('exposes drag-only palette items and remembers collapse state', () => {
        render(<OfflineNodePalette disabled={false} />);

        expect(screen.getByLabelText('MySQL，拖到画布添加')).toBeTruthy();
        expect(screen.getByLabelText('PostgreSQL，拖到画布添加')).toBeTruthy();
        expect(screen.getByLabelText('ClickHouse，拖到画布添加')).toBeTruthy();
        expect(screen.getByLabelText('HiveSQL，拖到画布添加')).toBeTruthy();
        expect(screen.getByLabelText('Shell，拖到画布添加')).toBeTruthy();
        expect(screen.getByLabelText('Transfer，拖到画布添加')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '添加传输节点' })).toBeNull();

        const transfer = screen.getByLabelText('Transfer，拖到画布添加');
        const dataTransfer = {
            data: {} as Record<string, string>,
            setData(type: string, value: string) {
                this.data[type] = value;
            },
            getData(type: string) {
                return this.data[type] ?? '';
            },
            effectAllowed: 'uninitialized',
        };
        fireEvent.dragStart(transfer, { dataTransfer });
        expect(dataTransfer.getData('nodeKind')).toBe('TRANSFER');
        expect(dataTransfer.effectAllowed).toBe('copy');

        fireEvent.click(screen.getByRole('button', { name: '收起节点抽屉' }));
        expect(window.localStorage.getItem(NODE_PALETTE_EXPANDED_STORAGE_KEY)).toBe('false');
        expect(screen.queryByLabelText('Transfer，拖到画布添加')).toBeNull();

        const expand = screen.getByRole('button', { name: '展开节点抽屉' });
        expect(expand.closest('.offline-node-palette-header')).toBeTruthy();
        expect(expand.className).toContain('offline-node-palette-toggle');

        cleanup();
        render(<OfflineNodePalette disabled={false} />);
        expect(screen.getByRole('button', { name: '展开节点抽屉' })).toBeTruthy();
        expect(screen.queryByLabelText('Transfer，拖到画布添加')).toBeNull();
    });

    it('keeps the collapse control in the palette header and shows brand marks', () => {
        render(<OfflineNodePalette disabled={false} />);

        const collapse = screen.getByRole('button', { name: '收起节点抽屉' });
        expect(collapse.closest('.offline-node-palette-header')).toBeTruthy();
        expect(screen.getByTitle('MySQL')).toBeTruthy();
        expect(screen.getByTitle('PostgreSQL')).toBeTruthy();

        const hive = screen.getByTitle('HiveSQL');
        expect(hive.className).toContain('offline-node-kind-mask');

        const clickhouse = screen.getByTitle('ClickHouse').closest('svg');
        expect(clickhouse?.getAttribute('viewBox')).toBe('0 0 9 8');
        expect(clickhouse?.getAttribute('fill')).toBe('currentColor');
    });

    it('does not start a drag when the palette is disabled', () => {
        render(<OfflineNodePalette disabled />);

        const mysql = screen.getByLabelText('MySQL，拖到画布添加');
        const dataTransfer = {
            setData: vi.fn(),
            effectAllowed: 'uninitialized',
        };
        fireEvent.dragStart(mysql, { dataTransfer });
        expect(dataTransfer.setData).not.toHaveBeenCalled();
    });
});
