# Issue #19 Dialog Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the shared dialog shell and close affordance across standard dialogs, the offline execution dialog, `SaveConflictDialog`, and the full-screen `NodeEditorDialog` without changing their business behavior.

**Architecture:** Keep `wb-data-frontend/src/components/ui/dialog.tsx` as the only base shell, and move the visual contract into shared CSS in `src/index.css`. Adopt that contract in the three outlier dialogs by reusing one close-affordance class/slot and one toolbar/shell rhythm, while keeping each dialog’s existing close handlers and layout logic intact.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Radix Dialog

---

### Task 1: Create an isolated issue19 worktree and confirm the frontend baseline

**Files:**
- Check: `docs/superpowers/specs/2026-05-02-issue19-dialog-shell-design.md`
- Check: `wb-data-frontend/package.json`

- [ ] **Step 1: Create the worktree and branch**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
git worktree add .worktrees/issue19-dialog-shell -b issue19-dialog-shell
```

Expected: a new worktree is created at `/Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell`.

- [ ] **Step 2: Install frontend dependencies in the worktree**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell/wb-data-frontend
npm install
```

Expected: install finishes without changing project dependencies.

- [ ] **Step 3: Verify the baseline frontend test suite**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell/wb-data-frontend
npm test
```

Expected: the current frontend suite passes before any issue19 changes are made.

### Task 2: Add regression coverage for shared close-affordance adoption

**Files:**
- Modify: `wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`
- Check: `wb-data-frontend/src/views/offline/SaveConflictDialog.tsx`
- Check: `wb-data-frontend/src/views/offline/NodeEditorDialog.tsx`
- Check: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Check: `wb-data-frontend/src/components/ui/dialog.tsx`

- [ ] **Step 1: Extend the offline workbench test harness so the execution dialog can be opened through the real UI**

Update the offline API mock and helper area in `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`:

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
        listOfflineExecutions: vi.fn(),
        getOfflineExecution: vi.fn(),
    };
});

async function openExecutionResultsDialog() {
    fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
    await screen.findByTestId('flow-canvas');
    fireEvent.click(screen.getByRole('button', { name: '执行结果' }));
    return screen.findByRole('dialog');
}
```

And in the shared `beforeEach` setup for the file:

```tsx
vi.mocked(offlineApi.listOfflineExecutions).mockResolvedValue([]);
vi.mocked(offlineApi.getOfflineExecution).mockResolvedValue({
    executionId: 'exec-1',
    flowPath: '_flows/example/flow.yaml',
    status: 'SUCCESS',
    displayName: '示例执行',
    triggeredBy: 7,
    startDate: '2026-05-01T00:00:00Z',
    endDate: '2026-05-01T00:01:00Z',
    durationMs: 60000,
    taskRuns: [],
});
```

- [ ] **Step 2: Add failing tests for the close-affordance contract in `SaveConflictDialog` and `NodeEditorDialog`**

Update `wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx`:

```tsx
it('uses the shared close affordance contract and keeps pending disable behavior', () => {
    render(
        <SaveConflictDialog
            open
            pending
            onOpenChange={() => {}}
            onOverwrite={() => {}}
            onDiscardAndReload={() => {}}
        />,
    );

    const closeButton = screen.getByRole('button', { name: '关闭' });
    expect(closeButton.getAttribute('data-slot')).toBe('dialog-close');
    expect(closeButton.className).toContain('dialog-close-button');
    expect((closeButton as HTMLButtonElement).disabled).toBe(true);
});
```

Update `wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx`:

```tsx
it('uses the shared close affordance contract for the top-bar close action', () => {
    const onOpenChange = vi.fn();

    render(
        <NodeEditorDialog
            open
            groupId={1}
            activeNode={makeShellNode()}
            content="echo hello"
            onOpenChange={onOpenChange}
            onTempSave={() => {}}
            onContentChange={() => {}}
        />,
    );

    const closeButton = screen.getByRole('button', { name: '关闭' });
    expect(closeButton.getAttribute('data-slot')).toBe('dialog-close');
    expect(closeButton.className).toContain('dialog-close-button');

    fireEvent.click(closeButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 3: Add a failing offline workbench test for the execution dialog toolbar close affordance**

Append this case in `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`:

```tsx
it('uses the shared close affordance for the execution dialog toolbar close action', async () => {
    renderOfflineWorkbench();

    const dialog = await openExecutionResultsDialog();
    const closeButton = within(dialog).getByRole('button', { name: '关闭' });

    expect(closeButton.getAttribute('data-slot')).toBe('dialog-close');
    expect(closeButton.className).toContain('dialog-close-button');

    fireEvent.click(closeButton);

    await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
```

- [ ] **Step 4: Run the focused test files and confirm they fail for the intended gap**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell/wb-data-frontend
npm test -- --run \
  src/views/offline/SaveConflictDialog.test.tsx \
  src/views/offline/NodeEditorDialog.test.tsx \
  src/views/offline/OfflineWorkbench.test.tsx
```

Expected: FAIL because the outlier dialogs still use bespoke close-button markup/styles and do not yet expose the shared close-affordance contract (`data-slot="dialog-close"` plus `dialog-close-button` styling).

### Task 3: Implement the shared dialog shell contract and migrate the outliers

**Files:**
- Modify: `wb-data-frontend/src/components/ui/dialog.tsx`
- Modify: `wb-data-frontend/src/index.css`
- Modify: `wb-data-frontend/src/views/offline/SaveConflictDialog.tsx`
- Modify: `wb-data-frontend/src/views/offline/NodeEditorDialog.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css`
- Modify: `wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`

- [ ] **Step 1: Move the shared shell and close-affordance contract into `dialog.tsx`**

Update `wb-data-frontend/src/components/ui/dialog.tsx` so the default close button and content shell expose one stable contract:

```tsx
<DialogPrimitive.Content
  ref={ref}
  data-slot="dialog-content"
  className={cn(
    "dialog-content",
    fullScreen && "dialog-content-fullscreen",
    className
  )}
  {...props}
>
  {children}
  {!hideClose && (
    <DialogPrimitive.Close
      type="button"
      aria-label="关闭"
      data-slot="dialog-close"
      className="dialog-close-button dialog-close-icon"
    >
      <X size={18} />
      <span className="sr-only">关闭</span>
    </DialogPrimitive.Close>
  )}
</DialogPrimitive.Content>
```

Keep `hideClose` and `fullScreen`; do **not** change the behavioral ownership of `onOpenChange`.

- [ ] **Step 2: Define the shell, toolbar, and close-affordance styles in `src/index.css`**

Add/reshape the shared classes in `wb-data-frontend/src/index.css`:

```css
.dialog-content {
    position: relative;
    width: 100%;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    box-shadow: var(--shadow-xl);
    outline: none;
    animation: dialogContentShow 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.dialog-content-fullscreen {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: var(--color-bg-primary);
}

.dialog-toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-bg-primary);
}

.dialog-close-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--color-text-muted);
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    cursor: pointer;
}

.dialog-close-button:hover {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
}

.dialog-close-button:focus-visible {
    outline: none;
    border-color: var(--color-border);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-border) 35%, transparent);
}

.dialog-close-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.dialog-close-icon {
    position: absolute;
    top: 16px;
    right: 16px;
}
```

Keep the existing overlay/positioner ownership in the shared file; remove styling duplication instead of creating a second shell system in business CSS.

- [ ] **Step 3: Migrate `SaveConflictDialog` to the shared toolbar and close affordance**

Refactor `wb-data-frontend/src/views/offline/SaveConflictDialog.tsx` from the bespoke ghost close button to the shared contract:

```tsx
<DialogContent style={{ maxWidth: '480px' }} hideClose>
    <div className="dialog-toolbar">
        <DialogHeader className="flex-1" style={{ padding: 0, borderBottom: 'none' }}>
            <DialogTitle>保存冲突</DialogTitle>
            <DialogDescription>
                服务器版本已更新。请选择覆盖保存、加载最新内容，或稍后处理。
            </DialogDescription>
        </DialogHeader>
        <button
            type="button"
            aria-label="关闭"
            data-slot="dialog-close"
            className="dialog-close-button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
        >
            <X size={16} />
        </button>
    </div>
```

Keep the rest of the conflict flow and pending logic unchanged.

- [ ] **Step 4: Migrate the offline execution dialog and `NodeEditorDialog` to the shared special-shell contract**

Update the execution dialog inside `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`:

```tsx
<DialogContent className="offline-execution-dialog" hideClose>
    <div className="dialog-toolbar offline-dialog-toolbar">
        <div className="offline-execution-toolbar-left">
            ...
        </div>
        <div className="offline-execution-toolbar-right">
            ...
            <button
                type="button"
                aria-label="关闭"
                data-slot="dialog-close"
                className="dialog-close-button"
                onClick={() => onOpenChange(false)}
            >
                <X size={16} />
            </button>
        </div>
    </div>
```

Then remove the obsolete bespoke close-button styling from `wb-data-frontend/src/views/offline/OfflineWorkbench.css`:

```css
.offline-execution-toolbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
}

.offline-execution-dialog {
    max-width: 1200px !important;
    height: 85vh;
    display: flex;
    flex-direction: column;
    padding: 0;
}
```

Update `wb-data-frontend/src/views/offline/NodeEditorDialog.tsx` so the top-bar close action reuses the shared close affordance while preserving the existing close flow:

```tsx
<div className="dialog-toolbar flex items-center justify-between gap-4 bg-[#fdfcfb] shadow-sm z-10">
    <div className="flex items-center gap-5">
        ...
    </div>

    <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1">
            ...
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label="关闭"
                        data-slot="dialog-close"
                        className="dialog-close-button"
                        onClick={handleAttemptClose}
                    >
                        <X size={18} />
                    </button>
                </TooltipTrigger>
                <TooltipContent className="tooltip-content z-[2100]" side="bottom">
                    关闭
                </TooltipContent>
            </Tooltip>
        </div>
    </TooltipProvider>
</div>
```

Do **not** change `onTempSave`, `handleAttemptClose`, or the full-screen open/close rules.

- [ ] **Step 5: Re-run the focused regression files**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell/wb-data-frontend
npm test -- --run \
  src/views/offline/SaveConflictDialog.test.tsx \
  src/views/offline/NodeEditorDialog.test.tsx \
  src/views/offline/OfflineWorkbench.test.tsx
```

Expected: PASS with the three dialog outlier test files green.

- [ ] **Step 6: Commit the shell cleanup implementation**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell
git add wb-data-frontend/src/components/ui/dialog.tsx \
        wb-data-frontend/src/index.css \
        wb-data-frontend/src/views/offline/SaveConflictDialog.tsx \
        wb-data-frontend/src/views/offline/NodeEditorDialog.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.css \
        wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx \
        wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "fix: unify dialog shell and close affordances" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Verify, merge, push, and clean up

**Files:**
- Verify: `wb-data-frontend/src/components/ui/dialog.tsx`
- Verify: `wb-data-frontend/src/index.css`
- Verify: `wb-data-frontend/src/views/offline/SaveConflictDialog.tsx`
- Verify: `wb-data-frontend/src/views/offline/NodeEditorDialog.tsx`
- Verify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Verify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css`

- [ ] **Step 1: Run targeted dialog verification**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell/wb-data-frontend
npm test -- --run \
  src/views/offline/SaveConflictDialog.test.tsx \
  src/views/offline/NodeEditorDialog.test.tsx \
  src/views/offline/OfflineWorkbench.test.tsx
```

Expected: PASS with dialog outlier behavior intact.

- [ ] **Step 2: Run full frontend verification**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/issue19-dialog-shell/wb-data-frontend
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
git merge --ff-only issue19-dialog-shell
git push origin main
gh issue close 19 --comment "已统一 Dialog 基础壳层与关闭按钮实现，并收敛 SaveConflictDialog、离线执行弹窗和 NodeEditorDialog 的特例样式。该修复已随 main 推送。"
```

Expected: `origin/main` advances to the issue19 fix commit and issue #19 is closed.

- [ ] **Step 4: Remove the worktree and branch**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
git worktree remove .worktrees/issue19-dialog-shell
git branch -d issue19-dialog-shell
```

Expected: only the root `main` worktree remains.
