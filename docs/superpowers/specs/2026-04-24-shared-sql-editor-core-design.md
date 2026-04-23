# Shared SQL editor core design

## Problem

The frontend currently has two places where users write SQL:

1. the self-service query page
2. the offline workbench's SQL / HiveSQL node editor dialog

Both use Monaco, but reuse stops at a thin lazy-load helper and shared theme registration. Query-side formatting, keyboard actions, and metadata-backed completion are still wired directly inside `Query.tsx`, while the offline node editor keeps a lighter, separate Monaco setup inside `OfflineWorkbench.tsx`.

That split is already causing capability drift and will keep increasing maintenance cost as SQL editing evolves.

## Goals

- Extract a reusable frontend SQL editor core that both entry points use
- Keep Monaco loading, theme registration, default editor options, SQL formatting, and common keyboard behavior consistent
- Provide a clean extension point for SQL completion providers without forcing every surface to use the same backend data
- Reduce editor-specific code inside `Query.tsx` and `OfflineWorkbench.tsx`
- Preserve current query-page and offline-workbench business semantics

## Non-goals

- Do not merge the query and offline execution chains
- Do not unify result panels, export flows, or offline debugging UI
- Do not change SQL / HiveSQL node business semantics
- Do not add full metadata-driven completion to offline SQL nodes in this first pass
- Do not fold the offline SHELL node editor into this SQL-specific core

## Recommended approach

Create a new shared module at `wb-data-frontend/src/components/sql-editor/` and move SQL-editor-specific infrastructure into it.

The shared layer should own only editor-core responsibilities:

- Monaco lazy loading
- theme registration
- default SQL editor options
- SQL formatting
- shared editor action registration
- optional completion-provider mounting and cleanup

Both query and offline surfaces should keep their own UI shells and business state, but build their editor instances on top of the same core.

This is the safest cut because it maximizes reuse where the issue asks for it, while keeping the existing scene-specific logic intact.

## Module boundary

Add a focused shared package:

- `sqlEditorModule.ts`
  - shared Monaco lazy-load entry
  - replaces the query-specific `queryEditorModule.ts` naming
- `sqlEditorTheme.ts`
  - shared theme registration
  - replaces the query-specific `editorUtils.ts` naming for editor theme work
- `sqlEditorOptions.ts`
  - default SQL editor options
  - lightweight helpers for scenario-specific overrides
- `sqlFormatting.ts`
  - shared SQL formatting helper using `sql-formatter`
- `sqlEditorCore.ts`
  - shared mount-time setup and teardown
  - registers theme, shared actions, and optional completion provider
- `SqlEditor.tsx`
  - thin shared Monaco wrapper component using `lazy(load...) + Suspense`

Responsibility split:

- **shared core**
  - editor infrastructure and shared SQL editing behavior
- **Query page**
  - data source / database context
  - execution shortcuts
  - metadata completion inputs
  - result, export, layout, and sidebar behavior
- **Offline node editor**
  - node data source selection
  - draft persistence
  - dialog lifecycle
  - Flow editing semantics

## Shared editor contract

`SqlEditor` should stay intentionally small and composable.

Suggested prop surface:

- `value`
- `onChange`
- `language`
- `loadingFallback`
- `optionsOverrides`
- `onMountExtras`
- `completionProviderFactory`
- `beforeMount` only if a caller truly needs a low-level escape hatch after the shared theme hook is in place

Behavior:

1. load Monaco through the shared module loader
2. apply shared SQL theme + base options
3. merge scenario-specific option overrides
4. run shared mount setup from `sqlEditorCore`
5. let the caller register extra scene-specific actions and optional completion providers
6. dispose scene-owned registrations on unmount

This keeps the common editor deterministic while still letting query and offline surfaces attach their own behavior.

## Query-page integration

The query page should migrate from a handwritten Monaco mount to the shared core.

Move into the shared layer:

- Monaco lazy loading
- warm-parchment theme registration
- default SQL editor options
- SQL formatting helper
- shared keyboard-action plumbing

Keep in the query page:

- statement-at-cursor execution logic
- `Cmd/Ctrl+Enter` execution behavior
- metadata-driven SQL completion provider creation
- result-panel and export behavior

After the change, `Query.tsx` should mostly provide:

- current SQL value
- query-specific extra action registration
- query completion provider factory
- query-specific loading skeleton / layout wrappers

The query page still owns the richest SQL workflow, but it no longer owns the raw editor infrastructure.

## Offline node-editor integration

The offline workbench should replace the SQL / HiveSQL node Monaco setup with the shared `SqlEditor`.

Keep in `NodeEditorDialog`:

- node identity and dialog chrome
- data source picker and node-kind restrictions
- draft update callbacks
- close / temp-save behaviors

Move out of `OfflineWorkbench.tsx`:

- shared theme setup
- duplicated Monaco options for SQL editing
- SQL-formatting and shared keyboard hooks once they live in the core

First-pass scope for offline SQL / HiveSQL nodes:

- use shared theme and base options
- use shared SQL formatting behavior and shortcut
- keep a completion-provider extension point available
- do not wire full query-style metadata completion yet

SHELL nodes remain on their current editor path in this issue so the SQL core stays focused.

## Shared action model

The core should distinguish between:

- **shared SQL actions**
  - formatting
  - common editor behavior that should be identical across SQL surfaces
- **scene-specific actions**
  - query execution
  - any future offline-only preview or validation actions

Recommended rule:

- shared core always registers formatting
- callers can optionally register extra actions via `onMountExtras`

This prevents query-only behavior from leaking into offline dialogs, while still giving both surfaces identical formatting and common editor ergonomics.

## Completion-provider model

The core should not own metadata fetching or SQL-domain knowledge.

Instead, it should accept an optional `completionProviderFactory(monaco)` callback and manage only:

- registration timing
- replacing an old provider when dependencies change
- cleanup on unmount

Initial usage:

- **Query page** passes the existing metadata-backed SQL completion registration
- **Offline node editor** passes nothing in this issue

This gives the project a stable extension point now without forcing a premature offline completion design.

## Error handling

- Theme registration should stay idempotent so mounting from multiple surfaces is safe
- SQL formatting failures should preserve the current content rather than surfacing a blocking error
- Missing completion providers must be treated as normal, not exceptional
- Shared editor mount / dispose must always clean up provider registrations owned by the core

The goal is to make the shared layer safe to embed in multiple places without cross-surface leakage.

## Testing strategy

Focus testing on the extracted core boundary and on scene-level regressions.

### Shared core tests

Add focused tests for:

1. default SQL editor options merging with overrides
2. SQL formatting helper behavior
3. shared mount setup registering shared actions
4. optional completion-provider registration and disposal

### Query-page regression checks

Verify:

1. formatting still works from the toolbar and keyboard shortcut
2. query execution shortcut still runs the selected SQL / current statement
3. metadata-backed completion still mounts and disposes correctly

### Offline regression checks

Verify:

1. SQL / HiveSQL node dialogs still load the editor and preserve draft updates
2. data source selection behavior stays unchanged
3. shared formatting behavior is available in offline SQL editors
4. SHELL nodes remain unaffected

### Verification gate

Use the existing frontend verification flow after integration:

- targeted tests for any new shared-core units
- `npm test`
- `npm run build`

## Risks and mitigations

- **Risk:** the shared component becomes a second business container  
  **Mitigation:** keep execution, metadata, result, and draft logic in scene-level code

- **Risk:** query-only actions leak into offline dialogs  
  **Mitigation:** separate shared actions from caller-provided `onMountExtras`

- **Risk:** offline SQL completion scope expands mid-change  
  **Mitigation:** freeze the first pass at “completion extension point only”

- **Risk:** SHELL editor behavior gets accidentally folded into SQL logic  
  **Mitigation:** keep SHELL on its existing path in this issue

## Implementation notes

- Favor narrow utilities over a large all-knowing `SqlEditor` component
- Rename query-specific helper files only when the move directly supports the new shared structure
- Keep shared core APIs explicit and scene-driven rather than inferring behavior from page context
- If `Query.tsx` or `OfflineWorkbench.tsx` still need small scene-specific mount helpers after extraction, that is acceptable as long as the core/editor infrastructure no longer lives there
