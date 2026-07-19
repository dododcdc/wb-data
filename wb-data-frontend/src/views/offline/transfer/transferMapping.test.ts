import { describe, expect, it } from 'vitest';

import { createDefaultFieldMappings, reconcileTargetMappings } from './transferMapping';

describe('createDefaultFieldMappings', () => {
    it('maps target columns to same-name source columns', () => {
        expect(createDefaultFieldMappings(['id', 'created_at'], ['id', 'amount'])).toEqual([
            { target: 'id', kind: 'source_field', source: 'id' },
            { target: 'amount', kind: 'source_field' },
        ]);
    });
});

describe('reconcileTargetMappings', () => {
    it('fills late same-name source metadata and drops stale target columns', () => {
        expect(reconcileTargetMappings(
            [
                { target: 'id', kind: 'source_field' },
                { target: 'old_amount', kind: 'source_field', source: 'old_amount' },
                { target: 'kept_expression', kind: 'source_expression', expression: 'price * qty' },
            ],
            ['id', 'kept_expression'],
            ['id', 'new_amount', 'kept_expression'],
        )).toEqual([
            { target: 'id', kind: 'source_field', source: 'id' },
            { target: 'new_amount', kind: 'source_field' },
            { target: 'kept_expression', kind: 'source_expression', expression: 'price * qty' },
        ]);
    });
});
