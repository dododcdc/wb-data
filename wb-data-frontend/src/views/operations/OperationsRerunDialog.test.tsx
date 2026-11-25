import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
    getOperationsExecution,
    getOperationsExecutionRerunContext,
    type OperationsExecutionDetail,
    type OperationsExecutionRerunContext,
} from '../../api/operations';
import { OperationsRerunDialog } from './OperationsRerunDialog';

vi.mock('../../api/operations', () => ({
    getOperationsExecution: vi.fn(),
    getOperationsExecutionRerunContext: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ReactFlow: ({
        nodes,
        nodeTypes,
    }: {
        nodes: Array<{ id: string; type?: string; style?: React.CSSProperties; data: Record<string, unknown> }>;
        nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
    }) => (
        <div data-testid="mock-reactflow">
            {nodes.map((node) => {
                const Renderer = node.type ? nodeTypes?.[node.type] : undefined;
                return (
                    <div key={node.id} data-testid={`rf-node-${node.id}`} style={node.style}>
                        {Renderer ? <Renderer data={node.data} /> : node.id}
                    </div>
                );
            })}
        </div>
    ),
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    BackgroundVariant: { Dots: 'dots' },
    Background: () => null,
    Controls: () => null,
    useNodesInitialized: () => true,
    useReactFlow: () => ({ fitView: vi.fn(() => Promise.resolve(true)) }),
}));

const getOperationsExecutionMock = vi.mocked(getOperationsExecution);
const getOperationsExecutionRerunContextMock = vi.mocked(getOperationsExecutionRerunContext);

function detailFixture(overrides: Partial<OperationsExecutionDetail> = {}): OperationsExecutionDetail {
    return {
        id: 'exec-1',
        namespace: 'g4-main',
        flowId: 'daily_etl',
        branch: 'main',
        status: 'FAILED',
        plannedAt: '2026-06-07T00:00:00Z',
        createdAt: '2026-06-07T01:00:00Z',
        startDate: '2026-06-07T01:00:02Z',
        endDate: '2026-06-07T01:03:00Z',
        durationMs: 178000,
        rerunnable: true,
        taskRuns: [],
        inputs: {},
        labels: {},
        parameterResolutionStatus: 'NONE',
        parameters: [],
        ...overrides,
    };
}

function contextFixture(overrides: Partial<OperationsExecutionRerunContext> = {}): OperationsExecutionRerunContext {
    return {
        executionId: 'exec-1',
        namespace: 'g4-main',
        flowId: 'daily_etl',
        partialRerunSupported: true,
        graphChanged: false,
        fallbackReason: null,
        nodes: [
            { taskId: 'extract', kind: 'MYSQL', dataSourceType: 'MYSQL', executionStatus: 'SUCCESS' },
            { taskId: 'stage', kind: 'SHELL', dataSourceType: null, executionStatus: 'SUCCESS' },
            { taskId: 'transform', kind: 'HIVE_SQL', dataSourceType: 'HIVE', executionStatus: 'FAILED' },
            { taskId: 'load', kind: 'TRANSFER', dataSourceType: null, executionStatus: 'NOT_RUN' },
        ],
        edges: [
            { source: 'extract', target: 'stage' },
            { source: 'stage', target: 'transform' },
            { source: 'transform', target: 'load' },
        ],
        defaultSelectedTaskIds: ['transform', 'load'],
        requiredTaskIds: ['transform', 'load'],
        ...overrides,
    };
}

function renderDialog(
    detail: OperationsExecutionDetail | null = detailFixture(),
    onConfirm = vi.fn(),
) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    render(
        <QueryClientProvider client={queryClient}>
            <OperationsRerunDialog
                open
                groupId={4}
                executionId="exec-1"
                detail={detail}
                pending={false}
                onOpenChange={vi.fn()}
                onConfirm={onConfirm}
            />
        </QueryClientProvider>
    );
    return { onConfirm };
}

describe('OperationsRerunDialog', () => {
    beforeEach(() => {
        getOperationsExecutionMock.mockResolvedValue(detailFixture());
        getOperationsExecutionRerunContextMock.mockResolvedValue(contextFixture());
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('defaults to required failed/not-run downstream closure, cascades upstream selection, and submits partial payload', async () => {
        const { onConfirm } = renderDialog();

        const extractCheckbox = await screen.findByRole('checkbox', { name: /extract/ });
        const stageCheckbox = screen.getByRole('checkbox', { name: /stage/ });
        const transformCheckbox = screen.getByRole('checkbox', { name: /transform/ });
        const loadCheckbox = screen.getByRole('checkbox', { name: /load/ });

        expect(screen.getByTestId('rf-node-extract').style.pointerEvents).toBe('all');
        expect(extractCheckbox.className).toContain('nodrag');
        expect(extractCheckbox.className).toContain('nopan');

        await waitFor(() => expect(transformCheckbox.getAttribute('aria-checked')).toBe('true'));
        expect(extractCheckbox.getAttribute('aria-checked')).toBe('false');
        expect(stageCheckbox.getAttribute('aria-checked')).toBe('false');
        expect(transformCheckbox.getAttribute('aria-disabled')).toBe('true');
        expect(loadCheckbox.getAttribute('aria-checked')).toBe('true');
        expect(loadCheckbox.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('已选 2 / 4 个节点')).toBeTruthy();
        expect(screen.getByText('将执行 2 个节点，跳过 2 个节点')).toBeTruthy();

        // Clicking a required node shows lock notice and preserves selection
        fireEvent.click(transformCheckbox);
        expect(screen.getByText('节点「transform」为失败/未执行节点或其下游，必须包含在本次重跑中。')).toBeTruthy();
        expect(transformCheckbox.getAttribute('aria-checked')).toBe('true');

        // Selecting earliest upstream node automatically fills intermediate gap node `stage`
        fireEvent.click(extractCheckbox);
        expect(extractCheckbox.getAttribute('aria-checked')).toBe('true');
        expect(stageCheckbox.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByText('为避免数据断层，已自动联动勾选路径节点：stage')).toBeTruthy();
        expect(screen.getByText('已选 4 / 4 个节点')).toBeTruthy();
        expect(screen.getByText('全量重跑')).toBeTruthy();

        // When all 4 nodes are selected, omit selectedTaskIds to run full execution
        fireEvent.click(screen.getByRole('button', { name: '确认重跑' }));
        expect(onConfirm).toHaveBeenCalledWith({ reuseManualOverrides: false });

        // Reset back to default partial selection and submit partial selection
        fireEvent.click(screen.getByRole('button', { name: '恢复默认选区' }));
        expect(extractCheckbox.getAttribute('aria-checked')).toBe('false');
        expect(stageCheckbox.getAttribute('aria-checked')).toBe('false');
        expect(screen.getByText('已选 2 / 4 个节点')).toBeTruthy();

        // Add just `stage` so 3/4 nodes are selected
        fireEvent.click(stageCheckbox);
        expect(stageCheckbox.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByText('部分重跑')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '确认重跑' }));
        expect(onConfirm).toHaveBeenLastCalledWith({
            reuseManualOverrides: false,
            selectedTaskIds: ['stage', 'transform', 'load'],
        });
    });

    it('falls back to full rerun with hint when online flow does not support partial rerun', async () => {
        getOperationsExecutionRerunContextMock.mockResolvedValue(contextFixture({
            partialRerunSupported: false,
            fallbackReason: '当前线上版本暂不支持按节点重跑，本次将重跑整个任务；在离线开发中重新保存、提交并同步后即可支持按节点选择重跑。',
            defaultSelectedTaskIds: ['extract', 'stage', 'transform', 'load'],
            requiredTaskIds: ['extract', 'stage', 'transform', 'load'],
        }));
        const { onConfirm } = renderDialog();

        expect(await screen.findByText(/当前线上版本暂不支持按节点重跑/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: '全选重跑' })).toBeNull();
        expect(screen.getByText('已选 4 / 4 个节点')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '确认重跑' }));
        expect(onConfirm).toHaveBeenCalledWith({ reuseManualOverrides: false });
    });

    it('shows graph-changed alert and allows selecting previously skipped upstream node', async () => {
        getOperationsExecutionRerunContextMock.mockResolvedValue(contextFixture({
            graphChanged: true,
            fallbackReason: '原执行之后任务节点结构已更新，已默认全选当前节点，请确认重跑范围。',
            nodes: [
                { taskId: 'extract', kind: 'MYSQL', dataSourceType: 'MYSQL', executionStatus: 'SKIPPED' },
                { taskId: 'transform', kind: 'SHELL', dataSourceType: null, executionStatus: 'FAILED' },
            ],
            edges: [{ source: 'extract', target: 'transform' }],
            defaultSelectedTaskIds: ['extract', 'transform'],
            requiredTaskIds: ['transform'],
        }));
        const { onConfirm } = renderDialog();

        expect(await screen.findByText(/原执行之后任务节点结构已更新/)).toBeTruthy();
        expect(screen.getByText('已跳过')).toBeTruthy();
        const extractCheckbox = screen.getByRole('checkbox', { name: /extract/ });
        expect(extractCheckbox.getAttribute('aria-checked')).toBe('true');
        expect(extractCheckbox.getAttribute('aria-disabled')).toBe('false');

        fireEvent.click(extractCheckbox);
        expect(extractCheckbox.getAttribute('aria-checked')).toBe('false');

        fireEvent.click(screen.getByRole('button', { name: '确认重跑' }));
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
            reuseManualOverrides: false,
            selectedTaskIds: ['transform'],
        }));
    });
});
