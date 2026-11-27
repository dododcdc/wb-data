import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRecord } from '../../api/user';
import { DisableUserDialog } from './DisableUserDialog';

const ownershipApiMocks = vi.hoisted(() => ({
    getUserAssetSummary: vi.fn(),
}));

const groupSettingsApiMocks = vi.hoisted(() => ({
    getGroupOwnerCandidates: vi.fn(),
}));

vi.mock('../../api/ownership', () => ({
    getUserAssetSummary: ownershipApiMocks.getUserAssetSummary,
}));

vi.mock('../../api/groupSettings', () => ({
    getGroupOwnerCandidates: groupSettingsApiMocks.getGroupOwnerCandidates,
}));

const sampleUser: UserRecord = {
    id: 21,
    username: 'xiaoming',
    displayName: '小明',
    systemRole: 'USER',
    status: 'ACTIVE',
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
};

function renderDialog(overrides: Partial<Parameters<typeof DisableUserDialog>[0]> = {}) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
    const onClose = vi.fn();
    const onConfirmDisableOnly = vi.fn();
    const onConfirmHandoverAndDisable = vi.fn();
    render(
        <QueryClientProvider client={queryClient}>
            <DisableUserDialog
                user={sampleUser}
                onClose={onClose}
                onConfirmDisableOnly={onConfirmDisableOnly}
                onConfirmHandoverAndDisable={onConfirmHandoverAndDisable}
                {...overrides}
            />
        </QueryClientProvider>,
    );
    return { onClose, onConfirmDisableOnly, onConfirmHandoverAndDisable };
}

beforeEach(() => {
    groupSettingsApiMocks.getGroupOwnerCandidates.mockImplementation(async (groupId: number) => {
        if (groupId === 10) {
            return [
                { userId: 21, username: 'xiaoming', displayName: '小明', role: 'DEVELOPER', status: 'ACTIVE' },
                { userId: 31, username: 'xiaohong', displayName: '小红', role: 'GROUP_ADMIN', status: 'ACTIVE' },
            ];
        }
        return [
            { userId: 21, username: 'xiaoming', displayName: '小明', role: 'DEVELOPER', status: 'ACTIVE' },
            { userId: 41, username: 'laozhang', displayName: '老张', role: 'GROUP_ADMIN', status: 'ACTIVE' },
        ];
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('DisableUserDialog', () => {
    it('confirms direct disable when user owns no assets', async () => {
        ownershipApiMocks.getUserAssetSummary.mockResolvedValueOnce({
            userId: 21,
            totalDataSources: 0,
            totalParameterGroups: 0,
            totalOfflineFlows: 0,
            totalCount: 0,
            groups: [],
        });

        const { onConfirmDisableOnly } = renderDialog();

        const confirmBtn = await screen.findByRole('button', { name: '确认禁用' });
        fireEvent.click(confirmBtn);
        expect(onConfirmDisableOnly).toHaveBeenCalledWith(sampleUser);
    });

    it('requires successor per affected group before handing over and disabling', async () => {
        ownershipApiMocks.getUserAssetSummary.mockResolvedValueOnce({
            userId: 21,
            totalDataSources: 2,
            totalParameterGroups: 1,
            totalOfflineFlows: 3,
            totalCount: 6,
            groups: [
                {
                    groupId: 10,
                    groupName: '风险策略组',
                    userId: 21,
                    dataSourceCount: 2,
                    parameterGroupCount: 0,
                    offlineFlowCount: 1,
                    totalCount: 3,
                },
                {
                    groupId: 20,
                    groupName: '反欺诈组',
                    userId: 21,
                    dataSourceCount: 0,
                    parameterGroupCount: 1,
                    offlineFlowCount: 2,
                    totalCount: 3,
                },
            ],
        });

        const { onConfirmHandoverAndDisable, onConfirmDisableOnly } = renderDialog();

        expect(await screen.findByText(/在 2 个项目组中仍负责共 6 项资产/)).toBeTruthy();
        const handoverBtn = screen.getByRole('button', { name: '交接并禁用' }) as HTMLButtonElement;
        expect(handoverBtn.disabled).toBe(true);

        const group10Select = screen.getByRole('combobox', { name: '为 风险策略组 选择接手人' });
        fireEvent.click(group10Select);
        fireEvent.click(await screen.findByText('小红 (@xiaohong)'));
        expect(handoverBtn.disabled).toBe(true);

        const group20Select = screen.getByRole('combobox', { name: '为 反欺诈组 选择接手人' });
        fireEvent.click(group20Select);
        fireEvent.click(await screen.findByText('老张 (@laozhang)'));

        await waitFor(() => {
            expect((screen.getByRole('button', { name: '交接并禁用' }) as HTMLButtonElement).disabled).toBe(false);
        });

        fireEvent.click(screen.getByRole('button', { name: '交接并禁用' }));
        expect(onConfirmHandoverAndDisable).toHaveBeenCalledWith(sampleUser, [
            { groupId: 10, targetOwnerUserId: 31 },
            { groupId: 20, targetOwnerUserId: 41 },
        ]);

        fireEvent.click(screen.getByRole('button', { name: '暂不交接，直接禁用' }));
        expect(onConfirmDisableOnly).toHaveBeenCalledWith(sampleUser);
    });
});
