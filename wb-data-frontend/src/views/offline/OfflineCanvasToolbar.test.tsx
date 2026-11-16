import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../../components/ui/tooltip';
import { OfflineCanvasToolbar } from './OfflineCanvasToolbar';

afterEach(cleanup);

function renderToolbar(overrides: Partial<Parameters<typeof OfflineCanvasToolbar>[0]> = {}) {
    const props: Parameters<typeof OfflineCanvasToolbar>[0] = {
        activeFlowPath: '_flows/example/flow.yaml',
        groupId: 1,
        branch: 'main',
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
        onOpenVersions: vi.fn(),
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
            branch: null,
        });

        expect(view.container.querySelector('.offline-canvas-toolbar-meta')).toBeNull();
    });

    it('renders save error detail via Radix Tooltip with wrapping support', async () => {
        renderToolbar({
            draftSaveState: 'error',
            draftSaveError: '任务依赖图存在环，无法保存当前草稿',
            timezone: 'Asia/Shanghai',
        });

        const badge = screen.getByRole('status');
        expect(badge.textContent).toContain('保存失败');
        expect(badge.getAttribute('title')).toBeNull();

        fireEvent.pointerMove(badge, { pointerType: 'mouse' });
        const tooltip = await screen.findByRole('tooltip');
        expect(tooltip.textContent).toContain('任务依赖图存在环，无法保存当前草稿');
    });

    it('renders mode tabs on the left and hides mutating controls in online mode', () => {
        const onCanvasModeChange = vi.fn();
        const onOpenSchedule = vi.fn();
        const onOpenDependencies = vi.fn();
        const onOpenParameters = vi.fn();
        const onOpenVersions = vi.fn();
        const onOpenExecutions = vi.fn();

        const { rerender } = render(
            <TooltipProvider delayDuration={0}>
                <OfflineCanvasToolbar
                    activeFlowPath="_flows/example/flow.yaml"
                    groupId={1}
                    branch="main"
                    canvasMode="dev"
                    onCanvasModeChange={onCanvasModeChange}
                    deploymentConfig={{
                        id: 1,
                        groupId: 1,
                        branch: 'main',
                        namespace: 'pg-1',
                        syncFlowId: 'git-sync-main',
                        enabled: true,
                        lastSyncAt: '2026-11-14T10:00:00Z',
                        lastSyncStatus: 'SUCCESS',
                        lastSyncMessage: null,
                        lastDeployedSha: 'abcdef1234567890abcdef1234567890abcdef12',
                        lastDeployedAt: '2026-11-14T10:00:05Z',
                        deploymentEvidence: 'CONFIRMED',
                    }}
                    hasOnlineDocument={false}
                    canWrite
                    canConfigureParameters
                    parameterBindingStatus={null}
                    timezone="Asia/Shanghai"
                    nodeCount={2}
                    selectedNodeCount={0}
                    dirty={false}
                    commitDirty={false}
                    committing={false}
                    draftSaveState="idle"
                    draftSavedAt={null}
                    draftSaveError={null}
                    onSelectAll={vi.fn()}
                    onCommit={vi.fn()}
                    onOpenSchedule={onOpenSchedule}
                    onOpenDependencies={onOpenDependencies}
                    onOpenParameters={onOpenParameters}
                    onExecute={vi.fn()}
                    onOpenExecutions={onOpenExecutions}
                    onOpenVersions={onOpenVersions}
                />
            </TooltipProvider>,
        );

        const devTab = screen.getByRole('tab', { name: '开发模式' });
        const onlineTab = screen.getByRole('tab', { name: '线上模式' });
        expect(devTab.getAttribute('aria-selected')).toBe('true');
        expect(onlineTab.getAttribute('aria-selected')).toBe('false');
        expect(screen.getByText('当前线上 abcdef1')).toBeTruthy();

        fireEvent.click(onlineTab);
        expect(onCanvasModeChange).toHaveBeenCalledWith('online');

        rerender(
            <TooltipProvider delayDuration={0}>
                <OfflineCanvasToolbar
                    activeFlowPath="_flows/example/flow.yaml"
                    groupId={1}
                    branch="main"
                    canvasMode="online"
                    onCanvasModeChange={onCanvasModeChange}
                    deploymentConfig={{
                        id: 1,
                        groupId: 1,
                        branch: 'main',
                        namespace: 'pg-1',
                        syncFlowId: 'git-sync-main',
                        enabled: true,
                        lastSyncAt: '2026-11-14T10:00:00Z',
                        lastSyncStatus: 'SUCCESS',
                        lastSyncMessage: null,
                        lastDeployedSha: 'abcdef1234567890abcdef1234567890abcdef12',
                        lastDeployedAt: '2026-11-14T10:00:05Z',
                        deploymentEvidence: 'CONFIRMED',
                    }}
                    hasOnlineDocument={false}
                    canWrite
                    canConfigureParameters
                    parameterBindingStatus={null}
                    timezone="Asia/Shanghai"
                    nodeCount={2}
                    selectedNodeCount={0}
                    dirty
                    commitDirty
                    committing={false}
                    draftSaveState="saving"
                    draftSavedAt={null}
                    draftSaveError={null}
                    onSelectAll={vi.fn()}
                    onCommit={vi.fn()}
                    onOpenSchedule={onOpenSchedule}
                    onOpenDependencies={onOpenDependencies}
                    onOpenParameters={onOpenParameters}
                    onExecute={vi.fn()}
                    onOpenExecutions={onOpenExecutions}
                    onOpenVersions={onOpenVersions}
                />
            </TooltipProvider>,
        );

        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.queryByRole('button', { name: '提交当前任务' })).toBeNull();
        expect(screen.queryByRole('button', { name: '执行' })).toBeNull();
        expect(screen.queryByText('保存中')).toBeNull();
        expect(screen.getByText('线上快照 · 只读')).toBeTruthy();

        expect((screen.getByRole('button', { name: '调度' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: '依赖' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: '参数' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: '版本' }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole('button', { name: '执行结果' }) as HTMLButtonElement).disabled).toBe(false);

        rerender(
            <TooltipProvider delayDuration={0}>
                <OfflineCanvasToolbar
                    activeFlowPath="_flows/example/flow.yaml"
                    groupId={1}
                    branch="main"
                    canvasMode="online"
                    onCanvasModeChange={onCanvasModeChange}
                    deploymentConfig={null}
                    hasOnlineDocument
                    canWrite={false}
                    canConfigureParameters={false}
                    parameterBindingStatus={null}
                    timezone="Asia/Shanghai"
                    nodeCount={2}
                    selectedNodeCount={0}
                    dirty={false}
                    commitDirty={false}
                    committing={false}
                    draftSaveState="idle"
                    draftSavedAt={null}
                    draftSaveError={null}
                    onSelectAll={vi.fn()}
                    onCommit={vi.fn()}
                    onOpenSchedule={onOpenSchedule}
                    onOpenDependencies={onOpenDependencies}
                    onOpenParameters={onOpenParameters}
                    onExecute={vi.fn()}
                    onOpenExecutions={onOpenExecutions}
                    onOpenVersions={onOpenVersions}
                />
            </TooltipProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: '调度' }));
        fireEvent.click(screen.getByRole('button', { name: '依赖' }));
        fireEvent.click(screen.getByRole('button', { name: '参数' }));
        fireEvent.click(screen.getByRole('button', { name: '版本' }));
        fireEvent.click(screen.getByRole('button', { name: '执行结果' }));
        expect(onOpenSchedule).toHaveBeenCalledOnce();
        expect(onOpenDependencies).toHaveBeenCalledOnce();
        expect(onOpenParameters).toHaveBeenCalledOnce();
        expect(onOpenVersions).toHaveBeenCalledOnce();
        expect(onOpenExecutions).toHaveBeenCalledOnce();
    });

    it('renders single-flow push button enabled only when flowAhead and hides it in online mode', () => {
        const onPushFlow = vi.fn();
        const { rerender } = render(
            <TooltipProvider delayDuration={0}>
                <OfflineCanvasToolbar
                    activeFlowPath="_flows/example/flow.yaml"
                    groupId={1}
                    branch="main"
                    canvasMode="dev"
                    canWrite
                    canConfigureParameters
                    timezone="Asia/Shanghai"
                    nodeCount={2}
                    selectedNodeCount={0}
                    dirty={false}
                    commitDirty={false}
                    flowAhead={false}
                    committing={false}
                    draftSaveState="idle"
                    draftSavedAt={null}
                    draftSaveError={null}
                    onSelectAll={vi.fn()}
                    onCommit={vi.fn()}
                    onPushFlow={onPushFlow}
                    onOpenSchedule={vi.fn()}
                    onOpenDependencies={vi.fn()}
                    onOpenParameters={vi.fn()}
                    onExecute={vi.fn()}
                    onOpenExecutions={vi.fn()}
                    onOpenVersions={vi.fn()}
                />
            </TooltipProvider>,
        );

        const pushBtn = screen.getByRole('button', { name: '推送当前任务' }) as HTMLButtonElement;
        expect(pushBtn.disabled).toBe(true);

        rerender(
            <TooltipProvider delayDuration={0}>
                <OfflineCanvasToolbar
                    activeFlowPath="_flows/example/flow.yaml"
                    groupId={1}
                    branch="main"
                    canvasMode="dev"
                    canWrite
                    canConfigureParameters
                    timezone="Asia/Shanghai"
                    nodeCount={2}
                    selectedNodeCount={0}
                    dirty={false}
                    commitDirty={false}
                    flowAhead
                    committing={false}
                    draftSaveState="idle"
                    draftSavedAt={null}
                    draftSaveError={null}
                    onSelectAll={vi.fn()}
                    onCommit={vi.fn()}
                    onPushFlow={onPushFlow}
                    onOpenSchedule={vi.fn()}
                    onOpenDependencies={vi.fn()}
                    onOpenParameters={vi.fn()}
                    onExecute={vi.fn()}
                    onOpenExecutions={vi.fn()}
                    onOpenVersions={vi.fn()}
                />
            </TooltipProvider>,
        );

        expect((screen.getByRole('button', { name: '推送当前任务' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: '推送当前任务' }));
        expect(onPushFlow).toHaveBeenCalledOnce();
    });
});
