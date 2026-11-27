import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OfflineRepoTreeResponse } from '../../api/offline';
import { TooltipProvider } from '../../components/ui/tooltip';
import { OfflineWorkbenchSidebar } from './OfflineWorkbenchSidebar';

vi.mock('./repo/OfflineRepoTree', () => import('./repo/offlineRepoTreeDouble.test-helper'));

afterEach(cleanup);

function createTree(flowNames: string[]): OfflineRepoTreeResponse {
    return {
        groupId: 4,
        root: {
            id: '_flows',
            kind: 'ROOT',
            name: 'policy',
            path: '_flows',
            scheduleState: 'NONE',
            schedulePeriod: null,
            dependencyCount: 0,
            children: flowNames.map((name) => ({
                id: `_flows/${name}/flow.yaml`,
                kind: 'FLOW',
                name,
                path: `_flows/${name}/flow.yaml`,
                children: [],
                scheduleState: 'NONE',
                schedulePeriod: null,
                dependencyCount: 0,
            })),
        },
    };
}

function renderSidebar(treeData: OfflineRepoTreeResponse) {
    const props = {
        isGroupAdmin: true,
        branch: {
            label: 'feature/policy-review',
            canSwitch: true,
            menuOpen: false,
            tooltipOpen: false,
            loading: false,
            switching: false,
            branches: [{
                name: 'feature/policy-review',
                current: true,
                local: true,
                remote: false,
                remoteName: null,
                trackingBranch: null,
            }],
            dirtyState: null,
            onToggleMenu: vi.fn(),
            onMenuOpenChange: vi.fn(),
            onTooltipOpenChange: vi.fn(),
            onSwitch: vi.fn(),
        },
        repository: {
            available: true,
            loading: false,
            committing: false,
            pushLoading: false,
            canCommit: false,
            canPush: false,
            dirty: false,
            ahead: false,
            onRefresh: vi.fn(),
            onOpenCommit: vi.fn(),
            onOpenPush: vi.fn(),
        },
        creation: {
            canWrite: true,
            menuOpen: false,
            onMenuOpenChange: vi.fn(),
            onOpenNewFlow: vi.fn(),
            onOpenNewFolder: vi.fn(),
        },
        tree: {
            data: treeData,
            loading: false,
            flowLoading: false,
            activeFlowPath: null,
            canWrite: true,
            onOpenFlow: vi.fn(),
            onContextMenu: vi.fn(),
            onMoveNode: vi.fn(),
        },
    };

    const view = render(<OfflineWorkbenchSidebar {...props} />, { wrapper: TooltipProvider });
    return {
        ...view,
        rerenderTree(nextTreeData: OfflineRepoTreeResponse, loading = false) {
            view.rerender(
                <OfflineWorkbenchSidebar
                    {...props}
                    tree={{ ...props.tree, data: nextTreeData, loading }}
                />,
            );
        },
    };
}

describe('OfflineWorkbenchSidebar', () => {
    it('shows the project-group root even when the tree has no tasks', () => {
        const view = renderSidebar(createTree([]));
        const root = view.container.querySelector('button.offline-tree-root-label');

        expect(root?.textContent).toContain('policy');
        expect(screen.queryByText(/还没有可打开的任务/)).toBeNull();
    });

    it('keeps the project tree collapsed when refreshed data arrives', () => {
        const view = renderSidebar(createTree(['existing']));
        const root = view.container.querySelector('button.offline-tree-root-label');

        const existing = screen.getByRole('button', { name: 'existing' });
        fireEvent.click(root!);
        expect(screen.queryByRole('button', { name: 'existing' })).toBeNull();
        expect(screen.getByRole('button', { name: 'existing', hidden: true })).toBe(existing);

        view.rerenderTree(createTree(['existing', 'test1']));

        expect(screen.queryByRole('button', { name: 'existing' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'test1' })).toBeNull();
        expect(screen.getByRole('button', { name: 'existing', hidden: true })).toBe(existing);
    });

    it('keeps the loaded tree mounted while a refresh is pending', () => {
        const data = createTree(['existing']);
        const view = renderSidebar(data);
        const existing = screen.getByRole('button', { name: 'existing' });
        view.rerenderTree(data, true);
        expect(screen.getByRole('button', { name: 'existing' })).toBe(existing);
        expect(screen.queryByText('正在加载项目树')).toBeNull();
    });

    it('locates the active flow in the tree and disables the locate button when no flow is active', () => {
        const data = {
            ...createTree(['existing']),
            recentFlowPaths: ['_flows/existing/flow.yaml'],
        };
        const view = renderSidebar(data);
        const locateBtn = screen.getByRole('button', { name: '定位当前任务' }) as HTMLButtonElement;
        expect(locateBtn.disabled).toBe(true);

        view.rerender(
            <OfflineWorkbenchSidebar
                isGroupAdmin
                branch={{
                    label: 'feature/policy-review',
                    canSwitch: true,
                    menuOpen: false,
                    tooltipOpen: false,
                    loading: false,
                    switching: false,
                    branches: [{
                        name: 'feature/policy-review',
                        current: true,
                        local: true,
                        remote: false,
                        remoteName: null,
                        trackingBranch: null,
                    }],
                    dirtyState: null,
                    onToggleMenu: vi.fn(),
                    onMenuOpenChange: vi.fn(),
                    onTooltipOpenChange: vi.fn(),
                    onSwitch: vi.fn(),
                }}
                repository={{
                    available: true,
                    loading: false,
                    committing: false,
                    pushLoading: false,
                    canCommit: false,
                    canPush: false,
                    dirty: false,
                    ahead: false,
                    onRefresh: vi.fn(),
                    onOpenCommit: vi.fn(),
                    onOpenPush: vi.fn(),
                }}
                creation={{
                    canWrite: false,
                    menuOpen: false,
                    onMenuOpenChange: vi.fn(),
                    onOpenNewFlow: vi.fn(),
                    onOpenNewFolder: vi.fn(),
                }}
                tree={{
                    data,
                    loading: false,
                    flowLoading: false,
                    activeFlowPath: '_flows/existing/flow.yaml',
                    canWrite: false,
                    onOpenFlow: vi.fn(),
                    onContextMenu: vi.fn(),
                    onMoveNode: vi.fn(),
                }}
            />,
        );

        const activeLocateBtn = screen.getByRole('button', { name: '定位当前任务' }) as HTMLButtonElement;
        expect(activeLocateBtn.disabled).toBe(false);
        fireEvent.click(activeLocateBtn);
        expect(screen.getByTestId('repo-tree-double').getAttribute('data-revealed-flow')).toBe('_flows/existing/flow.yaml');
        expect(screen.getByTestId('repo-tree-double').getAttribute('data-recent-flows')).toBe('_flows/existing/flow.yaml');
    });

    it('highlights only the current branch with a check icon and shows switching spinner on trigger', () => {
        const data = createTree(['existing']);
        const view = render(
            <OfflineWorkbenchSidebar
                isGroupAdmin
                branch={{
                    label: 'main',
                    canSwitch: true,
                    menuOpen: true,
                    tooltipOpen: false,
                    loading: false,
                    switching: true,
                    branches: [
                        { name: 'main', current: true, local: true, remote: true, remoteName: 'origin/main', trackingBranch: 'origin/main' },
                        { name: 'develop', current: false, local: true, remote: true, remoteName: 'origin/develop', trackingBranch: 'origin/develop' },
                    ],
                    dirtyState: null,
                    onToggleMenu: vi.fn(),
                    onMenuOpenChange: vi.fn(),
                    onTooltipOpenChange: vi.fn(),
                    onSwitch: vi.fn(),
                }}
                repository={{
                    available: true,
                    loading: false,
                    committing: false,
                    pushLoading: false,
                    canCommit: false,
                    canPush: false,
                    dirty: false,
                    ahead: false,
                    onRefresh: vi.fn(),
                    onOpenCommit: vi.fn(),
                    onOpenPush: vi.fn(),
                }}
                creation={{
                    canWrite: true,
                    menuOpen: false,
                    onMenuOpenChange: vi.fn(),
                    onOpenNewFlow: vi.fn(),
                    onOpenNewFolder: vi.fn(),
                }}
                tree={{
                    data,
                    loading: false,
                    flowLoading: false,
                    activeFlowPath: null,
                    canWrite: true,
                    onOpenFlow: vi.fn(),
                    onContextMenu: vi.fn(),
                    onMoveNode: vi.fn(),
                }}
            />,
            { wrapper: TooltipProvider },
        );

        const trigger = screen.getByRole('button', { name: '切换分支，当前 main' });
        expect(trigger.querySelector('.offline-spin')).not.toBeNull();

        const currentRow = view.container.querySelector('.offline-branch-row.is-current');
        expect(currentRow?.textContent).toBe('main');
        expect(currentRow?.querySelector('.offline-branch-row-check')).not.toBeNull();

        const switchRow = screen.getByRole('button', { name: '切换到 develop' });
        expect(switchRow.querySelector('.offline-branch-row-check')).toBeNull();
    });

    it('filters tasks with IME protection, expands collapsed tree, clears on Escape/button, and resets on branch change', () => {
        const data = createTree(['alpha_task', 'beta_task']);
        const props = {
            isGroupAdmin: true,
            branch: {
                label: 'feature/policy-review',
                canSwitch: true,
                menuOpen: false,
                tooltipOpen: false,
                loading: false,
                switching: false,
                branches: [{
                    name: 'feature/policy-review',
                    current: true,
                    local: true,
                    remote: false,
                    remoteName: null,
                    trackingBranch: null,
                }],
                dirtyState: null,
                onToggleMenu: vi.fn(),
                onMenuOpenChange: vi.fn(),
                onTooltipOpenChange: vi.fn(),
                onSwitch: vi.fn(),
            },
            repository: {
                available: true,
                loading: false,
                committing: false,
                pushLoading: false,
                canCommit: false,
                canPush: false,
                dirty: false,
                ahead: false,
                onRefresh: vi.fn(),
                onOpenCommit: vi.fn(),
                onOpenPush: vi.fn(),
            },
            creation: {
                canWrite: true,
                menuOpen: false,
                onMenuOpenChange: vi.fn(),
                onOpenNewFlow: vi.fn(),
                onOpenNewFolder: vi.fn(),
            },
            tree: {
                data,
                loading: false,
                flowLoading: false,
                activeFlowPath: null,
                canWrite: true,
                onOpenFlow: vi.fn(),
                onContextMenu: vi.fn(),
                onMoveNode: vi.fn(),
            },
        };

        const view = render(<OfflineWorkbenchSidebar {...props} />, { wrapper: TooltipProvider });
        const search = screen.getByRole('searchbox', { name: '筛选任务' }) as HTMLInputElement;

        // Collapse root, then type a filter -> auto-expands tree.
        fireEvent.click(view.container.querySelector('button.offline-tree-root-label')!);
        expect(screen.queryByRole('button', { name: 'alpha_task' })).toBeNull();

        fireEvent.compositionStart(search);
        fireEvent.change(search, { target: { value: 'missing-ime' } });
        expect(search.value).toBe('missing-ime');
        expect(screen.queryByText('没有匹配的任务')).toBeNull();

        fireEvent.compositionEnd(search, { target: { value: 'alpha' } });
        expect(screen.getByRole('button', { name: 'alpha_task' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'beta_task' })).toBeNull();

        fireEvent.change(search, { target: { value: 'nonexistent' } });
        expect(screen.getByRole('status').textContent).toBe('没有匹配的任务');

        fireEvent.keyDown(search, { key: 'Escape' });
        expect(search.value).toBe('');
        expect(screen.getByRole('button', { name: 'beta_task' })).toBeTruthy();

        fireEvent.change(search, { target: { value: 'beta' } });
        expect(screen.queryByRole('button', { name: 'alpha_task' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '清空任务筛选' }));
        expect(search.value).toBe('');
        expect(screen.getByRole('button', { name: 'alpha_task' })).toBeTruthy();

        fireEvent.change(search, { target: { value: 'alpha' } });
        view.rerender(
            <OfflineWorkbenchSidebar
                {...props}
                branch={{ ...props.branch, label: 'main' }}
            />,
        );
        expect(search.value).toBe('');
        expect(screen.getByRole('button', { name: 'beta_task' })).toBeTruthy();
    });

    it('keeps branch menu focused on branches even when repository is dirty', () => {
        const data = createTree(['alpha_task']);

        render(
            <OfflineWorkbenchSidebar
                isGroupAdmin
                branch={{
                    label: 'feature/policy-review',
                    canSwitch: true,
                    menuOpen: true,
                    tooltipOpen: false,
                    loading: false,
                    switching: false,
                    branches: [
                        { name: 'feature/policy-review', current: true, local: true, remote: false, remoteName: null, trackingBranch: null },
                        { name: 'main', current: false, local: true, remote: false, remoteName: null, trackingBranch: null },
                    ],
                    dirtyState: null,
                    onToggleMenu: vi.fn(),
                    onMenuOpenChange: vi.fn(),
                    onTooltipOpenChange: vi.fn(),
                    onSwitch: vi.fn(),
                }}
                repository={{
                    available: true,
                    loading: false,
                    committing: false,
                    pushLoading: false,
                    canCommit: true,
                    canPush: false,
                    dirty: true,
                    ahead: false,
                    onRefresh: vi.fn(),
                    onOpenCommit: vi.fn(),
                    onOpenPush: vi.fn(),
                }}
                creation={{
                    canWrite: true,
                    menuOpen: false,
                    onMenuOpenChange: vi.fn(),
                    onOpenNewFlow: vi.fn(),
                    onOpenNewFolder: vi.fn(),
                }}
                tree={{
                    data,
                    loading: false,
                    flowLoading: false,
                    activeFlowPath: null,
                    canWrite: true,
                    onOpenFlow: vi.fn(),
                    onContextMenu: vi.fn(),
                    onMoveNode: vi.fn(),
                }}
            />,
            { wrapper: TooltipProvider },
        );

        expect(screen.queryByText('有未提交改动')).toBeNull();
        expect(screen.queryByText('还有已保存但未提交的任务')).toBeNull();
        expect(screen.getAllByText('feature/policy-review').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: '切换到 main' })).toBeTruthy();
    });
});
