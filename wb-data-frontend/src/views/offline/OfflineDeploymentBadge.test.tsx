import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as gitSettingsApi from '../../api/gitSettings';
import type { GitSyncConfig } from '../../api/gitSettings';
import { TooltipProvider } from '../../components/ui/tooltip';
import { OfflineDeploymentBadge } from './OfflineDeploymentBadge';
import { resolveDeploymentStatus } from './deploymentStatus';

afterEach(() => {
    cleanup();
});

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

describe('OfflineDeploymentBadge', () => {
    it('renders Radix Tooltip instead of native title for deployment detail', async () => {
        const getGitSyncConfigsSpy = vi.spyOn(gitSettingsApi, 'getGitSyncConfigs').mockResolvedValue({
            configs: [config()],
            availableBranches: ['main'],
            syncCron: '0 * * * *',
        });

        try {
            render(
                <TooltipProvider delayDuration={0}>
                    <OfflineDeploymentBadge groupId={4} branch="main" />
                </TooltipProvider>,
            );

            const badge = await screen.findByRole('status');
            expect(badge.textContent).toContain('状态未知');
            expect(badge.getAttribute('title')).toBeNull();

            fireEvent.pointerMove(badge, { pointerType: 'mouse' });
            const tooltip = await screen.findByRole('tooltip');
            expect(tooltip.textContent).toContain('尚未取得可信的 Kestra 部署证据');
        } finally {
            getGitSyncConfigsSpy.mockRestore();
        }
    });
});
