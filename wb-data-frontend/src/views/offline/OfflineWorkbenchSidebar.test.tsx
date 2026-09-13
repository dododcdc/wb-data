import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OfflineRepoTreeResponse } from '../../api/offline';
import { TooltipProvider } from '../../components/ui/tooltip';
import { OfflineWorkbenchSidebar } from './OfflineWorkbenchSidebar';

function createTree(flowNames: string[]): OfflineRepoTreeResponse {
    return {
        groupId: 4,
        root: {
            id: '_flows',
            kind: 'ROOT',
            name: 'policy',
            path: '_flows',
            children: flowNames.map((name) => ({
                id: `_flows/${name}/flow.yaml`,
                kind: 'FLOW',
                name,
                path: `_flows/${name}/flow.yaml`,
                children: [],
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
            onOpenFlow: vi.fn(),
            onContextMenu: vi.fn(),
        },
    };

    const view = render(<OfflineWorkbenchSidebar {...props} />, { wrapper: TooltipProvider });
    return {
        ...view,
        rerenderTree(nextTreeData: OfflineRepoTreeResponse) {
            view.rerender(
                <OfflineWorkbenchSidebar
                    {...props}
                    tree={{ ...props.tree, data: nextTreeData }}
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

        expect(screen.getByRole('button', { name: 'existing' })).toBeTruthy();
        fireEvent.click(root!);
        expect(screen.queryByRole('button', { name: 'existing' })).toBeNull();

        view.rerenderTree(createTree(['existing', 'test1']));

        expect(screen.queryByRole('button', { name: 'existing' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'test1' })).toBeNull();
    });
});
