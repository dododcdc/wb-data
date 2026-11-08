import { describe, expect, it } from 'vitest';

import type { GitSyncConfig } from '../../api/gitSettings';
import { resolveDeploymentStatus } from './deploymentStatus';

function config(overrides: Partial<GitSyncConfig> = {}): GitSyncConfig {
    return {
        id: 1,
        groupId: 4,
        branch: 'main',
        namespace: 'g4-main',
        syncFlowId: 'sync-flows-g4-main',
        enabled: true,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncMessage: null,
        lastDeployedSha: null,
        lastDeployedAt: null,
        deploymentEvidence: 'UNCONFIRMED',
        ...overrides,
    };
}

describe('resolveDeploymentStatus', () => {
    it('shows confirmed deployment with short sha', () => {
        const status = resolveDeploymentStatus(config({
            lastSyncStatus: 'SUCCESS',
            lastDeployedSha: '0123456789abcdef',
            deploymentEvidence: 'CONFIRMED',
        }));

        expect(status?.label).toBe('当前线上 0123456');
        expect(status?.tone).toBe('confirmed');
    });

    it('does not claim the previous version while sync is running', () => {
        const status = resolveDeploymentStatus(config({
            lastSyncStatus: 'QUEUED',
            lastDeployedSha: '0123456789abcdef',
            deploymentEvidence: 'CONFIRMED',
        }));

        expect(status?.label).toBe('同步中');
    });

    it('marks failed deployment as not effective', () => {
        const status = resolveDeploymentStatus(config({
            lastSyncStatus: 'FAILED',
            deploymentEvidence: 'UNKNOWN',
        }));

        expect(status?.label).toBe('推送未生效');
    });

    it('returns unknown without deployment evidence', () => {
        expect(resolveDeploymentStatus(config())?.label).toBe('状态未知');
    });
});
