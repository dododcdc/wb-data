# Issue #23 — 统一通知与错误展示规则 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Global Toast (`OperationFeedback`) 的错误停留时长，减少模板代码，并明确 Toast vs Inline Error 的使用规则。

**Architecture:** 将时长常量从 `useOperationFeedback.ts` 提取到独立常量文件，按 `tone` 自动推断默认展示时长，消除 6 处手动传 `5000ms` 的硬编码。随后增加 `showSuccess`/`showError` 便捷方法减少模板代码。最后将规则文档化。

**Tech Stack:** React, TypeScript, Zustand, Vitest

---

### Phase 1 — 基础设施：统一时长 & 自动推断

**涉及文件：**
- Create: `wb-data-frontend/src/constants/feedback.ts`
- Modify: `wb-data-frontend/src/hooks/useOperationFeedback.ts`
- Modify: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx` (3 处)
- Modify: `wb-data-frontend/src/views/datasources/DataSourceList.tsx` (2 处)
- Modify: `wb-data-frontend/src/views/users/UserList.tsx` (1 处)

#### Step 1: 创建常量文件

**文件：** Create `wb-data-frontend/src/constants/feedback.ts`

```typescript
export const FEEDBACK_DURATION = {
    success: 3000,
    info: 3000,
    error: 5000,
} as const;
```

- [ ] **创建 `src/constants/feedback.ts`**

#### Step 2: 更新 `useOperationFeedback.ts` 使用新常量 & 自动推断

**文件：** Modify `wb-data-frontend/src/hooks/useOperationFeedback.ts`

变更：
1. 导入 `FEEDBACK_DURATION`
2. `show` 方法根据 `payload.tone` 自动推断默认时长
3. 保留 `durationMs?` 参数用于显式覆盖
4. 导出 `showSuccess`/`showError`（Phase 2 再加，Phase 1 不动）

```typescript
import { create } from 'zustand';
import { FEEDBACK_DURATION } from '../constants/feedback';

export type FeedbackTone = 'success' | 'error' | 'info';

export interface FeedbackPayload {
    tone: FeedbackTone;
    title: string;
    detail: string;
}

interface FeedbackState {
    current: FeedbackPayload | null;
    timerId: number | null;
    show: (payload: FeedbackPayload, durationMs?: number) => void;
    dismiss: () => void;
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
    current: null,
    timerId: null,

    show: (payload, durationMs) => {
        const prev = get().timerId;
        if (prev != null) window.clearTimeout(prev);

        const ms = durationMs ?? FEEDBACK_DURATION[payload.tone];

        const id = window.setTimeout(() => {
            set({ current: null, timerId: null });
        }, ms);

        set({ current: payload, timerId: id });
    },

    dismiss: () => {
        const prev = get().timerId;
        if (prev != null) window.clearTimeout(prev);
        set({ current: null, timerId: null });
    },
}));

export function useOperationFeedback() {
    const show = useFeedbackStore((s) => s.show);
    const dismiss = useFeedbackStore((s) => s.dismiss);
    return { showFeedback: show, dismissFeedback: dismiss };
}
```

- [ ] **修改 `useOperationFeedback.ts`** — 导入 `FEEDBACK_DURATION`，`show` 方法改为 `durationMs ?? FEEDBACK_DURATION[payload.tone]`

#### Step 3: 验证现有测试通过

运行：

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npx vitest run --reporter=verbose src/hooks/useOperationFeedback.test.ts 2>&1 || true
```

如果有测试文件，确认通过。如果不存在则创建。

- [ ] **运行测试确认基线通过**

#### Step 4: 移除 6 处硬编码 `5000ms`

**规则：** 由于 `tone: 'error'` 默认时长已变成 `5000ms`，所有传 `5000` 的 `showFeedback` 调用可以删掉第二个参数。

以下 6 处修改：

**1. `src/views/group-settings/GroupSettingsPage.tsx` — 3 处**

```typescript
// Line 122-130: onError 中
showFeedback(
    {
        tone: 'error',
        title: '添加成员失败',
        detail: (error as { message?: string } | null)?.message ?? '无法添加成员，请稍后重试。',
    },
    5000,  // ← 删除这行和上一行的逗号
);
```

```typescript
// Line 148-155: onError 中
showFeedback(
    {
        tone: 'error',
        title: '角色变更失败',
        detail: (error as { message?: string } | null)?.message ?? '角色变更失败，请稍后重试。',
    },
    5000,  // ← 删除
);
```

```typescript
// Line 174-180: onError 中
showFeedback(
    {
        tone: 'error',
        title: '移除成员失败',
        detail: (error as { message?: string } | null)?.message ?? '移除成员失败，请稍后重试。',
    },
    5000,  // ← 删除
);
```

**2. `src/views/datasources/DataSourceList.tsx` — 2 处**

```typescript
// Line 189-193: onError 中
showFeedback({
    tone: 'error',
    title: '删除失败',
    detail: (error as { message?: string } | null)?.message ?? '数据源删除失败，请稍后重试。',
}, 5000);  // ← 改为 )
```

```typescript
// Line 230-234: onError 中
showFeedback({
    tone: 'error',
    title: '状态更新失败',
    detail: (error as { message?: string } | null)?.message ?? '数据源状态更新失败，请稍后重试。',
}, 5000);  // ← 改为 )
```

**3. `src/views/users/UserList.tsx` — 1 处**

```typescript
// Line 171-178: onError 中
showFeedback(
    {
        tone: 'error',
        title: '状态更新失败',
        detail: (error as { message?: string } | null)?.message ?? '用户状态更新失败，请稍后重试。',
    },
    5000,  // ← 删除
);
```

- [ ] **GroupSettingsPage.tsx** — 移除 3 处 `5000`
- [ ] **DataSourceList.tsx** — 移除 2 处 `, 5000`
- [ ] **UserList.tsx** — 移除 1 处 `5000``

#### Step 5: 验证所有测试通过

运行：

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npx vitest run --reporter=verbose 2>&1
```

Expected: All tests pass.

- [ ] **运行全量测试确认不破坏任何东西**

#### Step 6: 提交 Phase 1

```bash
git add -A
git commit -m "feat(feedback): unify error display durations and auto-infer from tone

- Extract FEEDBACK_DURATION constants to src/constants/feedback.ts
- Auto-infer default duration from feedback tone (success/info: 3s, error: 5s)
- Remove 6 hardcoded 5000ms in GroupSettingsPage, DataSourceList, UserList"
```

- [ ] **Commit Phase 1**

---

### Phase 2 — 开发者体验：便捷方法

**涉及文件：**
- Modify: `wb-data-frontend/src/hooks/useOperationFeedback.ts`
- Test: `wb-data-frontend/src/hooks/useOperationFeedback.test.ts`（或创建）

#### Step 1: 添加 `showSuccess` / `showError` 便捷方法

**文件：** Modify `wb-data-frontend/src/hooks/useOperationFeedback.ts`

在 `useOperationFeedback` 返回值中增加两个方法：

```typescript
import { getErrorMessage } from '../utils/error';

export function useOperationFeedback() {
    const show = useFeedbackStore((s) => s.show);
    const dismiss = useFeedbackStore((s) => s.dismiss);

    const showSuccess = useCallback((title: string, detail?: string) => {
        show({ tone: 'success', title, detail: detail ?? '' });
    }, [show]);

    const showError = useCallback((error: unknown, title: string) => {
        show({
            tone: 'error',
            title,
            detail: getErrorMessage(error, title),
        });
    }, [show]);

    return { showFeedback: show, dismissFeedback: dismiss, showSuccess, showError };
}
```

注意：`showFeedback` 保留完整灵活性用于 Info tone 和自定义时长场景。

- [ ] **添加 `showSuccess` 和 `showError` 到 `useOperationFeedback`**

#### Step 2: 编写测试

**文件：** Create `wb-data-frontend/src/hooks/useOperationFeedback.test.ts`

```typescript
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOperationFeedback, useFeedbackStore } from './useOperationFeedback';

describe('useOperationFeedback', () => {
    beforeEach(() => {
        useFeedbackStore.setState({ current: null, timerId: null });
        vi.useFakeTimers();
    });

    it('showFeedback shows success toast with default duration', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'success', title: '成功', detail: '' });
        expect(useFeedbackStore.getState().current?.title).toBe('成功');
    });

    it('showFeedback auto-dismisses after default duration', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'error', title: '失败', detail: '' });
        vi.advanceTimersByTime(5000);
        expect(useFeedbackStore.getState().current).toBeNull();
    });

    it('showFeedback uses custom duration when provided', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'error', title: '失败', detail: '' }, 10000);
        vi.advanceTimersByTime(5000);
        expect(useFeedbackStore.getState().current).not.toBeNull();
        vi.advanceTimersByTime(5000);
        expect(useFeedbackStore.getState().current).toBeNull();
    });

    it('showSuccess is a convenience for success toast', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showSuccess('操作成功');
        expect(useFeedbackStore.getState().current).toEqual({
            tone: 'success',
            title: '操作成功',
            detail: '',
        });
    });

    it('showError extracts message from Error object', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showError(new Error('网络错误'), '操作失败');
        expect(useFeedbackStore.getState().current).toEqual({
            tone: 'error',
            title: '操作失败',
            detail: '网络错误',
        });
    });

    it('dismissFeedback clears toast', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'info', title: '信息', detail: '' });
        result.current.dismissFeedback();
        expect(useFeedbackStore.getState().current).toBeNull();
    });
});
```

- [ ] **创建 `useOperationFeedback.test.ts`**
- [ ] **运行测试确认通过**：`npx vitest run --reporter=verbose src/hooks/useOperationFeedback.test.ts`

#### Step 3: 提交 Phase 2

```bash
git add -A
git commit -m "feat(feedback): add showSuccess and showError convenience methods
```

- [ ] **Commit Phase 2**

---

### Phase 3 — 规范文档 & 调用点审计

**涉及文件：**
- Create: `docs/superpowers/specs/2026-05-04-issue23-feedback-display-rules.md`

#### Step 1: 编写展示规则文档

**文件：** Create `docs/superpowers/specs/2026-05-04-issue23-feedback-display-rules.md`

```markdown
# 通知与错误展示规则

## 决策树

操作失败后，用户是否需要当前页面上下文才能理解/处理这个错误？
- **是 → Inline Error**（保持在上下文内展示）
  - 表单提交失败 → 表单底部 banner (`.form-feedback-error`)
  - 字段校验失败 → 字段下方 (`.input-error`)
  - SQL 执行失败 → 结果面板内卡片 (`QueryResultsPanel`)
  - 列表加载失败 → DataTable 行内错误 (`DataTableShell`)
- **否 → Global Toast**（右上角 OperationFeedback）
  - CRUD 增删改成功/失败
  - 启用/停用操作
  - 下载失败
  - 其他导航无关的独立操作

## 时长规则

| Toast 类型 | 默认时长 | 说明 |
|-----------|---------|------|
| `success` | 3000ms | 快速确认 |
| `info`    | 3000ms | 简短提示 |
| `error`   | 5000ms | 错误需要更多阅读时间 |

Inline Error：**无自动消失**，用户操作后才清除。

## API

```typescript
const { showFeedback, showSuccess, showError, dismissFeedback } = useOperationFeedback();

// 通用方法（可自定义 tone 和时长）
showFeedback({ tone: 'info', title: '处理中...', detail: '' });

// 便捷方法（自动推断时长）
showSuccess('保存成功');
showError(error, '保存失败');  // 自动调用 getErrorMessage
dismissFeedback();
```

## 注意

- 不要使用 `showFeedback` 展示 SQL 执行结果（应使用 `QueryResultsPanel` 行内卡片）
- 不要使用 `showFeedback` 展示字段校验错误（应使用 `.input-error` 组件）
```

- [ ] **创建规则文档** `docs/superpowers/specs/2026-05-04-issue23-feedback-display-rules.md`

#### Step 2: 提交 Phase 3

```bash
git add -A
git commit -m "docs: add feedback display rules spec for issue23
```

- [ ] **Commit Phase 3**

---

## 不考虑的内容

以下内容明确**不在此 plan 范围内**（复杂度高 / 收益低 / 非 issue 核心诉求）：

- ❌ 多 Toast 同时展示（消息队列）
- ❌ Interceptor 自动弹 Toast
- ❌ Hover pause / 倒计时暂停
- ❌ 重构 `request.ts`
