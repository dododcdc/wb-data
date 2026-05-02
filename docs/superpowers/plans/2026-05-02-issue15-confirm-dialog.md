# Issue #15 Confirm Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining `window.confirm` flow in `GitSettingsTab` with the shared in-app `ConfirmDialog`, and cover the delete dialog behavior with regression tests.

**Architecture:** Keep the fix tightly scoped to `GitSettingsTab`. Add one local dialog-open state, reuse the existing delete mutation and `ConfirmDialog`, and preserve the current success/error feedback path. The only behavior change is the confirmation boundary and its pending close rules.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, Testing Library

---

### Task 1: Add regression coverage for the Git config delete dialog

**Files:**
- Create: `wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx`
- Check: `wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GitSettingsTab from './GitSettingsTab';

const {
    getGitConfigMock,
    deleteGitConfigMock,
    showFeedbackMock,
} = vi.hoisted(() => ({
    getGitConfigMock: vi.fn(),
    deleteGitConfigMock: vi.fn(),
    showFeedbackMock: vi.fn(),
}));

vi.mock('./gitSettingsApi', () => ({
    getGitConfig: getGitConfigMock,
    saveGitConfig: vi.fn(),
    deleteGitConfig: deleteGitConfigMock,
    testGitConnection: vi.fn(),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({
        showFeedback: showFeedbackMock,
    }),
}));

function renderGitSettingsTab() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <GitSettingsTab groupId={12} />
        </QueryClientProvider>,
    );
}

describe('GitSettingsTab', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('opens an in-app confirmation dialog before deleting Git config', async () => {
        getGitConfigMock.mockResolvedValue({
            provider: 'github',
            username: 'alice',
            tokenMasked: '***',
            baseUrl: 'https://github.com',
        });

        renderGitSettingsTab();

        fireEvent.click(await screen.findByRole('button', { name: '删除配置' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('heading', { name: '删除 Git 配置' })).toBeTruthy();
        expect(within(dialog).getByText(/alice/)).toBeTruthy();
        expect(deleteGitConfigMock).not.toHaveBeenCalled();
    });

    it('keeps the dialog open and disables dismissal while delete is pending', async () => {
        getGitConfigMock.mockResolvedValue({
            provider: 'github',
            username: 'alice',
            tokenMasked: '***',
            baseUrl: 'https://github.com',
        });
        deleteGitConfigMock.mockImplementation(() => new Promise(() => {}));

        renderGitSettingsTab();

        fireEvent.click(await screen.findByRole('button', { name: '删除配置' }));
        const dialog = await screen.findByRole('dialog');

        fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));

        await waitFor(() => {
            expect(within(dialog).getByRole('button', { name: '删除中...' })).toBeDisabled();
        });
        expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    });

    it('keeps the dialog open after delete failure and closes it after success', async () => {
        getGitConfigMock.mockResolvedValue({
            provider: 'github',
            username: 'alice',
            tokenMasked: '***',
            baseUrl: 'https://github.com',
        });
        deleteGitConfigMock
            .mockRejectedValueOnce(new Error('delete failed'))
            .mockResolvedValueOnce(undefined);

        renderGitSettingsTab();

        fireEvent.click(await screen.findByRole('button', { name: '删除配置' }));
        fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

        expect(await screen.findByRole('dialog')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/group-settings/GitSettingsTab.test.tsx
```

Expected: FAIL because `GitSettingsTab` still uses `window.confirm`, so no in-app dialog is rendered and pending close behavior does not exist yet.

- [ ] **Step 3: Keep the failing tests in the working tree and move straight to implementation**

```bash
git diff -- wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx
```

### Task 2: Replace the native confirm flow in GitSettingsTab

**Files:**
- Modify: `wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx`

- [ ] **Step 1: Implement the minimal dialog state and handlers**

```tsx
import { ConfirmDialog } from '../../components/ui/confirm-dialog';

const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

const handleDeleteClick = () => {
    setIsDeleteDialogOpen(true);
};

const handleDeleteConfirm = async () => {
    await deleteMutation.mutateAsync();
};
```

And update the delete mutation so success closes the dialog while failure leaves it open:

```tsx
const deleteMutation = useMutation({
    mutationFn: () => deleteGitConfig(groupId),
    onSuccess: () => {
        setIsDeleteDialogOpen(false);
        showFeedback({ tone: 'success', title: '删除成功', detail: '' });
        setProvider('github');
        setUsername('');
        setToken('');
        setBaseUrl('https://github.com');
        void queryClient.invalidateQueries({ queryKey: ['git-config', groupId] });
    },
    onError: (e) => {
        showFeedback({ tone: 'error', title: '删除失败', detail: getErrorMessage(e, '删除配置失败，请稍后重试') });
    },
});
```

- [ ] **Step 2: Replace the button click behavior and render ConfirmDialog**

```tsx
<Button
    variant="destructive"
    size="sm"
    onClick={handleDeleteClick}
    disabled={deleteMutation.isPending}
>
    {deleteMutation.isPending ? <LoaderCircle size={14} className="offline-spin" /> : null}
    删除配置
</Button>

<ConfirmDialog
    open={isDeleteDialogOpen}
    onOpenChange={(nextOpen) => {
        if (!deleteMutation.isPending) {
            setIsDeleteDialogOpen(nextOpen);
        }
    }}
    title="删除 Git 配置"
    description={config ? (
        <>
            你将删除 <strong>{config.provider}</strong> 提供商下用户 <strong>{config.username}</strong> 的 Git 配置。
            <br />
            删除后如需再次使用远程仓库功能，需要重新填写凭证。
        </>
    ) : '删除后如需再次使用远程仓库功能，需要重新填写凭证。'}
    confirmText={deleteMutation.isPending ? '删除中...' : '确认删除'}
    cancelText="取消"
    variant="destructive"
    isLoading={deleteMutation.isPending}
    icon="warning"
    onConfirm={handleDeleteConfirm}
/>
```

- [ ] **Step 3: Re-run the focused tests**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/group-settings/GitSettingsTab.test.tsx
```

Expected: PASS with the new delete confirmation dialog behavior covered.

- [ ] **Step 4: Commit the implementation**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx \
        wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx
git commit -m "fix: replace git settings native confirm"
```

### Task 3: Verify, push, and clean up the worktree

**Files:**
- Modify: none
- Verify: `wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx`
- Verify: `wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx`

- [ ] **Step 1: Run targeted verification**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/group-settings/GitSettingsTab.test.tsx
```

Expected: PASS with all Git settings confirmation tests green.

- [ ] **Step 2: Run full frontend verification**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run lint
npm run build
npm test
```

Expected: all three commands exit 0.

- [ ] **Step 3: Integrate the branch and push**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
git checkout main
git merge --ff-only issue15-confirm-dialog
git push origin main
```

Expected: push succeeds and `origin/main` points at the issue #15 fix commit.

- [ ] **Step 4: Clean up the worktree**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
git worktree remove .worktrees/issue15-confirm-dialog
git branch -d issue15-confirm-dialog
```

Expected: only the root `main` worktree remains.
