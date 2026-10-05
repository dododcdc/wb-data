import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileTree, FileTreeDirectoryHandle, FileTreeDragAndDropConfig, FileTreeDropResult, FileTreeOptions } from '@pierre/trees';
import type { FileTree as FileTreeRenderer } from '@pierre/trees/react';

import type { OfflineRepoTreeNode } from '../../api/offline';
import { OfflineRepoTree, type OfflineRepoTreeHandle } from './OfflineRepoTree';

let model: FileTree;
let options: FileTreeOptions;
let rendererProps: ComponentProps<typeof FileTreeRenderer>;
vi.mock('@pierre/trees/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@pierre/trees/react')>();
    return {
        ...actual,
        useFileTree: (input: FileTreeOptions) => {
            const result = actual.useFileTree(input);
            if (model !== result.model) options = input;
            model = result.model;
            return result;
        },
        // Keep the real model, selection notifications, search and mutations; omit only the visual renderer.
        FileTree: (input: ComponentProps<typeof FileTreeRenderer>) => {
            rendererProps = input;
            return <div data-testid="file-tree" />;
        },
    };
});

afterEach(cleanup);

function node(kind: OfflineRepoTreeNode['kind'], path: string, children: OfflineRepoTreeNode[] = []): OfflineRepoTreeNode {
    return {
        id: path, kind, name: path.split('/').pop() ?? 'root',
        path: kind === 'FLOW' ? `_flows/${path}/flow.yaml` : `_flows/${path}`,
        children, scheduleState: 'NONE', schedulePeriod: null, dependencyCount: 0,
    };
}

const root = node('ROOT', '', [
    node('DIRECTORY', 'x', [
        node('FLOW', 'x/task'),
        node('DIRECTORY', 'x/sub', [node('FLOW', 'x/sub/leaf')]),
        node('DIRECTORY', 'x/closed'),
    ]),
    node('DIRECTORY', 'y', [node('FLOW', 'y/task'), node('FLOW', 'y/sub')]),
    node('DIRECTORY', 'z', [node('DIRECTORY', 'z/task'), node('DIRECTORY', 'z/sub')]),
]);

function mount(overrides: Partial<ComponentProps<typeof OfflineRepoTree>> = {}) {
    const props = { root, dataKey: '4:main', selectedTreePath: null, canWrite: true, onOpenFlow: vi.fn(), ...overrides };
    const ref = createRef<OfflineRepoTreeHandle>();
    return { ...render(<OfflineRepoTree {...props} ref={ref} />), props, ref };
}

function directory(path: string) {
    return model.getItem(path) as FileTreeDirectoryHandle;
}

function drop(draggedPaths: string[], directoryPath: string | null): FileTreeDropResult {
    return {
        draggedPaths, operation: 'move',
        target: { directoryPath, flattenedSegmentPath: null, hoveredPath: directoryPath, kind: directoryPath ? 'directory' : 'root' },
    };
}

function dragOptions() {
    return options.dragAndDrop as FileTreeDragAndDropConfig;
}

describe('OfflineRepoTree with the real Trees model', () => {
    it('uses the page font at 14px without changing virtual row height', () => {
        mount();
        expect(rendererProps.style).toMatchObject({
            '--trees-font-family-override': 'var(--font-sans)',
            '--trees-font-size-override': '0.875rem',
        });
        expect(options.itemHeight).toBe(30);
    });

    it('exposes full names across the shadow boundary and updates recycled labels without replacing badge titles', () => {
        const view = mount();
        const shadow = screen.getByTestId('file-tree').attachShadow({ mode: 'open' });
        const row = document.createElement('button');
        row.dataset.type = 'item';
        const label = document.createElement('div');
        label.dataset.itemSection = 'content';
        const text = document.createElement('span');
        text.textContent = 'crm…';
        label.append(text);
        const badge = document.createElement('span');
        badge.title = '天调度 · 已启用';
        row.append(label, badge);
        shadow.append(row);
        for (const name of ['crm_sales_daily_analysis', '每日销售分析_含中文及"引号"']) {
            row.setAttribute('aria-label', name);
            fireEvent.mouseMove(text, { composed: true });
            expect(label.title).toBe(name);
        }
        fireEvent.mouseMove(badge, { composed: true });
        expect(badge.title).toBe('天调度 · 已启用');
        expect(row.hasAttribute('title')).toBe(false);
        expect(view.props.onOpenFlow).not.toHaveBeenCalled();
    });

    it('renders schedule badges from the initial tree without selecting or opening a flow', async () => {
        const { renderScheduleBadge } = await import('./offlineTreeBadges');
        const view = mount({
            root: node('ROOT', '', [
                { ...node('FLOW', 'daily'), scheduleState: 'ENABLED', schedulePeriod: 'DAILY' },
                { ...node('FLOW', 'weekly'), scheduleState: 'DISABLED', schedulePeriod: 'WEEKLY' },
                node('FLOW', 'plain'),
            ]),
            renderBadge: renderScheduleBadge,
        });
        const decorations = Object.fromEntries(model.getVisibleRows(0, model.getVisibleCount() - 1)
            .map((row) => [row.path, options.renderRowDecoration?.({ item: row, row })?.title ?? null]));
        expect(decorations).toEqual({ daily: '天调度 · 已启用', weekly: '周调度 · 已停用', plain: null });
        expect(model.getSelectedPaths()).toEqual([]);
        expect(view.props.onOpenFlow).not.toHaveBeenCalled();
    });

    it('synchronizes programmatic selection, refreshes and clearing without opening a flow', () => {
        const view = mount({ selectedTreePath: 'x/task' });
        expect(model.getSelectedPaths()).toEqual(['x/task']);
        view.rerender(<OfflineRepoTree {...view.props} selectedTreePath="y/task" />);
        expect(model.getSelectedPaths()).toEqual(['y/task']);
        view.rerender(<OfflineRepoTree {...view.props} root={{ ...root }} selectedTreePath="y/task" />);
        expect(model.getSelectedPaths()).toEqual(['y/task']);
        // Clearing a multi-selection emits an intermediate selection containing the other flow.
        act(() => model.getItem('x/task')!.select());
        expect(model.getSelectedPaths()).toEqual(['y/task', 'x/task']);
        view.rerender(<OfflineRepoTree {...view.props} selectedTreePath={null} />);
        expect(model.getSelectedPaths()).toEqual([]);
        expect(view.props.onOpenFlow).not.toHaveBeenCalled();
    });

    it('opens a user-selected flow once, without repeating it during parent synchronization', () => {
        const view = mount();
        act(() => model.getItem('x/task')!.select());
        expect(view.props.onOpenFlow).toHaveBeenCalledTimes(1);
        expect(view.props.onOpenFlow).toHaveBeenCalledWith('_flows/x/task/flow.yaml');
        view.rerender(<OfflineRepoTree {...view.props} root={{ ...root }} selectedTreePath="x/task" />);
        act(() => model.getItem('x/task')!.select());
        expect(view.props.onOpenFlow).toHaveBeenCalledTimes(1);
    });

    it('preserves expanded descendants hidden under a collapsed parent on root updates', () => {
        const view = mount();
        act(() => {
            directory('x/closed/').collapse();
            directory('x/').collapse();
        });
        expect(directory('x/sub/').isExpanded()).toBe(true);
        expect(model.getVisibleRows(0, model.getVisibleCount()).map((row) => row.path)).not.toContain('x/sub/');

        view.rerender(<OfflineRepoTree {...view.props} root={{ ...root, children: [...root.children, node('FLOW', 'new')] }} />);
        expect.soft(directory('x/').isExpanded()).toBe(false);
        expect(directory('x/sub/').isExpanded()).toBe(true);
        expect(directory('x/closed/').isExpanded()).toBe(false);
        act(() => directory('x/').expand());
        expect(model.getVisibleRows(0, model.getVisibleCount()).map((row) => row.path)).toContain('x/sub/leaf');
    });

    it('expands all directories again when the repository scope changes', () => {
        const view = mount();
        act(() => directory('x/').collapse());
        view.rerender(<OfflineRepoTree {...view.props} dataKey="4:feature" />);
        expect(directory('x/').isExpanded()).toBe(true);
    });

    it.each([null, ''])('shows no-match feedback and restores the tree when search is cleared with %s', (clearValue) => {
        const view = mount();
        act(() => view.ref.current!.setSearch('missing-directory'));
        expect(model.getSearchMatchingPaths()).toEqual([]);
        expect(screen.getByRole('status').textContent).toBe('没有匹配的目录');
        expect(screen.getByTestId('file-tree').parentElement!.hidden).toBe(true);
        act(() => view.ref.current!.setSearch(clearValue));
        expect(model.getSearchValue()).toBe('');
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByTestId('file-tree').parentElement!.hidden).toBe(false);
        expect(view.props.onOpenFlow).not.toHaveBeenCalled();
    });

    it('recomputes no-match feedback when refreshed directories match the active search', () => {
        const view = mount({ directoriesOnly: true, readonly: true });
        act(() => view.ref.current!.setSearch('new-directory'));
        expect(screen.getByRole('status')).toBeTruthy();
        view.rerender(<OfflineRepoTree {...view.props} root={{ ...root, children: [...root.children, node('DIRECTORY', 'new-directory')] }} />);
        expect(screen.queryByRole('status')).toBeNull();
        expect(model.getSearchMatchingPaths()).toContain('new-directory/');
        view.rerender(<OfflineRepoTree {...view.props} />);
        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('searches directories without selecting them and omits context menus and dragging in readonly pickers', () => {
        const onSelectDirectory = vi.fn();
        const view = mount({ directoriesOnly: true, readonly: true, canWrite: false, onSelectDirectory });
        expect(model.getItem('x/task')).toBeNull();
        expect(model.getComposition()?.contextMenu).toBeUndefined();
        expect(rendererProps.renderContextMenu).toBeUndefined();
        expect(options.dragAndDrop).toBe(false);
        act(() => view.ref.current!.setSearch('missing-directory'));
        act(() => view.ref.current!.setSearch('sub'));
        expect(model.getSearchMatchingPaths()).toContain('x/sub/');
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByTestId('file-tree').parentElement!.hidden).toBe(false);
        expect(onSelectDirectory).not.toHaveBeenCalled();
        act(() => model.getItem('x/sub/')!.select());
        expect(onSelectDirectory).toHaveBeenCalledTimes(1);
        expect(onSelectDirectory).toHaveBeenCalledWith('x/sub/');
        expect(view.props.onOpenFlow).not.toHaveBeenCalled();
    });

    it('checks current write permission and only accepts single-node drags', () => {
        const view = mount();
        const drag = dragOptions();
        expect(drag.canDrag!(['x/task'])).toBe(true);
        expect(drag.canDrag!([])).toBe(false);
        expect(drag.canDrag!(['x/task', 'y/task'])).toBe(false);
        expect(drag.canDrop!(drop([], null))).toBe(false);
        expect(drag.canDrop!(drop(['x/task', 'y/task'], null))).toBe(false);
        view.rerender(<OfflineRepoTree {...view.props} canWrite={false} />);
        expect(drag.canDrag!(['x/task'])).toBe(false);
        expect(drag.canDrop!(drop(['x/task'], null))).toBe(false);
        view.rerender(<OfflineRepoTree {...view.props} />);
        expect(drag.canDrag!(['x/task'])).toBe(true);
        expect(drag.canDrop!(drop(['x/task'], null))).toBe(true);
    });

    it.each([
        ['x/task', 'x/'], // unchanged parent
        ['x/', null],
        ['x/', 'x/'], // self
        ['x/', 'x/sub/'], // descendant
        ['x/task', 'y/'], // flow collides with flow
        ['x/task', 'z/'], // flow collides with directory
        ['x/sub/', 'y/'], // directory collides with flow
        ['x/sub/', 'z/'], // directory collides with directory
    ])('rejects dropping %s into %s', (source, target) => {
        mount();
        expect(dragOptions().canDrop!(drop([source!], target))).toBe(false);
    });

    it('adopts a successful move only when the server root is refreshed', async () => {
        let finishMove!: () => void;
        const pending = new Promise<void>((resolve) => { finishMove = resolve; });
        const view = mount({ onMoveNode: () => pending });
        let completion: unknown;
        act(() => {
            model.move('x/task', 'task');
            completion = dragOptions().onDropComplete!(drop(['x/task'], null));
        });
        expect(model.getItem('x/task')).not.toBeNull();
        expect(model.getItem('task')).toBeNull();
        await act(async () => {
            finishMove();
            await completion;
        });
        expect(model.getItem('x/task')).not.toBeNull();
        expect(model.getItem('task')).toBeNull();
        const refreshedRoot = { ...root, children: [
            { ...root.children[0], children: root.children[0].children.filter((child) => child.path !== '_flows/x/task/flow.yaml') },
            ...root.children.slice(1), node('FLOW', 'task'),
        ] };
        view.rerender(<OfflineRepoTree {...view.props} root={refreshedRoot} />);
        expect(model.getItem('x/task')).toBeNull();
        expect(model.getItem('task')).not.toBeNull();
        expect(view.props.onOpenFlow).not.toHaveBeenCalled();
    });

    it.each(['x/task', 'x/sub/'])('restores server paths immediately after optimistic movement of %s and retains them on failure', async (source) => {
        let rejectMove!: (error: Error) => void;
        const pending = new Promise<void>((_resolve, reject) => { rejectMove = reject; });
        const onMoveNode = vi.fn(() => pending);
        const onOpenFlow = vi.fn();
        const view = mount({ onMoveNode, onOpenFlow });
        const next = source.slice(2);
        const drag = dragOptions();
        expect(drag.canDrop!(drop([source], null))).toBe(true);
        act(() => model.getItem(source)!.select());
        const opensBeforeMove = onOpenFlow.mock.calls.length;
        let completion: unknown;
        act(() => {
            // Trees moves before invoking onDropComplete; exercise that real mutation, not a stubbed reset.
            model.move(source, next);
            expect(model.getItem(source)).toBeNull();
            expect(model.getItem(next)).not.toBeNull();
            completion = drag.onDropComplete!(drop([source], null));
        });
        expect(onMoveNode).toHaveBeenCalledTimes(1);
        expect(onMoveNode).toHaveBeenCalledWith(source, next);
        expect(model.getItem(source)).not.toBeNull();
        expect(model.getItem('x/sub/leaf')).not.toBeNull();
        expect(model.getItem(next)).toBeNull();
        expect(drag.canDrag!(['y/task'])).toBe(false);
        expect(drag.canDrop!(drop(['y/task'], null))).toBe(false);
        act(() => model.getItem('y/task')!.select());
        expect(view.props.onOpenFlow).toHaveBeenCalledTimes(opensBeforeMove);

        const rejection = expect(completion).rejects.toThrow('move failed');
        await act(async () => {
            rejectMove(new Error('move failed'));
            await rejection;
        });
        expect(model.getItem(source)).not.toBeNull();
        expect(model.getItem('x/sub/leaf')).not.toBeNull();
        expect(model.getItem(next)).toBeNull();
        expect(drag.canDrag!(['y/task'])).toBe(true);
        expect(drag.canDrop!(drop(['y/task'], null))).toBe(true);
    });
});
