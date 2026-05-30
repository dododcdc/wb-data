import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import LocalSettingsTab from './LocalSettingsTab';

// Mock offline APIs
const {
    getOfflineRepoStatus,
    listBranches,
    createBranch,
    deleteBranch,
    mergeBranch,
} = vi.hoisted(() => ({
    getOfflineRepoStatus: vi.fn(),
    listBranches: vi.fn(),
    createBranch: vi.fn(),
    deleteBranch: vi.fn(),
    mergeBranch: vi.fn(),
}));

vi.mock('../../api/offline', () => ({
    getOfflineRepoStatus,
    listBranches,
    createBranch,
    deleteBranch,
    mergeBranch,
}));

vi.mock('../../components/SimpleSelect', () => ({
    SimpleSelect: ({ value, options, onChange, id }: { value?: string; options: { label: string; value: string }[]; onChange: (val: string) => void; id?: string }) => (
        <select
            data-testid={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            role="combobox"
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value} role="option">
                    {opt.label}
                </option>
            ))}
        </select>
    ),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
});

function renderWithQuery(ui: React.ReactElement) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter>
                {ui}
            </MemoryRouter>
        </QueryClientProvider>
    );
}

const mockStatus = {
    groupId: 1,
    repoPath: '/var/data/wb-data-1',
    exists: true,
    gitInitialized: true,
    dirty: false,
    ahead: false,
    hasRemote: true,
    hasUpstream: true,
    branch: 'main',
    headCommitId: 'abc1234',
    headCommitMessage: 'initial commit',
    headCommitAt: '2026-05-30T10:00:00Z',
};

const mockBranches = {
    branches: [
        { name: 'main', current: true, local: true, remote: true, remoteName: 'origin/main', trackingBranch: 'origin/main' },
        { name: 'dev', current: false, local: true, remote: true, remoteName: 'origin/dev', trackingBranch: 'origin/dev' },
        { name: 'feature/test', current: false, local: true, remote: false, remoteName: null, trackingBranch: null },
    ],
};

describe('LocalSettingsTab - basic display', () => {
    it('renders physical path and branch list properly', async () => {
        getOfflineRepoStatus.mockResolvedValue(mockStatus);
        listBranches.mockResolvedValue(mockBranches);

        renderWithQuery(<LocalSettingsTab groupId={1} canEdit={false} />);

        // Should show path
        const pathElem = await screen.findByTestId('repo-path');
        expect(pathElem.textContent).toBe('/var/data/wb-data-1');

        // Should show branches
        expect(screen.getByText('main')).toBeTruthy();
        expect(screen.getByText('dev')).toBeTruthy();
        expect(screen.getByText('feature/test')).toBeTruthy();

        // Active branch badge should be visible
        expect(screen.getByText('当前分支')).toBeTruthy();
        // Tracking text should be visible next to tracked branches
        expect(screen.getByText('→ 已关联远程: origin/main')).toBeTruthy();
    });
});

describe('LocalSettingsTab - permission controls', () => {
    it('hides actionable branch buttons and creation button when canEdit is false', async () => {
        getOfflineRepoStatus.mockResolvedValue(mockStatus);
        listBranches.mockResolvedValue(mockBranches);

        renderWithQuery(<LocalSettingsTab groupId={1} canEdit={false} />);

        await screen.findByText('main');

        // Creation button and Merge buttons are absent
        expect(screen.queryByRole('button', { name: /新建分支/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /合并分支/ })).toBeNull();

        // Action icon (Delete) is absent
        expect(screen.queryByTitle('删除')).toBeNull();
    });

    it('shows action buttons when canEdit is true', async () => {
        getOfflineRepoStatus.mockResolvedValue(mockStatus);
        listBranches.mockResolvedValue(mockBranches);

        renderWithQuery(<LocalSettingsTab groupId={1} canEdit={true} />);

        await screen.findByText('main');

        // Creation and Merge buttons are present in header
        expect(screen.getByRole('button', { name: /新建分支/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /合并分支/ })).toBeTruthy();

        // Delete buttons are present (for non-active and non-main branches, i.e., 'dev' and 'feature/test')
        const deleteBtns = screen.getAllByTitle('删除');
        expect(deleteBtns.length).toBe(2);
    });
});

describe('LocalSettingsTab - branch actions', () => {
    it('triggers branch creation flow when submit button is clicked in modal', async () => {
        getOfflineRepoStatus.mockResolvedValue(mockStatus);
        listBranches.mockResolvedValue(mockBranches);
        createBranch.mockResolvedValue(null);

        renderWithQuery(<LocalSettingsTab groupId={1} canEdit={true} />);

        const createBtn = await screen.findByRole('button', { name: /新建分支/ });
        fireEvent.click(createBtn);

        // Modal should open
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByRole('heading', { name: '新建本地分支' })).toBeTruthy();

        // Input new branch name
        const input = screen.getByPlaceholderText('输入新分支名，如 feature/new-flow');
        fireEvent.change(input, { target: { value: 'feature/awesome' } });

        // Confirm
        const confirmBtn = screen.getByRole('button', { name: '确认创建' });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(createBranch).toHaveBeenCalledWith(1, 'feature/awesome', 'main');
        });
    });

    it('triggers branch merge flow with pre-check validation', async () => {
        getOfflineRepoStatus.mockResolvedValue(mockStatus);
        listBranches.mockResolvedValue(mockBranches);
        mergeBranch.mockResolvedValue(null);

        renderWithQuery(<LocalSettingsTab groupId={1} canEdit={true} />);

        // Centralized Merge button
        const mergeBtn = await screen.findByRole('button', { name: /合并分支/ });
        fireEvent.click(mergeBtn);

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByText('合并本地分支')).toBeTruthy();

        // Source defaults to 'dev' (first non-active branch), target defaults to active branch ('main')
        // Wait for conflict precheck simulation to end
        await screen.findByText('✓ 分支无物理冲突，可以自动合并。');

        const confirmBtn = screen.getByRole('button', { name: '确认合并并保存' });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(mergeBranch).toHaveBeenCalledWith(1, 'dev', 'main');
        });
    });

    it('prevents branch merging when source and target branches are identical', async () => {
        getOfflineRepoStatus.mockResolvedValue(mockStatus);
        listBranches.mockResolvedValue(mockBranches);

        renderWithQuery(<LocalSettingsTab groupId={1} canEdit={true} />);

        const mergeBtn = await screen.findByRole('button', { name: /合并分支/ });
        fireEvent.click(mergeBtn);

        expect(screen.getByRole('dialog')).toBeTruthy();

        // Initially source is 'dev' and target is 'main'
        await screen.findByText('✓ 分支无物理冲突，可以自动合并。');

        const dialog = screen.getByRole('dialog');
        const triggers = within(dialog).getAllByRole('combobox');
        expect(triggers.length).toBe(2);

        // Change target branch dropdown to 'dev' (making both source and target dev)
        fireEvent.change(triggers[1], { target: { value: 'dev' } });

        // Warning message should be displayed
        await screen.findByText('✗ 源分支和目标分支不能相同，请选择不同的分支。');

        // Button should be disabled
        const confirmBtn = screen.getByRole('button', { name: '确认合并并保存' });
        expect(confirmBtn.hasAttribute('disabled')).toBe(true);
    });

    it('triggers safe branch deletion and handles force deletion if conflict occurs', async () => {
        getOfflineRepoStatus.mockResolvedValue(mockStatus);
        listBranches.mockResolvedValue(mockBranches);

        const error409 = { response: { status: 409 }, message: 'Branch contains unmerged modifications.' };
        deleteBranch
            .mockRejectedValueOnce(error409)
            .mockResolvedValueOnce(null);

        renderWithQuery(<LocalSettingsTab groupId={1} canEdit={true} />);

        // Get delete button for 'dev'
        const deleteBtns = await screen.findAllByTitle('删除');
        fireEvent.click(deleteBtns[0]); // 'dev' delete button

        const dialog = await screen.findByRole('dialog');
        expect(screen.getByText('确认删除分支')).toBeTruthy();

        // Perform safe delete confirm
        const confirmBtn = within(dialog).getByRole('button', { name: '确认删除' });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(deleteBranch).toHaveBeenCalledWith(1, 'dev', false);
        });

        // Safe delete failed with 409, it should prompt for force delete warning
        await screen.findByText('强制删除分支');
        expect(screen.getByText(/警告：分支/)).toBeTruthy();

        // Perform force delete confirm
        const forceConfirmBtn = screen.getByRole('button', { name: '确认删除' });
        fireEvent.click(forceConfirmBtn);

        await waitFor(() => {
            expect(deleteBranch).toHaveBeenLastCalledWith(1, 'dev', true);
        });
    });
});
