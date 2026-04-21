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
});
