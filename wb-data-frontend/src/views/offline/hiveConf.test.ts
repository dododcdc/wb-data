import { describe, expect, it } from 'vitest';
import {
    areHiveConfsEqual,
    diffHiveConfEntries,
    normalizeHiveConfRecord,
    serializeHiveConfForSignature,
    validateHiveConfEntry,
} from './hiveConf';

describe('hiveConf helpers', () => {
    it('normalizes empty objects to undefined and trims valid keys', () => {
        expect(normalizeHiveConfRecord(undefined)).toBeUndefined();
        expect(normalizeHiveConfRecord(null)).toBeUndefined();
        expect(normalizeHiveConfRecord({})).toBeUndefined();
        expect(normalizeHiveConfRecord({ ' hive.exec.dynamic.partition ': 'true' })).toEqual({
            'hive.exec.dynamic.partition': 'true',
        });
    });

    it('compares confs order-insensitively while treating null/undefined/empty as equal', () => {
        expect(areHiveConfsEqual(undefined, {})).toBe(true);
        expect(areHiveConfsEqual(null, {})).toBe(true);
        expect(areHiveConfsEqual({ a: '1', b: '2' }, { a: '1', b: '2' })).toBe(true);
        expect(areHiveConfsEqual({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
        expect(areHiveConfsEqual({ a: '1', b: '2' }, { a: '1', c: '2' })).toBe(false);
        expect(serializeHiveConfForSignature({})).toBeNull();
    });

    it('validates keys and rejects multiline values', () => {
        expect(validateHiveConfEntry('hive.exec.dynamic.partition.mode', 'nonstrict')).toBeNull();
        expect(validateHiveConfEntry('bad key', '1')).toContain('仅支持');
        expect(validateHiveConfEntry('', '1')).toContain('不能为空');
        expect(validateHiveConfEntry('hive.foo', 'a\nb')).toContain('换行');
    });

    it('computes structured diffs for added, removed, and modified entries', () => {
        expect(diffHiveConfEntries(
            { a: '1', b: 'old' },
            { b: 'new', c: '3' },
        )).toEqual([
            { key: 'a', status: 'REMOVED', baseValue: '1', targetValue: null },
            { key: 'b', status: 'MODIFIED', baseValue: 'old', targetValue: 'new' },
            { key: 'c', status: 'ADDED', baseValue: null, targetValue: '3' },
        ]);
    });
});
