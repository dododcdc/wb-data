import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OfflineFlowDocument } from '../../../api/offline';
import FlowCanvas from './FlowCanvas';

const reactFlowPropsSpy = vi.fn();
const controlsPropsSpy = vi.fn();

vi.mock('../../../components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@xyflow/react', async () => {
    const React = await vi.importActual<typeof import('react')>('react');
    return {
        ReactFlow: (props: Record<string, unknown>) => {
            reactFlowPropsSpy(props);
            const nodes = (props.nodes as Array<{ id: string }>) ?? [];
            const onNodeDoubleClick = props.onNodeDoubleClick as ((e: unknown, n: { id: string }) => void) | undefined;
            const onNodeContextMenu = props.onNodeContextMenu as ((e: unknown, n: { id: string }) => void) | undefined;
            const onNodesChange = props.onNodesChange as ((changes: Array<Record<string, unknown>>) => void) | undefined;
            return (
                <div data-testid="mock-react-flow">
                    {nodes.map((node) => (
                        <div
                            key={node.id}
                            data-testid={`canvas-node-${node.id}`}
                            onDoubleClick={(e) => onNodeDoubleClick?.(e, node)}
                            onContextMenu={(e) => onNodeContextMenu?.(e, node)}
                        >
                            {node.id}
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={() => onNodesChange?.([{ type: 'remove', id: 'sql_1' }])}
                    >
                        trigger-remove
                    </button>
                    <button
                        type="button"
                        onClick={() => onNodesChange?.([{ type: 'dimensions', id: 'sql_1' }])}
                    >
                        trigger-dimensions
                    </button>
                    {props.children as ReactNode}
                </div>
            );
        },
        Background: () => null,
        Controls: ({ children, ...rest }: { children?: ReactNode; [key: string]: unknown }) => {
            controlsPropsSpy(rest);
            return <div data-testid="controls">{children}</div>;
        },
        BackgroundVariant: { Dots: 'dots' },
        useNodesState: <T,>(initial: T[]) => {
            const [nodes, setNodes] = React.useState(initial);
            const onChange = React.useCallback((changes: Array<{ type: string; id?: string }>) => {
                setNodes((curr) => curr.filter((item) => !changes.some((c) => c.type === 'remove' && c.id === (item as { id: string }).id)));
            }, []);
            return [nodes, setNodes, onChange] as const;
        },
        useEdgesState: <T,>(initial: T[]) => {
            const [edges, setEdges] = React.useState(initial);
            return [edges, setEdges, vi.fn()] as const;
        },
        addEdge: vi.fn((_, eds) => eds),
        reconnectEdge: vi.fn((_, __, eds) => eds),
        useReactFlow: () => ({
            fitView: vi.fn(),
            screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })),
        }),
    };
});

afterEach(() => {
    cleanup();
    reactFlowPropsSpy.mockClear();
    controlsPropsSpy.mockClear();
});

const sampleDocument: OfflineFlowDocument = {
    groupId: 1,
    path: '_flows/online/flow.yaml',
    flowId: 'online',
    namespace: 'team.online',
    documentHash: 'hash',
    documentUpdatedAt: 1,
    stages: [
        {
            stageId: 'main',
            parallel: false,
            nodes: [
                {
                    taskId: 'sql_1',
                    kind: 'HIVE_SQL',
                    scriptPath: 'scripts/online/sql_1.sql',
                    scriptContent: 'SELECT 1',
                },
            ],
        },
    ],
    edges: [],
    layout: { sql_1: { x: 100, y: 80 } },
};

describe('FlowCanvas readOnly mode', () => {
    it('disables editing interactions, layout button, and mutating context actions while keeping inspect and copy', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        const onNodesChange = vi.fn();
        const onEdgesChange = vi.fn();
        const onDoubleClickNode = vi.fn();
        const onAddNode = vi.fn();

        const { container } = render(
            <FlowCanvas
                readOnly
                flowDocument={sampleDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onReplaceTaskSelection={vi.fn()}
                onDoubleClickNode={onDoubleClickNode}
                onAddNode={onAddNode}
                onRenameNode={vi.fn()}
            />,
        );

        expect(container.querySelector('.flow-canvas-container.is-readonly')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '自动排版' })).toBeNull();

        const calls = reactFlowPropsSpy.mock.calls;
        const latestProps = calls[calls.length - 1]?.[0] as Record<string, unknown>;
        expect(latestProps.nodesDraggable).toBe(false);
        expect(latestProps.nodesConnectable).toBe(false);
        expect(latestProps.edgesReconnectable).toBe(false);
        expect(latestProps.onConnect).toBeUndefined();
        expect(latestProps.onReconnect).toBeUndefined();
        expect(latestProps.onNodeDragStop).toBeUndefined();
        expect(latestProps.onNodesDelete).toBeUndefined();
        expect(latestProps.onEdgesDelete).toBeUndefined();

        // Removing or pressing Delete does not remove nodes or emit changes back to dev state
        fireEvent.click(screen.getByRole('button', { name: 'trigger-remove' }));
        expect(screen.getByTestId('canvas-node-sql_1')).toBeTruthy();
        const canvasEl = container.querySelector('.flow-canvas-container') as HTMLElement;
        act(() => {
            canvasEl.focus();
            fireEvent.keyDown(canvasEl, { key: 'Delete' });
        });
        expect(onNodesChange).not.toHaveBeenCalled();
        expect(onEdgesChange).not.toHaveBeenCalled();

        // Double click opens read-only node inspector
        fireEvent.doubleClick(screen.getByTestId('canvas-node-sql_1'));
        expect(onDoubleClickNode).toHaveBeenCalledWith('sql_1');

        // Context menu only exposes copy name (no rename / delete)
        fireEvent.contextMenu(screen.getByTestId('canvas-node-sql_1'), { clientX: 50, clientY: 60 });
        expect(screen.queryByRole('button', { name: /重命名/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
        const copyBtn = screen.getByRole('button', { name: /复制节点名称/ });
        fireEvent.click(copyBtn);
        expect(writeText).toHaveBeenCalledWith('sql_1');
    });

    it('uses instant initial fitView, keeps smooth manual controls fitView, and reveals viewport on dimensions measure', () => {
        const { container, rerender } = render(
            <FlowCanvas
                flowDocument={sampleDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onReplaceTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
                onAddNode={vi.fn()}
                onRenameNode={vi.fn()}
            />,
        );

        const rfCalls = reactFlowPropsSpy.mock.calls;
        const latestRfProps = rfCalls[rfCalls.length - 1]?.[0] as { fitViewOptions?: { duration?: number } };
        expect(latestRfProps.fitViewOptions?.duration).toBe(0);

        const ctrlCalls = controlsPropsSpy.mock.calls;
        const latestCtrlProps = ctrlCalls[ctrlCalls.length - 1]?.[0] as { fitViewOptions?: { duration?: number } };
        expect(latestCtrlProps.fitViewOptions?.duration).toBe(280);

        const canvasEl = container.querySelector('.flow-canvas-container');
        expect(canvasEl?.classList.contains('is-viewport-ready')).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'trigger-dimensions' }));
        expect(container.querySelector('.flow-canvas-container.is-viewport-ready')).toBeTruthy();

        rerender(
            <FlowCanvas
                flowDocument={{ ...sampleDocument, path: '_flows/empty/flow.yaml', stages: [], edges: [], layout: {} }}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onReplaceTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
                onAddNode={vi.fn()}
                onRenameNode={vi.fn()}
            />,
        );
        expect(container.querySelector('.flow-canvas-container.is-viewport-ready')).toBeTruthy();
    });
});
