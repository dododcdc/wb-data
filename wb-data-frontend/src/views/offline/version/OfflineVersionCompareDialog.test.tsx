import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getOfflineFlowSnapshot,
    getOfflineFlowVersions,
} from '../../../api/offline';
import { OfflineVersionCompareDialog } from './OfflineVersionCompareDialog';

vi.mock('../../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../../api/offline')>('../../../api/offline');
    return {
        ...actual,
        getOfflineFlowSnapshot: vi.fn(),
        getOfflineFlowVersions: vi.fn(),
    };
});

describe('OfflineVersionCompareDialog', () => {
    afterEach(cleanup);
    it('loads both revisions and renders business difference tabs', async () => {
        vi.mocked(getOfflineFlowSnapshot).mockImplementation((_groupId, _path, rev) => Promise.resolve({
            revision: rev,
            document: { stages: [], edges: [], layout: {} } as never,
            files: [{ path: 'scripts/example.sql', sha256: rev === 'old' ? 'old' : 'new', size: 8, content: null }],
            nodeMetadata: {},
        }));

        render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'old', label: '旧版本' }}
                target={{ revision: 'new', label: '新版本' }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        expect((await screen.findAllByRole('button', { name: /节点/ })).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: '原始文件' })).toBeNull();
    });

    it('swaps comparison direction without refetching and retries after snapshot failure', async () => {
        vi.mocked(getOfflineFlowSnapshot).mockClear();
        vi.mocked(getOfflineFlowSnapshot)
            .mockRejectedValueOnce(new Error('网络暂时不可用'))
            .mockImplementation((_groupId, _path, rev) => Promise.resolve({
                revision: rev,
                document: { stages: [], edges: [], layout: {} } as never,
                files: [],
                nodeMetadata: {},
            }));

        render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'old1234', label: '旧版本' }}
                target={{ revision: 'new5678', label: '新版本' }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        expect(await screen.findByText('网络暂时不可用')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '重试' }));

        const swapBtn = await screen.findByRole('button', { name: '交换方向' });
        await waitFor(() => {
            expect((swapBtn as HTMLButtonElement).disabled).toBe(false);
        });
        const callsBeforeSwap = vi.mocked(getOfflineFlowSnapshot).mock.calls.length;

        fireEvent.click(swapBtn);
        expect(vi.mocked(getOfflineFlowSnapshot).mock.calls.length).toBe(callsBeforeSwap);
    });

    it('ignores late responses from a superseded version pair after switching versions', async () => {
        let resolveSlowWorktree!: (value: never) => void;
        const slowWorktreePromise = new Promise<never>((resolve) => {
            resolveSlowWorktree = resolve;
        });

        vi.mocked(getOfflineFlowSnapshot).mockImplementation((_groupId, _path, rev) => {
            if (rev === 'WORKTREE') {
                return slowWorktreePromise;
            }
            if (rev === 'rev3') {
                return Promise.resolve({
                    revision: rev,
                    document: {
                        stages: [{
                            id: 's1',
                            name: 's1',
                            parallel: false,
                            nodes: [{ taskId: 'node_only_in_v3', kind: 'SHELL', scriptPath: 'scripts/v3.sh' }],
                        }],
                        edges: [],
                        layout: {},
                    } as never,
                    files: [{ path: 'scripts/v3.sh', sha256: 'v3', size: 10, content: 'echo v3' }],
                    nodeMetadata: {},
                });
            }
            return Promise.resolve({
                revision: rev,
                document: { stages: [], edges: [], layout: {} } as never,
                files: [],
                nodeMetadata: {},
            });
        });

        const { rerender } = render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'rev1', label: 'v1' }}
                target={{ revision: 'WORKTREE', label: '当前工作区' }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        // Close and reopen with a different pair while WORKTREE is still pending
        rerender(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'rev1', label: 'v1' }}
                target={{ revision: 'WORKTREE', label: '当前工作区' }}
                open={false}
                onOpenChange={vi.fn()}
            />,
        );
        rerender(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'rev2', label: 'v2' }}
                target={{ revision: 'rev3', label: 'v3' }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        expect(await screen.findByText('node_only_in_v3')).toBeTruthy();

        // Late completion of the superseded WORKTREE request must not overwrite v2 -> v3
        resolveSlowWorktree({
            revision: 'WORKTREE',
            document: {
                stages: [{
                    id: 's1',
                    name: 's1',
                    parallel: false,
                    nodes: [{ taskId: 'stale_worktree_node', kind: 'SHELL', scriptPath: 'scripts/wt.sh' }],
                }],
                edges: [],
                layout: {},
            } as never,
            files: [{ path: 'scripts/wt.sh', sha256: 'wt', size: 10, content: 'echo wt' }],
            nodeMetadata: {},
        } as never);

        await waitFor(() => {
            expect(screen.getByText('node_only_in_v3')).toBeTruthy();
            expect(screen.queryByText('stale_worktree_node')).toBeNull();
        });
    });

    it('hides raw file path and commit metadata inline while revealing details on hover/focus', async () => {
        vi.mocked(getOfflineFlowSnapshot).mockImplementation((_groupId, _path, rev) => Promise.resolve({
            revision: rev,
            document: { stages: [], edges: [], layout: {} } as never,
            files: [],
            nodeMetadata: {},
        }));

        const { container } = render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/s5_version_probe/flow.yaml"
                base={{
                    revision: '5a1a714deadbeef',
                    kind: 'COMMIT',
                    label: 'feat: 修改 HiveSQL 与 Shell 节点内容',
                    shortRevision: '5a1a714',
                    message: 'feat: 修改 HiveSQL 与 Shell 节点内容',
                    authorName: 'dododcdc',
                    committedAt: '2026-11-08T09:19:00Z',
                }}
                target={{
                    revision: 'WORKTREE',
                    kind: 'DEVELOPMENT',
                    label: '开发版本',
                    shortRevision: '工作区',
                    message: '工作区有未提交修改',
                }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        await screen.findAllByRole('button', { name: /节点/ });

        // Raw flow.yaml path, commit message, author, and timestamp must not clutter the visible layout
        expect(container.querySelector('.offline-compare-subtitle')).toBeNull();
        expect(screen.queryByText(/_flows\/s5_version_probe\/flow\.yaml/)).toBeNull();
        expect(screen.queryByText(/feat: 修改 HiveSQL 与 Shell 节点内容/)).toBeNull();
        expect(screen.queryByText(/dododcdc/)).toBeNull();

        // Concise identifiers stay visible in top chips and overview cards
        expect(screen.getAllByText('5a1a714').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('当前工作区').length).toBeGreaterThanOrEqual(1);

        // Hovering over the version chip reveals commit message and author metadata in TooltipContent
        const baseChip = document.querySelector('.offline-compare-version-chip.is-base') as HTMLElement;
        expect(baseChip).toBeTruthy();
        expect(screen.queryByRole('button', { name: '重选版本' })).toBeNull();
        expect(screen.getByRole('button', { name: '交换方向' }).textContent?.trim()).toBe('');
        fireEvent.pointerMove(baseChip, { pointerType: 'mouse' });

        await waitFor(() => {
            expect(screen.getAllByText('feat: 修改 HiveSQL 与 Shell 节点内容').length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText(/dododcdc/).length).toBeGreaterThanOrEqual(1);
        }, { timeout: 1000 });
    });

    it('lets users pick different base and target versions directly from the header dropdowns', async () => {
        vi.mocked(getOfflineFlowVersions).mockClear();
        vi.mocked(getOfflineFlowSnapshot).mockImplementation((_groupId, _path, rev) => Promise.resolve({
            revision: rev,
            document: {
                stages: rev === '1111aaa9999'
                    ? [{ id: 's1', name: 's1', parallel: false, nodes: [{ taskId: 'legacy_node', kind: 'SHELL', scriptPath: 'scripts/old.sh' }] }]
                    : [],
                edges: [],
                layout: {},
            } as never,
            files: rev === '1111aaa9999'
                ? [{ path: 'scripts/old.sh', sha256: 'old', size: 8, content: 'echo old' }]
                : [],
            nodeMetadata: {},
        }));
        vi.mocked(getOfflineFlowVersions).mockImplementation((_groupId, _path, options) => Promise.resolve({
            branch: 'main',
            total: options?.onlineOnly ? 1 : 3,
            page: 1,
            size: 50,
            items: [
                ...(options?.onlineOnly ? [] : [{
                    revision: 'WORKTREE',
                    kind: 'DEVELOPMENT' as const,
                    message: null,
                    authorName: null,
                    committedAt: null,
                    dirty: true,
                    publications: [],
                }]),
                {
                    revision: '5a1a714deadbeef',
                    kind: 'COMMIT' as const,
                    message: 'feat: 修改 HiveSQL 与 Shell 节点内容',
                    authorName: 'dododcdc',
                    committedAt: '2026-11-08T09:19:00Z',
                    dirty: false,
                    publications: [{
                        publishRecordId: 2,
                        onlineVersion: 2,
                        afterSha: '5a1a714deadbeef',
                        pushedAt: '2026-11-08T09:20:00Z',
                        status: 'SUCCESS',
                        currentOnline: true,
                    }],
                },
                ...(options?.onlineOnly ? [] : [{
                    revision: '1111aaa9999',
                    kind: 'COMMIT' as const,
                    message: 'feat: 初始化遗留节点',
                    authorName: 'alice',
                    committedAt: '2026-11-07T08:00:00Z',
                    dirty: false,
                    publications: [],
                }]),
            ],
        }));

        render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/s5_version_probe/flow.yaml"
                base={{
                    revision: '5a1a714deadbeef',
                    kind: 'COMMIT',
                    label: 'feat: 修改 HiveSQL 与 Shell 节点内容',
                    shortRevision: '5a1a714',
                    message: 'feat: 修改 HiveSQL 与 Shell 节点内容',
                    authorName: 'dododcdc',
                    committedAt: '2026-11-08T09:19:00Z',
                }}
                target={{
                    revision: 'WORKTREE',
                    kind: 'DEVELOPMENT',
                    label: '开发版本',
                    shortRevision: '工作区',
                    message: '工作区有未提交修改',
                }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        await screen.findAllByRole('button', { name: /节点/ });
        expect(getOfflineFlowVersions).not.toHaveBeenCalled();

        // Open base version dropdown lazily without unmounting/remounting the anchor button
        const baseTriggerBefore = screen.getByRole('button', { name: /选择基准版本/ });
        fireEvent.click(baseTriggerBefore);
        await waitFor(() => {
            expect(getOfflineFlowVersions).toHaveBeenCalledWith(4, '_flows/s5_version_probe/flow.yaml', {
                onlineOnly: false,
                page: 1,
                size: 50,
            });
        });
        expect(baseTriggerBefore.isConnected).toBe(true);
        expect(document.querySelector('.offline-compare-version-chip.is-base')).toBe(baseTriggerBefore);

        // Worktree is used on target side so it is disabled in the base picker with a fast Radix tooltip
        const worktreeOption = (await screen.findByRole('option', { name: /当前工作区/ })) as HTMLButtonElement;
        expect(worktreeOption.disabled).toBe(true);
        expect(worktreeOption.hasAttribute('title')).toBe(false);
        const worktreeWrap = worktreeOption.closest('.offline-version-option-wrap') as HTMLElement;
        expect(worktreeWrap).toBeTruthy();
        fireEvent.pointerMove(worktreeWrap, { pointerType: 'mouse' });
        await waitFor(() => {
            const peerTooltip = screen.getByRole('tooltip');
            expect(peerTooltip.textContent).toContain('该版本正在作为对比版本，点击交换图标可对调');
            const tooltipContent = document.querySelector('.offline-version-option-tooltip');
            expect(tooltipContent).toBeTruthy();
            expect(tooltipContent?.getAttribute('data-side')).toBe('bottom');
            expect(tooltipContent?.getAttribute('data-align')).toBe('center');
        }, { timeout: 1000 });
        fireEvent.pointerLeave(worktreeWrap, { pointerType: 'mouse' });

        // Non-truncated commit message stays quiet on hover (no redundant duplicate tooltip)
        const legacyOption = screen.getByRole('option', { name: /1111aaa/ });
        expect(legacyOption.hasAttribute('title')).toBe(false);
        const legacyWrap = legacyOption.closest('.offline-version-option-wrap') as HTMLElement;
        const legacyMsg = legacyOption.querySelector('.offline-version-option-msg') as HTMLElement;
        Object.defineProperty(legacyMsg, 'scrollWidth', { configurable: true, value: 120 });
        Object.defineProperty(legacyMsg, 'clientWidth', { configurable: true, value: 120 });
        fireEvent.pointerMove(legacyWrap, { pointerType: 'mouse' });
        await new Promise((r) => setTimeout(r, 220));
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.pointerLeave(legacyWrap, { pointerType: 'mouse' });

        // Truncated commit message reveals full description on hover
        Object.defineProperty(legacyMsg, 'scrollWidth', { configurable: true, value: 320 });
        Object.defineProperty(legacyMsg, 'clientWidth', { configurable: true, value: 140 });
        fireEvent.pointerMove(legacyWrap, { pointerType: 'mouse' });
        await waitFor(() => {
            expect(screen.getByRole('tooltip').textContent).toContain('feat: 初始化遗留节点');
        }, { timeout: 1000 });
        fireEvent.pointerLeave(legacyWrap, { pointerType: 'mouse' });

        // Selecting 1111aaa switches base revision in place without reopening any drawer
        fireEvent.click(legacyOption);
        expect(await screen.findByText('legacy_node')).toBeTruthy();

        // Re-open and test 仅线上 filter
        fireEvent.click(screen.getByRole('button', { name: /选择基准版本/ }));
        fireEvent.click(await screen.findByRole('button', { name: '仅线上' }));
        await waitFor(() => {
            expect(getOfflineFlowVersions).toHaveBeenCalledWith(4, '_flows/s5_version_probe/flow.yaml', {
                onlineOnly: true,
                page: 1,
                size: 50,
            });
        });
    });

    it('flushes pending worktree draft before loading WORKTREE snapshot on selector switch and surfaces flush failures', async () => {
        vi.mocked(getOfflineFlowSnapshot).mockClear();
        vi.mocked(getOfflineFlowSnapshot).mockImplementation((_groupId, _path, rev) => Promise.resolve({
            revision: rev,
            document: { stages: [], edges: [], layout: {} } as never,
            files: [],
            nodeMetadata: {},
        }));
        vi.mocked(getOfflineFlowVersions).mockResolvedValue({
            branch: 'main',
            total: 3,
            page: 1,
            size: 50,
            items: [
                {
                    revision: 'WORKTREE',
                    kind: 'DEVELOPMENT',
                    message: null,
                    authorName: null,
                    committedAt: null,
                    dirty: true,
                    publications: [],
                },
                {
                    revision: 'rev1111',
                    kind: 'COMMIT',
                    message: 'first',
                    authorName: 'alice',
                    committedAt: '2026-11-07T08:00:00Z',
                    dirty: false,
                    publications: [],
                },
                {
                    revision: 'rev2222',
                    kind: 'COMMIT',
                    message: 'second',
                    authorName: 'alice',
                    committedAt: '2026-11-08T08:00:00Z',
                    dirty: false,
                    publications: [],
                },
            ],
        });

        const onBeforeLoadWorktree = vi.fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/s5_version_probe/flow.yaml"
                base={{ revision: 'rev1111', kind: 'COMMIT', label: 'rev1111' }}
                target={{ revision: 'rev2222', kind: 'COMMIT', label: 'rev2222' }}
                open
                onOpenChange={vi.fn()}
                onBeforeLoadWorktree={onBeforeLoadWorktree}
            />,
        );

        await screen.findAllByRole('button', { name: /节点/ });
        expect(onBeforeLoadWorktree).not.toHaveBeenCalled();

        // Switch target selector to WORKTREE: flushes before requesting WORKTREE snapshot
        fireEvent.click(screen.getByRole('button', { name: /选择对比版本/ }));
        fireEvent.click(await screen.findByRole('option', { name: /当前工作区/ }));

        await waitFor(() => {
            expect(onBeforeLoadWorktree).toHaveBeenCalledTimes(1);
            expect(getOfflineFlowSnapshot).toHaveBeenCalledWith(4, '_flows/s5_version_probe/flow.yaml', 'WORKTREE');
        });

        // Switch target away then back to WORKTREE when flush fails -> shows error and skips WORKTREE fetch
        fireEvent.click(screen.getByRole('button', { name: /选择对比版本/ }));
        fireEvent.click(await screen.findByRole('option', { name: /second/ }));
        vi.mocked(getOfflineFlowSnapshot).mockClear();

        fireEvent.click(screen.getByRole('button', { name: /选择对比版本/ }));
        fireEvent.click(await screen.findByRole('option', { name: /当前工作区/ }));
        expect(await screen.findByText(/工作区草稿保存失败/)).toBeTruthy();
        expect(onBeforeLoadWorktree).toHaveBeenCalledTimes(2);
        expect(getOfflineFlowSnapshot).not.toHaveBeenCalledWith(4, '_flows/s5_version_probe/flow.yaml', 'WORKTREE');

        // Retrying after resolving flush failure loads WORKTREE cleanly
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        await waitFor(() => {
            expect(onBeforeLoadWorktree).toHaveBeenCalledTimes(3);
            expect(getOfflineFlowSnapshot).toHaveBeenCalledWith(4, '_flows/s5_version_probe/flow.yaml', 'WORKTREE');
        });
    });

    it('renders rollback button for compared COMMIT when canWrite and calls onRollback with preferred historical commit', async () => {
        vi.mocked(getOfflineFlowSnapshot).mockImplementation((_groupId, _path, rev) => Promise.resolve({
            revision: rev,
            document: { stages: [], edges: [], layout: {} } as never,
            files: [],
            nodeMetadata: {},
        }));
        const onRollback = vi.fn();

        const { rerender } = render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'aaaa11112222', kind: 'COMMIT', label: 'v1' }}
                target={{ revision: 'WORKTREE', kind: 'DEVELOPMENT', label: '开发版本' }}
                open
                canWrite={false}
                onOpenChange={vi.fn()}
                onRollback={onRollback}
            />,
        );

        await screen.findAllByRole('button', { name: /节点/ });
        expect(screen.queryByRole('button', { name: /回滚到/ })).toBeNull();

        rerender(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'aaaa11112222', kind: 'COMMIT', label: 'v1' }}
                target={{ revision: 'WORKTREE', kind: 'DEVELOPMENT', label: '开发版本' }}
                open
                canWrite
                onOpenChange={vi.fn()}
                onRollback={onRollback}
            />,
        );

        const rollbackBtn = screen.getByRole('button', { name: '回滚到 aaaa111' });
        fireEvent.click(rollbackBtn);
        expect(onRollback).toHaveBeenCalledTimes(1);
        expect(onRollback).toHaveBeenCalledWith(expect.objectContaining({
            revision: 'aaaa11112222',
        }));
    });
});
