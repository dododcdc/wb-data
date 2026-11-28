import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './auth';
import {
    clearSelectedOfflineBranch,
    getActiveOfflineBranchForRequest,
    getSelectedOfflineBranch,
    setSelectedOfflineBranch,
} from './offlineBranchStore';

function makeStorage() {
    const store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
    };
}

describe('offlineBranchStore', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', makeStorage());
        useAuthStore.setState({ userInfo: { id: 10, username: 'alice', displayName: 'Alice', systemRole: 'USER' } });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        useAuthStore.setState({ userInfo: null });
    });

    it('isolates selected branch per user and per group', () => {
        expect(getSelectedOfflineBranch(1)).toBeNull();

        setSelectedOfflineBranch(1, 'feature/a');
        setSelectedOfflineBranch(2, 'feature/b');
        setSelectedOfflineBranch(1, 'hotfix/x', 20);

        expect(getSelectedOfflineBranch(1)).toBe('feature/a');
        expect(getActiveOfflineBranchForRequest(1)).toBe('feature/a');
        expect(getSelectedOfflineBranch(2)).toBe('feature/b');
        expect(getSelectedOfflineBranch(1, 20)).toBe('hotfix/x');

        useAuthStore.setState({ userInfo: { id: 20, username: 'bob', displayName: 'Bob', systemRole: 'USER' } });
        expect(getActiveOfflineBranchForRequest(1)).toBe('hotfix/x');
    });

    it('clears branch when set to null/blank or explicitly cleared', () => {
        setSelectedOfflineBranch(1, 'feature/a');
        expect(getSelectedOfflineBranch(1)).toBe('feature/a');

        setSelectedOfflineBranch(1, '   ');
        expect(getSelectedOfflineBranch(1)).toBeNull();

        setSelectedOfflineBranch(1, 'feature/a');
        clearSelectedOfflineBranch(1);
        expect(getSelectedOfflineBranch(1)).toBeNull();
    });
});
