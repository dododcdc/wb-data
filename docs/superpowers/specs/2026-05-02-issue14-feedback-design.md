# Issue #14 feedback fixes

## Problem

Issue #14 is still open because two user-facing failure paths remain unclear:

1. `AddMemberDialog` treats member-search failures like empty results, so users cannot distinguish "no matches" from "request failed".
2. Query export download failures still fall back to `console.error`, so users do not receive actionable feedback when a completed export cannot be downloaded.

## Scope

This spec only covers the two behaviors explicitly in scope for issue #14:

- `AddMemberDialog` member search feedback
- Query export/download failure feedback

Out of scope:

- broader feedback unification across the app
- redesigning the query export UI
- refactoring async search controls beyond what is needed for clear error display

## Design

### 1. AddMemberDialog search feedback

`AddMemberDialog` will keep its current search field and dropdown structure, but introduce an explicit `searchError` state.

Behavior:

- When a search request succeeds, clear `searchError`, update the user list, and show the dropdown.
- When a search request fails, clear the user list, set `searchError` to `搜索失败，请稍后重试`, and keep the dropdown open so the failure is visible in-context.
- When the input changes, is cleared, or a user is selected/cleared, clear any previous `searchError`.
- When there is no keyword, do not show an error; reset to the neutral empty state.

Rendering rules:

- `loading === true` -> show the existing loading state
- `searchError !== null` -> show the explicit error message
- `users.length === 0` -> show the existing "未找到匹配的用户" empty state
- otherwise -> show user options

This preserves the existing interaction model while making failure visible and distinguishable from "no results".

### 2. Query export and download failure feedback

The query page already has inline export-task creation feedback through `exportState`. That structure stays in place.

Behavior:

- **Create export task failure:** keep using `exportState` inline feedback in the export menu. No UI redesign is needed.
- **Download export task failure:** replace the current `console.error`-only path with user-visible feedback.

Download failure messaging:

- Prefer server-provided error text when available.
- Otherwise show a fallback such as `导出文件下载失败，请稍后重试。`

Implementation approach:

- Reuse the existing operation feedback pattern already used elsewhere in the frontend instead of introducing a new download-only surface.
- Thread the feedback dependency into the query export logic with the smallest possible change.

## Testing

Add regression coverage for the exact issue scope:

1. `AddMemberDialog`
   - shows `搜索失败，请稍后重试` when member search fails
   - clears that error when the search input is cleared or retried successfully
2. Query export
   - shows user-visible feedback when export download fails

## Success criteria

Issue #14 is considered fixed when:

- member search failures in `AddMemberDialog` are visibly different from empty search results
- query export download failures are visible to users without relying on the console
- the relevant tests pass and the frontend verification commands remain green
