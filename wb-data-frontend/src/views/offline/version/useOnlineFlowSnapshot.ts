import { useCallback, useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';

import { getGitSyncConfigs, type GitSyncConfig } from '../../../api/gitSettings';
import {
    getOfflineFlowSnapshot,
    type OfflineFlowDocument,
    type OfflineFlowVersionSnapshot,
} from '../../../api/offline';
import { getErrorMessage } from '../../../utils/error';

export type CanvasMode = 'dev' | 'online';

export type OnlineSnapshotStatus =
    | 'idle'
    | 'checking-deployment'
    | 'unconfirmed'
    | 'loading'
    | 'ready'
    | 'not-in-revision'
    | 'error';

interface UseOnlineFlowSnapshotParams {
    groupId: number | null;
    branch: string | null;
    activeFlowPath: string | null;
    enabled: boolean;
}

type SnapshotOutcome =
    | { key: string; kind: 'ready'; snapshot: OfflineFlowVersionSnapshot; nonce: number }
    | { key: string; kind: 'not-in-revision'; nonce: number }
    | { key: string; kind: 'error'; error: string; nonce: number };

export interface UseOnlineFlowSnapshotResult {
    deploymentConfig: GitSyncConfig | null;
    deploymentLoading: boolean;
    confirmedRevision: string | null;
    status: OnlineSnapshotStatus;
    snapshot: OfflineFlowVersionSnapshot | null;
    onlineDocument: OfflineFlowDocument | null;
    error: string | null;
    refresh: () => void;
    refreshDeployment: () => void;
}

const DEPLOYMENT_POLL_INTERVAL_MS = 30_000;

export function useOnlineFlowSnapshot({
    groupId,
    branch,
    activeFlowPath,
    enabled,
}: UseOnlineFlowSnapshotParams): UseOnlineFlowSnapshotResult {
    const [deploymentConfig, setDeploymentConfig] = useState<GitSyncConfig | null>(null);
    const [deploymentLoading, setDeploymentLoading] = useState(false);
    const [deploymentError, setDeploymentError] = useState<string | null>(null);
    const [deploymentNonce, setDeploymentNonce] = useState(0);

    const [snapshotOutcome, setSnapshotOutcome] = useState<SnapshotOutcome | null>(null);
    const [snapshotLoading, setSnapshotLoading] = useState(false);
    const [snapshotNonce, setSnapshotNonce] = useState(0);

    const loadedDeploymentKeyRef = useRef<string | null>(null);
    const deploymentRequestVersionRef = useRef(0);
    const snapshotRequestVersionRef = useRef(0);
    const pendingSnapshotRefreshRef = useRef(false);
    const snapshotOutcomeRef = useRef<SnapshotOutcome | null>(null);

    const commitSnapshotOutcome = useCallback((next: SnapshotOutcome | null) => {
        snapshotOutcomeRef.current = next;
        setSnapshotOutcome(next);
    }, []);

    useEffect(() => {
        const currentKey = groupId != null && branch != null ? `${groupId}:${branch}` : null;
        if (currentKey == null || groupId == null || branch == null) {
            deploymentRequestVersionRef.current += 1;
            loadedDeploymentKeyRef.current = null;
            pendingSnapshotRefreshRef.current = false;
            setDeploymentConfig(null);
            setDeploymentLoading(false);
            setDeploymentError(null);
            return;
        }

        const isInitialKeyLoad = loadedDeploymentKeyRef.current !== currentKey;
        if (isInitialKeyLoad) {
            setDeploymentConfig(null);
            setDeploymentLoading(true);
            setDeploymentError(null);
        }

        let cancelled = false;
        const load = () => {
            const version = ++deploymentRequestVersionRef.current;
            void getGitSyncConfigs(groupId)
                .then((response) => {
                    if (cancelled || deploymentRequestVersionRef.current !== version) return;
                    const matched = response.configs.find((item) => item.branch === branch) ?? null;
                    loadedDeploymentKeyRef.current = currentKey;
                    setDeploymentConfig(matched);
                    setDeploymentError(null);
                })
                .catch((cause) => {
                    if (cancelled || deploymentRequestVersionRef.current !== version) return;
                    if (loadedDeploymentKeyRef.current !== currentKey) {
                        setDeploymentConfig(null);
                    }
                    setDeploymentError(getErrorMessage(cause, '部署状态读取失败'));
                })
                .finally(() => {
                    if (cancelled || deploymentRequestVersionRef.current !== version) return;
                    setDeploymentLoading(false);
                    if (pendingSnapshotRefreshRef.current) {
                        pendingSnapshotRefreshRef.current = false;
                        setSnapshotNonce((current) => current + 1);
                    }
                });
        };

        load();
        const timer = window.setInterval(load, DEPLOYMENT_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [groupId, branch, deploymentNonce]);

    const confirmedRevision =
        deploymentConfig?.deploymentEvidence === 'CONFIRMED' && deploymentConfig.lastDeployedSha
            ? deploymentConfig.lastDeployedSha
            : null;

    const targetSnapshotKey =
        groupId != null && activeFlowPath && confirmedRevision
            ? `${groupId}:${activeFlowPath}:${confirmedRevision}`
            : null;

    const matchingOutcome =
        targetSnapshotKey && snapshotOutcome?.key === targetSnapshotKey
            ? snapshotOutcome
            : null;

    useEffect(() => {
        if (!enabled || !targetSnapshotKey || groupId == null || !activeFlowPath || !confirmedRevision) {
            snapshotRequestVersionRef.current += 1;
            setSnapshotLoading(false);
            return;
        }

        const settled = snapshotOutcomeRef.current;
        if (
            settled
            && settled.key === targetSnapshotKey
            && settled.nonce === snapshotNonce
            && settled.kind !== 'error'
        ) {
            return;
        }

        const version = ++snapshotRequestVersionRef.current;
        let cancelled = false;
        setSnapshotLoading(true);

        void getOfflineFlowSnapshot(groupId, activeFlowPath, confirmedRevision)
            .then((nextSnapshot) => {
                if (cancelled || snapshotRequestVersionRef.current !== version) return;
                commitSnapshotOutcome({
                    key: targetSnapshotKey,
                    kind: 'ready',
                    snapshot: nextSnapshot,
                    nonce: snapshotNonce,
                });
            })
            .catch((cause) => {
                if (cancelled || snapshotRequestVersionRef.current !== version) return;
                if (cause instanceof AxiosError && cause.response?.status === 404) {
                    commitSnapshotOutcome({
                        key: targetSnapshotKey,
                        kind: 'not-in-revision',
                        nonce: snapshotNonce,
                    });
                    return;
                }
                commitSnapshotOutcome({
                    key: targetSnapshotKey,
                    kind: 'error',
                    error: getErrorMessage(cause, '线上版本快照加载失败'),
                    nonce: snapshotNonce,
                });
            })
            .finally(() => {
                if (cancelled || snapshotRequestVersionRef.current !== version) return;
                setSnapshotLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        activeFlowPath,
        commitSnapshotOutcome,
        confirmedRevision,
        enabled,
        groupId,
        snapshotNonce,
        targetSnapshotKey,
    ]);

    const refreshDeployment = useCallback(() => {
        setDeploymentNonce((current) => current + 1);
    }, []);

    const refresh = useCallback(() => {
        pendingSnapshotRefreshRef.current = true;
        setDeploymentNonce((current) => current + 1);
    }, []);

    let status: OnlineSnapshotStatus = 'idle';
    let error: string | null = null;

    if (enabled && groupId != null && activeFlowPath != null) {
        if (deploymentLoading && deploymentConfig == null) {
            status = 'checking-deployment';
        } else if (deploymentError && deploymentConfig == null) {
            status = 'error';
            error = deploymentError;
        } else if (!confirmedRevision) {
            status = 'unconfirmed';
        } else if (matchingOutcome?.kind === 'ready') {
            status = 'ready';
        } else if (snapshotLoading || !matchingOutcome) {
            status = 'loading';
        } else if (matchingOutcome.kind === 'not-in-revision') {
            status = 'not-in-revision';
        } else {
            status = 'error';
            error = matchingOutcome.error;
        }
    }

    const readySnapshot = matchingOutcome?.kind === 'ready' ? matchingOutcome.snapshot : null;

    return {
        deploymentConfig,
        deploymentLoading,
        confirmedRevision,
        status,
        snapshot: readySnapshot,
        onlineDocument: readySnapshot?.document ?? null,
        error,
        refresh,
        refreshDeployment,
    };
}
