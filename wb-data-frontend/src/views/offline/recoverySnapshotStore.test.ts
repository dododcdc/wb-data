import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listRecoverySnapshotPaths, writeRecoverySnapshot } from './recoverySnapshotStore';
import type { RecoverySnapshot } from './recoverySnapshotStore';

function makeSnapshot(): RecoverySnapshot {
    return {
        document: {
            groupId: 1,
            path: 'test/flow.yml',
            flowId: 'flow-id',
            namespace: 'ns',
            documentHash: 'abc',
            documentUpdatedAt: 1000,
            stages: [],
            edges: [],
            layout: {},
        } as never,
        baseDocumentHash: 'abc',
        baseDocumentUpdatedAt: 1000,
        selectedNodeId: null,
        selectedTaskIds: [],
        updatedAt: 1000,
    };
}

function makeStorage() {
    const store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        key: vi.fn((n: number) => Object.keys(store)[n] ?? null),
        get length() { return Object.keys(store).length; },
        _store: store,
    };
}

describe('writeRecoverySnapshot', () => {
    let mockStorage: ReturnType<typeof makeStorage>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockStorage = makeStorage();
        vi.stubGlobal('localStorage', mockStorage);
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('does not throw when localStorage.setItem throws QuotaExceededError', () => {
        mockStorage.setItem.mockImplementation(() => {
            throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        });

        expect(() => writeRecoverySnapshot(1, 'test/flow.yml', makeSnapshot())).not.toThrow();
    });

    it('logs a console.warn when localStorage.setItem throws', () => {
        mockStorage.setItem.mockImplementation(() => {
            throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        });

        writeRecoverySnapshot(1, 'test/flow.yml', makeSnapshot());

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[recovery-snapshot]'),
            expect.anything(),
        );
    });

    it('still writes when localStorage works normally', () => {
        writeRecoverySnapshot(1, 'test/flow.yml', makeSnapshot());

        expect(mockStorage.setItem).toHaveBeenCalledWith(
            'wb-data:offline-recovery:1:test/flow.yml',
            expect.stringContaining('"baseDocumentHash":"abc"'),
        );
    });

    it('lists only recovery snapshot paths for the requested group', () => {
        writeRecoverySnapshot(1, '_flows/a/flow.yaml', makeSnapshot());
        writeRecoverySnapshot(2, '_flows/b/flow.yaml', makeSnapshot());

        expect(listRecoverySnapshotPaths(1)).toEqual(['_flows/a/flow.yaml']);
        expect(listRecoverySnapshotPaths(2)).toEqual(['_flows/b/flow.yaml']);
    });
});
