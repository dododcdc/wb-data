import { describe, expect, it } from 'vitest';
import { mergeDatabaseOptions, pickSelectedDatabase, resolveDatabaseAfterLoad } from './storageUtils';

describe('mergeDatabaseOptions', () => {
    it('does not inject an unknown fallback database into the options', () => {
        expect(mergeDatabaseOptions(['wb_data', 'mysql'], 'transfer_demo')).toEqual(['wb_data', 'mysql']);
    });
});

describe('pickSelectedDatabase', () => {
    it('prefers the datasource configured database over remembered sticky names', () => {
        expect(pickSelectedDatabase(['wb_data', 'mysql', 'transfer_demo'], 'transfer_demo', 'wb_data')).toBe('wb_data');
    });

    it('uses remembered database when configured default is absent from the list', () => {
        expect(pickSelectedDatabase(['mysql', 'transfer_demo'], 'transfer_demo', 'wb_data')).toBe('transfer_demo');
    });

    it('falls back to the first loaded database when neither preferred nor default exists', () => {
        expect(pickSelectedDatabase(['alpha', 'beta'], 'transfer_demo', 'missing')).toBe('alpha');
    });

    it('returns empty when the datasource has no databases', () => {
        expect(pickSelectedDatabase([], 'transfer_demo', 'wb_data')).toBe('');
    });

    it('with blank connectionDefault, remembered can win (non-switch path)', () => {
        expect(pickSelectedDatabase(['wb_data', 'transfer_demo'], 'transfer_demo', '')).toBe('transfer_demo');
        expect(pickSelectedDatabase(['wb_data', 'transfer_demo'], 'transfer_demo', undefined)).toBe('transfer_demo');
    });
});

describe('resolveDatabaseAfterLoad', () => {
    it('ignores remembered database entirely on datasource switch', () => {
        expect(
            resolveDatabaseAfterLoad(['transfer_demo', 'wb_data', 'mysql'], {
                connectionDefault: 'wb_data',
                rememberedDatabase: 'transfer_demo',
                ignoreRemembered: true,
            }),
        ).toBe('wb_data');
    });

    it('on switch without connection default, uses first list item (not remembered)', () => {
        expect(
            resolveDatabaseAfterLoad(['transfer_demo', 'wb_data'], {
                rememberedDatabase: 'transfer_demo',
                ignoreRemembered: true,
            }),
        ).toBe('transfer_demo');
        // Still first item — but if connection default is present it wins:
        expect(
            resolveDatabaseAfterLoad(['transfer_demo', 'wb_data'], {
                connectionDefault: 'wb_data',
                rememberedDatabase: 'transfer_demo',
                ignoreRemembered: true,
            }),
        ).toBe('wb_data');
    });

    it('switch policy is connectionDefault || list[0] even when remembered matches a later item', () => {
        // API prioritizeConfiguredDatabase puts wb_data first; remembered must not win.
        expect(
            resolveDatabaseAfterLoad(['wb_data', 'mysql', 'transfer_demo'], {
                connectionDefault: undefined,
                rememberedDatabase: 'transfer_demo',
                ignoreRemembered: true,
            }),
        ).toBe('wb_data');
    });

    it('missing connectionDefault on switch still never uses remembered (util-level fetch-default policy)', () => {
        // After loadDatabases awaits getDataSourceById, connectionDefault should be filled.
        // If still blank, resolve must pick list[0], not sticky memory — covers the util contract
        // that ignoreRemembered means remembered is never consulted.
        expect(
            resolveDatabaseAfterLoad(['wb_data', 'transfer_demo'], {
                connectionDefault: '',
                rememberedDatabase: 'transfer_demo',
                ignoreRemembered: true,
            }),
        ).toBe('wb_data');
    });

    it('uses remembered database when not switching', () => {
        expect(
            resolveDatabaseAfterLoad(['transfer_demo', 'wb_data'], {
                connectionDefault: undefined,
                rememberedDatabase: 'transfer_demo',
                ignoreRemembered: false,
            }),
        ).toBe('transfer_demo');
    });

    it('non-switch still prefers connectionDefault over remembered', () => {
        expect(
            resolveDatabaseAfterLoad(['wb_data', 'transfer_demo'], {
                connectionDefault: 'wb_data',
                rememberedDatabase: 'transfer_demo',
                ignoreRemembered: false,
            }),
        ).toBe('wb_data');
    });
});
