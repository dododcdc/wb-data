import { describe, expect, it } from 'vitest';

import { createDefaultFieldMappings } from './transferMapping';

describe('createDefaultFieldMappings', () => {
    it('maps target columns to same-name source columns', () => {
        expect(createDefaultFieldMappings(['id', 'created_at'], ['id', 'amount'])).toEqual([
            { target: 'id', kind: 'source_field', source: 'id' },
            { target: 'amount', kind: 'source_field' },
        ]);
    });
});
