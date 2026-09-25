import { describe, expect, it } from 'vitest';

import type { OfflineRepoTreeNode } from '../../api/offline';
import {
    flattenRepoTreePaths,
    flowApiPathToTreePath,
    indexNodesByTreePath,
    moveTreePath,
    toTreePath,
    treePathToFlowApiPath,
    treePathToFolderApiPath,
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
});
