# Bulk Member Addition Design

## Problem

The current Group Settings "Add Member" dialog only supports adding one user at a time. This creates repetitive work when a project owner needs to add several members with the same role. The current search results also show `displayName`, which can be mistaken for a project-group role and adds noise during selection.

## Goals

- Support adding multiple members in one submission from the Group Settings dialog.
- Keep a single shared role selector for all selected members.
- Show only usernames in the candidate list to avoid role-related confusion.
- Preserve existing single-select behavior in other places such as query data source selection.
- Keep batch add semantics atomic: all selected members are added successfully, or none are.

## Non-Goals

- No per-member role assignment in the same batch.
- No changes to query data source selection behavior.
- No change to the current search-first rule in the add-member dialog.
- No partial-success batch add behavior.

## User Experience

### Dialog behavior

The existing "添加成员" dialog becomes a batch-add dialog while keeping the same overall layout:

- A multi-select user search field replaces the current single-select member picker.
- Search results show **username only**.
- Selecting a candidate adds it to the **selected-members tag area**.
- The tag area supports:
  - removing a single selected member
  - clearing all selected members
- After a user is selected:
  - the search input is cleared
  - focus stays in the input
  - the dropdown stays open so the operator can continue selecting
- The role selector remains single-value and applies to the entire batch.
- The submit button reflects quantity, for example:
  - `添加 1 名成员`
  - `添加 3 名成员`

### Search behavior

- The dialog remains **search-first**.
- No candidates are shown before input.
- Search results continue excluding:
  - users already in the current project group
  - `SYSTEM_ADMIN`
  - inactive users

### Submission behavior

- Submitting with an empty selection is disabled.
- Batch submission is **all-or-nothing**.
- If any selected user becomes invalid before submission, the entire operation fails and the dialog shows the returned error.

## Component Design

### Keep single-select isolated

The existing `SearchSelect` remains a single-select component. Its API and behavior stay unchanged so existing consumers such as `DataSourceSelect` are not affected.

### New `MultiSearchSelect`

A new `MultiSearchSelect` component is introduced for batch member selection.

Responsibilities:

- manage multiple selected values
- render selected-member tags
- support remove-one and clear-all actions
- keep the popup open across repeated selections
- clear the input after each successful selection
- reuse the existing combobox popup styling and interaction primitives where possible

This avoids overloading `SearchSelect` with two substantially different selection models and minimizes regression risk for current single-select flows.

### `AddMemberDialog` changes

`AddMemberDialog` becomes the integration layer for:

- debounced user search
- mapping available users to `MultiSearchSelect` options
- role selection
- submit button enablement and quantity label
- batch submission error display

The selected members state changes from:

- `selectedUser: AvailableUser | null`

to:

- `selectedUsers: AvailableUser[]`

## Backend/API Design

### New batch add contract

Introduce a batch add API dedicated to this flow. The request shape is:

```json
{
  "userIds": [12, 18, 25],
  "role": "DEVELOPER"
}
```

The backend processes the request in a single transaction.

### Validation rules

For each requested user, the service must reject the entire batch if any item is:

- missing
- inactive
- already a member of the current group
- `SYSTEM_ADMIN`

The role value must still be validated against supported group roles.

### Atomicity

The backend uses one transactional service operation so the batch is committed only when all validations pass. No partial insertions are allowed.

## Error Handling

### Frontend

- Keep inline dialog error messaging for search failures.
- Add a submission error area for batch add failures returned by the backend.
- Do not silently drop invalid selections.

### Backend

- Return explicit validation errors for invalid batch submissions.
- Prefer clear messages that indicate why the batch failed, for example:
  - selected user already belongs to the project group
  - selected user is disabled
  - `SYSTEM_ADMIN` does not need project-group membership

## Testing Strategy

### Frontend

Add focused tests for:

1. `MultiSearchSelect`
   - selecting multiple users
   - removing one selected user
   - clearing all selected users
   - keeping popup interaction stable inside dialogs
2. `AddMemberDialog`
   - submit button disabled when no users are selected
   - quantity-based submit label
   - shared role application
   - batch submit payload generation
   - error rendering on batch submission failure

### Backend

Add service/controller tests for:

1. successful batch add
2. atomic failure when one user is invalid
3. rejecting `SYSTEM_ADMIN`
4. rejecting existing members
5. rejecting inactive or missing users

## Risks and Mitigations

### Risk: Breaking other searchable dropdowns

Mitigation:

- keep `SearchSelect` unchanged
- introduce a separate `MultiSearchSelect`
- reuse lower-level combobox primitives rather than changing single-select semantics

### Risk: Confusing result states during repeated selection

Mitigation:

- clear the input after each selection
- retain focus for continued searching
- show current selections as explicit tags

## Success Criteria

- Operators can add multiple users in one dialog submission.
- Existing single-select searchable dropdowns behave exactly as before.
- Candidate items show only usernames.
- Batch add is atomic and validated server-side.
