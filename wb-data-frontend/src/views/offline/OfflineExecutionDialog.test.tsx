import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOfflineExecutionLogs } from '../../api/offline';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useAuthStore } from '../../utils/auth';
import { OfflineExecutionDialog } from './OfflineExecutionDialog';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        getOfflineExecutionLogs: vi.fn(),
    };
});

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: {
        data: unknown[];
        itemContent: (index: number, item: unknown) => React.ReactNode;
    }) => (
        <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>
    ),
}));

const getOfflineExecutionLogsMock = vi.mocked(getOfflineExecutionLogs);

const execution = {
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

const detail = {
    executionId: 'exec-1',
    mode: 'DEBUG',
    flowPath: '_flows/example/flow.yaml',
    requestedBy: 1,
    branch: 'feature/policy-review',
    sourceRevision: 'abc',
    status: 'SUCCESS',
    createdAt: '2026-09-13T04:48:06Z',
    startDate: '2026-09-13T04:48:06Z',
    endDate: '2026-09-13T04:48:06Z',
    taskRuns: [
        {
            taskId: 'sql_node_1',
            status: 'SUCCESS',
            startDate: '2026-09-13T04:48:06Z',
            endDate: '2026-09-13T04:48:06Z',
            durationMs: 109,
        },
    ],
    parameterResolutionStatus: 'NONE' as const,
    parameters: [],
};

function renderDialog(
    overrides: Partial<ComponentProps<typeof OfflineExecutionDialog>> = {},
) {
    return render(
        <TooltipProvider>
            <OfflineExecutionDialog
                open
                executions={[execution]}
                loading={false}
                detail={detail}
                detailLoading={false}
                activeExecutionId="exec-1"
                actionPending={null}
                requestedByFilter={null}
                currentUserId={1}
                onOpenChange={vi.fn()}
                onRefresh={vi.fn()}
                onSelectExecution={vi.fn()}
                onStopAll={vi.fn()}
                onRequestedByFilterChange={vi.fn()}
                {...overrides}
            />
        </TooltipProvider>,
    );
}

describe('OfflineExecutionDialog logs', () => {
    beforeEach(() => {
        useAuthStore.setState({
            token: 'token',
            userInfo: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
            systemAdmin: false,
            currentGroup: { id: 4, name: 'policy', description: '', role: 'DEVELOPER' },
            accessibleGroups: [{ id: 4, name: 'policy', description: '', role: 'DEVELOPER' }],
            permissions: ['offline.read'],
            contextLoaded: true,
        });
        getOfflineExecutionLogsMock.mockResolvedValue([
            {
                timestamp: '2026-09-13T04:48:06Z',
                taskId: 'sql_node_1',
                level: 'INFO',
                message: 'select 1 done',
            },
        ]);
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('opens task logs inside the dialog without a full-page loading screen', async () => {
        renderDialog();

        fireEvent.click(screen.getByRole('button', { name: '日志' }));

        expect(screen.queryByText('页面加载中')).toBeNull();
        expect(screen.getByRole('button', { name: '返回执行详情' })).toBeTruthy();
        expect(screen.queryByText('节点执行详情')).toBeNull();

        await waitFor(() => expect(screen.getByText('select 1 done')).toBeTruthy());
        expect(getOfflineExecutionLogsMock).toHaveBeenCalledWith(4, 'exec-1', 'sql_node_1');
    });

    it('returns to the execution detail when going back from logs', async () => {
        renderDialog();

        fireEvent.click(screen.getByRole('button', { name: '日志' }));
        await waitFor(() => expect(screen.getByText('select 1 done')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: '返回执行详情' }));

        expect(screen.getByText('节点执行详情')).toBeTruthy();
        expect(screen.queryByText('select 1 done')).toBeNull();
    });
});
