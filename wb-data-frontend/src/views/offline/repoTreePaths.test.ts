import { describe, expect, it } from 'vitest';

import type { OfflineFlowDocument, OfflineRepoTreeNode } from '../../api/offline';
import {
    RECENT_FLOWS_DIR_PATH,
    buildRepoTreeEntries,
    flattenRepoTreePaths,
    flowApiPathToTreePath,
    getAncestorDirectoryTreePaths,
    indexNodesByTreePath,
    isRecentFlowsTreePath,
    moveTreePath,
    prependRecentFlowPath,
    toTreePath,
    treePathToFlowApiPath,
    treePathToFolderApiPath,
    updateRepoTreeFlowStatus,
} from './repoTreePaths';

function flow(path: string, name: string): OfflineRepoTreeNode {
    return {
        id: path,
        kind: 'FLOW',
        name,
        path,
        children: [],
        scheduleState: 'NONE',
        schedulePeriod: null,
        dependencyCount: 0,
    };
}

function directory(path: string, name: string, children: OfflineRepoTreeNode[]): OfflineRepoTreeNode {
    return {
        id: path,
        kind: 'DIRECTORY',
        name,
        path,
        children,
        scheduleState: 'NONE',
        schedulePeriod: null,
        dependencyCount: 0,
    };
}

function root(children: OfflineRepoTreeNode[]): OfflineRepoTreeNode {
    return {
        id: 'root',
        kind: 'ROOT',
        name: 'Team',
        path: '',
        children,
        scheduleState: 'NONE',
        schedulePeriod: null,
        dependencyCount: 0,
    };
}

describe('toTreePath', () => {
    it('strips the _flows prefix and flow.yaml suffix for flows', () => {
        expect(toTreePath(flow('_flows/x/task-a/flow.yaml', 'task-a'))).toBe('x/task-a');
        expect(toTreePath(flow('_flows/task-a/flow.yaml', 'task-a'))).toBe('task-a');
    });

    it('marks directories with a trailing slash', () => {
        expect(toTreePath(directory('_flows/x', 'x', []))).toBe('x/');
        expect(toTreePath(directory('_flows/x/y', 'y', []))).toBe('x/y/');
    });
});

describe('api path mapping', () => {
    it('round-trips flow paths', () => {
        expect(treePathToFlowApiPath('x/task-a')).toBe('_flows/x/task-a/flow.yaml');
        expect(flowApiPathToTreePath('_flows/x/task-a/flow.yaml')).toBe('x/task-a');
    });

    it('round-trips folder paths', () => {
        expect(treePathToFolderApiPath('x/y/')).toBe('_flows/x/y');
    });
});

describe('moveTreePath', () => {
    it('moves a flow into a target directory', () => {
        expect(moveTreePath('x/task-a', 'y/')).toBe('y/task-a');
    });

    it('moves a directory preserving its trailing slash', () => {
        expect(moveTreePath('x/sub/', 'y/z/')).toBe('y/z/sub/');
    });

    it('moves to the tree root when target is null', () => {
        expect(moveTreePath('x/task-a', null)).toBe('task-a');
        expect(moveTreePath('x/sub/', null)).toBe('sub/');
    });
});

describe('flattenRepoTreePaths', () => {
    it('flattens the tree depth-first including empty directories', () => {
        const tree = root([
            directory('_flows/x', 'x', [
                flow('_flows/x/task-a/flow.yaml', 'task-a'),
                directory('_flows/x/empty', 'empty', []),
            ]),
            flow('_flows/task-b/flow.yaml', 'task-b'),
        ]);
        expect(flattenRepoTreePaths(tree)).toEqual([
            'x/',
            'x/task-a',
            'x/empty/',
            'task-b',
        ]);
    });

    it('indexes nodes by their tree path', () => {
        const tree = root([
            directory('_flows/x', 'x', [flow('_flows/x/task-a/flow.yaml', 'task-a')]),
        ]);
        const index = indexNodesByTreePath(tree);
        expect(index.get('x/')?.kind).toBe('DIRECTORY');
        expect(index.get('x/task-a')?.kind).toBe('FLOW');
    });

    it('builds recent flow entries capped at 5 and maps them to canonical flow nodes', () => {
        const tree = root([
            directory('_flows/x', 'x', [
                flow('_flows/x/task-1/flow.yaml', 'task-1'),
                flow('_flows/x/task-2/flow.yaml', 'task-2'),
                flow('_flows/x/task-3/flow.yaml', 'task-3'),
                flow('_flows/x/task-4/flow.yaml', 'task-4'),
                flow('_flows/x/task-5/flow.yaml', 'task-5'),
                flow('_flows/x/task-6/flow.yaml', 'task-6'),
            ]),
        ]);
        const entries = buildRepoTreeEntries(tree, {
            recentFlowPaths: [
                '_flows/x/task-3/flow.yaml',
                '_flows/x/missing/flow.yaml',
                '_flows/x/task-1/flow.yaml',
                '_flows/x/task-2/flow.yaml',
                '_flows/x/task-4/flow.yaml',
                '_flows/x/task-5/flow.yaml',
                '_flows/x/task-6/flow.yaml',
            ],
        });
        expect(entries.paths.slice(0, 5)).toEqual([
            RECENT_FLOWS_DIR_PATH,
            '最近操作/task-3',
            '最近操作/task-1',
            '最近操作/task-2',
            '最近操作/task-4',
        ]);
        expect(entries.nodeIndex.get('最近操作/task-3')?.path).toBe('_flows/x/task-3/flow.yaml');
        expect(entries.nodeIndex.has(RECENT_FLOWS_DIR_PATH)).toBe(false);
        expect(isRecentFlowsTreePath(RECENT_FLOWS_DIR_PATH)).toBe(true);
        expect(isRecentFlowsTreePath('最近操作/task-3')).toBe(true);
        expect(isRecentFlowsTreePath('x/task-3')).toBe(false);
    });

    it('computes ancestor directory paths and prepends recent flows in LRU order', () => {
        expect(getAncestorDirectoryTreePaths('x/sub/leaf')).toEqual(['x/', 'x/sub/']);
        expect(getAncestorDirectoryTreePaths('root-task')).toEqual([]);

        const initial = ['_flows/a/flow.yaml', '_flows/b/flow.yaml'];
        expect(prependRecentFlowPath(initial, '_flows/a/flow.yaml')).toBe(initial);
        expect(prependRecentFlowPath(initial, '_flows/b/flow.yaml')).toEqual([
            '_flows/b/flow.yaml',
            '_flows/a/flow.yaml',
        ]);
    });
});

describe('updateRepoTreeFlowStatus', () => {
    const document: OfflineFlowDocument = {
        groupId: 4,
        path: '_flows/x/task-a/flow.yaml',
        flowId: 'task-a',
        namespace: 'team',
        documentHash: 'persisted-hash',
        documentUpdatedAt: 123,
        stages: [], edges: [], layout: {},
        schedule: { enabled: true, period: 'DAILY', cron: '0 0 * * *', timezone: 'UTC' },
        dependencyConfig: {
            dependencies: [{ groupId: 4, flowId: 'upstream-a' }, { groupId: 5, flowId: 'upstream-b' }],
            failurePolicy: 'PAUSE', crossGroupDependency: 'ALLOW',
        },
    };

    it.each([true, false])('maps persisted schedule enabled=%s and dependency count, copying only the affected branch', (enabled) => {
        const target = flow(document.path, 'task-a');
        const sibling = flow('_flows/x/task-b/flow.yaml', 'task-b');
        const untouched = directory('_flows/y', 'y', []);
        const tree = root([directory('_flows/x', 'x', [target, sibling]), untouched]);
        const updated = updateRepoTreeFlowStatus(tree, {
            ...document, schedule: { ...document.schedule!, enabled },
        });

        expect(updated).not.toBe(tree);
        expect(updated.children[0]).not.toBe(tree.children[0]);
        expect(updated.children[0].children[0]).toEqual({
            ...target, scheduleState: enabled ? 'ENABLED' : 'DISABLED', schedulePeriod: 'DAILY', dependencyCount: 2,
        });
        expect(updated.children[0].children[1]).toBe(sibling);
        expect(updated.children[1]).toBe(untouched);
        expect(target.scheduleState).toBe('NONE');
        expect(target.dependencyCount).toBe(0);
    });

    it.each([null, undefined])('clears status when the persisted document has schedule=%s and no dependency config', (schedule) => {
        const target = { ...flow(document.path, 'task-a'), scheduleState: 'DISABLED' as const, schedulePeriod: 'WEEKLY' as const, dependencyCount: 3 };
        const tree = root([target]);
        const updated = updateRepoTreeFlowStatus(tree, { ...document, schedule, dependencyConfig: undefined });
        expect(updated.children[0]).toEqual({ ...target, scheduleState: 'NONE', schedulePeriod: null, dependencyCount: 0 });
        expect(target.dependencyCount).toBe(3);
    });

    it('keeps all references when status is unchanged, even if other persisted document fields differ', () => {
        const tree = updateRepoTreeFlowStatus(root([directory('_flows/x', 'x', [flow(document.path, 'task-a')])]), document);
        const updated = updateRepoTreeFlowStatus(tree, {
            ...document,
            documentHash: 'new-persisted-hash',
            schedule: { ...document.schedule!, cron: '0 1 * * *' },
            dependencyConfig: {
                ...document.dependencyConfig!,
                dependencies: [{ groupId: 4, flowId: 'other-a' }, { groupId: 4, flowId: 'other-b' }],
            },
        });
        expect(updated).toBe(tree);
        expect(updated.children).toBe(tree.children);
        expect(updated.children[0].children[0]).toBe(tree.children[0].children[0]);
    });

    it('keeps the root reference when the saved flow is not in the tree', () => {
        const tree = root([flow('_flows/unrelated/flow.yaml', 'unrelated')]);
        expect(updateRepoTreeFlowStatus(tree, document)).toBe(tree);
    });
});
