# Issue #18 remaining destructive confirmation cleanup

## Problem

Issue #18 remains open because the application already has a shared `ConfirmDialog`, but the offline workbench still keeps two destructive confirmation flows on bespoke `Dialog` implementations:

1. deleting a Flow
2. deleting a folder

That leaves one visible inconsistency in:

1. destructive confirmation presentation,
2. pending/loading treatment,
3. close behavior during in-flight deletion,
4. reuse of the shared app confirmation pattern.

## Scope

This spec intentionally covers only the remaining destructive confirmation scenes that fit the shared `ConfirmDialog` pattern inside `OfflineWorkbench`:

- replace the custom delete Flow dialog with `ConfirmDialog`
- replace the custom delete folder dialog with `ConfirmDialog`

Out of scope:

- `SaveConflictDialog`
- rename Flow dialog
- rename folder dialog
- broader refactoring of offline workbench dialog state
- `ConfirmDialog` redesign unless implementation proves a missing capability
- follow-up cleanup from issue #19

## Design

### 1. Trigger and dialog state

`OfflineWorkbench` will stop rendering bespoke destructive delete dialogs for Flow and folder deletion.

Instead:

- clicking delete for a Flow opens a shared `ConfirmDialog`
- clicking delete for a folder opens a shared `ConfirmDialog`
- each dialog keeps its current local open state and target metadata (`name`, `path`)
- the existing delete handlers remain the only code paths that perform the actual delete requests

### 2. Dialog content

The shared dialog keeps the current destructive semantics for each action:

- destructive confirm button
- cancel button
- explicit irreversible warning in the description

The dialog text remains action-specific:

- Flow delete mentions the selected Flow name
- folder delete mentions the selected folder name and keeps the stronger warning that all nested content will be physically removed

### 3. Loading and close behavior

While a delete request is pending:

- confirm is disabled
- cancel is disabled
- the dialog cannot be closed through `onOpenChange`

After the request completes:

- **success:** close the dialog and preserve the existing success feedback / refresh behavior
- **failure:** keep the dialog open and preserve the existing error feedback so the user can retry or cancel

This issue changes only the confirmation shell, not the underlying delete semantics.

## Testing

Add regression coverage for the two remaining destructive confirmation flows in the offline workbench:

1. deleting a Flow opens the shared confirmation dialog
2. deleting a folder opens the shared confirmation dialog
3. pending deletion prevents dialog dismissal
4. delete failure keeps the dialog open
5. delete success closes the dialog

## Success criteria

Issue #18 is fixed when:

- delete Flow uses the shared `ConfirmDialog`
- delete folder uses the shared `ConfirmDialog`
- both pending states disable dismissal
- both success/failure close behaviors match this spec
- regression coverage exists for the migrated destructive flows
