import { describe, expect, it } from 'vitest';
import type { OperationsRerunGraphEdge } from '../../api/operations';
import { toggleRerunNodeSelection } from './rerunSelection';

describe('toggleRerunNodeSelection', () => {
    const chainEdges: OperationsRerunGraphEdge[] = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'd' },
    ];
    const order = ['a', 'b', 'c', 'd'];

    it('blocks unselecting required nodes and returns required reason', () => {
        const result = toggleRerunNodeSelection(
            new Set(['c', 'd']),
            'c',
            chainEdges,
            new Set(['c', 'd']),
            order,
        );
        expect(result.blockedReason).toBe('required');
        expect(Array.from(result.nextSelected)).toEqual(['c', 'd']);
    });

    it('auto-selects intermediate path nodes when selecting a disconnected upstream ancestor', () => {
        const result = toggleRerunNodeSelection(
            new Set(['c', 'd']),
            'a',
            chainEdges,
            new Set(['c', 'd']),
            order,
        );
        expect(result.blockedReason).toBeNull();
        expect(result.autoAdded).toEqual(['b']);
        expect(Array.from(result.nextSelected)).toEqual(['c', 'd', 'a', 'b']);
    });

    it('cascades deselection to upstream ancestors when unchecking a bridge node', () => {
        const result = toggleRerunNodeSelection(
            new Set(['a', 'b', 'c', 'd']),
            'b',
            chainEdges,
            new Set(['c', 'd']),
            order,
        );
        expect(result.blockedReason).toBeNull();
        expect(result.autoRemoved).toEqual(['a']);
        expect(Array.from(result.nextSelected)).toEqual(['c', 'd']);
    });

    it('does not pull in sibling branches or auto-select outside diamond paths', () => {
        const diamondEdges: OperationsRerunGraphEdge[] = [
            { source: 'a', target: 'b' },
            { source: 'a', target: 'c' },
            { source: 'b', target: 'd' },
            { source: 'c', target: 'd' },
        ];
        // When d is selected/required and user checks a, both intermediate branches b & c form paths a->b->d and a->c->d
        const fromLeaf = toggleRerunNodeSelection(
            new Set(['d']),
            'a',
            diamondEdges,
            new Set(['d']),
            ['a', 'b', 'c', 'd'],
        );
        expect(fromLeaf.autoAdded).toEqual(['b', 'c']);
        expect(Array.from(fromLeaf.nextSelected)).toEqual(['d', 'a', 'b', 'c']);

        // When only branch b->d is required and user selects a, sibling c is also between a and d, so c is added;
        // whereas in fork a->b, a->c with c required, checking b does NOT add c's siblings unless c isn't descendant of b.
        const forkEdges: OperationsRerunGraphEdge[] = [
            { source: 'a', target: 'b' },
            { source: 'a', target: 'c' },
        ];
        const forkPickB = toggleRerunNodeSelection(
            new Set(['c']),
            'b',
            forkEdges,
            new Set(['c']),
            ['a', 'b', 'c'],
        );
        expect(forkPickB.autoAdded).toEqual([]);
        expect(Array.from(forkPickB.nextSelected)).toEqual(['c', 'b']);
    });
});
