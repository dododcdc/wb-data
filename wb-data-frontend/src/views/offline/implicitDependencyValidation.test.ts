import { describe, expect, it } from 'vitest';

import { hasImplicitDependenciesAfterSaveRoundTrip } from './implicitDependencyValidation';

describe('hasImplicitDependenciesAfterSaveRoundTrip', () => {
    it('returns true when a disconnected node would become an implicit dependency after save', () => {
        expect(hasImplicitDependenciesAfterSaveRoundTrip({
            nodeIds: ['a', 'b', 'c'],
            edges: [{ source: 'a', target: 'b' }],
        })).toBe(true);
    });

    it('returns false when every save-time dependency is already explicitly drawn', () => {
        expect(hasImplicitDependenciesAfterSaveRoundTrip({
            nodeIds: ['a', 'b', 'c'],
            edges: [
                { source: 'a', target: 'b' },
                { source: 'c', target: 'b' },
            ],
        })).toBe(false);
    });

    it('returns true for a layered graph that would gain c to b after save round-trip', () => {
        expect(hasImplicitDependenciesAfterSaveRoundTrip({
            nodeIds: ['a', 'b', 'c', 'd'],
            edges: [
                { source: 'a', target: 'b' },
                { source: 'b', target: 'd' },
                { source: 'c', target: 'd' },
            ],
        })).toBe(true);
    });

    it('detects missing explicit edge when delimiter collision occurs', () => {
        // Edge set flattening with '---' can collide: 'a---b' + '---' + 'c' == 'a' + '---' + 'b---c'
        expect(hasImplicitDependenciesAfterSaveRoundTrip({
            nodeIds: ['a---b', 'a', 'b---c', 'c', 'd'],
            edges: [
                { source: 'a', target: 'b---c' },
                { source: 'd', target: 'c' },
            ],
        })).toBe(true);
    });

    it('fails safe when collision hides a missing explicit edge (regression)', () => {
        // Setup where the only missing explicit edge is: 'a---b' -> 'c'
        // but another explicit edge 'a' -> 'b---c' flattens to the same key 'a---b---c'
        // If the implementation uses string concatenation, the missing edge may be hidden.
        expect(hasImplicitDependenciesAfterSaveRoundTrip({
            nodeIds: ['a---b', 'a', 'b---c', 'c', 'd'],
            edges: [
                { source: 'a', target: 'b---c' },
                { source: 'a', target: 'c' },
                { source: 'd', target: 'c' },
                { source: 'c', target: 'b---c' },
            ],
        })).toBe(true);
    });
});
