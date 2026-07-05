# Flow Editing Session Simplification Design

## Context

The first offline workbench simplification moved repository operations, tree mutations, execution loading, and schedule staging out of `OfflineWorkbench`. The page is still about 3,000 lines and the remaining complexity is concentrated around Flow editing:

- active Flow path and document loading
- draft session and dirty state
- pending node editor drafts
- recovery snapshots
- route and Flow-leave confirmation
- canvas node, edge, and layout updates
- node rename and add-node behavior
- save validation
- save conflict handling
- current Flow commit orchestration

This area is high risk because previous schedule bugs crossed frontend draft state, document save payloads, YAML persistence, Git push, and Kestra registration. The next refactor must reduce page complexity without changing user behavior or hiding those layers.

## Goal

Create a deeper Flow editing module that owns the editing session workflow behind a smaller interface. `OfflineWorkbench` should remain the page composition layer: it renders layout and dialogs, wires toolbar controls, and delegates editing behavior to the module.

The intended outcome is lower coupling, better local tests for Flow editing rules, and a smaller `OfflineWorkbench` surface for future changes.

## Non-Goals

- No backend API changes.
- No visual redesign.
- No Flow canvas rewrite.
- No change to Kestra YAML semantics.
- No change to save, commit, push, or schedule behavior.
- No deletion of existing coverage unless replaced by behavior-equivalent tests in the same commit.
- No broad CSS cleanup.

## Options Considered

### Option A: Extract Pure Flow Document Mutations First

Move node rename, add-node, canvas node sync, edge sync, layout commit, and validation into pure functions before extracting a React hook.

Pros:
- Lowest risk.
- Easy red-green tests.
- Creates reusable building blocks for the hook.

Cons:
- `OfflineWorkbench` remains state-heavy until later steps.

### Option B: Extract One Large `useFlowEditingSession` Hook Directly

Move all Flow editing state and side effects into a hook in one pass.

Pros:
- Fastest visible reduction in `OfflineWorkbench`.
- Produces the target shape sooner.

Cons:
- High regression risk.
- Harder to prove behavior because many state transitions move at once.
- Tests can become hook implementation tests rather than behavior tests.

### Option C: Keep the Current Shape and Only Add Tests

Improve confidence without further extraction.

Pros:
- Minimal code churn.
- Useful if release pressure is high.

Cons:
- Leaves the main complexity in the page.
- Future schedule/save changes remain expensive to reason about.

## Recommended Approach

Use Option A, then incrementally move orchestration into `useFlowEditingSession`.

The design should prefer deep modules:

- Pure document operations expose small function interfaces and contain graph/layout details.
- The React editing-session hook owns stateful workflow rules and exposes user actions.
- `OfflineWorkbench` does not duplicate draft state or pending editor state after extraction.

## Target Module Map

### `flowDocumentMutations.ts`

Pure in-process module. No React, no API calls, no localStorage.

Responsibilities:
- create default node for a kind and Flow path
- add a node to the first stage or create the first stage
- rename a node and update script path, edges, layout, active selection, and selected task IDs
- apply canvas node removals to the document
- apply canvas edges to the document
- apply canvas layout to the document
- validate graph constraints used before save

Suggested interface:

```ts
export function addFlowNode(input: AddFlowNodeInput): AddFlowNodeResult;
export function renameFlowNode(input: RenameFlowNodeInput): RenameFlowNodeResult;
export function applyCanvasNodes(input: ApplyCanvasNodesInput): ApplyCanvasNodesResult;
export function applyCanvasEdges(input: ApplyCanvasEdgesInput): OfflineFlowDocument;
export function applyCanvasLayout(input: ApplyCanvasLayoutInput): OfflineFlowDocument;
export function validateFlowDocumentForSave(document: OfflineFlowDocument, override?: NodeOverride): FlowSaveValidation;
```

The result types should include any selection updates that currently happen in `OfflineWorkbench`.

### `useFlowEditingSession.ts`

Stateful React module. Owns Flow editing workflow but not JSX.

Responsibilities:
- active Flow path
- flow loading
- `FlowDraftSession`
- dirty state
- selected node and selected task IDs
- active node derivation
- pending node editor draft
- node editor open state and content
- recovery snapshot writes/removes
- stale snapshot restore/discard
- save conflict state and actions
- save Flow
- current Flow commit
- leave-current-Flow behavior

Suggested interface:

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
    nodeEditorOpen: boolean;
    nodeEditorContent: string;
    staleDraft: DraftConflict | null;
    saveConflictState: SaveConflictState | null;
    saveConflictPending: boolean;

    openFlowDocument(path: string, options?: OpenFlowOptions): Promise<boolean>;
    leaveCurrentFlow(groupOverride?: number | null): void;
    resetAfterBranchSwitch(): void;

    setSelectedNodeId(taskId: string | null): void;
    setSelectedTaskIds(taskIds: string[] | ((current: string[]) => string[])): void;
    toggleTaskSelection(taskId: string): void;
    replaceTaskSelection(taskIds: string[]): void;

    openNodeEditor(taskId: string): void;
    setNodeEditorOpen(open: boolean): void;
    updateNodeEditorContent(content: string): void;
    stageNodeEditorDraft(content: string, dataSourceId?: number, dataSourceType?: string): void;
    saveNodeEditorDraft(content: string, dataSourceId?: number, dataSourceType?: string): void;

    addNode(kind: OfflineFlowNodeKind, position: NodePosition): void;
    renameNode(oldId: string, newId: string): void;
    updateCanvasNodes(nodes: Node[]): void;
    updateCanvasEdges(edges: Edge[]): void;
    commitCanvasLayout(nodes: Node[]): void;

    refreshFlowCommitStatus(): Promise<void>;
    saveFlow(nodeOverride?: NodeOverride, silent?: boolean): Promise<boolean>;
    commitCurrentFlow(message: string, mode: CommitMode): Promise<boolean>;

    restoreStaleDraft(): void;
    discardStaleDraft(): void;
    closeSaveConflict(): void;
    discardSaveConflict(): Promise<void>;
    overwriteSaveConflict(): Promise<void>;
}
```

The exact interface may shrink during implementation. It should not expose raw refs or require callers to know when to flush pending editor drafts.

### `OfflineWorkbench.tsx`

After this refactor, the page should:

- render page structure, tree, toolbar, canvas, dialogs
- pass controller actions to child components
- coordinate cross-module decisions only when unavoidable, such as branch switch confirmation and route blockers
- not directly manipulate `FlowDraftSession`
- not directly read or write recovery snapshots
- not directly hold `pendingNodeEditorDraftRef`

## Data Flow

1. User opens a Flow from the tree.
2. `useFlowEditingSession.openFlowDocument` loads the server document, reads a matching recovery snapshot, creates a draft session, and asks the schedule module to load schedule state for the same path.
3. User edits nodes through canvas or node editor.
4. Pure mutation functions produce the next draft document and selection state.
5. The hook stores the next draft session and manages pending editor draft flush/cancel rules.
6. Save validates SQL data-source requirements and graph constraints, flushes pending editor drafts, writes the document, rebases the draft session from the server response, removes recovery snapshots, and refreshes repository and Flow commit status.
7. A save conflict writes a recovery snapshot and opens conflict state.
8. Commit current Flow optionally saves first, then calls the Flow-scoped commit API.

## Error Handling

- 409 save conflicts stay user-visible through the existing save conflict dialog.
- Failed save shows the existing save error feedback.
- Invalid SQL datasource and invalid graph constraints block save before API calls.
- Failed Flow load keeps the current feedback behavior.
- Branch/group changes must cancel pending editor drafts and clear stale editing state.
- The hook must guard async responses by group id, matching current behavior.

## Testing Strategy

### Red-Green Tests Before Moving Production Code

Add tests for pure mutations first:

- rename updates node id, script path, edges, layout, active node, and selected task IDs
- rename rejects duplicate or invalid ids through a structured validation result
- add node creates predictable ids and script paths
- add node preserves existing stage behavior
- canvas node removal flushes pending draft and reconciles selection
- save validation rejects cycles
- save validation rejects disconnected graphs

Then add hook tests for workflow behavior:

- opening a Flow prefers a matching recovery snapshot
- leaving a dirty Flow writes a recovery snapshot after flushing pending editor draft
- saving flushes pending editor draft and includes schedule
- save conflict stores pending session and allows overwrite/discard
- committing current Flow calls save first when requested and dirty

Keep high-level `OfflineWorkbench.test.tsx` tests for user-facing wiring:

- schedule-save-commit-push
- branch switch with dirty draft
- current Flow commit path
- repo commit path

### Manual Verification

After implementation, run the real flow:

1. Start backend and frontend from the new worktree.
2. Login as `admin / admin123`.
3. Select project group `policy`.
4. In offline development, create a Flow under `jack`.
5. Add a Shell node and write a simple script.
6. Set schedule to every minute and enable it.
7. Save.
8. Commit current Flow.
9. Push.
10. Open operations center.
11. Confirm exactly one execution per planned minute.
12. Open detail and confirm only user nodes are shown, no `flow_dag`, no opaque execution id under the title, and logs follow the selected node.

## Implementation Slices

1. Add pure mutation characterization tests and create `flowDocumentMutations.ts`.
2. Replace node rename/add/canvas document mutation logic in `OfflineWorkbench` with pure functions.
3. Add `useFlowEditingSession` skeleton around existing draft session state without moving save/conflict yet.
4. Move node editor pending draft behavior into the hook.
5. Move open/leave/recovery snapshot behavior into the hook.
6. Move save, save conflict, and current Flow commit behavior into the hook.
7. Run full frontend tests, frontend build, backend related tests.
8. Run manual end-to-end verification.

Each slice should be small enough to commit independently.

## Rollback Plan

Because the refactor is frontend-only and behavior-preserving, rollback is a normal git revert of the new branch commits. Keep commits small so a problematic slice can be reverted without losing earlier tested pure-function extraction.

## Acceptance Criteria

- `OfflineWorkbench.tsx` no longer owns pending node editor draft refs, recovery snapshot persistence, save conflict internals, or raw Flow draft mutation logic.
- New pure mutation tests cover graph/layout/selection behavior.
- New hook tests cover save and conflict workflow behavior.
- Existing offline and operations tests pass.
- Frontend build passes.
- Backend offline-related tests pass.
- Manual save, commit, push, schedule, and operations verification passes.
