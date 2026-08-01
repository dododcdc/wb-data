import { describe, expect, it } from 'vitest';

import { resolveTransferDatabaseSelection } from './transferDatabaseSelection';

describe('resolveTransferDatabaseSelection', () => {
    it('selects the configured default database when available', () => {
        expect(resolveTransferDatabaseSelection(undefined, 'transfer_demo', ['transfer_demo', 'archive']))
            .toEqual({ database: 'transfer_demo', unavailable: false });
    });

    it('selects the only available database when the configured default is unavailable', () => {
        expect(resolveTransferDatabaseSelection(undefined, 'missing', ['default']))
            .toEqual({ database: 'default', unavailable: false });
    });

    it('requires an explicit selection when multiple databases have no available default', () => {
        expect(resolveTransferDatabaseSelection(undefined, 'missing', ['a', 'b']))
            .toEqual({ database: undefined, unavailable: false });
    });

    it('preserves an available saved database', () => {
        expect(resolveTransferDatabaseSelection('archive', 'transfer_demo', ['transfer_demo', 'archive']))
            .toEqual({ database: 'archive', unavailable: false });
    });

    it('preserves an unavailable saved database and marks it invalid', () => {
        expect(resolveTransferDatabaseSelection('removed', 'transfer_demo', ['transfer_demo']))
            .toEqual({ database: 'removed', unavailable: true });
    });
});
