import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOfflineFlowVersions } from '../../api/offline';
import { OfflineVersionHistoryDrawer } from './OfflineVersionHistoryDrawer';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return { ...actual, getOfflineFlowVersions: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function response(onlineOnly: boolean) {
    return {
        branch: 'main',
        total: 2,
        page: 1,
        size: 50,
        items: [
            ...(onlineOnly ? [] : [{
                revision: 'WORKTREE',
                kind: 'DEVELOPMENT' as const,
                message: null,
                authorName: null,
                committedAt: null,
                dirty: true,
                publications: [],
            }]),
            {
                revision: 'cccccccc9999',
                kind: 'COMMIT' as const,
                message: '第二次提交',
                authorName: '张三',
                committedAt: '2026-11-08T01:00:00Z',
                dirty: false,
                publications: [{
                    publishRecordId: 2,
                    onlineVersion: 2,
                    afterSha: 'cccccccc9999',
                    pushedAt: '2026-11-08T01:01:00Z',
                    status: 'SUCCESS',
                    currentOnline: true,
                }],
            },
            {
                revision: 'aaaaaaaa4444',
                kind: 'COMMIT' as const,
                message: '第一次提交',
                authorName: '李四',
                committedAt: '2026-11-07T01:00:00Z',
                dirty: false,
                publications: [{
                    publishRecordId: 1,
                    onlineVersion: 1,
                    afterSha: 'aaaaaaaa4444',
                    pushedAt: '2026-11-07T01:01:00Z',
                    status: 'SUCCESS',
                    currentOnline: false,
                }],
            },
        ],
    };
}

describe('OfflineVersionHistoryDrawer', () => {
    it('renders development and online versions and filters online only', async () => {
        vi.mocked(getOfflineFlowVersions).mockImplementation((_groupId, _path, options) =>
            Promise.resolve(response(options?.onlineOnly ?? false)));

        render(<OfflineVersionHistoryDrawer groupId={4} path="_flows/example/flow.yaml" open onOpenChange={vi.fn()} />);

        expect(await screen.findByText('开发版本（工作区）')).toBeTruthy();
        expect(screen.getByText('第二次提交')).toBeTruthy();
        expect(screen.getByText('线上 v2')).toBeTruthy();
        expect(screen.getByText('当前线上')).toBeTruthy();

        fireEvent.click(screen.getByRole('checkbox', { name: '只看线上版本' }));

        await waitFor(() => {
            expect(getOfflineFlowVersions).toHaveBeenLastCalledWith(4, '_flows/example/flow.yaml', {
                onlineOnly: true,
                page: 1,
                size: 50,
            });
        });
        expect(screen.queryByText('开发版本（工作区）')).toBeNull();
    });
});
