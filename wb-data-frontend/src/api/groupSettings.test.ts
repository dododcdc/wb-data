import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => ({
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
}));

vi.mock('../utils/request', () => ({
    default: requestMock,
}));

import {
    addMember,
    getGroupSettings,
    getMemberPage,
    removeMember,
    updateGroupSettings,
} from './groupSettings';

describe('group settings API group-scoped routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses group-scoped routes for settings and member operations', async () => {
        await getGroupSettings(4);
        await updateGroupSettings(4, { name: 'policy', description: 'rules' });
        await getMemberPage({ groupId: 4, page: 2, size: 20, keyword: 'admin' });
        await addMember(4, { userId: 9, role: 'DEVELOPER' });
        await removeMember(4, 10);

        expect(requestMock.get).toHaveBeenCalledWith('/api/v1/groups/4/settings');
        expect(requestMock.put).toHaveBeenCalledWith(
            '/api/v1/groups/4/settings',
            { name: 'policy', description: 'rules' },
        );
        expect(requestMock.get).toHaveBeenCalledWith(
            '/api/v1/groups/4/settings/members',
            { params: { page: 2, size: 20, keyword: 'admin' } },
        );
        expect(requestMock.post).toHaveBeenCalledWith(
            '/api/v1/groups/4/settings/members',
            { userId: 9, role: 'DEVELOPER' },
        );
        expect(requestMock.delete).toHaveBeenCalledWith('/api/v1/groups/4/settings/members/10');
    });
});
