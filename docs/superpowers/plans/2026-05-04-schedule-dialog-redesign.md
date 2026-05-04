# Schedule Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite ScheduleDialog to cron-only mode with enable switch in title bar, next-3-executions preview, and improved UX.

**Architecture:** Single component rewrite in `OfflineWorkbench.tsx`. The `ScheduleDialog` component is currently defined inline in this file (not a separate file). We replace its JSX and update the parent's props/handler wiring. No backend changes. Add `cron-parser` npm package for execution time preview.

**Tech Stack:** React, TypeScript, shadcn/ui (Dialog, Input, Button), cron-parser

---

## File Map

| File | Role |
|---|---|
| `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx` | ScheduleDialog component (inline), all schedule state and handlers |
| `wb-data-frontend/src/api/offline.ts` | API functions — no changes needed |
| `wb-data-frontend/package.json` | Add `cron-parser` dependency |

---

### Task 1: Install cron-parser dependency

**Files:**
- Modify: `wb-data-frontend/package.json`

- [ ] **Step 1: Install cron-parser**

```bash
cd wb-data-frontend && npm install cron-parser
```

- [ ] **Step 2: Verify install**

```bash
node -e "const p = require('cron-parser'); console.log(p.parseExpression('0 10 * * *').next().toISOString())"
```

Expected: prints next occurrence ISO string.

- [ ] **Step 3: Commit**

```bash
cd wb-data-frontend && git add package.json package-lock.json && git commit -m "chore: add cron-parser for schedule execution preview"
```

---

### Task 2: Rewrite ScheduleDialog component

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:726-825`

This is the core task — replace the entire `ScheduleDialogProps` interface and `ScheduleDialog` function component.

- [ ] **Step 1: Add imports for cron-parser and extract flow name helper**

At the top of the file, the cron-parser types are used inside the component via dynamic `import()` — no top-level import change needed. We'll use `cron-parser` via a `useMemo` inside `ScheduleDialog`.

- [ ] **Step 2: Replace ScheduleDialogProps interface (lines 726-739)**

```typescript
interface ScheduleDialogProps {
    open: boolean;
    schedule: OfflineScheduleResponse | null;
    cron: string;
    timezone: string;
    loading: boolean;
    saving: boolean;
    path: string | null;
    onOpenChange: (open: boolean) => void;
    onCronChange: (value: string) => void;
    onTimezoneChange: (value: string) => void;
    onSave: () => void;
    onToggle: (enabled: boolean) => void;
}
```

No changes to the props interface — the same props are used, only the rendering changes.

- [ ] **Step 3: Add cron preview helper inside ScheduleDialog**

Add this `useMemo` at the top of the `ScheduleDialog` function body (after destructuring props):

```typescript
const preview = useMemo(() => {
    if (!cron.trim()) return { type: 'empty' as const };
    try {
        // Dynamic import to avoid top-level dependency issues
        const parser = require('cron-parser');
        const interval = parser.parseExpression(cron, { tz: timezone || undefined });
        const times: string[] = [];
        for (let i = 0; i < 3; i++) {
            times.push(interval.next().toISOString());
        }
        return { type: 'ok' as const, times };
    } catch {
        return { type: 'error' as const, message: '无效的 cron 表达式' };
    }
}, [cron, timezone]);
```

Wait, `require` won't work well with ESM/TypeScript. Let me use a dynamic import approach that's simpler — just import `cron-parser` at the top of the file and use it directly.

Actually let me use a simpler approach — import `parseExpression` from `cron-parser` at the top, and use it in a `useMemo`:

```typescript
import { parseExpression } from 'cron-parser';
```

Then in the component:

```typescript
const preview = useMemo(() => {
    if (!cron.trim()) return { type: 'empty' as const };
    try {
        const interval = parseExpression(cron, { tz: timezone || undefined });
        const times: string[] = [];
        for (let i = 0; i < 3; i++) {
            times.push(interval.next().toISOString());
        }
        return { type: 'ok' as const, times };
    } catch {
        return { type: 'error' as const };
    }
}, [cron, timezone]);
```

- [ ] **Step 4: Add flow name helper**

Add helper function before the `ScheduleDialog` component:

```typescript
function flowNameFromPath(path: string | null): string {
    if (!path) return '尚未选择 Flow';
    // "_flows/demo/flow.yaml" -> "demo"
    const parts = path.split('/');
    return parts.length >= 2 ? parts[1] : path;
}
```

- [ ] **Step 5: Rewrite the ScheduleDialog JSX (lines 757-825)**

Replace the entire return statement of `ScheduleDialog`:

```tsx
return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="offline-schedule-dialog">
            <DialogHeader>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <DialogTitle>调度配置</DialogTitle>
                        <DialogDescription>
                            {flowNameFromPath(path)}
                        </DialogDescription>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={schedule?.enabled ?? false}
                        disabled={saving || loading || !schedule}
                        onClick={() => onToggle(!(schedule?.enabled ?? false))}
                        className="offline-switch"
                        data-enabled={schedule?.enabled ?? false}
                    >
                        <span className="offline-switch-thumb" />
                    </button>
                </div>
            </DialogHeader>

            <div className="offline-form-grid">
                <label className="offline-field">
                    <span>Cron 表达式</span>
                    <Input
                        value={cron}
                        placeholder="例如：0 10 * * *"
                        onChange={(event) => onCronChange(event.target.value)}
                        disabled={saving}
                    />
                    <span className="offline-field-hint">分 时 日 月 周</span>
                </label>
                <label className="offline-field">
                    <span>时区</span>
                    <Input
                        value={timezone}
                        placeholder="例如：Asia/Shanghai"
                        onChange={(event) => onTimezoneChange(event.target.value)}
                        disabled={saving}
                    />
                </label>
            </div>

            <div className={`offline-schedule-preview ${preview.type === 'error' ? 'is-error' : preview.type === 'empty' ? 'is-empty' : ''}`}>
                <div className="offline-schedule-preview-label">未来 3 次执行时间</div>
                {preview.type === 'empty' && (
                    <div className="offline-schedule-preview-text">请先配置调度时间</div>
                )}
                {preview.type === 'error' && (
                    <div className="offline-schedule-preview-text is-error">无效的 cron 表达式</div>
                )}
                {preview.type === 'ok' && preview.times.map((t, i) => (
                    <div key={i} className="offline-schedule-preview-text">
                        {new Date(t).toLocaleString('zh-CN', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                ))}
            </div>

            <p className="offline-schedule-hint">设置将在 Commit + Push 后由 Kestra 同步生效</p>

            <div className="offline-dialog-actions">
                <Button
                    type="button"
                    onClick={onSave}
                    disabled={saving || loading || cron.trim().length === 0 || preview.type === 'error'}
                >
                    {saving ? <LoaderCircle size={14} className="offline-spin" /> : null}
                    暂存调度
                </Button>
            </div>
        </DialogContent>
    </Dialog>
);
```

- [ ] **Step 6: Add CSS for the switch and preview areas**

Create or modify the CSS file used by the offline module. Check which CSS file `OfflineWorkbench` uses.

```bash
grep -n "import.*css\|import.*\.css" wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
```

If using an existing CSS file, add these styles:

```css
/* Switch toggle */
.offline-switch {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: none;
    background: #d4d4d4;
    cursor: pointer;
    transition: background 0.2s;
    padding: 0;
    flex-shrink: 0;
}
.offline-switch[data-enabled="true"] {
    background: #22c55e;
}
.offline-switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.offline-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s;
    display: block;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.offline-switch[data-enabled="true"] .offline-switch-thumb {
    transform: translateX(18px);
}

/* Schedule preview */
.offline-schedule-preview {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
}
.offline-schedule-preview.is-error {
    background: #fef2f2;
    border-color: #fecaca;
}
.offline-schedule-preview.is-empty {
    background: #f5f5f5;
    border-color: #e5e5e5;
}
.offline-schedule-preview-label {
    font-size: 12px;
    color: #666;
    margin-bottom: 4px;
}
.offline-schedule-preview-text {
    font-size: 12px;
    color: #166534;
}
.offline-schedule-preview-text.is-error {
    color: #dc2626;
}
.offline-schedule-preview.is-empty .offline-schedule-preview-text {
    color: #999;
}

/* Hint text */
.offline-schedule-hint {
    font-size: 11px;
    color: #999;
    text-align: center;
    margin-bottom: 10px;
}

/* Field hint */
.offline-field-hint {
    font-size: 11px;
    color: #999;
    margin-top: 4px;
    display: block;
}
```

- [ ] **Step 7: Verify the component renders without errors**

```bash
cd wb-data-frontend && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: no new TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx wb-data-frontend/src/views/offline/*.css
git commit -m "feat(ui): redesign schedule dialog — cron-only, switch toggle, execution preview"
```

---

### Task 3: Update parent integration for flow name extraction

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:2795-2813`

- [ ] **Step 1: Verify the ScheduleDialog usage site**

The usage site at lines 2795-2813 passes `path={activeFlowPath}`. The new `ScheduleDialog` uses `flowNameFromPath(path)` internally, so no prop changes needed. Verify nothing else needs to change.

- [ ] **Step 2: Remove unused defaultTimezone from schedule toggle**

The `onToggle` prop is still called the same way. No change needed.

- [ ] **Step 3: No commit needed if no changes**

If the usage site requires no changes, skip this commit.

---

### Task 4: End-to-end verification

- [ ] **Step 1: Start the dev server**

```bash
cd wb-data-frontend && npm run dev
```

- [ ] **Step 2: Manual test checklist**

Open the offline workbench in the browser and verify:

1. Open a flow → click schedule button → dialog opens
2. **No schedule**: preview shows "请先配置调度时间", save button disabled
3. **Enter valid cron** (e.g. `0 10 * * *`): preview shows 3 future times in green box
4. **Enter invalid cron** (e.g. `abc`): preview shows "无效的 cron 表达式" in red box, save button disabled
5. **Toggle switch**: status pill updates, PATCH API called
6. **Change cron + save**: shows success feedback
7. **Flow name** shown in description (not full path)
8. **Hint text** visible at bottom

- [ ] **Step 3: Fix any issues found, then commit**

```bash
git add -A && git commit -m "chore: verification fixes for schedule dialog redesign"
```

---

## Self-Review

**Spec coverage:**
- ✅ Cron-only mode (no preset)
- ✅ Enable/disable switch in title bar
- ✅ "暂存调度" button renamed
- ✅ Next 3 execution time preview
- ✅ Flow name instead of path
- ✅ Bottom hint text
- ✅ Invalid cron → red error + button disabled
- ✅ No backend changes

**Placeholder scan:** No TBD, TODO, or incomplete steps.

**Type consistency:** `preview` object shape `{ type, times?, message? }` is consistent across creation and consumption. Props interface unchanged — no signature mismatches.
