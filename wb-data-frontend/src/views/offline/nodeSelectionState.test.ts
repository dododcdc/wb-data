import { describe, expect, it } from 'vitest';

import { resolveSelectionStateAfterAddingNode } from './nodeSelectionState';

describe('resolveSelectionStateAfterAddingNode', () => {
    it('preserves checkbox-selected tasks while focusing the new node', () => {
        expect(resolveSelectionStateAfterAddingNode({
            currentSelectedTaskIds: ['node-a'],
            newTaskId: 'node-d',
        })).toEqual({
            nextActiveNodeId: 'node-d',
            nextSelectedTaskIds: ['node-a'],
        });
    });
});
