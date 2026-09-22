import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOfflineDependents, type OfflineDependentItem } from '../../api/offline';
import { DeleteFlowDependencyDialog, type DeleteFlowDependencyDialogProps } from './DeleteFlowDependencyDialog';

vi.mock('../../api/offline', () => ({ getOfflineDependents: vi.fn() }));

const dependent: OfflineDependentItem = {
    groupId: 2,
    groupName: '数据分析',
    flowId: 'daily_report',
    path: '_flows/daily_report/flow.yaml',
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function renderDialog(overrides: Partial<DeleteFlowDependencyDialogProps> = {}) {
    const props: DeleteFlowDependencyDialogProps = {
        groupId: 1,
        path: '_flows/example/flow.yaml',
        name: 'example',
        pending: false,
        onOpenChange: vi.fn(),
        onSubmit: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<DeleteFlowDependencyDialog {...props} />) };
}

function deleteButton() {
    return screen.getByRole('button', { name: '删除' }) as HTMLButtonElement;
}

beforeEach(() => {
    vi.mocked(getOfflineDependents).mockReset().mockResolvedValue([]);
});

afterEach(cleanup);

describe('DeleteFlowDependencyDialog', () => {
    it('opens on mount, quietly checks dependencies and disables deletion until loaded', async () => {
        const request = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValue(request.promise);
        const { props } = renderDialog();
        expect(screen.getByRole('dialog', { name: '确认删除任务' })).toBeTruthy();
        expect(screen.getByText('确定要删除任务「example」吗？此操作不可恢复。')).toBeTruthy();
        expect(getOfflineDependents).toHaveBeenCalledWith(1, props.path);
        expect(deleteButton().disabled).toBe(true);
        expect(screen.getByRole('region', { name: '删除依赖检查' }).getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/加载中/)).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
        fireEvent.click(deleteButton());
        expect(props.onSubmit).not.toHaveBeenCalled();
        await act(async () => request.resolve([]));
        expect(deleteButton().disabled).toBe(false);
        expect(screen.getByText(/删除时服务器仍会复核依赖关系/)).toBeTruthy();
        fireEvent.click(deleteButton());
        expect(props.onSubmit).toHaveBeenCalledOnce();
        expect(props.onOpenChange).not.toHaveBeenCalled();
    });

    it('blocks deletion and shows downstream task, group and full path with valid list markup', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([dependent, { ...dependent, groupId: 3, groupName: null }]);
        const { props } = renderDialog();
        const list = await screen.findByRole('list', { name: '下游任务' });
        expect(screen.getByText(/先在下游任务中解除依赖/)).toBeTruthy();
        expect(screen.getByText('数据分析 / daily_report')).toBeTruthy();
        expect(screen.getByText('项目组 3 / daily_report')).toBeTruthy();
        expect(screen.getAllByText(dependent.path)).toHaveLength(2);
        expect(list.closest('p')).toBeNull();
        expect(list.style.maxHeight).toBe('192px');
        expect(list.tabIndex).toBe(0);
        expect(deleteButton().disabled).toBe(true);
        fireEvent.click(deleteButton());
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('can recheck after downstream dependencies have been removed', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValueOnce([dependent]).mockResolvedValueOnce([]);
        renderDialog();
        fireEvent.click(await screen.findByRole('button', { name: '重新检查' }));
        expect(deleteButton().disabled).toBe(true);
        await waitFor(() => expect(deleteButton().disabled).toBe(false));
        expect(screen.queryByRole('list')).toBeNull();
        expect(getOfflineDependents).toHaveBeenCalledTimes(2);
    });

    it('retains server error during loading, read failure, retry and successful recheck', async () => {
        const failed = deferred<OfflineDependentItem[]>();
        const retried = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValueOnce(failed.promise).mockReturnValueOnce(retried.promise);
        renderDialog({ error: '服务器复核失败：任务已有新下游' });
        expect(screen.getByRole('alert').textContent).toBe('服务器复核失败：任务已有新下游');
        await act(async () => failed.reject(new Error('网络不可用')));
        expect(screen.getByText(/下游依赖读取失败：网络不可用/)).toBeTruthy();
        expect(screen.getByText('服务器复核失败：任务已有新下游')).toBeTruthy();
        expect(deleteButton().disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(deleteButton().disabled).toBe(true);
        expect(screen.getByText('服务器复核失败：任务已有新下游')).toBeTruthy();
        expect(screen.queryByText(/下游依赖读取失败/)).toBeNull();
        await act(async () => retried.resolve([]));
        expect(deleteButton().disabled).toBe(false);
        expect(screen.getByText('服务器复核失败：任务已有新下游')).toBeTruthy();
    });

    it('reflects a later server rejection without closing or hiding dependency evidence', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([dependent]);
        const { props, rerender } = renderDialog();
        await screen.findByRole('list', { name: '下游任务' });
        rerender(<DeleteFlowDependencyDialog {...props} error="删除失败，请重新检查依赖" />);
        expect(screen.getByRole('alert').textContent).toBe('删除失败，请重新检查依赖');
        expect(screen.getByText('数据分析 / daily_report')).toBeTruthy();
        expect(props.onOpenChange).not.toHaveBeenCalled();
        expect(getOfflineDependents).toHaveBeenCalledOnce();
    });

    it('uses a recoverable fallback when the request rejects without an Error', async () => {
        vi.mocked(getOfflineDependents).mockRejectedValue(null);
        const { props } = renderDialog();
        await screen.findByText(/请检查网络后重试/);
        expect(deleteButton().disabled).toBe(true);
        fireEvent.click(deleteButton());
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it.each(['取消', '关闭', 'Escape'])('closes via %s without submitting while the read is still pending', async (action) => {
        const request = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValue(request.promise);
        const { props, unmount } = renderDialog();
        if (action === 'Escape') {
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        } else {
            fireEvent.click(screen.getByRole('button', { name: action }));
        }
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
        expect(props.onSubmit).not.toHaveBeenCalled();
        unmount();
        await act(async () => request.resolve([]));
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('blocks duplicate submission and closure while pending, and retains the server error', async () => {
        const { props, rerender } = renderDialog();
        await waitFor(() => expect(deleteButton().disabled).toBe(false));
        fireEvent.click(deleteButton());
        rerender(<DeleteFlowDependencyDialog {...props} pending error="服务器正在复核" />);
        const submit = screen.getByRole('button', { name: '删除中…' }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
        expect(screen.getByRole('alert').textContent).toBe('服务器正在复核');
        fireEvent.click(submit);
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(props.onSubmit).toHaveBeenCalledOnce();
        expect(props.onOpenChange).not.toHaveBeenCalled();
    });

    it.each([{ groupId: 2 }, { path: '_flows/other/flow.yaml' }])('ignores a late empty response for the previous target: %j', async (target) => {
        const old = deferred<OfflineDependentItem[]>();
        const next = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
        const { props, rerender } = renderDialog();
        rerender(<DeleteFlowDependencyDialog {...props} {...target} />);
        expect(deleteButton().disabled).toBe(true);
        await act(async () => next.resolve([dependent]));
        await act(async () => old.resolve([]));
        expect(deleteButton().disabled).toBe(true);
        expect(screen.getByRole('list', { name: '下游任务' })).toBeTruthy();
        expect(getOfflineDependents).toHaveBeenCalledTimes(2);
        fireEvent.click(deleteButton());
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('invalidates a prior empty result as soon as the target changes', async () => {
        const next = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockResolvedValueOnce([]).mockReturnValueOnce(next.promise);
        const { props, rerender } = renderDialog();
        await waitFor(() => expect(deleteButton().disabled).toBe(false));
        rerender(<DeleteFlowDependencyDialog {...props} path="other.yaml" />);
        expect(deleteButton().disabled).toBe(true);
        fireEvent.click(deleteButton());
        expect(props.onSubmit).not.toHaveBeenCalled();
        await act(async () => next.resolve([]));
        expect(deleteButton().disabled).toBe(false);
    });

    it('ignores a late failure from a previously mounted dialog', async () => {
        const old = deferred<OfflineDependentItem[]>();
        vi.mocked(getOfflineDependents).mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
        const previous = renderDialog();
        previous.unmount();
        renderDialog();
        await waitFor(() => expect(deleteButton().disabled).toBe(false));
        await act(async () => old.reject(new Error('旧任务失败')));
        expect(deleteButton().disabled).toBe(false);
        expect(screen.queryByText(/旧任务失败/)).toBeNull();
    });

    it('constrains long names, errors and large lists without truncating task identity', async () => {
        const name = '任务名称'.repeat(80);
        const path = `_flows/${'long-path-'.repeat(80)}/flow.yaml`;
        vi.mocked(getOfflineDependents).mockResolvedValue(Array.from({ length: 50 }, (_, groupId) => ({ ...dependent, groupId, path })));
        renderDialog({ name, error: '服务端错误'.repeat(80) });
        const list = await screen.findByRole('list', { name: '下游任务' });
        expect(screen.getAllByRole('listitem')).toHaveLength(50);
        expect(screen.getAllByText(path)).toHaveLength(50);
        expect(list.className).toContain('overflow-y-auto');
        expect(list.style.maxHeight).toBe('192px');
        const dialog = screen.getByRole('dialog');
        expect(dialog.style.maxHeight).toBe('calc(100dvh - 48px)');
        expect(dialog.querySelector('.dialog-description')?.className).toContain('[overflow-wrap:anywhere]');
        expect(dialog.querySelector('.dialog-body')?.getAttribute('style')).toContain('min-height: 96px');
        expect(screen.getByText(`确定要删除任务「${name}」吗？此操作不可恢复。`)).toBeTruthy();
    });
});
