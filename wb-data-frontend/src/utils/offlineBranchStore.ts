import { useAuthStore } from './auth';

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const BRANCH_KEY_PREFIX = 'wb-data:offline-branch:';
const memoryStorage = new Map<string, string>();

function getStorage(): StorageLike {
    const storage = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    if (
        storage
        && typeof storage.getItem === 'function'
        && typeof storage.setItem === 'function'
        && typeof storage.removeItem === 'function'
    ) {
        return storage;
    }

    return {
        getItem(key: string) {
            return memoryStorage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            memoryStorage.set(key, value);
        },
        removeItem(key: string) {
            memoryStorage.delete(key);
        },
    };
}

function resolveUserId(userId?: number | null): number | null {
    if (userId !== undefined) {
        return typeof userId === 'number' && Number.isFinite(userId) ? userId : null;
    }
    const storeUserId = useAuthStore.getState().userInfo?.id;
    return typeof storeUserId === 'number' && Number.isFinite(storeUserId) ? storeUserId : null;
}

function buildBranchStorageKey(groupId: number, userId?: number | null) {
    const resolvedUserId = resolveUserId(userId);
    return `${BRANCH_KEY_PREFIX}${resolvedUserId ?? 'anon'}:${groupId}`;
}

export function getSelectedOfflineBranch(groupId: number, userId?: number | null): string | null {
    if (!Number.isFinite(groupId) || groupId <= 0) {
        return null;
    }
    const raw = getStorage().getItem(buildBranchStorageKey(groupId, userId));
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
}

export function setSelectedOfflineBranch(groupId: number, branch: string | null, userId?: number | null): void {
    if (!Number.isFinite(groupId) || groupId <= 0) {
        return;
    }
    const key = buildBranchStorageKey(groupId, userId);
    const trimmed = branch?.trim();
    const storage = getStorage();
    if (!trimmed) {
        storage.removeItem(key);
        return;
    }
    try {
        storage.setItem(key, trimmed);
    } catch {
        memoryStorage.set(key, trimmed);
    }
}

export function clearSelectedOfflineBranch(groupId: number, userId?: number | null): void {
    if (!Number.isFinite(groupId) || groupId <= 0) {
        return;
    }
    const key = buildBranchStorageKey(groupId, userId);
    memoryStorage.delete(key);
    getStorage().removeItem(key);
}

export function getActiveOfflineBranchForRequest(groupId: number): string | null {
    return getSelectedOfflineBranch(groupId);
}
