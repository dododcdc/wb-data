# Offline Workbench Next Simplification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue simplifying the offline development frontend by reducing `OfflineWorkbench.tsx` page-orchestration load without changing user-visible behavior.

**Architecture:** Keep the existing deep hooks for repository workflow, tree mutations, flow editing, execution, and scheduling. Add a small number of page-level modules around navigation guards, commit dialogs, and page shell rendering so `OfflineWorkbench.tsx` becomes a composition layer instead of a workflow coordinator.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, React Testing Library, Spring Boot 3, Maven, Kestra.

---

## Current State

The offline development module is no longer in the high-risk state it was in before the earlier simplification passes.

Current frontend modules already separate the largest behavior clusters:

- `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
  - Flow loading, draft session, dirty detection, node editor draft flushing, save, conflict handling, recovery snapshots, canvas refs.
- `wb-data-frontend/src/views/offline/useOfflineRepositoryWorkflow.ts`
  - Repository status, remote status, branch list, branch switching, commit, push, rebuild.
- `wb-data-frontend/src/views/offline/useOfflineTreeMutations.ts`
  - New flow/folder, rename, delete, context menu state.
- `wb-data-frontend/src/views/offline/useFlowExecutionAndSchedule.ts`
  - Debug execution list/detail, stop controls, schedule dialog state, schedule staging and toggle.
- `wb-data-frontend/src/views/offline/flowDraftController.ts`
  - Pure draft/session operations.
- `wb-data-frontend/src/views/offline/flowDocumentMutations.ts`
  - Pure document graph and node mutations.

Remaining complexity is concentrated in `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`, currently around 2,300 lines. The problem is no longer "all logic is in one file"; it is that the page still owns several coordination rules that callers must understand together:

- Dirty-flow navigation guard and router blocker handling.
- Open-flow wrapper that decides whether to prompt, discard, or force-open.
- Group switching and branch-change event reset behavior.
- Branch-switch dirty-draft bridge between repository workflow and flow editing.
- Duplicate commit dialog state for current Flow commit and repository commit.
- Large render tree with inline dialog and toolbar wiring.

Backend `OfflineFlowYamlSupport.java` is still large, but it is package-private implementation detail. It should not be part of this next simplification unless a new backend feature touches YAML compilation, scheduling trigger writing, or node type compilation.

## Decision

Proceed with a narrow frontend-only simplification pass.

Do not do a broad rewrite. Do not change API contracts. Do not change Kestra YAML semantics. Do not change save, commit, push, schedule, or execution behavior.

The next pass should leave these user workflows identical:

1. Open offline development under project group `policy`.
2. Create folders and flows.
3. Add Shell, SQL, and HiveSQL nodes.
4. Edit node content and data source binding.
5. Move nodes on the canvas independently.
6. Save a Flow.
7. Commit current Flow.
8. Commit repository changes.
9. Push repository changes.
10. Configure and toggle schedule.
11. Execute a Flow manually.
12. Switch branches with and without unsaved draft changes.
13. Navigate away with unsaved draft changes and choose save/discard/cancel.

## Target Module Map

### Create `useOfflineWorkbenchNavigation.ts`

Path:

`wb-data-frontend/src/views/offline/useOfflineWorkbenchNavigation.ts`

Responsibility:

- Own `pendingNavigation`.
- Own the "open another Flow while current Flow is dirty" decision.
- Own router blocker confirm/cancel behavior.
- Own the `didDiscardLeaveRef` escape hatch currently embedded in `OfflineWorkbench.tsx`.
- Expose a small interface for the page and leave flow editing/session details behind callbacks.

Proposed interface:

```ts
import type { Blocker } from 'react-router-dom';
import type { FlowDraftSession } from './flowDraftController';

export type OfflinePendingNavigation =
    | { type: 'router'; blocker: Blocker }
    | { type: 'flow'; flowPath: string };

export interface UseOfflineWorkbenchNavigationParams {
    groupId: number | null;
    draftSession: FlowDraftSession | null;
    isDirty: boolean;
    openFlowDocumentFromSession: (
        path: string,
        options?: { force?: boolean; canLeaveDirty?: boolean; skipLeaveCurrent?: boolean },
    ) => Promise<boolean>;
    saveCurrentFlow: () => Promise<boolean>;
    discardCurrentFlowDraft: () => void;
    resetActiveFlow: () => void;
}

export interface OfflineWorkbenchNavigationController {
    pendingNavigation: OfflinePendingNavigation | null;
    openFlowDocument: (
        path: string,
        options?: { force?: boolean; canLeaveDirty?: boolean; skipLeaveCurrent?: boolean },
    ) => Promise<boolean>;
    markDraftDiscardedForExternalSwitch: () => void;
    confirmLeave: (action: 'save' | 'discard') => Promise<void>;
    cancelLeave: () => void;
    setPendingRouterNavigation: (blocker: Blocker) => void;
}
```

### Create `OfflineCommitDialogs.tsx`

Path:

`wb-data-frontend/src/views/offline/OfflineCommitDialogs.tsx`

Responsibility:

- Render the current Flow commit dialog.
- Render the repository commit dialog.
- Own shared commit-message input UI.
- Keep the actual commit operations in `OfflineWorkbench.tsx` or hooks through callbacks.

Proposed props:

```ts
export interface OfflineCommitDialogsProps {
    flowCommitOpen: boolean;
    repoCommitOpen: boolean;
    commitMessage: string;
    committing: boolean;
    flowDirty: boolean;
    repoDirty: boolean;
    onFlowCommitOpenChange: (open: boolean) => void;
    onRepoCommitOpenChange: (open: boolean) => void;
    onCommitMessageChange: (message: string) => void;
    onCommitFlow: (mode: 'save-and-commit' | 'saved-only') => void;
    onCommitRepo: (mode: 'save-and-commit' | 'saved-only') => void;
}
```

### Create `OfflineWorkbenchLifecycle.ts`

Path:

`wb-data-frontend/src/views/offline/OfflineWorkbenchLifecycle.ts`

Responsibility:

- Provide small hook helpers for page-level events that are not business workflows:
  - group changed reset
  - external branch changed event
  - URL `flowPath` restore
  - `beforeunload` leave handling
  - `Ctrl/Cmd+N` new Flow shortcut

This file should not call offline API functions directly. It should only compose callbacks passed by `OfflineWorkbench.tsx`.

### Modify `OfflineWorkbench.tsx`

Path:

`wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

Responsibility after this pass:

- Read auth/group context.
- Instantiate workflow hooks.
- Compose page-level modules.
- Render shell, side rail, canvas, dialogs.

Target after this pass:

- Remove most navigation-guard logic from the page body.
- Remove duplicate commit dialog JSX from the page body.
- Reduce direct page-level effects to a small number of lifecycle hook calls.
- Keep the file functional even if it remains over 1,500 lines. The success criterion is lower cognitive load, not an arbitrary line count.

## Implementation Plan

### Task 1: Add Characterization Tests For Current Page Coordination

**Files:**

- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`
- Modify only if needed: `wb-data-frontend/src/views/offline/useOfflineRepositoryWorkflow.test.ts`
- Modify only if needed: `wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts`

- [ ] **Step 1: Add or confirm tests for dirty Flow navigation**

Add coverage that starts with an open dirty Flow, attempts to open a different Flow, and expects the unsaved-changes dialog to appear. Verify:

- Cancel keeps the current Flow active.
- Discard opens the target Flow.
- Save calls the save path before opening the target Flow.

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run src/views/offline/OfflineWorkbench.test.tsx
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 2: Add or confirm tests for commit dialog choices**

Cover both dialogs:

- Current Flow commit when the Flow is dirty uses `save-and-commit`.
- Current Flow commit when the Flow is already saved uses `saved-only`.
- Repository commit with dirty current Flow offers the saved-only path and the save-and-commit path.

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run src/views/offline/OfflineWorkbench.test.tsx
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 3: Commit test characterization**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "test: characterize offline workbench coordination"
```

### Task 2: Extract Dirty Navigation Controller

**Files:**

- Create: `wb-data-frontend/src/views/offline/useOfflineWorkbenchNavigation.ts`
- Create: `wb-data-frontend/src/views/offline/useOfflineWorkbenchNavigation.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write hook tests first**

Test these behaviors:

- `openFlowDocument(path)` delegates immediately when there is no dirty draft.
- `openFlowDocument(path)` stores pending flow navigation when dirty.
- `confirmLeave('discard')` discards the draft and opens the pending Flow with force.
- `confirmLeave('save')` saves first and only opens the pending Flow when save succeeds.
- `cancelLeave()` resets router blocker when pending navigation is router-based.

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run src/views/offline/useOfflineWorkbenchNavigation.test.ts
```

Expected before implementation:

```text
FAIL
```

- [ ] **Step 2: Implement `useOfflineWorkbenchNavigation.ts`**

Move the existing pending navigation and discard-ref behavior out of `OfflineWorkbench.tsx`. Do not change toast copy, dialog copy, or save/discard decisions.

- [ ] **Step 3: Wire `OfflineWorkbench.tsx` to the hook**

Replace local state and callbacks:

- `pendingNavigation`
- `didDiscardLeaveRef`
- `openFlowDocument`
- `handleConfirmLeave`
- `handleCancelLeave`
- branch-switch discard marker logic

Keep the existing `UnsavedChangesDialog` rendering in `OfflineWorkbench.tsx` for this task.

- [ ] **Step 4: Verify**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run \
  src/views/offline/useOfflineWorkbenchNavigation.test.ts \
  src/views/offline/OfflineWorkbench.test.tsx
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/views/offline/useOfflineWorkbenchNavigation.ts \
  wb-data-frontend/src/views/offline/useOfflineWorkbenchNavigation.test.ts \
  wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: extract offline workbench navigation guard"
```

### Task 3: Extract Commit Dialog Rendering

**Files:**

- Create: `wb-data-frontend/src/views/offline/OfflineCommitDialogs.tsx`
- Create: `wb-data-frontend/src/views/offline/OfflineCommitDialogs.test.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write dialog component tests**

Test:

- Flow commit dialog renders the correct primary action when `flowDirty=true`.
- Flow commit dialog calls `onCommitFlow('save-and-commit')` for dirty Flow primary action.
- Flow commit dialog calls `onCommitFlow('saved-only')` for saved-only action.
- Repository commit dialog calls `onCommitRepo(...)` with the selected mode.
- Buttons are disabled when `committing=true` or commit message is blank.

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run src/views/offline/OfflineCommitDialogs.test.tsx
```

Expected before implementation:

```text
FAIL
```

- [ ] **Step 2: Implement `OfflineCommitDialogs.tsx`**

Move only JSX and shared commit-message controls. Keep actual commit behavior as callbacks supplied by `OfflineWorkbench.tsx`.

- [ ] **Step 3: Replace inline dialog JSX in `OfflineWorkbench.tsx`**

Keep state names stable unless the component extraction requires a local rename:

- `flowCommitDialogOpen`
- `repoCommitDialogOpen`
- `commitMessage`
- `committing`
- `handleFlowCommit`
- `handleRepoCommit`

- [ ] **Step 4: Verify**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run \
  src/views/offline/OfflineCommitDialogs.test.tsx \
  src/views/offline/OfflineWorkbench.test.tsx
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/views/offline/OfflineCommitDialogs.tsx \
  wb-data-frontend/src/views/offline/OfflineCommitDialogs.test.tsx \
  wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: extract offline commit dialogs"
```

### Task 4: Extract Page Lifecycle Effects

**Files:**

- Create: `wb-data-frontend/src/views/offline/OfflineWorkbenchLifecycle.ts`
- Create: `wb-data-frontend/src/views/offline/OfflineWorkbenchLifecycle.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write lifecycle tests**

Test pure hook behavior with mock callbacks:

- group change calls leave/reset/refresh callbacks in the same order as current behavior
- external `wbdata:offline-branch-changed` event resets the active Flow and refreshes workspace for the same group
- event from a different group is ignored
- URL `flowPath` restore runs only once per mount
- `Ctrl/Cmd+N` opens new Flow only when blocking dialogs are closed

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run src/views/offline/OfflineWorkbenchLifecycle.test.ts
```

Expected before implementation:

```text
FAIL
```

- [ ] **Step 2: Implement lifecycle helpers**

Use exported hooks, for example:

```ts
export function useOfflineWorkbenchGroupLifecycle(params: GroupLifecycleParams): void;
export function useOfflineWorkbenchBranchEvent(params: BranchEventParams): void;
export function useOfflineWorkbenchUrlRestore(params: UrlRestoreParams): void;
export function useOfflineWorkbenchShortcut(params: ShortcutParams): void;
```

The helpers must not own business state. They receive callbacks and call them.

- [ ] **Step 3: Replace corresponding `useEffect` blocks in `OfflineWorkbench.tsx`**

Move only effects that are page lifecycle wiring. Do not move repository, execution, schedule, or draft business logic.

- [ ] **Step 4: Verify**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run \
  src/views/offline/OfflineWorkbenchLifecycle.test.ts \
  src/views/offline/OfflineWorkbench.test.tsx
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/views/offline/OfflineWorkbenchLifecycle.ts \
  wb-data-frontend/src/views/offline/OfflineWorkbenchLifecycle.test.ts \
  wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: extract offline workbench lifecycle wiring"
```

### Task 5: Final Verification And Manual Acceptance

**Files:**

- Modify only if verification finds a defect.

- [ ] **Step 1: Run focused offline frontend tests**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run src/views/offline
```

Expected:

```text
Test Files  passed
```

- [ ] **Step 2: Run full frontend tests**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- --run
```

Expected:

```text
Test Files  passed
```

- [ ] **Step 3: Run lint and build**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run lint
npm run build
```

Expected:

```text
npm run lint exits 0
npm run build exits 0
```

- [ ] **Step 4: Run backend safety check**

This refactor should be frontend-only, but run backend tests that protect the save/commit/schedule/execution contracts touched by manual acceptance.

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server
mvn -pl wb-data-backend -Dtest=GroupScopedRouteMappingTest,OfflineScheduleControllerGroupScopeTest,OfflineExecutionControllerGroupScopeTest test
```

Expected:

```text
BUILD SUCCESS
```

- [ ] **Step 5: Manual acceptance using local development setup**

Start services:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend
DB_PASSWORD=1111 mvn spring-boot:run -Dspring-boot.run.fork=false
```

Human-style flow:

1. Open `http://127.0.0.1:5173`.
2. Log in with `admin / admin123`.
3. Select project group `policy`.
4. Open `离线开发`.
5. Create or open `jack/refactor-acceptance/test-flow`.
6. Add two Shell nodes.
7. Move each node independently and confirm the other node does not move.
8. Edit the first Shell node:

```bash
echo "first node"
```

9. Edit the second Shell node:

```bash
echo "second node"
```

10. Save the Flow.
11. Click current Flow commit. Use a commit message such as:

```text
refactor acceptance flow save
```

12. Commit repository changes.
13. Push repository changes.
14. Open schedule settings.
15. Set cron to one minute.
16. Enable schedule.
17. Save schedule.
18. Go to operations center.
19. Confirm a scheduled execution appears after the next planned minute.
20. Return to offline development and confirm the schedule still shows enabled.
21. Try switching branches with an unsaved edit and confirm the dirty-draft prompt still appears.
22. Choose cancel and confirm the current Flow remains open.
23. Repeat branch switch, choose discard, and confirm the switch completes.

Expected:

- No JavaScript console error during the flow.
- No UI text or controls disappear after extraction.
- Unsaved-change prompts behave the same as before.
- Commit dialogs offer the same choices as before.
- Schedule remains enabled after save/commit/push.
- Operations center shows scheduled execution records.

## Acceptance Criteria

The refactor is accepted only if all criteria are met:

- `OfflineWorkbench.tsx` no longer owns dirty-navigation state directly.
- `OfflineWorkbench.tsx` no longer contains the full commit dialog JSX.
- Page lifecycle effects are moved into named helpers or hooks.
- Existing save, commit, push, schedule, execution, branch switch, and dirty navigation behavior is unchanged.
- Focused offline tests pass.
- Full frontend test suite passes.
- Frontend lint passes.
- Frontend build passes.
- Backend group/schedule/execution safety tests pass.
- Manual human-style acceptance flow passes under project group `policy`.

## Stop Conditions

Stop the refactor and reassess if any of these happen:

- A task requires backend API changes.
- A task changes Flow YAML output.
- A task changes schedule trigger semantics.
- A task requires rewriting `useFlowEditingSession.ts` or `useOfflineRepositoryWorkflow.ts` from scratch.
- The manual acceptance flow reveals a behavior difference that cannot be fixed locally in the current task.

## Deferred Work

Do not include these in this pass:

- Splitting `OfflineFlowYamlSupport.java`.
- Redesigning the offline UI layout.
- Moving the whole offline workbench to a global store.
- Replacing React Flow or canvas logic.
- Adding new node types.
- Building the full Docker integration environment.

