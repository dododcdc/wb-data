import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOfflineRepoStatus } from '../../api/offline';
import { listOperationsExecutions, rerunOperationsExecution } from '../../api/operations';
import { formatLocalDateTime } from '../../lib/dateTime';
import { useAuthStore } from '../../utils/auth';
import OperationsCenter from './OperationsCenter';
import * as SimpleSelectModule from '../../components/SimpleSelect';

const { showFeedback } = vi.hoisted(() => ({
    showFeedback: vi.fn(),
}));

vi.mock('../../api/offline', () => ({
    getOfflineRepoStatus: vi.fn(),
}));

vi.mock('../../api/operations', () => ({
    listOperationsExecutions: vi.fn(),
    rerunOperationsExecution: vi.fn(),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({ showFeedback }),
}));

vi.mock('../../components/TimeRangePicker', () => ({
    TimeRangePicker: ({
        from,
        to,
        onChange,
    }: {
        from: string;
        to: string;
        onChange: (from: string, to: string) => void;
    }) => (
        <div data-testid="mock-time-range-picker">
            <span data-testid="range-from">{from}</span>
            <span data-testid="range-to">{to}</span>
            <button
                type="button"
                onClick={() => onChange('2026-06-07 01:00:15', '2026-06-07 02:00:45')}
            >
                应用测试时间范围
            </button>
        </div>
    ),
}));


const listOperationsExecutionsMock = vi.mocked(listOperationsExecutions);
const rerunOperationsExecutionMock = vi.mocked(rerunOperationsExecution);
const getOfflineRepoStatusMock = vi.mocked(getOfflineRepoStatus);

describe('OperationsCenter', () => {
    beforeEach(() => {
        vi.spyOn(SimpleSelectModule, 'SimpleSelect').mockImplementation(
            ({ value, options, onChange, id, className }: { value?: string; options: { label: string; value: string }[]; onChange: (val: string) => void; id?: string; className?: string }) => (
                <select
                    data-testid={id || 'simple-select'}
                    className={className}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            )
        );
        useAuthStore.setState({
            token: 'token',
            userInfo: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
            systemAdmin: false,
            currentGroup: { id: 4, name: 'policy', description: '', role: 'DEVELOPER' },
            accessibleGroups: [{ id: 4, name: 'policy', description: '', role: 'DEVELOPER' }],
            permissions: ['offline.read', 'offline.write'],
            contextLoaded: true,
        });
        getOfflineRepoStatusMock.mockResolvedValue({
            groupId: 4,
            repoPath: '/tmp/wb-data-4',
            exists: true,
            gitInitialized: true,
            dirty: false,
            ahead: false,
            hasRemote: true,
            hasUpstream: true,
            branch: 'feature/policy-review',
            headCommitId: 'abc',
            headCommitMessage: 'init',
            headCommitAt: null,
        });
        listOperationsExecutionsMock.mockResolvedValue({
            branches: ['feature/policy-review', 'main'],
            selectedBranch: 'feature/policy-review',
            from: '2026-06-06T02:00:00Z',
            to: '2026-06-07T02:00:00Z',
            executions: [
                {
                    id: 'exec-1',
                    namespace: 'g4-feature-policy-review',
                    flowId: 'daily_policy',
                    branch: 'feature/policy-review',
                    status: 'FAILED',
                    createdAt: '2026-06-07T01:00:00Z',
                    startDate: '2026-06-07T01:00:02Z',
                    endDate: '2026-06-07T01:03:12Z',
                    durationMs: 190000,
                    failureSummary: 'load_policy failed',
                    rerunnable: true,
                },
                {
                    id: 'exec-2',
                    namespace: 'g4-feature-policy-review',
                    flowId: 'hourly_policy',
                    branch: 'feature/policy-review',
                    status: 'SUCCESS',
                    createdAt: '2026-06-07T00:00:00Z',
                    startDate: '2026-06-07T00:00:01Z',
                    endDate: '2026-06-07T00:01:01Z',
                    durationMs: 60000,
                    failureSummary: null,
                    rerunnable: false,
                },
            ],
        });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    function renderPage() {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <OperationsCenter />
                </MemoryRouter>
            </QueryClientProvider>
        );
    }

    it('loads current branch and renders formal executions', async () => {
        renderPage();

        expect(await screen.findByText('daily_policy')).toBeTruthy();
        expect(screen.getAllByText('feature/policy-review').length).toBeGreaterThan(0);
        expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
        expect(screen.getByText('load_policy failed')).toBeTruthy();
        expect(screen.getByRole('button', { name: '重跑 daily_policy' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '重跑 hourly_policy' })).toBeNull();
        expect(screen.getByText(formatLocalDateTime(new Date('2026-06-07T01:00:00Z')))).toBeTruthy();
        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenCalledWith(
            expect.objectContaining({ groupId: 4, branch: 'feature/policy-review' })
        ));
    });

    it('reruns failed execution and refreshes list', async () => {
        rerunOperationsExecutionMock.mockResolvedValue({
            originalExecutionId: 'exec-1',
            newExecutionId: 'exec-3',
            namespace: 'g4-feature-policy-review',
            flowId: 'daily_policy',
            status: 'CREATED',
            createdAt: '2026-06-07T02:00:00Z',
        });
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '重跑 daily_policy' }));

        await waitFor(() => expect(rerunOperationsExecutionMock).toHaveBeenCalledWith(4, 'exec-1'));
        await waitFor(() => expect(listOperationsExecutionsMock).toHaveBeenCalledTimes(2));
    });

    it('renders distinct status option labels to avoid duplicates', async () => {
        renderPage();
        const statusSelect = await screen.findByTestId('status-select') as HTMLSelectElement;
        const options = Array.from(statusSelect.options).map(opt => opt.text);
        expect(options).toContain('已创建');
        expect(options).toContain('排队中');
        expect(options.filter(o => o === '就绪').length).toBe(0);
    });

    it('queries only with the applied second-precision range', async () => {
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '应用测试时间范围' }));

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date('2026-06-07T01:00:15').toISOString(),
                    to: new Date('2026-06-07T02:00:45').toISOString(),
                })
            );
        });
    });

    it('initializes an explicit browser-local last-24-hours range', async () => {
        const now = new Date(2026, 5, 20, 12, 0, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now.getTime());

        renderPage();

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
                    to: now.toISOString(),
                })
            );
        });
    });

    it('resets an applied custom range to the browser-local last 24 hours', async () => {
        const now = new Date(2026, 5, 20, 12, 0, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: '应用测试时间范围' }));
        await waitFor(() => expect(screen.getByTestId('range-from').textContent).toBe('2026-06-07 01:00:15'));

        fireEvent.click(screen.getByRole('button', { name: '重置' }));

        expect(screen.getByTestId('range-from').textContent)
            .toBe(formatLocalDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
        expect(screen.getByTestId('range-to').textContent).toBe(formatLocalDateTime(now));
    });
});
