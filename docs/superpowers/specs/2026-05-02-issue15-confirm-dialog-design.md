# Issue #15 dangerous confirmation cleanup

## Problem

Issue #15 remains open because `GitSettingsTab` still uses the native `window.confirm` flow for deleting the saved Git configuration, while the rest of the application has already moved destructive actions into app-level dialogs.

This leaves one visible inconsistency in:

1. presentation (browser native confirm vs app dialog),
2. destructive button treatment,
3. pending/loading behavior,
4. close behavior while the request is in flight.

## Scope

This spec intentionally covers only the explicit remaining gap in issue #15:

- replace the Git configuration delete `window.confirm` flow in `GitSettingsTab`

Out of scope:

- refactoring all existing destructive dialogs
- broad `ConfirmDialog` API redesign
- dialog visual unification beyond the Git settings delete flow
- follow-up work from issues #18 or #19

## Design

### 1. Trigger and dialog state

`GitSettingsTab` will stop calling `window.confirm` directly.

Instead:

- clicking `删除配置` opens an in-app `ConfirmDialog`
- the dialog open state is tracked locally inside `GitSettingsTab`
- the existing delete mutation remains the only code path that performs the delete request

### 2. Dialog content

The dialog keeps the existing app pattern for destructive confirmation:

- title: `删除 Git 配置`
- destructive confirm button
- cancel button
- pending state on the confirm button while the request is running

The description should make the consequence explicit:

- deleting the configuration removes the saved credential setup
- future Git operations require re-entering the credential

When configuration data is present, the description should include enough context to reduce accidental deletion, such as the configured provider and username.

### 3. Loading and close behavior

While the delete mutation is pending:

- confirm is disabled
- cancel is disabled
- the dialog cannot be closed through backdrop click or close affordances

After the request completes:

- **success:** close the dialog and keep the current success/reset behavior already implemented in `GitSettingsTab`
- **failure:** keep the dialog open so the user can retry or cancel after the error feedback appears

### 4. Error and success handling

The existing feedback path stays in place:

- success continues to use the current success feedback and form reset behavior
- failure continues to use the current error feedback

This issue changes only the confirmation UI boundary, not the mutation semantics.

## Testing

Add regression coverage for the Git settings delete flow:

1. opening the delete action renders an in-app confirmation dialog
2. the dialog cannot be dismissed while delete is pending
3. delete failure leaves the dialog open
4. delete success closes the dialog

## Success criteria

Issue #15 is fixed when:

- `GitSettingsTab` no longer uses `window.confirm`
- deleting Git configuration uses the shared app confirmation dialog
- pending delete state disables dialog dismissal
- failure/success close behavior matches this spec
- regression tests cover the Git settings delete flow
