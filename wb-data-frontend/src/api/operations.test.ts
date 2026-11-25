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
    getOperationsExecutionRerunContext,
    listOperationsExecutions,
    markOperationsExecutionSuccess,
    rerunOperationsExecution,
    stopOperationsExecution,
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

    it('uses group-scoped routes for detail, rerun-context, and partial rerun', async () => {
        await getOperationsExecution(4, 'exec-1');
        await getOperationsExecutionRerunContext(4, 'exec-1');
        await rerunOperationsExecution(4, 'exec-1', {
            reuseManualOverrides: false,
            selectedTaskIds: ['transform', 'load'],
        });

        expect(requestMock.get).toHaveBeenCalledWith('/api/v1/groups/4/operations/executions/exec-1');
        expect(requestMock.get).toHaveBeenCalledWith('/api/v1/groups/4/operations/executions/exec-1/rerun-context');
        expect(requestMock.post).toHaveBeenCalledWith(
            '/api/v1/groups/4/operations/executions/exec-1/rerun',
            { reuseManualOverrides: false, selectedTaskIds: ['transform', 'load'] },
        );
    });

    it('uses group-scoped route for stopping an execution', async () => {
        await stopOperationsExecution(4, 'exec-1');

        expect(requestMock.post).toHaveBeenCalledWith('/api/v1/groups/4/operations/executions/exec-1/stop');
    });

    it('uses group-scoped route for marking an execution as success', async () => {
        await markOperationsExecutionSuccess(4, 'exec-1/sub');

        expect(requestMock.post).toHaveBeenCalledWith(
            '/api/v1/groups/4/operations/executions/exec-1%2Fsub/mark-success',
        );
    });
});
