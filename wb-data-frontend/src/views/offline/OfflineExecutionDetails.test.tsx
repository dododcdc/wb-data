import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { OfflineExecutionParameters, OfflineExecutionTaskTable } from './OfflineExecutionDialog';

afterEach(cleanup);

const parameters: ComponentProps<typeof OfflineExecutionParameters>['parameters'] = [
    { key: 'bizDate', dataType: 'STRING', value: '20260913', source: 'MANUAL_OVERRIDE' },
    { key: 'empty', dataType: 'STRING', value: '', source: 'CONSTANT' },
    { key: 'missing', dataType: 'STRING', value: null, source: 'CONSTANT' },
];

const successTask: ComponentProps<typeof OfflineExecutionTaskTable>['tasks'][number] = {
    taskId: 'sql_node_1',
    status: 'SUCCESS',
    startDate: '2026-09-13T04:48:06Z',
    endDate: '2026-09-13T04:48:06.109Z',
    durationMs: 109,
};

describe('OfflineExecutionParameters', () => {
    it('preserves raw values and source labels', () => {
        render(<OfflineExecutionParameters parameters={parameters} />);

        expect(screen.getByRole('table', { name: '执行参数快照' })).toBeTruthy();
        expect(screen.getByText(':bizDate')).toBeTruthy();
        expect(screen.getByText('20260913')).toBeTruthy();
        expect(screen.getByText('手动覆盖')).toBeTruthy();
        expect(screen.getByText('""')).toBeTruthy();
        expect(screen.getByText('—')).toBeTruthy();
        expect(screen.getAllByText('固定值')).toHaveLength(2);
    });
});

describe('OfflineExecutionTaskTable', () => {
    it('shows node metrics and opens logs', () => {
        const onOpenLogs = vi.fn();
        render(<TooltipProvider><OfflineExecutionTaskTable tasks={[successTask]} onOpenLogs={onOpenLogs} /></TooltipProvider>);

        expect(screen.getByRole('table', { name: '节点执行表' })).toBeTruthy();
        expect(screen.getAllByRole('columnheader')).toHaveLength(7);
        expect(screen.getByText('sql_node_1')).toBeTruthy();
        expect(screen.getByText('109ms')).toBeTruthy();
        expect(screen.getByText('100%')).toBeTruthy();
        expect(screen.getByText('成功')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '日志' }));
        expect(onOpenLogs).toHaveBeenCalledWith('sql_node_1');
    });

    it('keeps running progress visible', () => {
        const { container } = render(
            <TooltipProvider>
                <OfflineExecutionTaskTable
                    tasks={[{ ...successTask, status: 'RUNNING', endDate: null }]}
                    onOpenLogs={vi.fn()}
                />
            </TooltipProvider>,
        );

        expect(screen.getByText('执行中')).toBeTruthy();
        expect(container.querySelector('.progress-bar-inner.is-running')).toBeTruthy();
    });
});
