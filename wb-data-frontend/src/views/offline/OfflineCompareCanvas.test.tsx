import { createContext, StrictMode, useContext, useEffect, useRef, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OfflineFlowDocument, OfflineFlowNode, OfflineFlowVersionSnapshot } from '../../api/offline';
import { OfflineCompareCanvas } from './OfflineCompareCanvas';

interface MockViewport {
    x: number;
    y: number;
    zoom: number;
}

interface CapturedPaneProps {
    viewport: MockViewport;
    fitView: ReturnType<typeof vi.fn>;
    setCenter: ReturnType<typeof vi.fn>;
    setViewport: ReturnType<typeof vi.fn>;
    getViewport: ReturnType<typeof vi.fn>;
    onMoveStart?: (event: unknown, viewport: MockViewport) => void;
    onMove?: (event: unknown, viewport: MockViewport) => void;
    onMoveEnd?: (event: unknown, viewport: MockViewport) => void;
}

const { paneControls } = vi.hoisted(() => ({
    paneControls: [] as CapturedPaneProps[],
}));

const PaneContext = createContext<CapturedPaneProps | null>(null);

function createPaneState(): CapturedPaneProps {
    const state: CapturedPaneProps = {
        viewport: { x: 0, y: 0, zoom: 1 },
        fitView: vi.fn(() => {
            state.viewport = { x: 180, y: 40, zoom: 1.05 };
            state.onMoveEnd?.(null, state.viewport);
            return Promise.resolve(true);
        }),
        setCenter: vi.fn(),
        setViewport: vi.fn((vp: MockViewport) => {
            state.viewport = vp;
            state.onMove?.(undefined, vp);
            state.onMoveEnd?.(undefined, vp);
            return Promise.resolve(true);
        }),
        getViewport: vi.fn(() => state.viewport),
    };
    return state;
}

vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({ children }: { children: ReactNode }) => {
        const paneRef = useRef<CapturedPaneProps | null>(null);
        if (!paneRef.current) {
            paneRef.current = createPaneState();
        }
        useEffect(() => {
            const pane = paneRef.current;
            if (!pane) return;
            paneControls.push(pane);
            return () => {
                const idx = paneControls.indexOf(pane);
                if (idx >= 0) paneControls.splice(idx, 1);
            };
        }, []);
        return <PaneContext.Provider value={paneRef.current}>{children}</PaneContext.Provider>;
    },
    ReactFlow: ({
        nodes,
        edges,
        nodeTypes,
        onInit,
        onNodeClick,
        onNodeDoubleClick,
        onMoveStart,
        onMove,
        onMoveEnd,
    }: {
        nodes: Array<{ id: string; type?: string; className: string; position?: { x: number; y: number }; data: Record<string, unknown> }>;
        edges: Array<{ id: string; style: { stroke: string } }>;
        nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
        onInit?: (instance: { getViewport: () => MockViewport }) => void;
        onNodeClick?: (event: unknown, node: { id: string }) => void;
        onNodeDoubleClick?: (event: unknown, node: { id: string }) => void;
        onMoveStart?: (event: unknown, viewport: MockViewport) => void;
        onMove?: (event: unknown, viewport: MockViewport) => void;
        onMoveEnd?: (event: unknown, viewport: MockViewport) => void;
    }) => {
        const pane = useContext(PaneContext);
        if (pane) {
            pane.onMoveStart = onMoveStart;
            pane.onMove = onMove;
            pane.onMoveEnd = onMoveEnd;
        }
        useEffect(() => {
            if (pane) {
                onInit?.({ getViewport: pane.getViewport });
            }
        }, [onInit, pane]);
        return (
            <div>
                {nodes.map((node) => {
                    const NodeRenderer = node.type ? nodeTypes?.[node.type] : undefined;
                    return (
                        <div
                            key={node.id}
                            data-testid={`node-${node.id}`}
                            data-pos={`${node.position?.x ?? 0}:${node.position?.y ?? 0}`}
                            className={node.className}
                            onClick={() => onNodeClick?.({}, node)}
                            onDoubleClick={() => onNodeDoubleClick?.({}, node)}
                        >
                            {NodeRenderer ? <NodeRenderer data={node.data} /> : node.id}
                        </div>
                    );
                })}
                {edges.map((edge) => <span key={edge.id} data-testid={`edge-${edge.id}`} data-stroke={edge.style.stroke} />)}
            </div>
        );
    },
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    BackgroundVariant: { Dots: 'dots', Lines: 'lines', Cross: 'cross' },
    useNodesInitialized: () => true,
    Background: () => null,
    Controls: () => null,
    useReactFlow: () => useContext(PaneContext)!,
}));

function node(taskId: string): OfflineFlowNode {
    return { taskId, kind: 'SHELL', scriptContent: `echo ${taskId}` };
}

function snapshot(nodes: OfflineFlowNode[], edges: OfflineFlowDocument['edges']): OfflineFlowVersionSnapshot {
    return {
        revision: 'rev',
        document: {
            groupId: 4,
            path: '_flows/example/flow.yaml',
            flowId: 'example',
            namespace: 'pg-4',
            documentHash: 'hash',
            documentUpdatedAt: 0,
            stages: [{ stageId: 'stage-1', parallel: false, nodes }],
            edges,
            layout: {},
        },
        files: [],
        nodeMetadata: {},
    };
}

describe('OfflineCompareCanvas', () => {
    afterEach(cleanup);
    it('colors added removed and unchanged nodes without marking upstream-only changes yellow', () => {
        const base = snapshot([node('a'), node('b')], [{ source: 'a', target: 'b' }]);
        const target = snapshot([node('a'), node('c')], [{ source: 'a', target: 'c' }]);

        const { unmount } = render(<OfflineCompareCanvas baseSnapshot={base} targetSnapshot={target} onSelectNode={vi.fn()} />);

        for (const element of screen.getAllByTestId('node-a')) {
            expect(element.getAttribute('class')).toContain('is-unchanged');
        }
        expect(screen.getByTestId('node-b').getAttribute('class')).toContain('is-removed');
        expect(screen.getByTestId('node-c').getAttribute('class')).toContain('is-added');
        expect(screen.getByTestId('edge-a->b').getAttribute('data-stroke')).toBe('var(--color-error)');
        expect(screen.getByTestId('edge-a->c').getAttribute('data-stroke')).toBe('var(--color-success)');
        unmount();

        // Inbound-edge change only (`upstreamChanged: true`, node self unchanged) keeps downstream node clean white
        const inboundBase = snapshot([node('upstream_old'), node('downstream')], [{ source: 'upstream_old', target: 'downstream' }]);
        const inboundTarget = snapshot([node('upstream_new'), node('downstream')], [{ source: 'upstream_new', target: 'downstream' }]);
        render(<OfflineCompareCanvas baseSnapshot={inboundBase} targetSnapshot={inboundTarget} onSelectNode={vi.fn()} />);

        for (const element of screen.getAllByTestId('node-downstream')) {
            expect(element.getAttribute('class')).toContain('is-unchanged');
            expect(element.getAttribute('class')).not.toContain('is-modified');
        }
        expect(screen.queryByRole('button', { name: '查看 downstream 差异' })).toBeNull();
    });

    it('keeps canvas toolbar free of redundant legend/node pills and omits commit noise in pane titles', () => {
        const base = snapshot([node('a'), node('b')], [{ source: 'a', target: 'b' }]);
        const target = snapshot([node('a'), node('c')], [{ source: 'a', target: 'c' }]);

        const { container, rerender } = render(
            <OfflineCompareCanvas
                base={{
                    revision: '5a1a714deadbeef',
                    kind: 'COMMIT',
                    label: 'feat: 修改节点',
                    shortRevision: '5a1a714',
                    message: 'feat: 修改节点',
                    authorName: 'dododcdc',
                    committedAt: '2026-11-08T09:19:00Z',
                }}
                target={{
                    revision: 'WORKTREE',
                    kind: 'DEVELOPMENT',
                    label: '开发版本',
                    shortRevision: '工作区',
                    message: '工作区有未提交修改',
                }}
                baseSnapshot={base}
                targetSnapshot={target}
                onSelectNode={vi.fn()}
            />,
        );

        expect(container.querySelector('.offline-compare-legend')).toBeNull();
        expect(container.querySelector('.offline-compare-change-list')).toBeNull();
        expect(container.querySelector('.offline-compare-pane-count')).toBeNull();
        expect(screen.queryByText(/节点\s*·\s*.*连线/)).toBeNull();
        expect(container.querySelectorAll('.offline-compare-canvas-pane h3 code')).toHaveLength(2);
        expect(screen.queryByText(/feat: 修改节点/)).toBeNull();
        expect(screen.queryByText(/dododcdc/)).toBeNull();
        expect(screen.getByText('5a1a714')).toBeTruthy();
        expect(screen.getByText('工作区')).toBeTruthy();

        fireEvent.click(screen.getByTestId('node-b'));
        expect(screen.getByTestId('node-b').className).toContain('is-focused');
        expect(screen.getByText(/在对比版本中已删除/)).toBeTruthy();

        // Switching compared revisions clears stale active node focus and single-side banners
        const nextBase = snapshot([node('a'), node('b')], [{ source: 'a', target: 'b' }]);
        nextBase.revision = 'next_base';
        nextBase.document.documentHash = 'next_base_hash';
        const nextTarget = snapshot([node('a'), node('b')], [{ source: 'a', target: 'b' }]);
        nextTarget.revision = 'next_target';
        nextTarget.document.documentHash = 'next_target_hash';
        rerender(<OfflineCompareCanvas baseSnapshot={nextBase} targetSnapshot={nextTarget} onSelectNode={vi.fn()} />);

        for (const el of screen.getAllByTestId('node-b')) {
            expect(el.className).not.toContain('is-focused');
        }
        expect(screen.queryByText(/在对比版本中已删除/)).toBeNull();
    });

    it('shows missing-pane indicator when focusing single-side nodes and triggers detail inspection', () => {
        const base = snapshot([node('a'), node('b')], [{ source: 'a', target: 'b' }]);
        const target = snapshot([node('a'), node('c')], [{ source: 'a', target: 'c' }]);
        const onSelectNode = vi.fn();

        const { container } = render(
            <OfflineCompareCanvas baseSnapshot={base} targetSnapshot={target} onSelectNode={onSelectNode} />,
        );

        fireEvent.click(screen.getByTestId('node-b'));
        expect(screen.getByText(/在对比版本中已删除/)).toBeTruthy();

        fireEvent.doubleClick(screen.getByTestId('node-b'));
        expect(onSelectNode).toHaveBeenCalledTimes(1);
        expect(onSelectNode.mock.calls[0][0].taskId).toBe('b');

        // Clickable attached trapezoid ear tab triggers detail inspection while unchanged nodes omit extra badges/rows
        expect(container.querySelectorAll('.compare-canvas-reasons')).toHaveLength(0);
        expect(container.querySelectorAll('.compare-canvas-source')).toHaveLength(0);
        expect(screen.queryByText('未变更')).toBeNull();
        const statusTab = screen.getByRole('button', { name: '查看 c 差异' });
        expect(statusTab.classList.contains('compare-canvas-status-tag')).toBe(true);
        const tabPaths = statusTab.querySelectorAll('svg.compare-canvas-status-tag-shape path');
        expect(tabPaths).toHaveLength(2);
        expect(tabPaths[1].getAttribute('d')).toContain('Z');
        expect(statusTab.querySelector('.compare-canvas-status-tag-label')?.textContent).toMatch(/^(新增|变更|删除)$/);
        fireEvent.click(statusTab);
        expect(onSelectNode).toHaveBeenCalledTimes(2);
        expect(onSelectNode.mock.calls[1][0].taskId).toBe('c');
    });

    it('always uses unified aligned layout, resets and fits both panes on "重置视图", and links viewport pan via "画布联动" without compounding deltas', async () => {
        paneControls.length = 0;

        const base = snapshot([node('hive_sales'), node('transfer_sales')], [{ source: 'hive_sales', target: 'transfer_sales' }]);
        base.revision = 'rev_base';
        base.document.documentHash = 'hash_base';
        base.document.layout = { hive_sales: { x: 160, y: 180 }, transfer_sales: { x: 480, y: 180 } };

        const target = snapshot([node('hive_sales'), node('transfer_sales')], [{ source: 'hive_sales', target: 'transfer_sales' }]);
        target.revision = 'WORKTREE';
        target.document.documentHash = 'hash_target';
        target.document.layout = { hive_sales: { x: 40, y: 40 }, transfer_sales: { x: -131, y: 160 } };

        render(
            <StrictMode>
                <OfflineCompareCanvas baseSnapshot={base} targetSnapshot={target} onSelectNode={vi.fn()} />
            </StrictMode>,
        );

        const [basePane, targetPane] = paneControls.slice(-2);

        // Legacy mode/fit buttons and jargon toggle are gone; only 重置视图 and 画布联动 remain
        expect(screen.queryByRole('button', { name: '对齐视图' })).toBeNull();
        expect(screen.queryByRole('button', { name: '原图位置' })).toBeNull();
        expect(screen.queryByRole('button', { name: '适应画布' })).toBeNull();
        expect(screen.queryByText('同步视口')).toBeNull();

        const resetBtn = screen.getByRole('button', { name: '重置视图' });
        const linkCheckbox = screen.getByRole('checkbox', { name: '画布联动' }) as HTMLInputElement;
        expect(linkCheckbox.checked).toBe(true);

        // Wait through initial StrictMode double-rAF fitView and programmatic guard window
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 120));
        });
        expect(basePane.fitView).toHaveBeenCalled();
        expect(targetPane.fitView).toHaveBeenCalled();
        expect(basePane.viewport).toEqual({ x: 180, y: 40, zoom: 1.05 });
        expect(targetPane.viewport).toEqual({ x: 180, y: 40, zoom: 1.05 });

        // Divergent saved coordinates are unified identically Top-to-Bottom across both panes
        const alignedUpstream = screen.getAllByTestId('node-hive_sales');
        const alignedDownstream = screen.getAllByTestId('node-transfer_sales');
        expect(alignedDownstream[0].getAttribute('data-pos')).toBe(alignedDownstream[1].getAttribute('data-pos'));
        expect(Number(alignedDownstream[0].getAttribute('data-pos')?.split(':')[1]))
            .toBeGreaterThan(Number(alignedUpstream[0].getAttribute('data-pos')?.split(':')[1]));

        // Multi-frame left drag on base must apply 1:1 delta to target (never compounding per frame)
        targetPane.setViewport.mockClear();
        act(() => {
            basePane.onMoveStart?.({ type: 'mousedown' }, { x: 180, y: 40, zoom: 1.05 });
        });
        for (const nextX of [176, 170, 162, 152, 145]) {
            act(() => {
                basePane.viewport = { x: nextX, y: 40, zoom: 1.05 };
                basePane.onMove?.({ type: 'mousemove' }, basePane.viewport);
            });
        }
        act(() => {
            basePane.viewport = { x: 145, y: 40, zoom: 1.05 };
            basePane.onMoveEnd?.({ type: 'mouseup' }, basePane.viewport);
        });
        expect(targetPane.viewport.x).toBe(145);
        expect(targetPane.viewport.y).toBe(40);
        expect(targetPane.viewport.zoom).toBeCloseTo(1.05);

        // Clicking 重置视图 fits both panes independently without cross-pane overwrites
        basePane.fitView.mockClear();
        targetPane.fitView.mockClear();
        basePane.setViewport.mockClear();
        targetPane.setViewport.mockClear();
        fireEvent.click(resetBtn);
        expect(basePane.fitView).toHaveBeenCalledTimes(1);
        expect(targetPane.fitView).toHaveBeenCalledTimes(1);
        expect(basePane.setViewport).not.toHaveBeenCalled();
        expect(targetPane.setViewport).not.toHaveBeenCalled();

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 90));
        });

        // Unchecking 画布联动 stops cross-pane viewport sync
        targetPane.setViewport.mockClear();
        fireEvent.click(linkCheckbox);
        expect(linkCheckbox.checked).toBe(false);
        act(() => {
            basePane.onMoveStart?.({ type: 'mousedown' }, { x: 180, y: 40, zoom: 1.05 });
            basePane.onMove?.({ type: 'mousemove' }, { x: 120, y: 20, zoom: 1.05 });
            basePane.onMoveEnd?.({ type: 'mouseup' }, { x: 120, y: 20, zoom: 1.05 });
        });
        expect(targetPane.setViewport).not.toHaveBeenCalled();
    });
});
