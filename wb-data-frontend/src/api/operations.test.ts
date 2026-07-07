import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
}));

vi.mock('../utils/request', () => ({
    default: requestMock,
}));

import {
    getOperationsExecution,
    listOperationsExecutions,
    rerunOperationsExecution,
} from './operations';

describe('operations API group-scoped routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the group-scoped route without query groupId for execution list', async () => {
        await listOperationsExecutions({
            groupId: 4,
            branch: 'feature/policy-review',
            flowId: 'test12',
            page: 2,
            pageSize: 50,
        });

        expect(requestMock.get).toHaveBeenCalledWith(
            '/api/v1/groups/4/operations/executions?branch=feature%2Fpolicy-review&flowId=test12&page=2&pageSize=50',
        );
    });

    it('uses group-scoped routes for detail and rerun', async () => {
        await getOperationsExecution(4, 'exec-1');
        await rerunOperationsExecution(4, 'exec-1');

        expect(requestMock.get).toHaveBeenCalledWith('/api/v1/groups/4/operations/executions/exec-1');
        expect(requestMock.post).toHaveBeenCalledWith('/api/v1/groups/4/operations/executions/exec-1/rerun', null);
    });
});
