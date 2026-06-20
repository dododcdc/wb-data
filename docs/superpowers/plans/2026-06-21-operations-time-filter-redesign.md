# Operations Time Filter Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected operations time picker with a new `react-day-picker` based filter that supports precise browser-local timestamps and complete desktop dual-month range selection.

**Architecture:** Delete the old shared `TimeRangePicker` implementation and create an operations-specific `OperationsTimeFilter` beside `OperationsCenter`. The component owns draft state inside a Base UI popover, separates preset and custom modes, and only calls the existing `onChange(from, to)` boundary after explicit Apply.

**Tech Stack:** React 18, TypeScript, `react-day-picker` 8.10, Base UI Popover, date-fns zh-CN locale, Vitest, Testing Library, CSS design tokens.

---

## File map

- Delete `wb-data-frontend/src/components/TimeRangePicker.tsx`: rejected implementation.
- Delete `wb-data-frontend/src/components/TimeRangePicker.css`: rejected styles.
- Delete `wb-data-frontend/src/components/TimeRangePicker.test.tsx`: tests coupled to rejected interaction.
- Create `wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx`: new draft state, modes, exact inputs, dual-month calendar and apply boundary.
- Create `wb-data-frontend/src/views/operations/OperationsTimeFilter.css`: compact warm visual treatment and responsive layout.
- Create `wb-data-frontend/src/views/operations/OperationsTimeFilter.test.tsx`: behavior and regression tests.
- Modify `wb-data-frontend/src/views/operations/OperationsCenter.tsx`: replace component import and rendering.
- Modify `wb-data-frontend/src/views/operations/OperationsCenter.test.tsx`: mock the new component boundary.
- Modify `wb-data-frontend/src/views/operations/OperationsCenter.css`: allocate sufficient trigger width without changing the rest of the filter grid.

### Task 1: Establish the new public boundary with a failing integration test

**Files:**
- Modify: `wb-data-frontend/src/views/operations/OperationsCenter.test.tsx`

- [ ] **Step 1: Replace the old mock with the desired module boundary**

```tsx
vi.mock('./OperationsTimeFilter', () => ({
    OperationsTimeFilter: ({ from, to, onChange }: {
        from: string;
        to: string;
        onChange: (from: string, to: string) => void;
    }) => (
        <div data-testid="mock-operations-time-filter">
            <span data-testid="range-from">{from}</span>
            <span data-testid="range-to">{to}</span>
            <button type="button" onClick={() => onChange('2026-06-07 01:00:15', '2026-06-07 02:00:45')}>
                应用测试时间范围
            </button>
        </div>
    ),
}));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsCenter.test.tsx`

Expected: FAIL because `OperationsCenter` still imports `../../components/TimeRangePicker`, so the desired new boundary is unused.

- [ ] **Step 3: Change the page import and element**

```tsx
import { OperationsTimeFilter } from './OperationsTimeFilter';

<OperationsTimeFilter
    from={fromFilter}
    to={toFilter}
    onChange={(from, to) => {
        setFromFilter(from);
        setToFilter(to);
    }}
/>
```

- [ ] **Step 4: Create only the minimum exported component shell needed for compilation**

```tsx
export interface OperationsTimeFilterProps {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
}

export function OperationsTimeFilter({ from, to }: OperationsTimeFilterProps) {
    return <button type="button">{from} → {to}</button>;
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsCenter.test.tsx`

Expected: all OperationsCenter tests PASS.

- [ ] **Step 6: Commit the boundary change**

```bash
git add wb-data-frontend/src/views/operations/OperationsCenter.tsx wb-data-frontend/src/views/operations/OperationsCenter.test.tsx wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx
git commit -m "refactor(operations): replace time filter boundary"
```

### Task 2: Build preset draft behavior from failing component tests

**Files:**
- Create: `wb-data-frontend/src/views/operations/OperationsTimeFilter.test.tsx`
- Modify: `wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx`

- [ ] **Step 1: Write tests for exact trigger text, preset drafts, cancel and Apply**

```tsx
it('shows the exact applied range and keeps presets as drafts until Apply', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 5, 21, 12, 0, 0).getTime());
    const onChange = vi.fn();
    render(<OperationsTimeFilter from="2025-12-28 08:30:00" to="2026-01-03 18:45:30" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /2025-12-28 08:30:00.*2026-01-03 18:45:30/ }));
    fireEvent.click(await screen.findByRole('button', { name: '最近 7 天' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('2026-06-14 12:00:00')).toBeTruthy();
    expect(screen.getByText('2026-06-21 12:00:00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(onChange).toHaveBeenCalledWith('2026-06-14 12:00:00', '2026-06-21 12:00:00');
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx`

Expected: FAIL because the shell has no popover, mode selector, draft or Apply behavior.

- [ ] **Step 3: Implement the popover, modes and preset draft model**

Use `PopoverPrimitive.Root`, `Trigger`, `Portal`, `Positioner` and `Popup`. On open, parse the applied props with `parseLocalDateTime`; initialize `draftStart`, `draftEnd`, `mode='quick'`, and `activePreset`. Preset buttons update dates using `Date.now()` but do not call `onChange`. Apply formats with `formatLocalDateTime`, calls `onChange`, and closes.

- [ ] **Step 4: Run the component test and verify GREEN**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit preset behavior**

```bash
git add wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx wb-data-frontend/src/views/operations/OperationsTimeFilter.test.tsx
git commit -m "feat(operations): add time filter preset drafts"
```

### Task 3: Add controlled desktop dual-month range selection

**Files:**
- Modify: `wb-data-frontend/src/views/operations/OperationsTimeFilter.test.tsx`
- Modify: `wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx`

- [ ] **Step 1: Write failing dual-month and cross-year tests**

```tsx
it('shows two consecutive months and supports a December to January range', async () => {
    const onChange = vi.fn();
    render(<OperationsTimeFilter from="2025-12-28 08:30:00" to="2026-01-03 18:45:30" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /2025-12-28 08:30:00/ }));
    fireEvent.click(await screen.findByRole('tab', { name: '自定义范围' }));

    expect(screen.getByText('2025年12月')).toBeTruthy();
    expect(screen.getByText('2026年1月')).toBeTruthy();
    expect(screen.getAllByRole('grid')).toHaveLength(2);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx`

Expected: FAIL because the custom mode and calendars do not exist.

- [ ] **Step 3: Implement the calendar with explicit navigation**

Render `DayPicker` with `mode="range"`, `locale={zhCN}`, `month={visibleMonth}`, `numberOfMonths={compact ? 1 : 2}`, `fixedWeeks`, `showOutsideDays`, and a controlled `onDayClick`. Render year and month selects for the left month plus previous/next buttons. Preserve time parts when dates change and normalize earlier second clicks into chronological order.

- [ ] **Step 4: Run the component tests and verify GREEN**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx`

Expected: PASS with two grids on desktop and December/January captions.

- [ ] **Step 5: Commit dual-month behavior**

```bash
git add wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx wb-data-frontend/src/views/operations/OperationsTimeFilter.test.tsx
git commit -m "feat(operations): add dual month range selection"
```

### Task 4: Add exact date-time editing and validation

**Files:**
- Modify: `wb-data-frontend/src/views/operations/OperationsTimeFilter.test.tsx`
- Modify: `wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx`

- [ ] **Step 1: Write failing tests for direct entry and reversed ranges**

```tsx
it('applies directly entered second-precision values', async () => {
    const onChange = vi.fn();
    render(<OperationsTimeFilter from="2026-01-01 00:00:00" to="2026-01-02 00:00:00" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /2026-01-01 00:00:00/ }));
    fireEvent.click(await screen.findByRole('tab', { name: '自定义范围' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-12-31' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '23:59:58' } });
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(onChange).toHaveBeenCalledWith('2025-12-31 23:59:58', '2026-01-02 00:00:00');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx`

Expected: FAIL because exact inputs are absent.

- [ ] **Step 3: Implement exact fields and validation**

Add labelled `type="text"` inputs with placeholders `yyyy-MM-dd` and `HH:mm:ss`. Combine each pair into the existing local date-time parser; show `请输入有效的开始时间`, `请输入有效的结束时间`, or `开始时间不能晚于结束时间`. Disable Apply while invalid. Valid edits synchronize `DateRange` and visible month.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit exact editing**

```bash
git add wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx wb-data-frontend/src/views/operations/OperationsTimeFilter.test.tsx
git commit -m "feat(operations): add precise time range editing"
```

### Task 5: Replace rejected styling and remove all old picker files

**Files:**
- Create: `wb-data-frontend/src/views/operations/OperationsTimeFilter.css`
- Modify: `wb-data-frontend/src/views/operations/OperationsTimeFilter.tsx`
- Modify: `wb-data-frontend/src/views/operations/OperationsCenter.css`
- Delete: `wb-data-frontend/src/components/TimeRangePicker.tsx`
- Delete: `wb-data-frontend/src/components/TimeRangePicker.css`
- Delete: `wb-data-frontend/src/components/TimeRangePicker.test.tsx`

- [ ] **Step 1: Add a responsive test before styles**

Set `window.matchMedia('(max-width: 720px)')` to match and assert custom mode renders one calendar grid; set it to false and assert two grids.

- [ ] **Step 2: Run and verify RED**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx`

Expected: FAIL until the component responds to the media query.

- [ ] **Step 3: Implement responsive state and the new stylesheet**

Use new `operations-time-filter__*` classes only. Set desktop popup width to `min(760px, calc(100vw - 24px))`, give each DayPicker month an independent `minmax(0, 1fr)` column, and limit popup height to `calc(100vh - 24px)`. Use warm design tokens, 40px controls, terracotta range endpoints, soft range middle, tabular numeric text, and a single-column layout below 720px.

- [ ] **Step 4: Remove the old implementation completely**

Delete all three `TimeRangePicker` files and verify no source reference remains:

Run: `rg -n "TimeRangePicker|time-range-picker__" wb-data-frontend/src`

Expected: no output.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cd wb-data-frontend && npm run test -- src/views/operations/OperationsTimeFilter.test.tsx src/views/operations/OperationsCenter.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the replacement**

```bash
git add -A wb-data-frontend/src/components/TimeRangePicker.tsx wb-data-frontend/src/components/TimeRangePicker.css wb-data-frontend/src/components/TimeRangePicker.test.tsx wb-data-frontend/src/views/operations
git commit -m "style(operations): replace time filter interface"
```

### Task 6: Full verification and browser acceptance

**Files:**
- Modify only if verification reveals a defect in the files listed above.

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd wb-data-frontend && npm run test`

Expected: all tests PASS.

- [ ] **Step 2: Run lint and production build**

Run: `cd wb-data-frontend && npm run lint && npm run build`

Expected: exit code 0; no new lint errors; production build completes.

- [ ] **Step 3: Start or reuse the feature preview and inspect in-browser**

Open the operations page, then verify: exact trigger fits the filter row; popup stays inside the viewport; both months are complete; December/January selection works; exact inputs apply seconds; Cancel leaves the applied range unchanged; narrow viewport shows one month.

- [ ] **Step 4: Confirm the old code is absent**

Run: `rg -n "TimeRangePicker|time-range-picker__" wb-data-frontend/src || true`

Expected: no matches.

- [ ] **Step 5: Commit any verified corrections**

```bash
git add wb-data-frontend/src/views/operations
git commit -m "fix(operations): complete time filter browser verification"
```
