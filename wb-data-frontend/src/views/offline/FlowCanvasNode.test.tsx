import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FlowCanvasNode, type FlowCanvasNodeData } from './FlowCanvasNode';

vi.mock('@xyflow/react', () => ({
    Handle: () => <div data-testid="handle" />,
    Position: { Top: 'top', Bottom: 'bottom' },
}));

vi.mock('../../components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('FlowCanvasNode', () => {
    it('uses the common node container style for transfer nodes', () => {
        const data: FlowCanvasNodeData = {
            taskId: 'transfer_node_1',
            kind: 'TRANSFER',
            selected: false,
            onToggleSelection: vi.fn(),
        };

        const { container } = render(<FlowCanvasNode data={data} />);
        const node = container.querySelector('.flow-canvas-node');
        const kindBadge = container.querySelector('.flow-canvas-node-kind');

        expect(node?.classList.contains('is-transfer')).toBe(false);
        expect(kindBadge?.classList.contains('is-transfer')).toBe(true);
        expect(kindBadge?.getAttribute('aria-label')).toBe('Transfer');
        expect(kindBadge?.querySelector('svg')).toBeTruthy();
    });

    it('renders a kind icon instead of the text label', () => {
        const data: FlowCanvasNodeData = {
            taskId: 'sql_node_1',
            kind: 'MYSQL',
            selected: false,
            onToggleSelection: vi.fn(),
        };

        const { container } = render(<FlowCanvasNode data={data} />);
        const kindBadge = container.querySelector('.flow-canvas-node-kind');

        expect(kindBadge?.classList.contains('is-mysql')).toBe(true);
        expect(kindBadge?.getAttribute('aria-label')).toBe('MySQL');
        expect(kindBadge?.querySelector('svg')).toBeTruthy();
    });
});
