# Offline Workbench Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `OfflineWorkbench` orchestration complexity without changing offline development behavior.

**Architecture:** Keep `OfflineWorkbench` as the page composition layer and move workflow state/side effects into deep hooks with small interfaces. Preserve the existing API contract, UI layout, and backend behavior while adding characterization tests before each extraction.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, React Testing Library, Spring Boot 3, Maven, Kestra, Git.

---

## Scope

### In Scope

- Split `OfflineWorkbench.tsx` workflow state and effects into focused modules.
- Preserve the current user workflows for Flow editing, schedule staging, save, commit, push, branch switching, execution, and operations verification.
- Add or strengthen tests around the workflows most likely to regress.
- Add a responsive guardrail for the left rail toolbar and canvas toolbar overlap found during manual testing.

### Out of Scope

- No backend API contract changes.
- No visual redesign.
- No Flow canvas rewrite.
- No change to Kestra YAML semantics.
- No change to Git commit/push behavior beyond preserving current behavior.
- No deletion of existing tests unless replaced by equivalent coverage in the same commit.

## Current Complexity

- `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx` is about 3,700 lines and owns repository state, branch switching, tree mutations, Flow draft state, node editing, save conflicts, scheduling, execution, commit, and push.
- `wb-data-frontend/src/views/offline/OfflineWorkbench.css` is about 2,700 lines and contains unrelated layout, rail, dialog, canvas, and animation rules.
- Existing deep modules such as `flowDraftController.ts` are good seams, but `OfflineWorkbench` still coordinates too much state directly.
- Previous scheduling failures crossed UI draft state, save DTOs, YAML persistence, Git push, and Kestra sync. The refactor must keep those layers explicit and testable.

## Target Module Map

### Create

- `wb-data-frontend/src/views/offline/useOfflineRepositoryWorkflow.ts`
  - Owns repo status, remote status, branch list loading, branch switching guards, repo commit, push, rebuild, and branch labels.

- `wb-data-frontend/src/views/offline/useOfflineTreeMutations.ts`
  - Owns new Flow/folder, delete Flow/folder, rename Flow/folder, context menu target state, and tree refresh calls.

- `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
  - Owns active Flow path, loading a Flow, draft session, dirty detection, node selection, node editor flushing, save, conflict handling, and recovery snapshots.

- `wb-data-frontend/src/views/offline/useFlowExecutionAndSchedule.ts`
  - Owns execution dialog state, execution list/detail loading, execute/stop controls, requested-by filter, schedule dialog state, schedule draft staging, and schedule toggle.

- `wb-data-frontend/src/views/offline/offlineWorkbenchLayout.test.tsx`
  - Tests toolbar hit targets and responsive layout guardrails.

### Modify

- `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
  - Keep page composition, dialogs, and rendering. Consume hook interfaces instead of owning every workflow state.

- `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`
  - Keep high-level behavior tests. Move lower-level workflow tests to hook tests where possible.

- `wb-data-frontend/src/views/offline/flowDraftController.ts`
  - Only extend if a pure draft operation is needed by `useFlowEditingSession`.

- `wb-data-frontend/src/views/offline/OfflineWorkbench.css`
  - Only add guardrail styles needed to prevent rail/canvas overlap. Deeper CSS splitting is a later refactor.

### Avoid

- Do not create thin pass-through wrappers around API calls.
- Do not duplicate state between `OfflineWorkbench` and extracted hooks.
- Do not move JSX into hooks.
- Do not hide user-confirmation decisions inside API helpers.

## Target Interfaces

### `useOfflineRepositoryWorkflow`

```ts
export interface OfflineRepositoryWorkflow {
    repoStatus: OfflineRepoStatus | null;
    repoLoading: boolean;
    remoteStatus: RemoteStatus | null;
    pushLoading: boolean;
    rebuildLoading: boolean;
    branchLabel: string;
    branches: BranchItem[];
    branchLoading: boolean;
    branchSwitching: boolean;
    branchDirtyState: BranchDirtyState | null;
    pendingBranchSwitch: string | null;
    canSwitchBranch: boolean;
    canCommitRepo: boolean;
    canPush: boolean;
    refreshRepoStatus: () => Promise<void>;
    refreshRemoteStatus: () => Promise<void>;
    refreshRepository: () => Promise<void>;
    loadBranchList: () => Promise<void>;
    requestBranchSwitch: (branch: string, options?: { discardDraft?: boolean }) => Promise<void>;
    confirmDiscardAndSwitchBranch: () => Promise<void>;
    cancelBranchSwitch: () => void;
    commitRepo: (message: string, mode: 'save-and-commit' | 'saved-only') => Promise<boolean>;
    push: () => Promise<void>;
    rebuildRemote: () => Promise<void>;
}
```

### `useFlowEditingSession`

```ts
export interface FlowEditingSessionController {
    activeFlowPath: string | null;
    flowDocument: OfflineFlowDocument | null;
    activeNode: OfflineFlowNode | null;
    activeNodeId: string | null;
    selectedTaskIds: string[];
    nodeCount: number;
    isDirty: boolean;
    flowLoading: boolean;
    savingFlow: boolean;
    flowCommitDirty: boolean;
    saveConflictState: SaveConflictState | null;
    saveConflictPending: boolean;
    nodeEditorOpen: boolean;
    nodeEditorContent: string;
    openFlowDocument: (path: string) => Promise<void>;
    leaveCurrentFlow: (session?: FlowDraftSession | null, groupOverride?: number | null) => void;
    setSelectedNodeId: (taskId: string | null) => void;
    setSelectedTaskIds: (taskIds: string[]) => void;
    openNodeEditor: (taskId: string) => void;
    setNodeEditorOpen: (open: boolean) => void;
    updateNodeEditorContent: (content: string) => void;
    stageNodeEditorDraft: (content: string, dataSourceId?: number, dataSourceType?: string) => void;
    addNode: (kind: OfflineFlowNodeKind, position: { x: number; y: number }) => void;
    renameNode: (oldId: string, newId: string) => void;
    updateCanvasNodes: (nodes: Node[]) => void;
    updateCanvasEdges: (edges: Edge[]) => void;
    commitCanvasLayout: (nodes: Node[]) => void;
    saveFlow: (nodeOverride?: PendingNodeEditorDraft, silent?: boolean) => Promise<boolean>;
    commitCurrentFlow: (message: string, mode: 'save-and-commit' | 'saved-only') => Promise<boolean>;
    closeSaveConflict: () => void;
    discardSaveConflict: () => Promise<void>;
    overwriteSaveConflict: () => Promise<void>;
    restoreStaleDraft: () => void;
    discardStaleDraft: () => void;
}
```

### `useFlowExecutionAndSchedule`

```ts
export interface FlowExecutionAndScheduleController {
    executionDialogOpen: boolean;
    executions: OfflineExecutionListItem[];
    executionsLoading: boolean;
    activeExecutionId: string | null;
    executionDetail: OfflineExecutionDetail | null;
    executionDetailLoading: boolean;
    executionActionPending: string | null;
    executionRequestedByFilter: number | null;
    scheduleDialogOpen: boolean;
    schedule: OfflineScheduleResponse | null;
    scheduleCron: string;
    scheduleTimezone: string;
    scheduleSaving: boolean;
    setExecutionDialogOpen: (open: boolean) => void;
    setScheduleDialogOpen: (open: boolean) => void;
    setScheduleCron: (cron: string) => void;
    setScheduleTimezone: (timezone: string) => void;
    refreshExecutions: (preferExecutionId?: string | null, requestedByOverride?: number | null) => Promise<void>;
    loadExecutionDetail: (executionId: string, silent?: boolean) => Promise<void>;
    execute: () => Promise<void>;
    stopExecution: (executionId: string) => Promise<void>;
    stopAllExecutions: () => Promise<void>;
    loadScheduleSnapshot: (path: string) => Promise<void>;
    stageSchedule: () => void;
    toggleSchedule: (enabled: boolean) => void;
}
```

## Implementation Tasks

### Task 1: Add Characterization Tests Before Extraction

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`
- Create: `wb-data-frontend/src/views/offline/offlineWorkbenchLayout.test.tsx`

- [ ] **Step 1: Add workflow coverage for schedule-save-commit-push state**

Add a test that verifies:

- staging schedule makes the Flow dirty
- save sends `schedule` in `saveOfflineFlowDocument`
- Flow commit uses `commitOfflineCurrentFlow`
- push opens confirmation and calls `pushOfflineRepo`

Use the existing mocks in `OfflineWorkbench.test.tsx`; do not introduce real network calls.

- [ ] **Step 2: Add responsive toolbar hit-target test**

In `offlineWorkbenchLayout.test.tsx`, render the workbench in a constrained width and assert the rail toolbar actions are not covered by the canvas toolbar.

The test should check DOM geometry using mocked `getBoundingClientRect` values for:

- `.offline-rail-toolbar-actions`
- `.offline-canvas-toolbar`
- `button[aria-label="推送"]`

Expected assertion:

```ts
expect(pushButtonCenterX).toBeLessThan(canvasToolbarLeft);
```

- [ ] **Step 3: Run targeted frontend tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/OfflineWorkbench.test.tsx src/views/offline/offlineWorkbenchLayout.test.tsx
```

Expected: all targeted tests pass before extraction.

- [ ] **Step 4: Commit**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx wb-data-frontend/src/views/offline/offlineWorkbenchLayout.test.tsx
git commit -m "test: characterize offline workbench workflows"
```

### Task 2: Extract Repository Workflow Hook

**Files:**
- Create: `wb-data-frontend/src/views/offline/useOfflineRepositoryWorkflow.ts`
- Create: `wb-data-frontend/src/views/offline/useOfflineRepositoryWorkflow.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write hook tests**

Cover:

- repo status refresh updates `repoStatus`
- first push remains enabled when `hasRemote=true`, `hasUpstream=false`, and `ahead=true`
- push success refreshes remote and repo status
- dirty branch switch returns a `BranchDirtyState` instead of switching immediately
- confirmed discard branch switch calls `switchBranch`

- [ ] **Step 2: Move repository state**

Move these state groups out of `OfflineWorkbench`:

- `repoStatus`, `repoLoading`
- `remoteStatus`
- `pushLoading`, `pushDialogOpen`, `rebuildLoading`, `rebuildDialogOpen`
- branch list/menu/switching state
- repo commit state that is not Flow-scoped

Keep dialog open state in `OfflineWorkbench` only if it is strictly presentational; otherwise keep it inside the hook.

- [ ] **Step 3: Preserve public behavior**

`OfflineWorkbench` should still render:

- branch selector
- repo commit button
- push button
- rebuild dialog
- dirty branch switch confirmation

The page should call hook actions instead of local callbacks.

- [ ] **Step 4: Run tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useOfflineRepositoryWorkflow.test.ts src/views/offline/OfflineWorkbench.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/useOfflineRepositoryWorkflow.ts wb-data-frontend/src/views/offline/useOfflineRepositoryWorkflow.test.ts wb-data-frontend/src/views/offline/OfflineWorkbench.tsx wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "refactor: extract offline repository workflow"
```

### Task 3: Extract Flow Editing Session Hook

**Files:**
- Create: `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
- Create: `wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/flowDraftController.ts` only if a pure operation is missing

- [ ] **Step 1: Write hook tests**

Cover:

- opening a Flow creates a `FlowDraftSession`
- node editor draft is flushed before save
- save sends `stages`, `edges`, `layout`, and `schedule`
- conflict response opens save conflict state
- overwrite conflict rebases base metadata while preserving local draft
- closing or navigating away writes recovery snapshot when dirty

- [ ] **Step 2: Move Flow session state**

Move these state groups out of `OfflineWorkbench`:

- `activeFlowPath`, `flowLoading`
- `draftSession`
- `saveConflictState`, `saveConflictPending`
- `nodeEditorOpen`, `nodeEditorContent`
- selected node/task state derived from `draftSession`
- save and Flow-scoped commit logic

- [ ] **Step 3: Keep the hook interface deep**

The page should not manually call `flushNodeEditorDraft`, `rebaseFlowDraftSession`, or `prepareSessionForLeave`. Those are implementation details inside `useFlowEditingSession`.

- [ ] **Step 4: Run tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts src/views/offline/flowDraftController.test.ts src/views/offline/OfflineWorkbench.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/useFlowEditingSession.ts wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts wb-data-frontend/src/views/offline/OfflineWorkbench.tsx wb-data-frontend/src/views/offline/flowDraftController.ts wb-data-frontend/src/views/offline/flowDraftController.test.ts
git commit -m "refactor: extract flow editing session"
```

### Task 4: Extract Tree Mutations

**Files:**
- Create: `wb-data-frontend/src/views/offline/useOfflineTreeMutations.ts`
- Create: `wb-data-frontend/src/views/offline/useOfflineTreeMutations.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write hook tests**

Cover:

- creating a Flow saves a new document at the selected parent path
- creating a folder refreshes the tree
- deleting the active Flow leaves the draft session and clears active path
- renaming the active Flow updates active path
- deleting a folder containing the active Flow leaves the draft session
- renaming a folder containing the active Flow updates active path

- [ ] **Step 2: Move tree mutation state**

Move state for:

- new Flow/folder dialogs
- context menu position and node
- delete Flow/folder dialogs
- rename Flow/folder dialogs
- loading flags for those mutations

- [ ] **Step 3: Run tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useOfflineTreeMutations.test.ts src/views/offline/OfflineWorkbench.test.tsx
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add wb-data-frontend/src/views/offline/useOfflineTreeMutations.ts wb-data-frontend/src/views/offline/useOfflineTreeMutations.test.ts wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: extract offline tree mutations"
```

### Task 5: Extract Execution and Schedule Hook

**Files:**
- Create: `wb-data-frontend/src/views/offline/useFlowExecutionAndSchedule.ts`
- Create: `wb-data-frontend/src/views/offline/useFlowExecutionAndSchedule.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write hook tests**

Cover:

- loading schedule uses draft schedule first when unsaved draft already has schedule
- staging schedule updates the Flow draft and does not call the backend directly
- toggling schedule updates the Flow draft and keeps `recoverMissedSchedules` behavior on save through existing backend contract
- execute uses current draft payload when unsaved changes exist
- stop execution and stop all execution update action pending state

- [ ] **Step 2: Move schedule and execution state**

Move:

- execution dialog state
- execution list/detail state
- active execution id
- action pending state
- requested-by filter
- schedule dialog state
- schedule cron/timezone state
- schedule staging/toggle logic

- [ ] **Step 3: Keep save ownership in Flow editing**

`useFlowExecutionAndSchedule` may stage schedule into the Flow draft, but only `useFlowEditingSession.saveFlow` should persist YAML. This keeps the schedule-save chain explicit.

- [ ] **Step 4: Run tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowExecutionAndSchedule.test.ts src/views/offline/OfflineWorkbench.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/useFlowExecutionAndSchedule.ts wb-data-frontend/src/views/offline/useFlowExecutionAndSchedule.test.ts wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: extract flow execution and schedule workflow"
```

### Task 6: Slim `OfflineWorkbench` Composition

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`

- [ ] **Step 1: Remove duplicate local state**

After hook extraction, `OfflineWorkbench` should own only:

- static rendering decisions
- dialog composition
- route blocker composition
- layout-level event wiring

It should not own raw API calls for offline workflow actions.

- [ ] **Step 2: Keep high-level integration tests**

`OfflineWorkbench.test.tsx` should continue to assert:

- permissions hide/show repo commit and push
- branch switching blockers
- Flow-scoped commit vs repo commit
- destructive confirmation behavior
- schedule-save-commit-push characterization

- [ ] **Step 3: Run tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/OfflineWorkbench.test.tsx
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "refactor: slim offline workbench composition"
```

### Task 7: Add Responsive Layout Guardrail

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css`
- Modify: `wb-data-frontend/src/views/offline/offlineWorkbenchLayout.test.tsx`

- [ ] **Step 1: Add or adjust layout rule**

Ensure the left rail toolbar cannot be visually or interactively covered by the main canvas toolbar at narrow widths.

The expected CSS direction is:

```css
.offline-rail {
    position: relative;
    z-index: 2;
}

.offline-main-panel {
    position: relative;
    z-index: 1;
    min-width: 0;
}
```

Only use this exact rule if it matches the final DOM stacking context. If another existing stacking context is responsible, fix the smallest rule that makes the rail toolbar hit target own its clickable area.

- [ ] **Step 2: Run layout test**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/offlineWorkbenchLayout.test.tsx
```

Expected: the push button hit target is not covered.

- [ ] **Step 3: Verify with browser screenshot**

Start frontend and use a narrow viewport around `600x836` to verify:

- push button is visible
- clicking push opens the confirmation dialog
- canvas toolbar does not overlap the rail toolbar

- [ ] **Step 4: Commit**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.css wb-data-frontend/src/views/offline/offlineWorkbenchLayout.test.tsx
git commit -m "fix: protect offline rail toolbar hit targets"
```

### Task 8: Full Verification

**Files:**
- No planned source changes.

- [ ] **Step 1: Run frontend tests**

```bash
cd wb-data-frontend
npm run test -- --run
```

Expected: all frontend tests pass.

- [ ] **Step 2: Run frontend build**

```bash
cd wb-data-frontend
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Run backend tests relevant to offline workflows**

```bash
cd wb-data-server
mvn -pl wb-data-backend -Dtest=OfflineFlowDocumentServiceTest,OfflineScheduleServiceTest,GitCommandServiceTest,GitCommandServiceBranchTest,OfflineExecutionServiceBranchTest test
```

Expected: all selected backend tests pass.

- [ ] **Step 4: Run full backend build if time allows**

```bash
cd wb-data-server
mvn clean install
```

Expected: full Maven build passes.

- [ ] **Step 5: Human-path end-to-end verification**

Start the app from the refactor branch, then run this exact flow through the UI:

1. Login as `admin / admin123`.
2. Select project group `policy`.
3. Open `离线开发`.
4. Use a branch that has Kestra sync enabled.
5. Create a Flow under `jack`.
6. Add one Shell node.
7. Enter `echo "offline refactor check $(date)"`.
8. Configure schedule as once per minute.
9. Enable schedule.
10. Save.
11. Commit current Flow.
12. Push.
13. Open `运维中心`.
14. Filter by the new Flow name.
15. Confirm records appear after the next minute boundary.
16. Confirm the first minute has one record, not two.
17. Open detail.
18. Confirm only user-facing nodes are shown and logs are for the selected node.

Expected: the full path works without console errors, layout overlap, missing schedule persistence, duplicate first-minute execution, or broken detail logs.

## Rollback Strategy

- Every task ends in a separate commit.
- If a regression appears, revert the most recent task commit and keep earlier completed extractions.
- Do not continue to the next hook extraction while targeted tests are failing.
- Do not merge the refactor branch until the human-path end-to-end verification passes.

## Done Criteria

- `OfflineWorkbench.tsx` no longer owns raw workflow state for repository, Flow editing, tree mutations, execution, and schedule.
- New hook modules have focused tests.
- Existing high-level workbench tests still pass.
- Responsive toolbar overlap is covered by a test and manual browser verification.
- Full frontend tests pass.
- Frontend build passes.
- Relevant backend tests pass.
- Manual end-to-end UI flow passes with a scheduled Flow visible in Operations Center.
