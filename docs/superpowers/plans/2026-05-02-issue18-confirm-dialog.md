# Issue #18 Confirm Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining destructive delete dialogs in `OfflineWorkbench` with the shared `ConfirmDialog`, and add regression coverage for Flow / folder delete confirmation behavior.

**Architecture:** Keep the change tightly scoped to `OfflineWorkbench.tsx` and `OfflineWorkbench.test.tsx`. Reuse the existing delete state, target metadata, and delete handlers; only swap the dialog shell to `ConfirmDialog` and add close guards while the delete request is pending. Extend the existing offline workbench test harness so the new coverage exercises the real context-menu entry points instead of calling handlers directly.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

### Task 1: Add regression coverage for offline destructive confirmations

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`
- Check: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Check: `wb-data-frontend/src/components/ui/confirm-dialog.tsx`

- [ ] **Step 1: Extend the test harness for delete actions**

Add the two delete APIs to the offline API mock and make the repo-tree fixture capable of rendering a deletable folder node.

```tsx
vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return {
        ...actual,
        getOfflineRepoStatus: vi.fn(),
        getOfflineRepoTree: vi.fn(),
        getOfflineRepoRemote: vi.fn(),
        getOfflineFlowDocument: vi.fn(),
        getOfflineSchedule: vi.fn(),
        saveOfflineFlowDocument: vi.fn(),
        deleteOfflineFlow: vi.fn(),
        deleteOfflineFolder: vi.fn(),
    };
});

function makeRepoTree(options?: { includeFolder?: boolean }) {
    const children: Array<{
        id: string;
        kind: 'FLOW' | 'DIRECTORY';
        name: string;
        path: string;
        children: Array<never>;
    }> = [
        {
            id: 'flow-1',
            kind: 'FLOW',
            name: 'Example Flow',
            path: '_flows/example/flow.yaml',
            children: [],
        },
    ];

    if (options?.includeFolder) {
        children.unshift({
            id: 'folder-1',
            kind: 'DIRECTORY',
            name: 'Drafts',
            path: '_flows/drafts',
            children: [],
        });
    }

    return {
        groupId: 1,
        root: {
            id: 'root',
            kind: 'ROOT' as const,
            name: '_flows',
            path: '_flows',
            children,
        },
    };
}
```

- [ ] **Step 2: Add helpers that open the delete dialogs through the context menu**

Put these helpers near `renderOfflineWorkbench()` so the tests drive the real UI path:

```tsx
async function openFlowDeleteDialog() {
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Example Flow' }), {
        clientX: 120,
        clientY: 80,
    });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    return screen.findByRole('dialog', { name: '确认删除 Flow' });
}

async function openFolderDeleteDialog() {
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Drafts' }), {
        clientX: 120,
        clientY: 80,
    });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    return screen.findByRole('dialog', { name: '确认删除文件夹' });
}
```

- [ ] **Step 3: Write the failing destructive confirmation tests**

Add a new describe block that covers both delete flows and asserts the shared dialog behavior that does **not** exist yet:

```tsx
describe('OfflineWorkbench destructive confirmations', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        setCurrentGroup({ id: 1, name: 'Team' });
        const offlineApi = await import('../../api/offline');
        vi.mocked(offlineApi.getOfflineRepoStatus).mockResolvedValue(makeRepoStatus());
        vi.mocked(offlineApi.getOfflineRepoTree).mockResolvedValue(makeRepoTree({ includeFolder: true }));
        vi.mocked(offlineApi.getOfflineRepoRemote).mockResolvedValue({ hasRemote: false, remoteUrl: null });
        vi.mocked(offlineApi.getOfflineFlowDocument).mockResolvedValue(makeFlowDocument());
        vi.mocked(offlineApi.getOfflineSchedule).mockResolvedValue({
            groupId: 1,
            path: '_flows/example/flow.yaml',
            triggerId: 'trigger-1',
            cron: '',
            timezone: null,
            enabled: false,
            contentHash: 'schedule-hash',
            fileUpdatedAt: 100,
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('keeps the flow delete dialog open while the request is pending and closes it after success', async () => {
        const offlineApi = await import('../../api/offline');
        const deleteDeferred = createDeferred<void>();
        vi.mocked(offlineApi.deleteOfflineFlow).mockReturnValueOnce(deleteDeferred.promise);

        renderOfflineWorkbench();

        const dialog = await openFlowDeleteDialog();
        expect(screen.getByRole('heading', { name: '确认删除 Flow' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '删除' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '处理中...' })).toHaveAttribute('disabled');
            expect(screen.getByRole('button', { name: '取消' })).toHaveAttribute('disabled');
        });

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: '确认删除 Flow' })).toBeTruthy();

        await act(async () => {
            deleteDeferred.resolve(undefined);
            await deleteDeferred.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '确认删除 Flow' })).toBeNull();
        });
    });

    it('keeps the folder delete dialog open after failure, blocks dismissal while retrying, and closes it after success', async () => {
        const offlineApi = await import('../../api/offline');
        const retryDeferred = createDeferred<void>();
        vi.mocked(offlineApi.deleteOfflineFolder)
            .mockRejectedValueOnce(new Error('delete failed'))
            .mockReturnValueOnce(retryDeferred.promise);

        renderOfflineWorkbench();

        const dialog = await openFolderDeleteDialog();
        expect(screen.getByRole('heading', { name: '确认删除文件夹' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '删除' }));

        await waitFor(() => {
            expect(screen.getByRole('dialog', { name: '确认删除文件夹' })).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: '删除' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '处理中...' })).toHaveAttribute('disabled');
            expect(screen.getByRole('button', { name: '取消' })).toHaveAttribute('disabled');
        });

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: '确认删除文件夹' })).toBeTruthy();

        await act(async () => {
            retryDeferred.resolve(undefined);
            await retryDeferred.promise;
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '确认删除文件夹' })).toBeNull();
        });
    });
});
```

- [ ] **Step 4: Run the focused tests to verify they fail for the intended product gap**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/offline/OfflineWorkbench.test.tsx
```

Expected: FAIL because the current bespoke delete dialogs still expose the old loading / dismissal behavior instead of the shared `ConfirmDialog` contract (`处理中...`, guarded `onOpenChange`, pending dismissal lock).

### Task 2: Replace the remaining offline delete dialogs with ConfirmDialog

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`

- [ ] **Step 1: Import `ConfirmDialog` and swap the Flow delete dialog**

Add the import near the other UI imports:

```tsx
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
```

Then replace the custom Flow delete dialog block with:

```tsx
<ConfirmDialog
    open={deleteFlowDialogOpen}
    onOpenChange={(nextOpen) => {
        if (!deleteFlowLoading) {
            setDeleteFlowDialogOpen(nextOpen);
        }
    }}
    title="确认删除 Flow"
    description={`确定要删除 Flow「${deleteFlowName}」吗？此操作不可恢复。`}
    confirmText="删除"
    cancelText="取消"
    variant="destructive"
    icon="warning"
    isLoading={deleteFlowLoading}
    onConfirm={() => void handleDeleteFlow()}
/>
```

- [ ] **Step 2: Swap the folder delete dialog and keep the stronger warning copy**

Replace the custom folder delete dialog block with:

```tsx
<ConfirmDialog
    open={deleteFolderDialogOpen}
    onOpenChange={(nextOpen) => {
        if (!deleteFolderLoading) {
            setDeleteFolderDialogOpen(nextOpen);
        }
    }}
    title="确认删除文件夹"
    description={`确定要删除文件夹「${deleteFolderName}」吗？其下所有内容都将被物理删除，此操作不可恢复。`}
    confirmText="删除"
    cancelText="取消"
    variant="destructive"
    icon="warning"
    isLoading={deleteFolderLoading}
    onConfirm={() => void handleDeleteFolder()}
/>
```

Do **not** change `handleDeleteFlow` or `handleDeleteFolder` beyond what is needed to preserve the existing success-close / failure-stays-open behavior they already have.

- [ ] **Step 3: Re-run the focused tests and keep the assertions aligned with `ConfirmDialog`**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/offline/OfflineWorkbench.test.tsx
```

Expected: PASS with the new destructive confirmation coverage green.

If any assertion still expects the legacy loading label `删除中…`, update it to the shared dialog loading label `处理中...`.

- [ ] **Step 4: Commit the implementation branch**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "fix: unify offline destructive confirmations" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Verify, merge, and clean up

**Files:**
- Verify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Verify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`

- [ ] **Step 1: Run focused verification for the offline workbench**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/offline/OfflineWorkbench.test.tsx
```

Expected: PASS with the destructive confirmation tests and the pre-existing save-conflict tests all green.

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
git merge --ff-only issue18-confirm-dialog
git push origin main
```

Expected: push succeeds and `origin/main` includes the issue #18 fix.

- [ ] **Step 4: Remove the dedicated worktree and branch**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
git worktree remove .worktrees/issue18-confirm-dialog
git branch -d issue18-confirm-dialog
```

Expected: only the root `main` worktree remains.
