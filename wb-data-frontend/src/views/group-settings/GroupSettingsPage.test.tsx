import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GroupSettingsPage from './GroupSettingsPage';
import { AxiosError, AxiosHeaders } from 'axios';
import { removeMember, updateMemberRole, type MemberRecord } from '../../api/groupSettings';

const { showSuccess, showError, addMembers, getMemberPage, authSnapshot } = vi.hoisted(() => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    addMembers: vi.fn(),
    getMemberPage: vi.fn(),
    authSnapshot: {
        currentGroup: { id: 1, name: 'Policy' },
        permissions: ['group.settings', 'member.manage'],
        systemAdmin: false,
        userInfo: { id: 9 },
    },
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({
        showSuccess,
        showError,
        dismissFeedback: vi.fn(),
    }),
}));

vi.mock('../../utils/auth', () => ({
    useAuthStore: (selector: (state: typeof authSnapshot) => unknown) => selector(authSnapshot),
}));

vi.mock('../../api/groupSettings', async () => {
    const actual = await vi.importActual<typeof import('../../api/groupSettings')>('../../api/groupSettings');
    return {
        ...actual,
        getGroupSettings: vi.fn().mockResolvedValue({
            id: 1,
            name: 'Policy',
            description: '',
            createdAt: '2026-05-03T00:00:00Z',
        }),
        getMemberPage,
        addMember: vi.fn(),
        addMembers,
        removeMember: vi.fn(),
        updateGroupSettings: vi.fn(),
        updateMemberRole: vi.fn(),
    };
});

vi.mock('./GroupInfoCard', () => ({
    default: () => <div>group-info-card</div>,
}));

vi.mock('./MemberTable', () => ({
    default: ({ data, onRemove, onChangeRole }: { data: MemberRecord[]; onRemove: (member: MemberRecord) => void; onChangeRole: (member: MemberRecord) => void }) => <div>
        member-table
        {data.map((member) => <div key={member.id}>
            <button onClick={() => onRemove(member)}>移除成员</button>
            <button onClick={() => onChangeRole(member)}>修改角色</button>
        </div>)}
    </div>,
}));

vi.mock('./ChangeRoleDialog', () => ({
    default: ({ open, member, onConfirm }: { open: boolean; member: MemberRecord | null; onConfirm: (id: number, role: string) => void }) =>
        open && member ? <button onClick={() => onConfirm(member.id, 'DEVELOPER')}>确认修改</button> : null,
}));

vi.mock('./GitSettingsTab', () => ({
    default: () => <div>git-settings-tab</div>,
}));

vi.mock('./KestraSyncSettingsTab', () => ({
    default: () => <div>kestra-sync-settings-tab</div>,
}));

vi.mock('../../components/ui/confirm-dialog', () => ({
    ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open ? <button onClick={onConfirm}>确认移除</button> : null,
}));

vi.mock('./AddMemberDialog', () => ({
    default: ({
        open,
        onSuccess,
    }: {
        open: boolean;
        onSuccess: (payload: { userIds: number[]; role: string }, usernames: string[]) => void;
    }) =>
        open ? (
            <button
                type="button"
                onClick={() => onSuccess({ userIds: [7, 8], role: 'GROUP_ADMIN' }, ['bob', 'alice'])}
            >
                完成批量添加
            </button>
        ) : null,
}));

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
}

function renderWithProviders(queryClient = createQueryClient()) {
    return {
        queryClient,
        ...render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <GroupSettingsPage />
                </MemoryRouter>
            </QueryClientProvider>,
        ),
    };
}

afterEach(() => {
    cleanup();
    authSnapshot.currentGroup = { id: 1, name: 'Policy' };
    vi.clearAllMocks();
});

describe('GroupSettingsPage', () => {
    beforeEach(() => {
        getMemberPage.mockResolvedValue({
            records: [],
            total: 0,
            pages: 0,
            current: 1,
            size: 10,
        });
    });

    it.each([
        ['移除成员', '确认移除', removeMember, '移除成员失败'],
        ['修改角色', '确认修改', updateMemberRole, '角色变更失败'],
    ] as const)('shows the server last-administrator rejection for %s', async (action, confirm, api, title) => {
        getMemberPage.mockResolvedValue({ records: [{ id: 1, userId: 7, role: 'GROUP_ADMIN', username: 'alice', displayName: 'Alice', createdAt: '' }], total: 1, pages: 1, current: 1, size: 10 });
        const message = '项目组必须保留至少一名管理员';
        const rejection = new AxiosError('Request failed with status code 400', undefined, undefined, undefined, {
            status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new AxiosHeaders() }, data: { message },
        });
        vi.mocked(api).mockRejectedValueOnce(rejection);
        renderWithProviders();
        fireEvent.click(await screen.findByRole('button', { name: action }));
        fireEvent.click(await screen.findByRole('button', { name: confirm }));
        await waitFor(() => expect(showError).toHaveBeenCalledWith(rejection, title));
    });

    it('refetches members for the newly selected project group', async () => {
        const { rerender, queryClient } = renderWithProviders();

        await waitFor(() => {
            expect(getMemberPage).toHaveBeenCalledWith(expect.objectContaining({ groupId: 1 }));
        });

        authSnapshot.currentGroup = { id: 2, name: 'Beta' };
        rerender(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <GroupSettingsPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        await waitFor(() => {
            expect(getMemberPage).toHaveBeenCalledWith(expect.objectContaining({ groupId: 2 }));
        });
    });

    it('keeps project settings focused on members and remote repository connection', async () => {
        renderWithProviders();

        expect(screen.queryByRole('button', { name: '工作分支' })).toBeNull();

        fireEvent.click(await screen.findByRole('button', { name: '远程仓库' }));
        expect(screen.getByText('git-settings-tab')).toBeTruthy();
    });

    it('opens schedule sync as an independent settings tab', async () => {
        renderWithProviders();

        fireEvent.click(await screen.findByRole('button', { name: '调度同步' }));

        expect(screen.getByText('kestra-sync-settings-tab')).toBeTruthy();
        expect(screen.queryByText('git-settings-tab')).toBeNull();
    });

    it('submits batch member payloads and shows quantity-based success feedback', async () => {
        addMembers.mockResolvedValueOnce(undefined);

        renderWithProviders();

        fireEvent.click(await screen.findByRole('button', { name: '添加成员' }));
        fireEvent.click(screen.getByRole('button', { name: '完成批量添加' }));

        await waitFor(() => {
            expect(addMembers).toHaveBeenCalledWith(1, { userIds: [7, 8], role: 'GROUP_ADMIN' });
        });

        await waitFor(() => {
            expect(showSuccess).toHaveBeenCalledWith('已添加 2 名成员');
        });
    });
});
