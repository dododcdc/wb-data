# Operations Time Range Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the operations center's basic time-range select and native datetime inputs with an explicit browser-time-zone range picker that supports cross-month/year navigation, second precision, draft confirmation, responsive layout, and full-year task timestamps.

**Architecture:** Keep applied values in `OperationsCenter` as local `yyyy-MM-dd HH:mm:ss` strings and convert them to UTC only when building API parameters. Put date parsing, local formatting, timezone labels, range duration, and validation in a small shared utility module. Build the picker as a controlled component with internal draft state; only its Apply action calls `onChange`.

**Tech Stack:** React 18, TypeScript, Base UI Popover, react-day-picker 8, date-fns locale data, Vitest, Testing Library, CSS design tokens.

---

## File map

- Create `wb-data-frontend/src/lib/dateTime.ts`: browser-local parsing, formatting, timezone offset, duration, and validation helpers.
- Create `wb-data-frontend/src/lib/dateTime.test.ts`: deterministic tests for local parsing, leap dates, invalid values, formatting, and duration.
- Create `wb-data-frontend/src/components/TimeRangePicker.tsx`: controlled applied value plus internal draft calendar/time interaction.
- Create `wb-data-frontend/src/components/TimeRangePicker.css`: warm-token calendar styling, composite time controls, and responsive layouts.
- Create `wb-data-frontend/src/components/TimeRangePicker.test.tsx`: draft/apply/cancel, presets, direct year/month navigation, summary, errors, and accessibility.
- Modify `wb-data-frontend/src/views/operations/OperationsCenter.tsx`: replace the select/native inputs, keep local applied range, and submit UTC.
- Modify `wb-data-frontend/src/views/operations/OperationsCenter.css`: give the range field stable space and remove mobile implicit columns.
- Modify `wb-data-frontend/src/views/operations/OperationsCenter.test.tsx`: test picker integration, reset, UTC query values, and full-year rendering.
- Modify `wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.tsx`: use the shared full browser-local formatter.
- Modify `wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.test.tsx`: assert full-year execution timestamps.
- Modify `wb-data-frontend/package.json` and `wb-data-frontend/package-lock.json`: add the calendar dependencies used by the approved prototype.

### Task 1: Browser-local date/time utilities

**Files:**
- Create: `wb-data-frontend/src/lib/dateTime.ts`
- Create: `wb-data-frontend/src/lib/dateTime.test.ts`

- [ ] **Step 1: Write failing utility tests**

Add tests covering explicit local parsing, invalid dates, leap day, formatting with year and seconds, UTC offset labels, range duration, and reversed ranges:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatBrowserDateTime,
  formatLocalDateTime,
  formatRangeDuration,
  getUtcOffsetLabel,
  parseLocalDateTime,
  validateLocalRange,
} from './dateTime';

describe('dateTime', () => {
  it('round-trips a valid browser-local second-precision value', () => {
    const value = '2024-02-29 08:30:05';
    expect(formatLocalDateTime(parseLocalDateTime(value)!)).toBe(value);
  });

  it('rejects impossible or malformed local values', () => {
    expect(parseLocalDateTime('2025-02-29 08:30:05')).toBeNull();
    expect(parseLocalDateTime('2025-01-01T08:30')).toBeNull();
  });

  it('formats API instants with a full browser-local year and seconds', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatBrowserDateTime(date.toISOString())).toBe('2026-01-02 03:04:05');
  });

  it('formats UTC offsets and elapsed range duration', () => {
    const start = new Date(2026, 0, 1, 0, 0, 0);
    const end = new Date(start.getTime() + 90_061_000);
    expect(getUtcOffsetLabel(start)).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    expect(formatRangeDuration(start, end)).toBe('1天 1小时 1分 1秒');
  });

  it('rejects reversed ranges', () => {
    expect(validateLocalRange('2026-01-02 00:00:00', '2026-01-01 23:59:59'))
      .toBe('开始时间不能晚于结束时间');
  });
});
```

- [ ] **Step 2: Run the utility tests and verify red**

Run: `npm test -- --run src/lib/dateTime.test.ts`

Expected: FAIL because `./dateTime` does not exist.

- [ ] **Step 3: Implement the utility API**

Implement these exported contracts in `dateTime.ts`:

```ts
export type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function parseLocalDateTime(value: string): Date | null;
export function formatLocalDateTime(date: Date): string;
export function formatBrowserDateTime(value: string | Date | null | undefined): string;
export function getBrowserTimeZoneName(): string;
export function getUtcOffsetLabel(date: Date): string;
export function formatRangeDuration(start: Date, end: Date): string;
export function validateLocalRange(from: string, to: string): string | null;
```

Use a strict regular expression for `yyyy-MM-dd HH:mm:ss`, construct with `new Date(year, month - 1, ...)`, and compare every resulting local component back to the input. Do not pass the local string to `Date.parse`.

- [ ] **Step 4: Run utility tests and verify green**

Run: `npm test -- --run src/lib/dateTime.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Commit utility work**

```bash
git add wb-data-frontend/src/lib/dateTime.ts wb-data-frontend/src/lib/dateTime.test.ts
git commit -m "feat(operations): add browser-local date time utilities"
```

### Task 2: Draft-based range picker behavior

**Files:**
- Create: `wb-data-frontend/src/components/TimeRangePicker.tsx`
- Create: `wb-data-frontend/src/components/TimeRangePicker.test.tsx`
- Modify: `wb-data-frontend/package.json`
- Modify: `wb-data-frontend/package-lock.json`

- [ ] **Step 1: Add calendar dependencies**

Run: `npm install react-day-picker@8.10.2 date-fns@^3.6.0`

Expected: `package.json` and lockfile include both dependencies without unrelated upgrades.

- [ ] **Step 2: Write failing picker tests**

Cover these observable contracts:

```tsx
render(
  <TimeRangePicker
    from="2025-12-28 08:30:00"
    to="2026-01-03 18:45:30"
    onChange={onChange}
  />
);

fireEvent.click(screen.getByRole('button', { name: /时间范围/ }));
expect(screen.getByText('选择时间范围')).toBeTruthy();
expect(screen.getByText('2025-12-28 08:30:00')).toBeTruthy();
expect(screen.getByText('2026-01-03 18:45:30')).toBeTruthy();
expect(screen.getByText(/浏览器时区/)).toBeTruthy();

fireEvent.click(screen.getByRole('button', { name: '最近 7 天' }));
expect(onChange).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole('button', { name: '应用' }));
expect(onChange).toHaveBeenCalledTimes(1);
```

Add separate tests for:

- Cancel and Escape discard draft changes.
- Year and month controls can jump from December 2025 to January 2024.
- Selecting a start date without an end shows “请选择结束日期” and disables Apply.
- Hour/minute/second segments accept direct input and arrow keys.
- Reversed local timestamps show the inline error and disable Apply.
- Trigger accessible name includes both applied timestamps and timezone.

- [ ] **Step 3: Run picker tests and verify red**

Run: `npm test -- --run src/components/TimeRangePicker.test.tsx`

Expected: FAIL because `TimeRangePicker` does not exist.

- [ ] **Step 4: Implement picker state and interactions**

Use this controlled boundary:

```ts
export interface TimeRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}
```

Implementation requirements:

- Initialize internal draft dates and segments from props every time the popover opens.
- Keep `activePreset` as explicit state; clear it after manual date/time edits.
- Presets update draft only and use the click-time `Date.now()` snapshot.
- Render two consecutive months above 760px and one month below 760px using `matchMedia`.
- Use direct year/month select controls to update the left anchor month; support years 2000 through next year.
- Provide a Today control that changes the visible anchor month without mutating the selected draft range.
- First custom day click starts a new range with `00:00:00` and pending end; second completes it with `23:59:59` and chronological ordering.
- Build a composite Start and End `HH:mm:ss` control with individually labelled numeric segments.
- Ignore wheel-based changes on time segments to prevent accidental edits while scrolling.
- Show exact start/end values, duration, IANA browser timezone, and UTC offsets in a persistent summary.
- Show separate Start and End UTC offsets when the selected dates cross a daylight-saving offset change.
- Apply calls `onChange` only when the range is complete and valid.
- Cancel, outside click, and Escape close without calling `onChange`.
- Remove browser `alert`; use an `aria-live="polite"` inline message.
- If externally supplied applied values are invalid, expose an invalid trigger state and initialize an editable last-24-hours draft without submitting it.

- [ ] **Step 5: Run picker tests and verify green**

Run: `npm test -- --run src/components/TimeRangePicker.test.tsx`

Expected: all picker tests pass.

- [ ] **Step 6: Commit picker behavior and dependencies**

```bash
git add wb-data-frontend/package.json wb-data-frontend/package-lock.json wb-data-frontend/src/components/TimeRangePicker.tsx wb-data-frontend/src/components/TimeRangePicker.test.tsx
git commit -m "feat(operations): add draft-based time range picker"
```

### Task 3: Picker visual system and responsive behavior

**Files:**
- Create: `wb-data-frontend/src/components/TimeRangePicker.css`
- Modify: `wb-data-frontend/src/components/TimeRangePicker.tsx`

- [ ] **Step 1: Add stable semantic class hooks**

Ensure the component exposes class hooks for the trigger, popup, presets, toolbar, calendars, time rows, summary, error, and footer. Import `react-day-picker/dist/style.css` before `TimeRangePicker.css` so project styles override dependency defaults.

- [ ] **Step 2: Implement warm-token and responsive CSS**

Required CSS outcomes:

```css
.time-range-picker__calendar {
  --rdp-accent-color: var(--color-accent-emphasis);
  --rdp-background-color: var(--color-accent-soft);
  --rdp-selected-color: var(--color-bg-primary);
}

.time-range-picker__time-segment,
.time-range-picker__preset,
.time-range-picker__action {
  min-height: 40px;
}

@media (max-width: 760px) {
  .time-range-picker__popup { width: min(100vw - 24px, 420px); }
  .time-range-picker__body { grid-template-columns: 1fr; }
  .time-range-picker__time-row { align-items: stretch; flex-direction: column; }
  .time-range-picker__time-segment,
  .time-range-picker__preset,
  .time-range-picker__action { min-height: 44px; }
}
```

Also remove DayPicker's default margin, use tabular numerals, provide visible focus rings, make the summary a quiet confirmation surface, and prevent popup overflow with max-width/max-height and internal scrolling.

- [ ] **Step 3: Run focused tests, build, and lint**

Run:

```bash
npm test -- --run src/components/TimeRangePicker.test.tsx
npm run build
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit visual work**

```bash
git add wb-data-frontend/src/components/TimeRangePicker.tsx wb-data-frontend/src/components/TimeRangePicker.css
git commit -m "style(operations): refine time range picker layout"
```

### Task 4: Operations center integration

**Files:**
- Modify: `wb-data-frontend/src/views/operations/OperationsCenter.tsx`
- Modify: `wb-data-frontend/src/views/operations/OperationsCenter.css`
- Modify: `wb-data-frontend/src/views/operations/OperationsCenter.test.tsx`

- [ ] **Step 1: Replace old integration tests with failing applied-range tests**

Mock `TimeRangePicker` as a controlled component and assert:

```tsx
expect(listOperationsExecutionsMock).toHaveBeenLastCalledWith(
  expect.objectContaining({
    from: new Date('2026-06-07T01:00:15').toISOString(),
    to: new Date('2026-06-07T02:00:45').toISOString(),
  })
);
```

Cover default last-24-hours initialization, Apply-driven query changes, Reset restoring last 24 hours, and table values containing `2026-`.

- [ ] **Step 2: Run integration test and verify red**

Run: `npm test -- --run src/views/operations/OperationsCenter.test.tsx`

Expected: FAIL because the page still renders `time-range-select` and native datetime inputs.

- [ ] **Step 3: Integrate the picker**

Make these changes:

- Initialize `fromFilter` and `toFilter` to browser-local now minus 24 hours and now.
- Remove `timeRange` and the native `datetime-local` fields.
- Render `TimeRangePicker` in a named full-width responsive grid class.
- Convert applied local values to UTC with `parseLocalDateTime(value)?.toISOString()` in the query payload.
- Rename Clear to Reset and restore branch, task, status, and last-24-hours range.
- Use `formatBrowserDateTime` for table timestamps.
- Replace inline grid styles with `.operations-filter__field--time-range` and set `grid-column: 1 / -1` below 760px.

- [ ] **Step 4: Run integration test and verify green**

Run: `npm test -- --run src/views/operations/OperationsCenter.test.tsx`

Expected: all operations center tests pass.

- [ ] **Step 5: Commit integration**

```bash
git add wb-data-frontend/src/views/operations/OperationsCenter.tsx wb-data-frontend/src/views/operations/OperationsCenter.css wb-data-frontend/src/views/operations/OperationsCenter.test.tsx
git commit -m "feat(operations): integrate precise time range filtering"
```

### Task 5: Full-year detail timestamps

**Files:**
- Modify: `wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.tsx`
- Modify: `wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.test.tsx`

- [ ] **Step 1: Add a failing full-year assertion**

Use a stable local `Date` fixture and assert the rendered Start and End metrics contain `yyyy-MM-dd HH:mm:ss`, including the year.

- [ ] **Step 2: Run detail test and verify red**

Run: `npm test -- --run src/views/operations/OperationsExecutionDetailPage.test.tsx`

Expected: FAIL because the existing formatter omits the year.

- [ ] **Step 3: Replace the local formatter**

Import `formatBrowserDateTime` from `../../lib/dateTime` and use it for execution and task timestamps. Keep log timestamps time-only because they are read in the context of one execution.

- [ ] **Step 4: Run detail test and verify green**

Run: `npm test -- --run src/views/operations/OperationsExecutionDetailPage.test.tsx`

Expected: all detail tests pass.

- [ ] **Step 5: Commit detail formatting**

```bash
git add wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.tsx wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.test.tsx
git commit -m "fix(operations): show full browser-local execution dates"
```

### Task 6: Final verification and visual review

**Files:**
- Modify only files required by issues discovered during verification.

- [ ] **Step 1: Run the complete frontend verification suite**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: 0 failed tests, 0 lint errors, production build exit 0.

- [ ] **Step 2: Run deterministic UI scan**

Run:

```bash
npx impeccable --json src/components/TimeRangePicker.tsx
npx impeccable --json src/views/operations/OperationsCenter.tsx
```

Expected: no unresolved P0/P1 interface findings; document any false positives.

- [ ] **Step 3: Start the worktree Vite server**

Run: `npm run dev -- --host 127.0.0.1 --port 5174`

Expected: Vite serves the feature worktree at `http://127.0.0.1:5174` without replacing the main workspace server on port 5173.

- [ ] **Step 4: Visually inspect desktop and narrow layouts**

Verify:

- Applied range is never truncated.
- Desktop shows consecutive months and direct year/month navigation.
- Draft summary updates before Apply.
- Presets do not submit immediately.
- Cancel and Escape preserve the applied value.
- Narrow layout has one month, no horizontal overflow, and 44px targets.
- Warm selection colors replace dependency blue.

- [ ] **Step 5: Commit verification fixes if required**

```bash
git add wb-data-frontend/src/components/TimeRangePicker.tsx wb-data-frontend/src/components/TimeRangePicker.css wb-data-frontend/src/components/TimeRangePicker.test.tsx wb-data-frontend/src/lib/dateTime.ts wb-data-frontend/src/lib/dateTime.test.ts wb-data-frontend/src/views/operations/OperationsCenter.tsx wb-data-frontend/src/views/operations/OperationsCenter.css wb-data-frontend/src/views/operations/OperationsCenter.test.tsx wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.tsx wb-data-frontend/src/views/operations/OperationsExecutionDetailPage.test.tsx
git commit -m "fix(operations): address time picker verification findings"
```

Skip this commit when verification requires no changes.
