import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => ({
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
}));

vi.mock('../../utils/request', () => ({
    default: requestMock,
}));

import {
    createGitSyncConfig,
    deleteGitConfig,
    getGitConfig,
    getGitSyncConfigs,
    testGitConnection,
    updateGitSyncConfigStatus,
} from './gitSettingsApi';

describe('git settings API group-scoped routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses group-scoped routes for git config and sync config', async () => {
        const payload = {
            provider: 'github',
            username: 'admin',
            token: 'secret',
            baseUrl: 'https://github.com',
        };

        await getGitConfig(4);
        await testGitConnection(4, payload);
        await deleteGitConfig(4);
        await getGitSyncConfigs(4);
        await createGitSyncConfig(4, 'main');
        await updateGitSyncConfigStatus(4, 7, true);

        expect(requestMock.get).toHaveBeenCalledWith('/api/v1/groups/4/git/config');
        expect(requestMock.post).toHaveBeenCalledWith(
            '/api/v1/groups/4/git/config/test',
            payload,
            { headers: { 'Content-Type': 'application/json' } },
        );
        expect(requestMock.delete).toHaveBeenCalledWith('/api/v1/groups/4/git/config');
        expect(requestMock.get).toHaveBeenCalledWith('/api/v1/groups/4/git/sync-config');
        expect(requestMock.post).toHaveBeenCalledWith(
            '/api/v1/groups/4/git/sync-config',
            { branch: 'main' },
            { headers: { 'Content-Type': 'application/json' } },
        );
        expect(requestMock.patch).toHaveBeenCalledWith(
            '/api/v1/groups/4/git/sync-config/7/status',
            { enabled: true },
            { headers: { 'Content-Type': 'application/json' } },
        );
    });
});
