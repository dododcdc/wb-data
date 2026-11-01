import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../../components/ui/tooltip';
import { OfflineCanvasToolbar } from './OfflineCanvasToolbar';

afterEach(cleanup);

function renderToolbar(overrides: Partial<Parameters<typeof OfflineCanvasToolbar>[0]> = {}) {
    const props: Parameters<typeof OfflineCanvasToolbar>[0] = {
        activeFlowPath: '_flows/example/flow.yaml',
        canWrite: true,
        canConfigureParameters: true,
        parameterBindingStatus: null,
        timezone: 'Asia/Shanghai',
        nodeCount: 2,
        selectedNodeCount: 0,
        dirty: false,
        commitDirty: false,
        committing: false,
        draftSaveState: 'idle',
        draftSavedAt: null,
        draftSaveError: null,
        onSelectAll: vi.fn(),
        onCommit: vi.fn(),
        onOpenSchedule: vi.fn(),
        onOpenDependencies: vi.fn(),
        onOpenParameters: vi.fn(),
        onExecute: vi.fn(),
        onOpenExecutions: vi.fn(),
        ...overrides,
    };

    return render(
        <TooltipProvider delayDuration={0}>
            <OfflineCanvasToolbar {...props} />
        </TooltipProvider>,
    );
}

describe('OfflineCanvasToolbar status and timezone metadata', () => {
    it('renders timezone quietly in the right metadata cluster without an orphan divider when draft status is idle', () => {
        const view = renderToolbar({
            draftSaveState: 'idle',
            dirty: false,
            timezone: 'Asia/Shanghai',
        });

        const meta = view.container.querySelector('.offline-canvas-toolbar-meta');
        expect(meta).not.toBeNull();
        expect(meta?.querySelector('.offline-canvas-timezone-icon')).not.toBeNull();
        expect(meta?.querySelector('.offline-canvas-timezone-text')?.textContent).toBe('Asia/Shanghai');
        expect(meta?.querySelector('.offline-canvas-meta-sep')).toBeNull();
    });

    it('groups draft save status and timezone together on the right with a subtle separator', () => {
        const savedAt = new Date(2026, 9, 31, 14, 8).getTime();
        const view = renderToolbar({
            draftSaveState: 'saved',
            draftSavedAt: savedAt,
            timezone: 'Asia/Shanghai',
        });

        const meta = view.container.querySelector('.offline-canvas-toolbar-meta');
        expect(meta).not.toBeNull();
        expect(screen.getByRole('status').textContent).toContain('已保存 14:08');
        expect(meta?.contains(screen.getByRole('status'))).toBe(true);
        expect(meta?.querySelector('.offline-canvas-meta-sep')).not.toBeNull();
        expect(meta?.querySelector('.offline-canvas-timezone-text')?.textContent).toBe('Asia/Shanghai');
    });

    it('omits the metadata container entirely when draft status is idle and timezone is absent', () => {
        const view = renderToolbar({
            draftSaveState: 'idle',
            dirty: false,
            timezone: null,
        });

        expect(view.container.querySelector('.offline-canvas-toolbar-meta')).toBeNull();
    });
});
