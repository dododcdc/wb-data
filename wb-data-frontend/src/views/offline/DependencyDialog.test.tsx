import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getOfflineDependencies,
    getOfflineDependents,
    searchOfflineDependencyCandidates,
    updateOfflineDependencies,
    type OfflineDependencyCandidate,
    type OfflineDependentItem,
    type OfflineFlowDocument,
} from '../../api/offline';
import { DependencyDialog } from './DependencyDialog';

vi.mock('../../api/offline', () => ({
    searchOfflineDependencyCandidates: vi.fn(),
    getOfflineDependents: vi.fn(),
    getOfflineDependencies: vi.fn(),
    updateOfflineDependencies: vi.fn(),
}));

function makeDocument(overrides: Partial<OfflineFlowDocument> = {}): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/当前任务/flow.yaml',
        flowId: 'current',
        namespace: 'offline',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        stages: [],
        edges: [],
        layout: {},
        schedule: { period: 'DAILY', cron: '0 2 * * *', timezone: 'Asia/Shanghai', enabled: true },
        ...overrides,
    };
}

function makeCandidate(overrides: Partial<OfflineDependencyCandidate> = {}): OfflineDependencyCandidate {
    return {
        groupId: 1,
        groupName: '数据平台',
        flowId: 'upstream',
        path: '_flows/每日汇总/flow.yaml',
        hasSchedule: true,
        period: 'DAILY',
        cron: '30 6 * * *',
        timezone: 'Asia/Shanghai',
        enabled: true,
        crossGroupDependency: 'ALLOW',
        ...overrides,
    };
}

function renderDialog(overrides: Partial<ComponentProps<typeof DependencyDialog>> = {}) {
    const props = { groupId: 1, document: makeDocument(), onClose: vi.fn(), onStage: vi.fn(), ...overrides };
    return { ...render(<DependencyDialog {...props} />), props };
}

async function loaded() {
    await waitFor(() => expect(screen.getByRole('region', { name: '添加前置任务' }).getAttribute('aria-busy')).toBe('false'));
}

function stageButton() {
    return screen.getByRole('button', { name: '暂存配置' }) as HTMLButtonElement;
}

function crossGroupSwitch() {
    return screen.getByRole('switch', { name: '允许被其他项目组依赖' }) as HTMLButtonElement;
}

function addButton(group = '数据平台', flow = 'upstream') {
    return screen.getByRole('button', { name: `添加 ${group} / ${flow}` }) as HTMLButtonElement;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([]);
    vi.mocked(getOfflineDependents).mockResolvedValue([]);
});

afterEach(cleanup);

describe('DependencyDialog', () => {
    it('opens on mount, stages defaults locally and explains configuration versus runtime behavior', async () => {
        const { props } = renderDialog();
        expect(screen.getByRole('dialog', { name: '依赖配置' })).toBeTruthy();
        expect(stageButton().disabled).toBe(true);
        expect(crossGroupSwitch().disabled).toBe(true);
        await loaded();
        expect((screen.getByRole('radio', { name: '继续调度' }) as HTMLInputElement).checked).toBe(true);
        expect(crossGroupSwitch().getAttribute('aria-checked')).toBe('true');
        const footer = stageButton().closest('.offline-schedule-footer') as HTMLElement;
        expect(within(footer).getByText('暂存后自动保存草稿；运行等待机制将在后续版本接入。')).toBeTruthy();
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith({ dependencies: [], failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW' });
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(getOfflineDependencies).not.toHaveBeenCalled();
        expect(updateOfflineDependencies).not.toHaveBeenCalled();
    });

    it('adds same-named tasks from different groups once each and removes only the matching ref', async () => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([
            makeCandidate({ flowId: 'daily' }),
            makeCandidate({ groupId: 2, groupName: '财务分析', flowId: 'daily', enabled: false }),
        ]);
        const { props } = renderDialog();
        await loaded();
        fireEvent.click(addButton('数据平台', 'daily'));
        fireEvent.click(addButton('财务分析', 'daily'));
        const selected = screen.getByRole('list', { name: '已选前置任务' });
        expect(within(selected).getAllByRole('listitem')).toHaveLength(2);
        expect(within(selected).getByText('每天 · 06:30 · Asia/Shanghai · 调度已暂停')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '已添加 财务分析 / daily' }));
        expect(within(selected).getAllByRole('listitem')).toHaveLength(2);
        fireEvent.click(within(selected).getByRole('button', { name: '移除 数据平台 / daily' }));
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith({
            dependencies: [{ groupId: 2, flowId: 'daily' }], failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW',
        });
    });

    it('searches flow IDs, directory display names and group names locally without fetching again', async () => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([
            makeCandidate({ flowId: 'DAILY_SALES', path: '_flows/业务分析/每日销售/flow.yaml' }),
            makeCandidate({ groupId: 2, groupName: '财务分析', flowId: 'report' }),
        ]);
        renderDialog();
        await loaded();
        const search = screen.getByRole('searchbox', { name: '添加前置任务' });
        for (const query of [' daily_sales ', '每日销售', '业务分析']) {
            fireEvent.change(search, { target: { value: query } });
            expect(addButton('数据平台', 'DAILY_SALES')).toBeTruthy();
            expect(screen.queryByRole('button', { name: '添加 财务分析 / report' })).toBeNull();
        }
        fireEvent.change(search, { target: { value: '财务分析' } });
        expect(addButton('财务分析', 'report')).toBeTruthy();
        fireEvent.change(search, { target: { value: 'nothing-matches' } });
        expect(screen.getByText('没有匹配的任务')).toBeTruthy();
        expect(searchOfflineDependencyCandidates).toHaveBeenCalledTimes(1);
        expect(searchOfflineDependencyCandidates).toHaveBeenCalledWith(1, '_flows/当前任务/flow.yaml');
        expect(getOfflineDependents).toHaveBeenCalledTimes(1);
        expect(getOfflineDependents).toHaveBeenCalledWith(1, '_flows/当前任务/flow.yaml');
    });

    it('shows each task directory with its tree root group name', async () => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([
            makeCandidate({ flowId: 'daily_sales', path: '_flows/业务分析/每日销售/flow.yaml' }),
            makeCandidate({ groupId: 2, groupName: null, flowId: 'report' }),
        ]);
        renderDialog();
        await loaded();
        expect(screen.getByText('数据平台 / 业务分析/每日销售')).toBeTruthy();
        expect(screen.getByText('项目组 2 / 每日汇总')).toBeTruthy();
    });

    it('keeps IME composition visible while deferring filtering until composition ends', async () => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([
            makeCandidate({ flowId: 'daily_sales' }),
            makeCandidate({ groupId: 2, groupName: '财务分析', flowId: 'report' }),
        ]);
        renderDialog();
        await loaded();
        const search = screen.getByRole('searchbox', { name: '添加前置任务' }) as HTMLInputElement;
        fireEvent.compositionStart(search);
        fireEvent.change(search, { target: { value: 'c' } });
        fireEvent.change(search, { target: { value: 'cai' } });
        // 组合中的文本照常显示，但候选过滤等上屏后才发生，避免列表随拼音抖动
        expect(search.value).toBe('cai');
        expect(addButton('数据平台', 'daily_sales')).toBeTruthy();
        expect(addButton('财务分析', 'report')).toBeTruthy();
        fireEvent.compositionEnd(search, { target: { value: '财务' } });
        expect(search.value).toBe('财务');
        expect(screen.queryByRole('button', { name: '添加 数据平台 / daily_sales' })).toBeNull();
        expect(addButton('财务分析', 'report')).toBeTruthy();
    });

    it.each([
        ['不能依赖当前任务', { flowId: 'current' }],
        ['未配置标准调度频率', { hasSchedule: false, period: null }],
        ['未配置标准调度频率', { period: 'CUSTOM', cron: '0 1,8 * * *' }],
        ['与当前任务调度频率不同', { period: 'WEEKLY', cron: '0 2 * * 1' }],
        ['该任务不允许跨项目组依赖', { groupId: 2, crossGroupDependency: 'DENY' }],
    ] as const)('disables a candidate and shows the reason: %s (%j)', async (reason, overrides) => {
        const candidate = makeCandidate(overrides);
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([candidate]);
        renderDialog();
        await loaded();
        const button = addButton('数据平台', candidate.flowId);
        expect(button.disabled).toBe(true);
        expect(within(button.closest('li')!).getByText(reason)).toBeTruthy();
        fireEvent.click(button);
        expect(screen.queryByRole('list', { name: '已选前置任务' })).toBeNull();
    });

    it.each([null, { period: 'CUSTOM' as const, cron: '0 1,8 * * *', timezone: 'UTC', enabled: true }])('blocks additions when the current draft has no standard frequency: %j', async (schedule) => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([makeCandidate()]);
        renderDialog({ document: makeDocument({ schedule }) });
        await loaded();
        expect(addButton().disabled).toBe(true);
        expect(screen.getByText('当前任务未配置标准调度频率，请先配置调度')).toBeTruthy();
        expect(stageButton().disabled).toBe(false); // Policies alone do not require a schedule.
    });

    it('uses the current draft frequency and allows a paused same-frequency task with a different time and timezone', async () => {
        const candidate = makeCandidate({ period: 'WEEKLY', cron: '45 9 * * 5', timezone: 'UTC', enabled: false, crossGroupDependency: 'DENY' });
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([candidate]);
        const { props, rerender } = renderDialog();
        await loaded();
        expect(addButton().disabled).toBe(true);
        rerender(<DependencyDialog {...props} document={makeDocument({
            schedule: { period: 'WEEKLY', cron: '0 2 * * 1', timezone: 'Asia/Shanghai', enabled: true },
        })} />);
        expect(addButton().disabled).toBe(false); // Same-group DENY does not prohibit this reference.
        fireEvent.click(addButton());
        expect(stageButton().disabled).toBe(false);
        expect(searchOfflineDependencyCandidates).toHaveBeenCalledTimes(1);
    });

    it('enforces the 20-ref limit without preventing removals', async () => {
        const candidates = Array.from({ length: 21 }, (_, index) => makeCandidate({ flowId: `task-${index}` }));
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue(candidates);
        const { props } = renderDialog({ document: makeDocument({ dependencyConfig: {
            dependencies: candidates.slice(0, 19).map(({ groupId, flowId }) => ({ groupId, flowId })),
            failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW',
        } }) });
        await loaded();
        fireEvent.click(addButton('数据平台', 'task-19'));
        expect(screen.getByText('20 / 20')).toBeTruthy();
        expect(addButton('数据平台', 'task-20').disabled).toBe(true);
        expect(screen.getByText('已达到 20 个前置任务上限')).toBeTruthy();
        fireEvent.click(addButton('数据平台', 'task-20'));
        fireEvent.click(screen.getByRole('button', { name: '移除 数据平台 / task-0' }));
        expect(addButton('数据平台', 'task-20').disabled).toBe(false);
        fireEvent.click(addButton('数据平台', 'task-20'));
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith({
            dependencies: candidates.slice(1).map(({ groupId, flowId }) => ({ groupId, flowId })),
            failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW',
        });
    });

    it('initializes from the draft, preserves both policies and emits only deduplicated refs', async () => {
        const candidate = makeCandidate();
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([candidate]);
        const document = makeDocument({ dependencyConfig: {
            dependencies: [candidate, candidate], failurePolicy: 'PAUSE', crossGroupDependency: 'DENY',
        } });
        const { props, rerender } = renderDialog({ document });
        await loaded();
        expect((screen.getByRole('radio', { name: '暂停后续调度' }) as HTMLInputElement).checked).toBe(true);
        expect(crossGroupSwitch().getAttribute('aria-checked')).toBe('false');
        expect(within(screen.getByRole('list', { name: '已选前置任务' })).getAllByRole('listitem')).toHaveLength(1);
        rerender(<DependencyDialog {...props} document={{ ...document }} />);
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledTimes(1);
        expect(props.onStage).toHaveBeenCalledWith({
            dependencies: [{ groupId: 1, flowId: 'upstream' }], failurePolicy: 'PAUSE', crossGroupDependency: 'DENY',
        });
        expect(document.dependencyConfig?.dependencies).toHaveLength(2);
        expect(getOfflineDependencies).not.toHaveBeenCalled();
        expect(updateOfflineDependencies).not.toHaveBeenCalled();
    });

    it('stages changes to both strategies without modifying the document', async () => {
        const { props } = renderDialog();
        await loaded();
        fireEvent.click(screen.getByRole('radio', { name: '暂停后续调度' }));
        fireEvent.click(crossGroupSwitch());
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith({ dependencies: [], failurePolicy: 'PAUSE', crossGroupDependency: 'DENY' });
        expect(props.document.dependencyConfig).toBeUndefined();
    });

    it.each(['取消', '关闭'])('discards local edits on %s without staging or writing', async (action) => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([makeCandidate()]);
        const { props } = renderDialog();
        await loaded();
        fireEvent.click(addButton());
        fireEvent.click(screen.getByRole('radio', { name: '暂停后续调度' }));
        fireEvent.click(screen.getByRole('button', { name: action }));
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onStage).not.toHaveBeenCalled();
        expect(updateOfflineDependencies).not.toHaveBeenCalled();
        expect(props.document.dependencyConfig).toBeUndefined();
    });

    it.each(['candidates', 'dependents'])('blocks staging on %s failure and retries both reads without resetting local edits', async (failingRead) => {
        const failingMock = failingRead === 'candidates' ? vi.mocked(searchOfflineDependencyCandidates) : vi.mocked(getOfflineDependents);
        failingMock.mockRejectedValueOnce(new Error('network failure'));
        const { props } = renderDialog();
        await screen.findByRole('alert');
        expect(stageButton().disabled).toBe(true);
        expect(crossGroupSwitch().disabled).toBe(true);
        expect(screen.queryByText('暂无可依赖的任务')).toBeNull();
        fireEvent.click(stageButton());
        expect(props.onStage).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('radio', { name: '暂停后续调度' }));
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        await loaded();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(stageButton().disabled).toBe(false);
        expect(searchOfflineDependencyCandidates).toHaveBeenCalledTimes(2);
        expect(getOfflineDependents).toHaveBeenCalledTimes(2);
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith({ dependencies: [], failurePolicy: 'PAUSE', crossGroupDependency: 'ALLOW' });
    });

    it.each(['resolve', 'reject'])('ignores a late %s from an old task and initializes the new task draft', async (settlement) => {
        const oldCandidates = deferred<OfflineDependencyCandidate[]>();
        const oldDependents = deferred<OfflineDependentItem[]>();
        vi.mocked(searchOfflineDependencyCandidates).mockReturnValueOnce(oldCandidates.promise).mockResolvedValueOnce([makeCandidate({ flowId: 'fresh' })]);
        vi.mocked(getOfflineDependents).mockReturnValueOnce(oldDependents.promise).mockResolvedValueOnce([]);
        const { props, rerender } = renderDialog();
        const nextDocument = makeDocument({ path: '_flows/新任务/flow.yaml', flowId: 'new-current', dependencyConfig: {
            dependencies: [{ groupId: 1, flowId: 'fresh' }], failurePolicy: 'PAUSE', crossGroupDependency: 'DENY',
        } });
        rerender(<DependencyDialog {...props} document={nextDocument} />);
        await loaded();
        await act(async () => {
            if (settlement === 'resolve') oldCandidates.resolve([makeCandidate({ flowId: 'stale' })]);
            else oldCandidates.reject(new Error('old task failed'));
            oldDependents.resolve([{ groupId: 2, groupName: '旧下游组', flowId: 'old-dependent', path: '_flows/旧下游/flow.yaml' }]);
        });
        expect(screen.queryByText('stale')).toBeNull();
        expect(screen.queryByText(/旧下游组/)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(crossGroupSwitch().disabled).toBe(false);
        expect(getOfflineDependents).toHaveBeenLastCalledWith(1, nextDocument.path);
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith(nextDocument.dependencyConfig);
    });

    it('ignores pending reads after unmount', async () => {
        const candidates = deferred<OfflineDependencyCandidate[]>();
        vi.mocked(searchOfflineDependencyCandidates).mockReturnValue(candidates.promise);
        const { unmount, props } = renderDialog();
        unmount();
        await act(async () => candidates.resolve([makeCandidate()]));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(props.onStage).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
    });

    it('keeps an unknown selected ref removable without exposing its identifiers or stale names', async () => {
        const hiddenRef = { groupId: 9999, flowId: 'secret_flow', groupName: '机密组名', path: '_flows/机密目录/flow.yaml' };
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([makeCandidate()]);
        const { props } = renderDialog({ document: makeDocument({ dependencyConfig: {
            dependencies: [hiddenRef], failurePolicy: 'PAUSE', crossGroupDependency: 'ALLOW',
        } }) });
        await loaded();
        expect(screen.getByText('不可见前置任务 1')).toBeTruthy();
        expect(screen.getByText('任务不可见或已不存在，请移除后暂存')).toBeTruthy();
        const dialog = screen.getByRole('dialog');
        for (const secret of ['9999', 'secret_flow', '机密组名', '机密目录']) expect(dialog.outerHTML).not.toContain(secret);
        expect(stageButton().disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: '移除前置任务 1' }));
        expect(stageButton().disabled).toBe(false);
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith({ dependencies: [], failurePolicy: 'PAUSE', crossGroupDependency: 'ALLOW' });
    });

    it('allows removing selected tasks that are no longer eligible', async () => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([makeCandidate({ period: 'MONTHLY', cron: '0 2 1 * *' })]);
        renderDialog({ document: makeDocument({ dependencyConfig: {
            dependencies: [{ groupId: 1, flowId: 'upstream' }], failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW',
        } }) });
        await loaded();
        expect(stageButton().disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: '移除 数据平台 / upstream' }));
        expect(stageButton().disabled).toBe(false);
    });

    it('locks the incoming cross-group switch and identifies visible downstream tasks', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([
            { groupId: 2, groupName: '报表组', flowId: 'daily-report', path: '_flows/日报/flow.yaml' },
            { groupId: 1, groupName: '数据平台', flowId: 'same-group', path: '_flows/内部/flow.yaml' },
        ]);
        const { props } = renderDialog();
        await loaded();
        expect(crossGroupSwitch().disabled).toBe(true);
        expect(crossGroupSwitch().getAttribute('aria-checked')).toBe('true');
        expect(screen.getByText('已有跨项目组下游依赖，请先解除以下依赖，再关闭开关：')).toBeTruthy();
        expect(within(screen.getByRole('list', { name: '跨项目组下游任务' })).getByText('报表组 / daily-report')).toBeTruthy();
        expect(screen.queryByText('数据平台 / same-group')).toBeNull();
        fireEvent.click(crossGroupSwitch());
        fireEvent.click(stageButton());
        expect(props.onStage).toHaveBeenCalledWith({ dependencies: [], failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW' });
    });

    it('lets an inconsistent DENY draft be corrected to ALLOW when cross-group downstreams exist', async () => {
        vi.mocked(getOfflineDependents).mockResolvedValue([{ groupId: 2, groupName: '报表组', flowId: 'report', path: '_flows/report/flow.yaml' }]);
        renderDialog({ document: makeDocument({ dependencyConfig: { dependencies: [], failurePolicy: 'CONTINUE', crossGroupDependency: 'DENY' } }) });
        await loaded();
        expect(stageButton().disabled).toBe(true);
        expect(crossGroupSwitch().getAttribute('aria-checked')).toBe('false');
        fireEvent.click(crossGroupSwitch());
        expect(crossGroupSwitch().disabled).toBe(true);
        expect(stageButton().disabled).toBe(false);
    });

    it('keeps all mutations disabled in read-only mode while allowing search and closing', async () => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([makeCandidate(), makeCandidate({ flowId: 'other' })]);
        const { props } = renderDialog({ canWrite: false, document: makeDocument({ dependencyConfig: {
            dependencies: [{ groupId: 1, flowId: 'upstream' }], failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW',
        } }) });
        await loaded();
        for (const radio of screen.getAllByRole('radio')) expect(radio.matches(':disabled')).toBe(true);
        expect(crossGroupSwitch().disabled).toBe(true);
        expect(addButton('数据平台', 'other').disabled).toBe(true);
        expect((screen.getByRole('button', { name: '移除 数据平台 / upstream' }) as HTMLButtonElement).disabled).toBe(true);
        expect(stageButton().disabled).toBe(true);
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'other' } });
        fireEvent.click(stageButton());
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
        expect(props.onStage).not.toHaveBeenCalled();
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it.each([
        ['HOURLY', '17 * * * *', '每小时 · 17 分 · UTC'],
        ['DAILY', '5 9 * * *', '每天 · 09:05 · UTC'],
        ['WEEKLY', '30 6 * * 0', '每周 · 周日 06:30 · UTC'],
        ['WEEKLY', '30 6 * * 7', '每周 · 周日 06:30 · UTC'],
        ['MONTHLY', '45 11 15 * *', '每月 · 15 日 11:45 · UTC'],
        ['YEARLY', '0 8 1 10 *', '每年 · 10 月 1 日 08:00 · UTC'],
        ['DAILY', null, '每天 · 计划时间不可用 · UTC'],
        ['DAILY', '99 99 * * *', '每天 · 计划时间不可用 · UTC'],
        ['DAILY', '0 1,8 * * *', '每天 · 计划时间不可用 · UTC'],
        ['DAILY', '0 2 * * 1', '每天 · 计划时间不可用 · UTC'],
    ] as const)('summarizes %s cron %s without inventing a plan time', async (period, cron, summary) => {
        vi.mocked(searchOfflineDependencyCandidates).mockResolvedValue([makeCandidate({ period, cron, timezone: 'UTC' })]);
        renderDialog({ document: makeDocument({ dependencyConfig: {
            dependencies: [{ groupId: 1, flowId: 'upstream' }], failurePolicy: 'CONTINUE', crossGroupDependency: 'ALLOW',
        } }) });
        await loaded();
        const selected = screen.getByRole('list', { name: '已选前置任务' });
        expect(within(selected).getByText(summary)).toBeTruthy();
        expect(screen.getByRole('dialog').contains(selected)).toBe(true);
        expect(screen.getByRole('dialog').contains(screen.getByRole('list', { name: '候选任务' }))).toBe(true);
    });
});
