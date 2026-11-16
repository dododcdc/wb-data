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

        render(<OfflineVersionHistoryDrawer groupId={4} path="_flows/example/flow.yaml" open onOpenChange={vi.fn()} onCompare={vi.fn()} />);

        expect(await screen.findByText('开发版本（工作区）')).toBeTruthy();
        expect(screen.getByText('版本历史 · example')).toBeTruthy();
        expect(document.querySelector('.offline-version-history-drawer .dialog-header p')?.className).toContain('sr-only');
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

    it('distinguishes a publication selection from its commit selection', async () => {
        vi.mocked(getOfflineFlowVersions).mockImplementation((_groupId, _path, options) =>
            Promise.resolve(response(options?.onlineOnly ?? false)));

        render(<OfflineVersionHistoryDrawer groupId={4} path="_flows/example/flow.yaml" open onOpenChange={vi.fn()} onCompare={vi.fn()} />);

        const publication = await screen.findByRole('button', { name: /线上 v2/ });
        const commit = screen.getByRole('checkbox', { name: '选择提交 ccccccc' }) as HTMLInputElement;
        fireEvent.click(publication);

        expect(publication.getAttribute('aria-pressed')).toBe('true');
        expect(commit.checked).toBe(false);
        expect(screen.getByText('已选 1/2 个版本')).toBeTruthy();

        fireEvent.click(commit);
        expect((screen.getByRole('button', { name: '对比所选' }) as HTMLButtonElement).disabled).toBe(false);
        expect(screen.getByText(/同一提交（内容一致）/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '清空' }));
        expect(screen.getByText('选择两个版本进行对比')).toBeTruthy();
    });

    it('supports one-click compare with the previous commit', async () => {
        const onCompare = vi.fn();
        vi.mocked(getOfflineFlowVersions).mockImplementation((_groupId, _path, options) =>
            Promise.resolve(response(options?.onlineOnly ?? false)));

        render(<OfflineVersionHistoryDrawer groupId={4} path="_flows/example/flow.yaml" open onOpenChange={vi.fn()} onCompare={onCompare} />);

        const prevButtons = await screen.findAllByRole('button', { name: '与上一版对比' });
        fireEvent.click(prevButtons[0]);

        expect(onCompare).toHaveBeenCalledTimes(1);
        expect(onCompare.mock.calls[0][0].revision).toBe('aaaaaaaa4444');
        expect(onCompare.mock.calls[0][1].revision).toBe('cccccccc9999');
    });

    it('preserves dirty worktree metadata across onlineOnly filtering', async () => {
        const onCompare = vi.fn();
        vi.mocked(getOfflineFlowVersions).mockImplementation((_groupId, _path, options) =>
            Promise.resolve(response(options?.onlineOnly ?? false)));

        render(<OfflineVersionHistoryDrawer groupId={4} path="_flows/example/flow.yaml" open onOpenChange={vi.fn()} onCompare={onCompare} />);

        await screen.findByText('开发版本（工作区）');
        fireEvent.click(screen.getByRole('checkbox', { name: '只看线上版本' }));
        await waitFor(() => {
            expect(screen.queryByText('开发版本（工作区）')).toBeNull();
        });

        fireEvent.click(screen.getByRole('button', { name: '与当前线上对比' }));
        expect(onCompare).toHaveBeenCalledTimes(1);
        expect(onCompare.mock.calls[0][1]).toMatchObject({
            revision: 'WORKTREE',
            message: '工作区有未提交修改',
        });
    });

    it('shows rollback buttons only on COMMIT rows when canWrite is enabled and invokes onRollback', async () => {
        const onRollback = vi.fn();
        vi.mocked(getOfflineFlowVersions).mockImplementation((_groupId, _path, options) =>
            Promise.resolve(response(options?.onlineOnly ?? false)));

        const { rerender } = render(
            <OfflineVersionHistoryDrawer
                groupId={4}
                path="_flows/example/flow.yaml"
                open
                canWrite={false}
                onOpenChange={vi.fn()}
                onCompare={vi.fn()}
                onRollback={onRollback}
            />,
        );

        await screen.findByText('第二次提交');
        expect(screen.queryByRole('button', { name: '回滚到此版本' })).toBeNull();

        rerender(
            <OfflineVersionHistoryDrawer
                groupId={4}
                path="_flows/example/flow.yaml"
                open
                canWrite
                onOpenChange={vi.fn()}
                onCompare={vi.fn()}
                onRollback={onRollback}
            />,
        );

        const rollbackButtons = screen.getAllByRole('button', { name: '回滚到此版本' });
        expect(rollbackButtons).toHaveLength(2);
        fireEvent.click(rollbackButtons[1]);

        expect(onRollback).toHaveBeenCalledTimes(1);
        expect(onRollback.mock.calls[0][0]).toMatchObject({
            revision: 'aaaaaaaa4444',
            message: '第一次提交',
        });
    });
});
