import type { OfflineFlowDocument } from '../../../api/offline';
import { getActiveOfflineBranchForRequest } from '../../../utils/offlineBranchStore';

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

function resolveBranchScope(groupId: number, branch?: string | null): string {
    const explicit = branch?.trim();
    if (explicit) {
        return explicit;
    }
    return getActiveOfflineBranchForRequest(groupId) || 'main';
}

function buildRecoverySnapshotKey(groupId: number, path: string, branch?: string | null) {
    return `wb-data:offline-recovery:${groupId}:${resolveBranchScope(groupId, branch)}:${path}`;
}

function buildRecoverySnapshotPrefix(groupId: number, branch?: string | null) {
    return `wb-data:offline-recovery:${groupId}:${resolveBranchScope(groupId, branch)}:`;
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

function readRawRecoverySnapshot(groupId: number, path: string, branch?: string | null): RecoverySnapshot | null {
    const storage = getStorage();
    const raw = storage.getItem(buildRecoverySnapshotKey(groupId, path, branch));
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as unknown;
        return isRecoverySnapshot(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function readRecoverySnapshot(groupId: number, path: string, branch?: string | null): RecoverySnapshot | null {
    return readRawRecoverySnapshot(groupId, path, branch);
}

export function writeRecoverySnapshot(groupId: number, path: string, snapshot: RecoverySnapshot, branch?: string | null) {
    const storage = getStorage();
    try {
        storage.setItem(buildRecoverySnapshotKey(groupId, path, branch), JSON.stringify(snapshot));
    } catch (error) {
        // Silently degrade on QuotaExceededError or other write failures to prevent
        // core flows (leaveCurrentFlow, unmount) from crashing.
        console.warn('[recovery-snapshot] write failed', error);
    }
}

export function removeRecoverySnapshot(groupId: number, path: string, branch?: string | null) {
    const storage = getStorage();
    storage.removeItem(buildRecoverySnapshotKey(groupId, path, branch));
}

export function moveRecoverySnapshot(groupId: number, oldPath: string, newPath: string, branch?: string | null) {
    if (oldPath === newPath) return;

    const snapshot = readRawRecoverySnapshot(groupId, oldPath, branch);
    if (!snapshot) {
        removeRecoverySnapshot(groupId, oldPath, branch);
        return;
    }

    const oldTaskDirectory = oldPath.match(/^_flows\/(.+)\/[^/]+$/)?.[1];
    const newTaskDirectory = newPath.match(/^_flows\/(.+)\/[^/]+$/)?.[1];
    const oldScriptPrefix = oldTaskDirectory ? `scripts/${oldTaskDirectory}/` : null;
    const newScriptPrefix = newTaskDirectory ? `scripts/${newTaskDirectory}/` : null;

    writeRecoverySnapshot(groupId, newPath, {
        ...snapshot,
        document: {
            ...snapshot.document,
            path: newPath,
            stages: snapshot.document.stages.map((stage) => ({
                ...stage,
                nodes: stage.nodes.map((node) => (
                    oldScriptPrefix && newScriptPrefix && node.scriptPath?.startsWith(oldScriptPrefix)
                        ? { ...node, scriptPath: `${newScriptPrefix}${node.scriptPath.slice(oldScriptPrefix.length)}` }
                        : node
                )),
            })),
        },
    }, branch);
    removeRecoverySnapshot(groupId, oldPath, branch);
}

export function listRecoverySnapshotPaths(groupId: number, branch?: string | null) {
    const prefix = buildRecoverySnapshotPrefix(groupId, branch);
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

export function moveFolderRecoverySnapshots(groupId: number, oldPrefix: string, newPrefix: string, branch?: string | null) {
    if (oldPrefix === newPrefix) return;

    listRecoverySnapshotPaths(groupId, branch)
        .filter((path) => path.startsWith(`${oldPrefix}/`))
        .forEach((path) => {
            moveRecoverySnapshot(groupId, path, path.replace(oldPrefix, newPrefix), branch);
        });
}

export function removeFolderRecoverySnapshots(groupId: number, folderPrefix: string, branch?: string | null) {
    listRecoverySnapshotPaths(groupId, branch)
        .filter((path) => path.startsWith(`${folderPrefix}/`))
        .forEach((path) => {
            removeRecoverySnapshot(groupId, path, branch);
        });
}
