import type { OfflineFlowDocument } from '../../api/offline';

export interface RecoverySnapshot {
    document: OfflineFlowDocument;
    baseDocumentHash: string;
    baseDocumentUpdatedAt: number;
    selectedNodeId: string | null;
    selectedTaskIds: string[];
    updatedAt: number;
}

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const memoryStorage = new Map<string, string>();

function getStorage(): StorageLike {
    const storage = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' && typeof storage.removeItem === 'function') {
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

function buildRecoverySnapshotKey(groupId: number, path: string) {
    return `wb-data:offline-recovery:${groupId}:${path}`;
}

function buildRecoverySnapshotPrefix(groupId: number) {
    return `wb-data:offline-recovery:${groupId}:`;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
    if (!isObject(value)) return false;
    if (typeof value.baseDocumentHash !== 'string') return false;
    if (typeof value.baseDocumentUpdatedAt !== 'number') return false;
    if (value.selectedNodeId !== null && typeof value.selectedNodeId !== 'string') return false;
    if (!Array.isArray(value.selectedTaskIds) || value.selectedTaskIds.some((taskId) => typeof taskId !== 'string')) return false;
    if (typeof value.updatedAt !== 'number') return false;
    if (!isObject(value.document)) return false;
    if (typeof value.document.groupId !== 'number') return false;
    if (typeof value.document.path !== 'string') return false;
    if (typeof value.document.flowId !== 'string') return false;
    if (typeof value.document.namespace !== 'string') return false;
    if (typeof value.document.documentHash !== 'string') return false;
    if (typeof value.document.documentUpdatedAt !== 'number') return false;
    if (!Array.isArray(value.document.stages) || !Array.isArray(value.document.edges) || !isObject(value.document.layout)) return false;
    return true;
}

function readRawRecoverySnapshot(groupId: number, path: string): RecoverySnapshot | null {
    const storage = getStorage();
    const raw = storage.getItem(buildRecoverySnapshotKey(groupId, path));
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as unknown;
        return isRecoverySnapshot(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function readRecoverySnapshot(groupId: number, path: string): RecoverySnapshot | null {
    return readRawRecoverySnapshot(groupId, path);
}

export function writeRecoverySnapshot(groupId: number, path: string, snapshot: RecoverySnapshot) {
    const storage = getStorage();
    try {
        storage.setItem(buildRecoverySnapshotKey(groupId, path), JSON.stringify(snapshot));
    } catch (error) {
        // Silently degrade on QuotaExceededError or other write failures to prevent
        // core flows (leaveCurrentFlow, unmount) from crashing.
        console.warn('[recovery-snapshot] write failed', error);
    }
}

export function removeRecoverySnapshot(groupId: number, path: string) {
    const storage = getStorage();
    storage.removeItem(buildRecoverySnapshotKey(groupId, path));
}

export function moveRecoverySnapshot(groupId: number, oldPath: string, newPath: string) {
    if (oldPath === newPath) return;

    const snapshot = readRawRecoverySnapshot(groupId, oldPath);
    if (!snapshot) {
        removeRecoverySnapshot(groupId, oldPath);
        return;
    }

    writeRecoverySnapshot(groupId, newPath, {
        ...snapshot,
        document: {
            ...snapshot.document,
            path: newPath,
        },
    });
    removeRecoverySnapshot(groupId, oldPath);
}

function listRecoverySnapshotPaths(groupId: number) {
    const prefix = buildRecoverySnapshotPrefix(groupId);
    const storage = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;

    if (storage && typeof storage.key === 'function' && typeof storage.length === 'number') {
        const paths: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(prefix)) {
                paths.push(key.slice(prefix.length));
            }
        }
        return paths;
    }

    return Array.from(memoryStorage.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
}

export function moveFolderRecoverySnapshots(groupId: number, oldPrefix: string, newPrefix: string) {
    if (oldPrefix === newPrefix) return;

    listRecoverySnapshotPaths(groupId)
        .filter((path) => path.startsWith(`${oldPrefix}/`))
        .forEach((path) => {
            moveRecoverySnapshot(groupId, path, path.replace(oldPrefix, newPrefix));
        });
}

export function removeFolderRecoverySnapshots(groupId: number, folderPrefix: string) {
    listRecoverySnapshotPaths(groupId)
        .filter((path) => path.startsWith(`${folderPrefix}/`))
        .forEach((path) => {
            removeRecoverySnapshot(groupId, path);
        });
}
