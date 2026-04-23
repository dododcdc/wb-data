# Dirty flow tree indicator design

## Problem

The offline workbench already shows dirty-state dots in the toolbar, but that only helps for the currently open Flow.

When a user edits Flow A, switches to Flow B, and leaves Flow A as a recovery snapshot in `localStorage`, the file tree gives no hint that Flow A still has unsaved local draft data. That makes the draft easy to forget.

## Goals

- Show a lightweight marker on Flow nodes in the repo tree when that path has a recovery snapshot
- Keep the scope aligned with the conservative issue proposal
- Reuse the existing recovery snapshot lifecycle instead of creating a second source of truth
- Avoid repeated `localStorage` scans during normal tree rendering

## Non-goals

- Do not show dirty state for the currently open in-memory draft unless it has already been persisted as a recovery snapshot
- Do not merge tree markers with the toolbar’s save / commit / push dirty semantics
- Do not introduce a global store or a broader offline draft refactor
- Do not redesign the repo tree UI

## Recommended approach

Use an in-memory `Set<string>` in `OfflineWorkbench` as a cached view of recovery snapshot paths for the current group.

This gives the tree fast lookups while keeping the source of truth in the existing recovery snapshot store. It also lines up cleanly with the current code structure, where `OfflineWorkbench` already orchestrates open/save/leave/delete/rename flows.

## Data model

Add a new `dirtyFlowPaths` state in `OfflineWorkbench`:

```ts
const [dirtyFlowPaths, setDirtyFlowPaths] = useState<Set<string>>(new Set());
```

Meaning:

- each path in the set is a Flow path for the current `groupId`
- presence means a recovery snapshot currently exists for that path
- absence means the tree should not render the dirty-dot marker for that path

The set is a cache, not the primary store. The source of truth remains recovery snapshots in `localStorage`.

## Recovery snapshot store change

`recoverySnapshotStore.ts` should export `listRecoverySnapshotPaths(groupId)`.

Current behavior already exists internally; this change only exposes it so `OfflineWorkbench` can rebuild `dirtyFlowPaths` from persisted data when needed.

No behavior change is needed inside snapshot storage itself beyond exporting the helper.

## Offline workbench state flow

### Initial load and group switch

Whenever the workbench initializes or `groupId` changes:

1. call `listRecoverySnapshotPaths(groupId)`
2. create a fresh `Set<string>` from the returned paths
3. replace `dirtyFlowPaths` with that new set

This ensures markers never leak across groups and always reflect persisted snapshots for the active group.

### Leaving a Flow

When `leaveCurrentFlow()` writes a recovery snapshot:

- add `session.path` to `dirtyFlowPaths`

If leaving the Flow produces no snapshot and removes the old one:

- remove `session.path` from `dirtyFlowPaths`

This keeps the tree cache synchronized with the already-existing snapshot lifecycle.

### Save success

When a Flow save succeeds and its recovery snapshot is removed:

- remove that path from `dirtyFlowPaths`

This is required so the tree marker disappears immediately after a successful save.

### Delete and explicit snapshot removal

Any path that is removed from recovery snapshot storage must also be removed from `dirtyFlowPaths`.

This includes:

- deleting a Flow
- deleting a folder
- explicit `removeRecoverySnapshot(...)`
- any flow where save success clears recovery state

### Rename and folder move

When flow or folder rename logic moves recovery snapshots:

- mirror that path migration in `dirtyFlowPaths`

This should reuse the same path transformation already used by snapshot move helpers, so the marker follows the renamed Flow rather than disappearing or staying on the old path.

## Component boundary changes

### `RepoTreeBranch`

Add a `dirtyFlowPaths: Set<string>` prop.

When rendering `node.kind === 'FLOW'`:

- compute `const hasDirtyDraft = dirtyFlowPaths.has(node.path)`
- render a small indicator only when `hasDirtyDraft` is true

No other node kinds need marker logic.

### `OfflineWorkbench`

Responsibility:

- own `dirtyFlowPaths`
- update it at the same points where recovery snapshots are created, moved, or removed
- pass it through to the recursive tree component

This keeps tree rendering dumb and leaves all state coordination in the workbench, where the relevant lifecycle decisions already live.

## UI treatment

Add a minimal marker next to the Flow name:

```tsx
<span className="offline-tree-row-label">{node.name}</span>
{hasDirtyDraft ? <span className="offline-tree-dirty-dot" aria-hidden="true" /> : null}
```

Visual requirements:

- small circular dot
- aligned with the existing tree row layout
- use the existing brand/dirty accent family rather than introducing a new semantic color
- should read as a subtle reminder, not a primary action cue

The tree marker should remain independent from the toolbar dot. The toolbar still communicates the current editor’s live state; the tree dot only communicates persisted recovery drafts.

## Testing strategy

Focus testing on synchronization correctness.

### Snapshot store test

Add a test that confirms `listRecoverySnapshotPaths(groupId)` returns only paths for the requested group.

### Workbench tests

Add focused `OfflineWorkbench` tests that verify:

1. tree renders a dirty-dot for Flow paths that already have a recovery snapshot
2. the marker disappears after save success clears the snapshot
3. group switch rebuilds markers from the next group’s snapshot set

If rename/delete paths are already covered in existing workbench tests, extend them to assert the marker state too. If not, keep tests focused on the three cases above unless implementation reveals a specific risk.

## Risks and mitigations

- **Risk:** stale markers after save/delete/rename  
  **Mitigation:** update `dirtyFlowPaths` in the same code paths that already change recovery snapshots

- **Risk:** group cross-contamination  
  **Mitigation:** rebuild `dirtyFlowPaths` from storage whenever `groupId` changes

- **Risk:** overloading tree semantics with live dirty state  
  **Mitigation:** only track persisted recovery snapshots, not in-memory unsaved edits

## Implementation notes

- Prefer small immutable `Set` updates (`new Set(previous)`) rather than mutating the existing instance in place
- Keep the exported snapshot helper narrow; do not add a subscription model or new storage abstraction
- If the tree row spacing shifts after adding the dot, adjust only the local row styles needed to keep labels aligned
