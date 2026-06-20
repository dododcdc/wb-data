import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOfflineRepoStatus } from '../../api/offline';
import { listOperationsExecutions, rerunOperationsExecution } from '../../api/operations';
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

    it('applies a second-precision range with time segment controls', async () => {
        renderPage();

        // 1. Time range defaults to 24h, custom start/end fields are hidden
        expect(screen.queryByLabelText('开始于')).toBeNull();
        expect(screen.queryByLabelText('结束于')).toBeNull();

        // 2. Change time range to Custom Time
        const rangeSelect = await screen.findByTestId('time-range-select') as HTMLSelectElement;
        fireEvent.change(rangeSelect, { target: { value: 'custom' } });

        // 3. Custom inputs should be rendered with step="1"
        const startInput = screen.getByLabelText('开始于') as HTMLInputElement;
        const endInput = screen.getByLabelText('结束于') as HTMLInputElement;
        expect(startInput.getAttribute('step')).toBe('1');
        expect(endInput.getAttribute('step')).toBe('1');

        // 4. Fill custom inputs with second-precision dates
        fireEvent.change(startInput, { target: { value: '2026-06-07T01:00:15' } });
        fireEvent.change(endInput, { target: { value: '2026-06-07T02:00:45' } });

        // 5. Verify the API is called with custom time range in ISO format
        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date('2026-06-07T01:00:15').toISOString(),
                    to: new Date('2026-06-07T02:00:45').toISOString(),
                })
            );
        });
    });

    it('calculates the 7-day range when 7d option is selected', async () => {
        const mockNow = new Date('2026-06-20T12:00:00Z').getTime();
        vi.spyOn(Date, 'now').mockReturnValue(mockNow);

        renderPage();

        const rangeSelect = await screen.findByTestId('time-range-select') as HTMLSelectElement;
        fireEvent.change(rangeSelect, { target: { value: '7d' } });

        await waitFor(() => {
            expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    from: new Date(mockNow - 7 * 24 * 60 * 60 * 1000).toISOString(),
                    to: new Date(mockNow).toISOString(),
                })
            );
        });
    });

    it('clears all custom filters and resets time range on clear button click', async () => {
        renderPage();

        const rangeSelect = await screen.findByTestId('time-range-select') as HTMLSelectElement;
        fireEvent.change(rangeSelect, { target: { value: 'custom' } });

        const startInput = screen.getByLabelText('开始于') as HTMLInputElement;
        fireEvent.change(startInput, { target: { value: '2026-06-07T01:00:00' } });

        const clearBtn = screen.getByRole('button', { name: '清空' });
        fireEvent.click(clearBtn);

        expect(rangeSelect.value).toBe('24h');
        expect(screen.queryByLabelText('开始于')).toBeNull();
    });
});
