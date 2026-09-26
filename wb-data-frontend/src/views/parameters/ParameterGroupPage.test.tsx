import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    archiveParameterGroup,
    createParameterGroup,
    getParameterGroup,
    getParameterGroupPage,
    getParameterGroupReferences,
    previewParameterGroup,
    updateParameterGroup,
} from '../../api/parameterGroups';
import { useAuthStore } from '../../utils/auth';
import ParameterGroupPage from './ParameterGroupPage';

vi.mock('../../api/parameterGroups', () => ({
    archiveParameterGroup: vi.fn(),
    createParameterGroup: vi.fn(),
    getParameterGroup: vi.fn(),
    getParameterGroupPage: vi.fn(),
    getParameterGroupReferences: vi.fn(),
    previewParameterGroup: vi.fn(),
    restoreParameterGroup: vi.fn(),
    updateParameterGroup: vi.fn(),
}));

const getParameterGroupPageMock = vi.mocked(getParameterGroupPage);
const createParameterGroupMock = vi.mocked(createParameterGroup);
const getParameterGroupMock = vi.mocked(getParameterGroup);
const getParameterGroupReferencesMock = vi.mocked(getParameterGroupReferences);
const previewParameterGroupMock = vi.mocked(previewParameterGroup);
const archiveParameterGroupMock = vi.mocked(archiveParameterGroup);
const updateParameterGroupMock = vi.mocked(updateParameterGroup);

describe('ParameterGroupPage', () => {
    beforeEach(() => {
        useAuthStore.setState({
            token: 'token',
            userInfo: { id: 1, username: 'alice', displayName: 'Alice', systemRole: 'USER' },
            systemAdmin: false,
            currentGroup: { id: 5, name: 'analytics', description: '', role: 'DEVELOPER' },
            accessibleGroups: [{ id: 5, name: 'analytics', description: '', role: 'DEVELOPER' }],
            permissions: ['parameter.read', 'parameter.write'],
            contextLoaded: true,
        });
        getParameterGroupPageMock.mockResolvedValue({
            records: [
                {
                    id: 12,
                    code: 'daily_common',
                    name: '日常公共参数',
                    description: '日批任务共用日期与租户参数',
                    version: 3,
                    revision: 8,
                    status: 'ACTIVE',
                    parameterCount: 2,
                    createdBy: 1,
                    updatedBy: 1,
                    createdAt: '2026-08-14T08:00:00Z',
                    updatedAt: '2026-08-15T08:30:00Z',
                },
            ],
            total: 1,
            size: 20,
            current: 1,
            pages: 1,
        });
        createParameterGroupMock.mockResolvedValue({
            id: 13,
            code: 'daily_sales',
            name: '销售日批参数',
            description: '销售任务共用参数',
            version: 1,
            revision: 1,
            status: 'ACTIVE',
            parameterCount: 2,
            createdBy: 1,
            updatedBy: 1,
            createdAt: '2026-08-15T09:00:00Z',
            updatedAt: '2026-08-15T09:00:00Z',
            definitions: [],
        });
        previewParameterGroupMock.mockResolvedValue({
            parameterGroupId: 12,
            version: 3,
            runtimeTimezone: 'Asia/Shanghai',
            plannedTime: '2026-08-15T02:00:00+08:00',
            executionStartTime: '2026-08-15T16:30:00+08:00',
            values: [
                { key: 'tenant_name', valueSource: 'CONSTANT', timeBasis: null, value: '小明', overridden: false },
                { key: 'v_day', valueSource: 'SYSTEM_TIME', timeBasis: 'PLANNED_TIME', value: '20260815', overridden: false },
            ],
        });
        archiveParameterGroupMock.mockResolvedValue({
            id: 12,
            code: 'daily_common',
            name: '日常公共参数',
            description: '日批任务共用日期与租户参数',
            version: 3,
            revision: 9,
            status: 'ARCHIVED',
            parameterCount: 2,
            createdBy: 1,
            updatedBy: 1,
            createdAt: '2026-08-14T08:00:00Z',
            updatedAt: '2026-08-15T09:00:00Z',
            definitions: [],
        });
        getParameterGroupMock.mockResolvedValue({
            id: 12,
            code: 'daily_common',
            name: '日常公共参数',
            description: '日批任务共用日期与租户参数',
            version: 3,
            revision: 8,
            status: 'ACTIVE',
            parameterCount: 1,
            createdBy: 1,
            updatedBy: 1,
            createdAt: '2026-08-14T08:00:00Z',
            updatedAt: '2026-08-15T08:30:00Z',
            definitions: [{
                id: 11,
                key: 'tenant_name',
                valueSource: 'CONSTANT',
                constantValue: '小明',
                timeBasis: null,
                format: null,
                offsetDays: 0,
                description: null,
                sortOrder: 0,
            }, {
                id: 12,
                key: 'v_day',
                valueSource: 'SYSTEM_TIME',
                constantValue: null,
                timeBasis: 'PLANNED_TIME',
                format: 'yyyyMMdd',
                offsetDays: 0,
                description: null,
                sortOrder: 1,
            }],
        });
        updateParameterGroupMock.mockImplementation(async (_groupId, _id, request) => ({
            ...await getParameterGroupMock(5, 12),
            name: request.name,
            revision: 9,
        }));
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('loads parameter groups for the current project group', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        expect(await screen.findByText('日常公共参数')).toBeTruthy();
        expect(screen.getByText('2 个参数')).toBeTruthy();
        expect(screen.getByText('v3')).toBeTruthy();
        await waitFor(() => expect(getParameterGroupPageMock).toHaveBeenCalledWith({
            groupId: 5,
            page: 1,
            size: 20,
            keyword: undefined,
            status: undefined,
        }));
    });

    it('creates a constant parameter group from the management page', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '新建参数组' }));
        expect(screen.getByText(/HiveSQL 里，值的位置会变成字符串/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('参数组名称'), { target: { value: '销售日批参数' } });
        fireEvent.change(screen.getByLabelText('参数组说明'), { target: { value: '销售任务共用参数' } });
        fireEvent.change(screen.getByLabelText('参数名 1'), { target: { value: 'tenant_name' } });
        fireEvent.change(screen.getByLabelText('固定值 1'), { target: { value: '小明' } });
        fireEvent.click(screen.getByRole('button', { name: '创建参数组' }));

        await waitFor(() => expect(createParameterGroupMock).toHaveBeenCalledWith(5, {
            code: expect.stringMatching(/^pg_[a-z0-9]+$/),
            name: '销售日批参数',
            description: '销售任务共用参数',
            definitions: [
                {
                    key: 'tenant_name',
                    valueSource: 'CONSTANT',
                    constantValue: '小明',
                    timeBasis: null,
                    format: null,
                    offsetDays: 0,
                    description: null,
                    sortOrder: 0,
                },
            ],
        }));
    });

    it('keeps the create dialog open when selecting value source and time basis', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '新建参数组' }));
        fireEvent.click(screen.getByRole('combobox', { name: '取值方式 1' }));
        const runtimeDateOption = await screen.findByRole('option', { name: '运行时日期' });
        fireEvent.mouseMove(runtimeDateOption);
        fireEvent.click(runtimeDateOption);

        expect(screen.getByRole('dialog', { name: '创建参数组' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: '取值方式 1' }).textContent).toContain('运行时日期');
        fireEvent.click(screen.getByRole('combobox', { name: '时间基准 1' }));
        const executionStartOption = await screen.findByRole('option', { name: '执行开始时间' });
        fireEvent.mouseMove(executionStartOption);
        fireEvent.click(executionStartOption);

        expect(screen.getByRole('dialog', { name: '创建参数组' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: '时间基准 1' }).textContent).toContain('执行开始时间');
        expect(screen.queryByText('类型')).toBeNull();
        expect(screen.queryByText('时区')).toBeNull();
    });

    it('uses the concurrency revision when updating a parameter group', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '编辑日常公共参数' }));
        await screen.findByDisplayValue('日常公共参数');
        fireEvent.change(screen.getByLabelText('参数组名称'), { target: { value: '公共参数（新）' } });
        fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

        await waitFor(() => expect(updateParameterGroupMock).toHaveBeenCalledWith(5, 12, expect.objectContaining({
            expectedRevision: 8,
            name: '公共参数（新）',
        })));
    });

    it('requires confirmation before saving a removed or renamed parameter key', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '编辑日常公共参数' }));
        await screen.findByDisplayValue('日常公共参数');
        fireEvent.change(screen.getByLabelText('参数名 1'), { target: { value: 'customer_name' } });
        fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

        const firstConfirmation = screen.getByRole('dialog', { name: '确认移除参数？' });
        expect(within(firstConfirmation).getByText('tenant_name')).toBeTruthy();
        expect(updateParameterGroupMock).not.toHaveBeenCalled();

        fireEvent.click(within(firstConfirmation).getByRole('button', { name: '返回修改' }));
        expect(screen.queryByRole('dialog', { name: '确认移除参数？' })).toBeNull();
        expect(screen.getByRole('dialog', { name: '编辑参数组' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
        const secondConfirmation = screen.getByRole('dialog', { name: '确认移除参数？' });
        fireEvent.click(within(secondConfirmation).getByRole('button', { name: '仍然保存' }));

        await waitFor(() => expect(updateParameterGroupMock).toHaveBeenCalledWith(5, 12, expect.objectContaining({
            expectedRevision: 8,
            definitions: expect.arrayContaining([
                expect.objectContaining({ key: 'customer_name' }),
            ]),
        })));
    });

    it('edits one parameter at a time and focuses a newly added parameter', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '编辑日常公共参数' }));
        await screen.findByDisplayValue('日常公共参数');

        expect(screen.getByRole('button', { name: '参数 tenant_name', pressed: true })).toBeTruthy();
        expect(screen.getByDisplayValue('tenant_name')).toBeTruthy();
        expect(screen.queryByDisplayValue('v_day')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '参数 v_day' }));
        expect(screen.getByLabelText('参数名 2')).toBeTruthy();
        expect(screen.getByDisplayValue('v_day')).toBeTruthy();
        expect(screen.queryByLabelText('参数名 1')).toBeNull();

        fireEvent.change(screen.getByLabelText('参数名 2'), { target: { value: '1bad' } });
        fireEvent.click(screen.getByRole('button', { name: '参数 tenant_name' }));
        fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', '第 2 个参数名格式不正确');
        expect(screen.getByLabelText('参数名 2').getAttribute('aria-invalid')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: '添加参数' }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByLabelText('参数名 3'));
        });
        expect(screen.getByRole('button', { name: '参数 3', pressed: true })).toBeTruthy();
    });

    it('filters the parameter list and opens the matching parameter', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '编辑日常公共参数' }));
        await screen.findByDisplayValue('日常公共参数');

        fireEvent.change(screen.getByLabelText('搜索参数'), { target: { value: 'v_day' } });

        expect(screen.queryByRole('button', { name: '参数 tenant_name' })).toBeNull();
        await waitFor(() => {
            expect(screen.getByRole('button', { name: '参数 v_day', pressed: true })).toBeTruthy();
        });
        expect(screen.getByLabelText('参数名 2')).toBeTruthy();
        expect(screen.getByText('匹配 1 / 2')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('搜索参数'), { target: { value: '不存在的参数' } });
        expect(screen.getByText('没有匹配的参数')).toBeTruthy();
    });

    it('previews the values resolved for a parameter group', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '预览日常公共参数' }));

        expect(await screen.findByText('20260815')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '使用浏览器当前时间与时区' })).toBeNull();
        expect(screen.getByText('小明')).toBeTruthy();
        expect(screen.getByText('tenant_name')).toBeTruthy();
        expect(screen.getByText('v_day')).toBeTruthy();
        expect(screen.getByText('固定值')).toBeTruthy();
        expect(screen.getByText('运行时日期')).toBeTruthy();
        expect(screen.queryByText('待计算')).toBeNull();
        expect(screen.getByRole('button', { name: '计划时间' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '执行开始时间' })).toBeNull();
        await waitFor(() => expect(previewParameterGroupMock).toHaveBeenCalledWith(5, 12, {
            plannedTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
            executionStartTime: null,
            runtimeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            overrides: {},
        }));
    });

    it('previews execution start time when a parameter uses that basis', async () => {
        getParameterGroupMock.mockResolvedValueOnce({
            ...await getParameterGroupMock(5, 12),
            definitions: [{
                id: 21,
                key: 'v_start',
                valueSource: 'SYSTEM_TIME',
                constantValue: null,
                timeBasis: 'EXECUTION_START_TIME',
                format: 'yyyyMMdd',
                offsetDays: 0,
                description: null,
                sortOrder: 0,
            }],
        });
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '预览日常公共参数' }));

        expect(await screen.findByRole('button', { name: '执行开始时间' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '计划时间' })).toBeNull();
        await waitFor(() => expect(previewParameterGroupMock).toHaveBeenCalledWith(5, 12, {
            plannedTime: null,
            executionStartTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
            runtimeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            overrides: {},
        }));
    });

    it('shows constant-only values without asking for a time context', async () => {
        getParameterGroupMock.mockResolvedValueOnce({
            ...await getParameterGroupMock(5, 12),
            parameterCount: 1,
            definitions: [{
                id: 11,
                key: 'tenant_name',
                valueSource: 'CONSTANT',
                constantValue: '小明',
                timeBasis: null,
                format: null,
                offsetDays: 0,
                description: null,
                sortOrder: 0,
            }],
        });
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '预览日常公共参数' }));

        expect(await screen.findByText('小明')).toBeTruthy();
        expect(screen.queryByRole('combobox', { name: '任务运行时区' })).toBeNull();
        expect(screen.queryByRole('button', { name: '计算预览' })).toBeNull();
        expect(previewParameterGroupMock).not.toHaveBeenCalled();
    });

    it('archives an active parameter group after confirmation', async () => {
        getParameterGroupReferencesMock.mockResolvedValue({ totalCount: 0, sampleFlows: [] });
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '归档日常公共参数' }));

        expect(await screen.findByText('当前没有任务绑定该参数组。')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '确认归档' }));

        await waitFor(() => expect(archiveParameterGroupMock).toHaveBeenCalledWith(5, 12));
    });

    it('shows binding impact with sample flows before archiving', async () => {
        getParameterGroupReferencesMock.mockResolvedValue({
            totalCount: 132,
            sampleFlows: ['_flows/alpha', '_flows/beta', '_flows/gamma'],
        });
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParameterGroupPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '归档日常公共参数' }));

        expect(await screen.findByText(/当前有/)).toBeTruthy();
        expect(screen.getByText('132')).toBeTruthy();
        expect(screen.getByText(/_flows\/alpha、_flows\/beta、_flows\/gamma 等 132 个/)).toBeTruthy();
        expect(getParameterGroupReferencesMock).toHaveBeenCalledWith(5, 12);
    });
});
