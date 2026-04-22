# Flow save conflict dialog design

## Problem

`OfflineWorkbench` already handles optimistic-lock save failures from `saveOfflineFlowDocument`, but the current `409 Conflict` path immediately snapshots the local draft, reloads the latest server document, and then still shows the generic "保存失败" feedback.

That behavior is technically safe, but it is a poor user experience:

- users do not know the failure was a save conflict
- users cannot choose whether to keep their draft or discard it
- the UI jumps to the server version before the user decides what to do

## Goals

- Detect `409 Conflict` as a dedicated save-conflict flow
- Let users choose among:
  - overwrite with my current draft
  - discard local draft and load the latest server version
  - handle later
- Keep the current editor state unchanged until the user makes an explicit choice
- Reuse existing offline dialog patterns and keep the change scoped

## Non-goals

- Show who changed the file or when it changed
- Add diff viewing for YAML content
- Refactor the entire save flow out of `OfflineWorkbench`
- Merge this flow with the existing stale-recovery banner shown when opening a file

## Recommended approach

Use a targeted split:

1. `OfflineWorkbench.tsx` owns conflict state and request orchestration
2. `SaveConflictDialog.tsx` owns the three-option UI
3. `flowDraftController.ts` adds a pure rebase helper for "overwrite with my draft"

This keeps the change local to the current offline editing flow without pushing more save-specific state transitions into the dialog component or over-abstracting the feature into a new service.

## State and UI model

Add a `saveConflictState` in `OfflineWorkbench` that is set only when a save attempt fails with `409`.

Proposed shape:

```ts
interface SaveConflictState {
    path: string;
    pendingSession: FlowDraftSession;
}
```

Rules:

- `saveConflictState === null` means no dialog
- when it is non-null, `SaveConflictDialog` is open
- closing the dialog via mask click, `Esc`, or the close button is treated as **handle later**
- **handle later** only clears `saveConflictState`; it does not mutate `draftSession`, `activeFlowPath`, or recovery snapshots

This preserves the exact editor state the user was looking at when the conflict happened.

## Component responsibilities

### `SaveConflictDialog.tsx`

Responsibility: presentation and user intent capture only.

Props should stay minimal and explicit:

```ts
interface SaveConflictDialogProps {
    open: boolean;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onOverwrite: () => void;
    onDiscardAndReload: () => void;
}
```

Behavior:

- use the existing offline `Dialog` structure and classes so it feels native to the page
- show three actions:
  - **用我的覆盖**
  - **丢弃本地并加载服务器**
  - **稍后处理**
- the overwrite path should include an inline second confirmation inside the same dialog, not a second modal
- the overwrite action uses destructive emphasis
- while an action is in flight, disable repeated clicks

### `flowDraftController.ts`

Add a pure helper dedicated to the overwrite flow. Suggested shape:

```ts
function forceOverwriteRebase(
    session: FlowDraftSession,
    serverDocument: OfflineFlowDocument,
): FlowDraftSession
```

Behavior:

- replace `baseDocument` with the latest server document
- keep `workingDraft` as the user draft they are trying to save
- preserve selection state where possible
- clear any conflict marker carried in the session

This creates a new session whose optimistic-lock metadata is fresh, but whose editable content is still the user's version.

### `OfflineWorkbench.tsx`

Responsibility: detect conflict, store pending state, and orchestrate follow-up actions.

Changes:

- on `409`, stop the normal save flow and set `saveConflictState`
- do **not** auto-load the latest server document
- keep the existing generic error feedback for non-`409` errors only
- add handlers for:
  - close / later
  - discard and reload
  - overwrite and retry

## Save-conflict flow

### Normal save

No change:

1. validate
2. build `sessionForSave`
3. call `saveOfflineFlowDocument`
4. rebase local session to the saved server result

### Conflict detected

When the save call returns `409`:

1. keep `sessionForSave` available as the pending local draft
2. set `saveConflictState = { path: activeFlowPath, pendingSession: sessionForSave }`
3. stop the success path
4. do not replace the current editor document
5. do not show the generic save-failed toast for this branch

### Handle later

When the user dismisses the dialog:

1. clear `saveConflictState`
2. keep the editor on the current local draft
3. do not alter recovery snapshots

### Discard and load server

When the user chooses to discard:

1. clear any recovery snapshot for the current path
2. clear `saveConflictState`
3. call `openFlowDocument(path, { preferRecoverySnapshot: false })`

This intentionally throws away the unsaved local draft and reloads the latest server version.

### Overwrite with my draft

When the user confirms overwrite:

1. fetch the latest server document with `getOfflineFlowDocument`
2. call `forceOverwriteRebase(pendingSession, latestServerDocument)`
3. retry the save with the rebased session
4. on success:
   - update `draftSession`
   - remove recovery snapshot
   - clear `saveConflictState`
   - keep the existing success feedback

The retry should reuse the existing save logic as much as possible instead of duplicating request assembly in multiple places.

## Error handling

- Non-`409` save failures keep the current generic feedback path
- If fetching the latest server document for overwrite fails:
  - keep the current draft intact
  - keep the dialog open
  - show explicit failure feedback
- If overwrite retry fails again with `409`:
  - stay in conflict mode
  - keep the pending draft intact
  - show feedback that the server version changed again and the user should retry
- If discard-and-reload fails:
  - keep the current draft visible
  - show explicit failure feedback

At no point should a failed follow-up action silently replace or discard the current local draft.

## Relationship to existing stale-recovery handling

The existing `staleDraft` banner is kept as-is.

The two flows solve different moments in the lifecycle:

- `staleDraft` banner: conflict discovered while **opening** a file from recovery snapshot
- save conflict dialog: conflict discovered while **saving** an actively edited file

They should share tone and warning style, but not state or behavior.

## Testing strategy

Add focused tests at the most stable boundaries:

1. `flowDraftController` unit test for `forceOverwriteRebase`
   - updates `baseDocument`
   - preserves `workingDraft`
   - preserves selection state
   - clears conflict state
2. `SaveConflictDialog` interaction test
   - later/close path
   - discard path
   - overwrite confirmation path
3. Reuse existing `OfflineWorkbench` validation/build/test commands instead of introducing a heavy new integration harness

This keeps coverage high on the new logic without adding expensive full-page tests around a large component.

## Implementation notes

- Prefer extracting a small internal save helper in `OfflineWorkbench` if needed so both normal save and overwrite retry can share request assembly
- Keep naming aligned with existing offline draft concepts (`draftSession`, `baseDocument`, `workingDraft`, `conflict`)
- Do not change the semantics of recovery snapshots outside the explicit discard path
