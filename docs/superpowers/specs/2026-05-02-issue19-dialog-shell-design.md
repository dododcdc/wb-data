# Issue #19 dialog shell and close affordance cleanup

## Problem

Issue #19 remains open because the frontend now has a shared `Dialog` primitive, but dialog presentation still splits across multiple visual systems:

1. standard card dialogs using `dialog-*`
2. offline workbench dialogs with bespoke toolbar / inline close treatments
3. custom close-button implementations inside business dialogs

That leaves visible inconsistency in:

1. overlay and content shell styling,
2. header spacing and title-area rhythm,
3. close button size, placement, hover/focus states, and accessibility semantics,
4. how special dialogs (toolbar-style and full-screen) relate to the shared dialog shell.

## Scope

This spec intentionally covers dialog-shell unification in two layers:

- strengthen `components/ui/dialog.tsx` as the single shared dialog shell
- migrate the most visible business-level close-button outliers onto the same shell rules

In scope:

- `components/ui/dialog.tsx`
- shared dialog CSS in `src/index.css`
- `SaveConflictDialog`
- offline execution dialog inside `OfflineWorkbench`
- `NodeEditorDialog` full-screen shell

Out of scope:

- rewriting every existing dialog into one identical DOM layout
- changing dialog business logic, submit flows, or pending rules beyond what is required to preserve current behavior
- redesigning unrelated components such as `Tooltip`, `Select`, or feedback systems
- broad follow-up cleanup from issues #20 and later

## Design

### 1. Shared shell ownership

`components/ui/dialog.tsx` remains the only base dialog shell.

It will own the visual baseline for:

- overlay
- positioner
- surface/card treatment
- default header spacing
- default footer spacing
- shared close affordance styling

This issue does **not** require every consumer to render the same child structure. Instead, it requires all dialog variants to derive from one consistent shell system.

### 2. Supported dialog forms

The shared shell will explicitly support two dialog forms:

1. **standard modal**
   - centered card dialog
   - default title/header/body/footer rhythm
   - default shell close button when the consumer does not hide it

2. **special shell**
   - still opened and framed by the shared `Dialog` primitives
   - may supply a custom top bar or full-screen header
   - must still reuse the same shell tokens for border, background, close affordance, and spacing intent

This preserves flexibility for `OfflineWorkbench` and `NodeEditorDialog` without leaving them as visually unrelated one-offs.

### 3. Close affordance rules

The system will standardize a single close-affordance pattern:

- consistent icon size and hit area
- consistent hover and focus treatment
- consistent muted/default visual hierarchy
- `aria-label="关闭"`

For ordinary dialogs, the default close affordance continues to come from `DialogContent`.

For dialogs that must place the close affordance inside a custom toolbar or full-screen header:

- they may keep their close button in a custom position
- but the button must reuse the same close-affordance styling contract instead of bespoke business styles

Applied to current outliers:

- `SaveConflictDialog` should stop using a one-off ghost button as its close affordance
- the offline execution dialog should stop using its bespoke inline close button styling
- `NodeEditorDialog` should keep its top-bar close action, but align its styling and interaction treatment with the shared close affordance

### 4. Header and spacing rules

For standard modals:

- `DialogHeader`, `DialogDescription`, `dialog-body`, and `DialogFooter` should produce one consistent spacing rhythm
- consumers should not need per-feature dialog shell CSS for ordinary layout

For special-shell dialogs:

- their toolbar/header may remain custom
- but top border treatment, shell background, and section spacing should align with the shared dialog system instead of feeling like a separate component family

### 5. Behavior preservation

This issue changes presentation structure, not dialog business behavior.

Specifically:

- current close handlers stay with the owning dialog
- current pending disable logic stays with the owning dialog
- current full-screen close flow in `NodeEditorDialog` stays intact
- current action layout and content layout in special dialogs stay intact unless a small structural change is required to adopt the shared shell/close affordance

## Testing

Add or update regression coverage where the shell changes affect observable behavior:

1. dialogs that already have tests should continue to open and close correctly
2. custom close-affordance dialogs should keep their close action wiring intact
3. full-screen `NodeEditorDialog` should still respect its existing close flow
4. offline execution and save-conflict dialogs should preserve current interaction behavior after shell cleanup

Visual uniformity is primarily verified through the shared component structure and CSS usage, but behavior-sensitive dialogs must keep automated coverage green.

## Success criteria

Issue #19 is fixed when:

- `dialog.tsx` clearly defines the shared dialog shell for both standard and special forms
- standard dialogs share one visual shell instead of drifting through per-feature variants
- `SaveConflictDialog`, offline execution dialog, and `NodeEditorDialog` no longer use bespoke close-button styling
- special dialogs still preserve their custom layout needs while aligning to the shared shell system
- existing dialog behavior remains intact and affected tests pass
