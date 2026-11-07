import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { OfflineExecutionList } from './OfflineExecutionDialog';

afterEach(cleanup);

const execution: ComponentProps<typeof OfflineExecutionList>['executions'][number] = {
    executionId: 'exec-1',
    flowPath: '_flows/example/flow.yaml',
    displayName: 'debug-1',
    requestedBy: 1,
    mode: 'DEBUG',
    status: 'SUCCESS',
    triggerType: 'MANUAL',
    startDate: '2026-09-13T04:48:06Z',
    endDate: '2026-09-13T04:48:06Z',
    durationMs: 109,
    sourceRevision: 'abc',
};

function renderList(overrides: Partial<ComponentProps<typeof OfflineExecutionList>> = {}) {
    const props: ComponentProps<typeof OfflineExecutionList> = {
        executions: [execution],
        listBusy: false,
        activeExecutionId: 'exec-1',
        onSelectExecution: vi.fn(),
        ...overrides,
    };
    const view = render(<OfflineExecutionList {...props} />);
    return { props, ...view };
}

describe('OfflineExecutionList', () => {
    it('shows status text and selects a record', () => {
        const { props } = renderList();

        expect(screen.getByText('debug-1')).toBeTruthy();
        expect(screen.getByText('成功')).toBeTruthy();
        const row = screen.getByText('debug-1').closest('button');
        expect(row?.getAttribute('aria-pressed')).toBe('true');
        if (row) fireEvent.click(row);
        expect(props.onSelectExecution).toHaveBeenCalledWith('exec-1');
    });

    it('shows the shared loading shell for initial loading', () => {
        const { container } = renderList({ executions: [], listBusy: true });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(container.querySelector('.offline-execution-skeleton')).toBeTruthy();
    });

    it('keeps old records visible during refresh', () => {
        const { container } = renderList({ listBusy: true });

        expect(screen.getByText('debug-1')).toBeTruthy();
        expect(container.querySelector('.offline-execution-list-shell.is-refreshing')).toBeTruthy();
        expect(container.querySelector('.offline-execution-skeleton')).toBeNull();
    });
});
