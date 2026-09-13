import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GroupSettingsPage from './GroupSettingsPage';

const { showFeedback, addMembers, getMemberPage, authSnapshot } = vi.hoisted(() => ({
    showFeedback: vi.fn(),
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
        showFeedback,
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
    default: () => <div>member-table</div>,
}));

vi.mock('./ChangeRoleDialog', () => ({
    default: () => null,
}));

vi.mock('./GitSettingsTab', () => ({
    default: () => <div>git-settings-tab</div>,
}));

vi.mock('./KestraSyncSettingsTab', () => ({
    default: () => <div>kestra-sync-settings-tab</div>,
}));

vi.mock('../../components/ui/confirm-dialog', () => ({
    ConfirmDialog: () => null,
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
            expect(showFeedback).toHaveBeenCalledWith({
                tone: 'success',
                title: '已添加 2 名成员',
                detail: '',
            });
        });
    });
});
