import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FlowCanvas from './FlowCanvas';
import type { OfflineFlowDocument } from '../../api/offline';

vi.mock('@xyflow/react', async () => {
    const ReactModule = await import('react');

    function useNodesState<T>(initialNodes: T[]) {
        const [nodes, setNodes] = ReactModule.useState(initialNodes);
        return [nodes, setNodes, vi.fn()] as const;
    }

    function useEdgesState<T>(initialEdges: T[]) {
        const [edges, setEdges] = ReactModule.useState(initialEdges);
        return [edges, setEdges, vi.fn()] as const;
    }

    return {
        ReactFlow: (props: {
            nodes: Array<{ id: string }>;
            edges: Array<{ id: string }>;
            onNodeContextMenu?: (event: MouseEvent, node: { id: string }) => void;
            onNodesDelete?: (nodes: Array<{ id: string }>) => void;
            onEdgesDelete?: (edges: Array<{ id: string }>) => void;
            onSelectionChange?: (selection: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }) => void;
            onEdgeClick?: (event: MouseEvent, edge: { id: string }) => void;
            children?: React.ReactNode;
        }) => {
            const { nodes, edges, onNodeContextMenu, onNodesDelete, onEdgesDelete, onSelectionChange, onEdgeClick, children } = props;

            return (
                <div>
                    <div data-testid="flow-node-ids">{nodes.map((node) => node.id).join(',')}</div>
                    <div data-testid="flow-edge-ids">{edges.map((edge) => edge.id).join(',')}</div>
                    <button
                        type="button"
                        data-testid="open-first-node-menu"
                        onContextMenu={(event) => {
                            if (nodes[0]) {
                                onNodeContextMenu?.(event.nativeEvent, nodes[0]);
                            }
                        }}
                    >
                        open menu
                    </button>
                    <button
                        type="button"
                        data-testid="delete-first-node"
                        onClick={() => {
                            if (nodes[0]) {
                                onNodesDelete?.([nodes[0]]);
                            }
                        }}
                    >
                        delete node
                    </button>
                    <button
                        type="button"
                        data-testid="delete-first-edge"
                        onClick={() => {
                            if (edges[0]) {
                                onEdgesDelete?.([edges[0]]);
                            }
                        }}
                    >
                        delete edge
                    </button>
                    <button
                        type="button"
                        data-testid="select-first-node"
                        onClick={() => onSelectionChange?.({ nodes: nodes[0] ? [nodes[0]] : [], edges: [] })}
                    >
                        select node
                    </button>
                    <button
                        type="button"
                        data-testid="select-first-edge"
                        onClick={() => onSelectionChange?.({ nodes: [], edges: edges[0] ? [edges[0]] : [] })}
                    >
                        select edge
                    </button>
                    <button
                        type="button"
                        data-testid="click-first-edge"
                        onClick={() => {
                            if (edges[0]) {
                                onEdgeClick?.(new MouseEvent('click'), edges[0]);
                            }
                        }}
                    >
                        click edge
                    </button>
                    {children}
                </div>
            );
        },
        Background: () => null,
        Controls: () => null,
        ControlButton: (props: { children?: React.ReactNode }) => <button type="button">{props.children}</button>,
        MiniMap: () => null,
        Handle: () => null,
        useNodesState,
        useEdgesState,
        useReactFlow: () => ({
            screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        }),
        addEdge: <T,>(edge: T, edges: T[]) => [...edges, edge],
        reconnectEdge: <T,>(oldEdge: T, newEdge: T, edges: T[]) =>
            edges.map((edge) => (edge === oldEdge ? newEdge : edge)),
        BackgroundVariant: {
            Dots: 'dots',
        },
        Position: {
            Top: 'top',
            Bottom: 'bottom',
        },
    };
});

function createFlowDocument(
    path: string,
    documentHash: string,
    taskIds: string[],
    edges: Array<{ source: string; target: string }> = [],
): OfflineFlowDocument {
    const pathParts = path.split('/');

    return {
        groupId: 1,
        path,
        flowId: pathParts[pathParts.length - 2] ?? 'flow',
        namespace: 'pg-1',
        documentHash,
        documentUpdatedAt: 1,
        stages: [
            {
                stageId: 'stage-1',
                parallel: false,
                nodes: taskIds.map((taskId) => ({
                    taskId,
                    kind: 'SHELL',
                    scriptPath: `scripts/${taskId}.sh`,
                    scriptContent: `echo ${taskId}`,
                })),
            },
        ],
        edges,
        layout: {},
    };
}

describe('FlowCanvas', () => {
    afterEach(() => {
        cleanup();
    });

    it('resets rendered nodes when switching to a different flow document', () => {
        const etlDocument = createFlowDocument('_flows/data_pipeline/etl/flow.yaml', 'etl-hash', [
            'extract',
            'transform',
        ]);
        const martDocument = createFlowDocument('_flows/data_pipeline/mart/flow.yaml', 'mart-hash', [
            'publish',
        ]);

        const props = {
            selectedTaskIds: [] as string[],
            activeNodeId: null,
            onNodesChange: vi.fn(),
            onEdgesChange: vi.fn(),
            onNodeLayoutCommit: vi.fn(),
            onSelectNode: vi.fn(),
            onToggleTaskSelection: vi.fn(),
            onDoubleClickNode: vi.fn(),
        };

        const { rerender } = render(
            <FlowCanvas
                {...props}
                flowDocument={etlDocument}
            />,
        );

        expect(screen.getByTestId('flow-node-ids').textContent).toBe('extract,transform');

        rerender(
            <FlowCanvas
                {...props}
                flowDocument={martDocument}
            />,
        );

        expect(screen.getByTestId('flow-node-ids').textContent).toBe('publish');
    });

    it('reports the latest flow nodes to the parent when switching documents', () => {
        const etlDocument = createFlowDocument('_flows/data_pipeline/etl/flow.yaml', 'etl-hash', [
            'extract',
            'transform',
        ]);
        const martDocument = createFlowDocument('_flows/data_pipeline/mart/flow.yaml', 'mart-hash', [
            'publish',
        ]);
        const onNodesChange = vi.fn();

        const props = {
            selectedTaskIds: [] as string[],
            activeNodeId: null,
            onNodesChange,
            onEdgesChange: vi.fn(),
            onNodeLayoutCommit: vi.fn(),
            onSelectNode: vi.fn(),
            onToggleTaskSelection: vi.fn(),
            onDoubleClickNode: vi.fn(),
        };

        const { rerender } = render(
            <FlowCanvas
                {...props}
                flowDocument={etlDocument}
            />,
        );

        rerender(
            <FlowCanvas
                {...props}
                flowDocument={martDocument}
            />,
        );

        const latestCall = onNodesChange.mock.calls[onNodesChange.mock.calls.length - 1];
        const latestNodes = latestCall?.[0];
        expect(latestNodes?.map((node: { id: string }) => node.id)).toEqual(['publish']);
    });

    it('removes deleted nodes from the controlled canvas state', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        expect(screen.getByTestId('flow-node-ids').textContent).toBe('build_mart,qa_check');
        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('build_mart->qa_check');

        fireEvent.click(screen.getByTestId('delete-first-node'));

        expect(screen.getByTestId('flow-node-ids').textContent).toBe('qa_check');
        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('');
    });

    it('removes deleted edges from the controlled canvas state', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('build_mart->qa_check');

        fireEvent.click(screen.getByTestId('delete-first-edge'));

        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('');
    });

    it('removes the selected node when Delete is pressed on the canvas container', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('select-first-node'));
        fireEvent.keyDown(document.querySelector('.flow-canvas-container')!, { key: 'Delete' });

        expect(screen.getByTestId('flow-node-ids').textContent).toBe('qa_check');
        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('');
    });

    it('removes the selected edge when Delete is pressed on the canvas container', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('select-first-edge'));
        fireEvent.keyDown(document.querySelector('.flow-canvas-container')!, { key: 'Delete' });

        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('');
    });

    it('does not delete the selected node when Backspace is pressed inside an input', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('select-first-node'));

        const container = document.querySelector('.flow-canvas-container') as HTMLDivElement;
        const input = document.createElement('input');
        container.appendChild(input);
        input.focus();

        fireEvent.keyDown(input, { key: 'Backspace' });

        expect(screen.getByTestId('flow-node-ids').textContent).toBe('build_mart,qa_check');
        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('build_mart->qa_check');
    });

    it('does not delete the selected node when Delete is pressed inside an input', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('select-first-node'));

        const container = document.querySelector('.flow-canvas-container') as HTMLDivElement;
        const input = document.createElement('input');
        container.appendChild(input);
        input.focus();

        fireEvent.keyDown(input, { key: 'Delete' });

        expect(screen.getByTestId('flow-node-ids').textContent).toBe('build_mart,qa_check');
        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('build_mart->qa_check');
    });

    it('does not restore deleted edges when parent callback props change', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        const { rerender } = render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('select-first-edge'));
        fireEvent.keyDown(document.querySelector('.flow-canvas-container')!, { key: 'Delete' });

        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('');

        rerender(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('');
    });

    it('removes a clicked edge when Delete is pressed on the canvas container', () => {
        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
            [{ source: 'build_mart', target: 'qa_check' }],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('click-first-edge'));
        fireEvent.keyDown(document.querySelector('.flow-canvas-container')!, { key: 'Delete' });

        expect(screen.getByTestId('flow-edge-ids').textContent).toBe('');
    });

    it('copies the node name from the context menu', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: {
                writeText,
            },
        });

        const flowDocument = createFlowDocument(
            '_flows/data_pipeline/mart/flow.yaml',
            'mart-hash',
            ['build_mart', 'qa_check'],
        );

        render(
            <FlowCanvas
                flowDocument={flowDocument}
                selectedTaskIds={[]}
                activeNodeId={null}
                onNodesChange={vi.fn()}
                onEdgesChange={vi.fn()}
                onNodeLayoutCommit={vi.fn()}
                onSelectNode={vi.fn()}
                onToggleTaskSelection={vi.fn()}
                onDoubleClickNode={vi.fn()}
            />,
        );

        fireEvent.contextMenu(screen.getByTestId('open-first-node-menu'));
        fireEvent.click(screen.getByText('复制节点名称'));

        expect(writeText).toHaveBeenCalledWith('build_mart');
    });
});
