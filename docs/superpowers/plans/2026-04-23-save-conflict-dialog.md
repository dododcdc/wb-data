# Save Conflict Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated save-conflict dialog for offline Flow saves so `409 Conflict` lets the user overwrite, discard, or defer without losing the current draft.

**Architecture:** Keep `OfflineWorkbench.tsx` as the save orchestrator, add a small `SaveConflictDialog.tsx` presentational component, and add a pure `forceOverwriteRebase()` helper in `flowDraftController.ts` so the overwrite path can refresh optimistic-lock metadata while preserving the user draft. Cover the new pure logic and dialog interactions with focused Vitest tests, then wire the dialog into the existing save flow.

**Tech Stack:** React 18, TypeScript, Vitest, `@testing-library/react`, Base UI Dialog primitives, existing offline draft/session helpers

---

## File map

- Create: `wb-data-frontend/src/views/offline/flowDraftController.test.ts`
- Create: `wb-data-frontend/src/views/offline/SaveConflictDialog.tsx`
- Create: `wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/offline/flowDraftController.ts:135-170`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:784-845`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1785-1912`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:2458-2850`

## Notes before coding

- Follow the same dialog structure already used by `ExecutionDialog` and the delete dialogs inside `OfflineWorkbench.tsx`.
- Reuse existing `Button` variants; `variant="destructive"` already exists in `src/components/ui/button.tsx`.
- Keep the existing stale-recovery banner untouched; this plan only changes save-time conflicts.
- The frontend currently has repo-wide lint failures unrelated to this feature, so the verification gate for this work is targeted Vitest + `npm test` + `npm run build`, not `npm run lint`.

### Task 1: Add `forceOverwriteRebase()` to the draft controller

**Files:**
- Create: `wb-data-frontend/src/views/offline/flowDraftController.test.ts`
- Modify: `wb-data-frontend/src/views/offline/flowDraftController.ts:158-170`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
    forceOverwriteRebase,
    type FlowDraftSession,
} from './flowDraftController';

function makeDocument(overrides?: Partial<FlowDraftSession['baseDocument']>) {
    return {
        groupId: 1,
        path: '_flows/example.yml',
        flowId: 'example',
        namespace: 'team.example',
        documentHash: 'base-hash',
        documentUpdatedAt: 100,
        stages: [],
        edges: [],
        layout: {},
        ...overrides,
    };
}

describe('forceOverwriteRebase', () => {
    it('refreshes base metadata while preserving the current working draft', () => {
        const session: FlowDraftSession = {
            path: '_flows/example.yml',
            baseDocument: makeDocument(),
            workingDraft: makeDocument({
                documentHash: 'draft-hash',
                documentUpdatedAt: 90,
                stages: [{ stageId: 'stage-1', nodes: [] }],
            }),
            selectedNodeId: 'node-1',
            selectedTaskIds: ['node-1'],
            conflict: {
                kind: 'stale-recovery',
                snapshot: {
                    document: makeDocument(),
                    baseDocumentHash: 'old-hash',
                    baseDocumentUpdatedAt: 10,
                    selectedNodeId: 'node-1',
                    selectedTaskIds: ['node-1'],
                    updatedAt: 11,
                },
            },
        };

        const latestServer = makeDocument({
            documentHash: 'server-hash',
            documentUpdatedAt: 200,
        });

        const next = forceOverwriteRebase(session, latestServer);

        expect(next.baseDocument.documentHash).toBe('server-hash');
        expect(next.baseDocument.documentUpdatedAt).toBe(200);
        expect(next.workingDraft.documentHash).toBe('draft-hash');
        expect(next.workingDraft.stages).toEqual([{ stageId: 'stage-1', nodes: [] }]);
        expect(next.selectedNodeId).toBe('node-1');
        expect(next.selectedTaskIds).toEqual(['node-1']);
        expect(next.conflict).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npx vitest run src/views/offline/flowDraftController.test.ts`

Expected: FAIL with an import/export error because `forceOverwriteRebase` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function forceOverwriteRebase(
    session: FlowDraftSession,
    serverDocument: OfflineFlowDocument,
): FlowDraftSession {
    return {
        ...session,
        baseDocument: cloneDocument(serverDocument),
        workingDraft: cloneDocument(session.workingDraft),
        selectedNodeId: session.selectedNodeId,
        selectedTaskIds: [...session.selectedTaskIds],
        conflict: null,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npx vitest run src/views/offline/flowDraftController.test.ts`

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/flowDraftController.ts \
        wb-data-frontend/src/views/offline/flowDraftController.test.ts
git commit -m "test: add overwrite rebase draft helper"
```

### Task 2: Build `SaveConflictDialog` with interaction tests

**Files:**
- Create: `wb-data-frontend/src/views/offline/SaveConflictDialog.tsx`
- Create: `wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SaveConflictDialog } from './SaveConflictDialog';

describe('SaveConflictDialog', () => {
    it('asks for confirmation before calling onOverwrite', () => {
        const onOverwrite = vi.fn();
        render(
            <SaveConflictDialog
                open
                pending={false}
                onOpenChange={() => {}}
                onOverwrite={onOverwrite}
                onDiscardAndReload={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '用我的覆盖' }));
        expect(onOverwrite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认覆盖保存' }));
        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('routes cancel actions through onOpenChange(false)', () => {
        const onOpenChange = vi.fn();
        render(
            <SaveConflictDialog
                open
                pending={false}
                onOpenChange={onOpenChange}
                onOverwrite={() => {}}
                onDiscardAndReload={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '稍后处理' }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('calls onDiscardAndReload directly', () => {
        const onDiscardAndReload = vi.fn();
        render(
            <SaveConflictDialog
                open
                pending={false}
                onOpenChange={() => {}}
                onOverwrite={() => {}}
                onDiscardAndReload={onDiscardAndReload}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '丢弃本地并加载服务器' }));
        expect(onDiscardAndReload).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npx vitest run src/views/offline/SaveConflictDialog.test.tsx`

Expected: FAIL because `SaveConflictDialog.tsx` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';

interface SaveConflictDialogProps {
    open: boolean;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onOverwrite: () => void;
    onDiscardAndReload: () => void;
}

export function SaveConflictDialog(props: SaveConflictDialogProps) {
    const { open, pending, onOpenChange, onOverwrite, onDiscardAndReload } = props;
    const [confirmOverwrite, setConfirmOverwrite] = useState(false);

    useEffect(() => {
        if (!open) setConfirmOverwrite(false);
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPortal>
                <DialogOverlay className="offline-dialog-backdrop" />
                <DialogContent className="offline-dialog-positioner">
                    <div className="offline-dialog-card" style={{ width: 'min(480px, 90vw)' }}>
                        <div className="offline-dialog-header">
                            <div>
                                <DialogTitle className="offline-dialog-title">保存冲突</DialogTitle>
                                <DialogDescription className="offline-dialog-description">
                                    服务器版本已更新。请选择覆盖保存、加载最新内容，或稍后处理。
                                </DialogDescription>
                            </div>
                            <button
                                className="offline-dialog-close"
                                type="button"
                                aria-label="关闭"
                                onClick={() => onOpenChange(false)}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div style={{ display: 'grid', gap: 12 }}>
                            <div className="offline-conflict-copy">
                                <AlertTriangle size={16} />
                                <div>
                                    <strong>当前保存的依据版本已经变化</strong>
                                    <p>你的本地草稿仍然保留，只有明确选择后才会覆盖或丢弃。</p>
                                </div>
                            </div>

                            {confirmOverwrite ? (
                                <div style={{ display: 'grid', gap: 8 }}>
                                    <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
                                        覆盖保存会以你当前草稿为准，直接写回最新服务器版本。
                                    </p>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOverwrite(false)} disabled={pending}>
                                            返回
                                        </Button>
                                        <Button type="button" variant="destructive" size="sm" onClick={onOverwrite} disabled={pending}>
                                            {pending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                            {pending ? '覆盖中…' : '确认覆盖保存'}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: 8 }}>
                                    <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmOverwrite(true)} disabled={pending}>
                                        用我的覆盖
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={onDiscardAndReload} disabled={pending}>
                                        丢弃本地并加载服务器
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
                                        稍后处理
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npx vitest run src/views/offline/SaveConflictDialog.test.tsx`

Expected: PASS with `3 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/SaveConflictDialog.tsx \
        wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx
git commit -m "feat: add save conflict dialog"
```

### Task 3: Wire the dialog into `OfflineWorkbench`

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:784-845`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1785-1912`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:2458-2850`

- [ ] **Step 1: Add save-conflict state and dialog import**

```ts
import { SaveConflictDialog } from './SaveConflictDialog';

interface SaveConflictState {
    path: string;
    pendingSession: FlowDraftSession;
}

const [saveConflictState, setSaveConflictState] = useState<SaveConflictState | null>(null);
const [saveConflictPending, setSaveConflictPending] = useState(false);
```

- [ ] **Step 2: Extract the existing save request into a reusable helper**

```ts
const persistFlowSession = useCallback(async (sessionForSave: FlowDraftSession) => {
    const draftDocument = sessionForSave.workingDraft;
    return saveOfflineFlowDocument({
        groupId,
        path: sessionForSave.path,
        documentHash: sessionForSave.baseDocument.documentHash,
        documentUpdatedAt: sessionForSave.baseDocument.documentUpdatedAt,
        stages: draftDocument.stages.map((stage) => ({
            stageId: stage.stageId,
            nodes: stage.nodes.map((node) => ({
                taskId: node.taskId,
                scriptContent: node.scriptContent,
                kind: node.kind,
                scriptPath: node.scriptPath,
                dataSourceId: node.dataSourceId,
                dataSourceType: node.dataSourceType,
            })),
        })),
        edges: draftDocument.edges,
        layout: draftDocument.layout,
    });
}, [groupId]);
```

- [ ] **Step 3: Change the `409` branch to open the dialog instead of auto-reloading**

```ts
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 409) {
                setSaveConflictState({
                    path: sessionForSave.path,
                    pendingSession: sessionForSave,
                });
                return;
            }

            showFeedback({
                tone: 'error',
                title: '保存失败',
                detail: getErrorMessage(error, '本地脚本文件保存失败，请稍后重试。'),
            });
        } finally {
```

- [ ] **Step 4: Add the three conflict handlers**

```ts
const handleCloseSaveConflict = useCallback(() => {
    if (saveConflictPending) return;
    setSaveConflictState(null);
}, [saveConflictPending]);

const handleDiscardSaveConflict = useCallback(async () => {
    if (!groupId || !saveConflictState) return;
    try {
        removeRecoverySnapshot(groupId, saveConflictState.path);
        await openFlowDocument(saveConflictState.path, { preferRecoverySnapshot: false });
        setSaveConflictState(null);
    } catch (error) {
        showFeedback({
            tone: 'error',
            title: '加载服务器版本失败',
            detail: getErrorMessage(error, '暂时无法加载最新服务器内容，请稍后重试。'),
        });
    }
}, [groupId, openFlowDocument, saveConflictState, showFeedback]);

const handleOverwriteSaveConflict = useCallback(async () => {
    if (!groupId || !saveConflictState) return;
    setSaveConflictPending(true);
    try {
        const latest = await getOfflineFlowDocument(groupId, saveConflictState.path);
        const rebasedSession = forceOverwriteRebase(saveConflictState.pendingSession, latest);
        setDraftSession(rebasedSession);
        const response = await persistFlowSession(rebasedSession);
        setDraftSession(rebaseFlowDraftSession(rebasedSession, response));
        removeRecoverySnapshot(groupId, rebasedSession.path);
        setSaveConflictState(null);
        await refreshRepoStatus();
        showFeedback({
            tone: 'success',
            title: 'Flow 已保存',
            detail: '节点内容、依赖关系和布局已写回本地仓库。',
        });
    } catch (error) {
        const detail = error instanceof AxiosError && error.response?.status === 409
            ? '服务器版本再次发生变化，请确认后重试覆盖保存。'
            : getErrorMessage(error, '暂时无法基于最新版本覆盖保存，请稍后重试。');
        showFeedback({
            tone: 'error',
            title: '覆盖保存失败',
            detail,
        });
    } finally {
        setSaveConflictPending(false);
    }
}, [groupId, persistFlowSession, refreshRepoStatus, saveConflictState, showFeedback]);
```

- [ ] **Step 5: Mount the dialog near the other workbench dialogs**

```tsx
            <SaveConflictDialog
                open={saveConflictState !== null}
                pending={saveConflictPending}
                onOpenChange={(open) => {
                    if (!open) handleCloseSaveConflict();
                }}
                onOverwrite={() => void handleOverwriteSaveConflict()}
                onDiscardAndReload={() => void handleDiscardSaveConflict()}
            />

            <ExecutionDialog
                open={executionDialogOpen}
```

- [ ] **Step 6: Run targeted verification**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npx vitest run src/views/offline/flowDraftController.test.ts src/views/offline/SaveConflictDialog.test.tsx
npm test
npm run build
```

Expected:

- targeted Vitest command: PASS
- `npm test`: PASS
- `npm run build`: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "feat: handle offline save conflicts explicitly"
```

### Task 4: Final regression sweep

**Files:**
- Modify if needed: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify if needed: `wb-data-frontend/src/views/offline/SaveConflictDialog.tsx`
- Modify if needed: `wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx`

- [ ] **Step 1: Manually verify the happy path still works**

Run: open the offline workbench, edit a Flow, click **保存 Flow**, and confirm the existing success toast still appears and the dialog does not show.

Expected: normal save remains unchanged when there is no conflict.

- [ ] **Step 2: Manually verify each conflict action**

Run: reproduce a `409` by editing the same Flow from two sessions or by changing the file on disk, then exercise:

- **稍后处理**: dialog closes and the local draft stays visible
- **丢弃本地并加载服务器**: latest server content loads
- **用我的覆盖**: second confirmation appears and the latest optimistic-lock metadata is used for retry

Expected: no action silently replaces the current local draft.

- [ ] **Step 3: Commit any regression fixes**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
        wb-data-frontend/src/views/offline/SaveConflictDialog.tsx \
        wb-data-frontend/src/views/offline/SaveConflictDialog.test.tsx \
        wb-data-frontend/src/views/offline/flowDraftController.ts \
        wb-data-frontend/src/views/offline/flowDraftController.test.ts
git commit -m "fix: polish offline save conflict flow"
```
