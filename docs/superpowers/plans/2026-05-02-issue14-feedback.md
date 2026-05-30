# Issue #14 Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make issue #14 closeable by surfacing explicit member-search failures in `AddMemberDialog` and user-visible query export download failures.

**Architecture:** Keep the current UI structure intact and add the smallest possible feedback state at each failure boundary. `AddMemberDialog` gets an explicit local `searchError` state, while the query export flow reuses the existing operation feedback pattern for download failures instead of inventing another inline surface.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing `useOperationFeedback` store, existing query export hook/state.

---

### Task 1: Make AddMemberDialog distinguish empty results from request failure

**Files:**
- Modify: `wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx`
- Create: `wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddMemberDialog from './AddMemberDialog';

const { getAvailableUsers } = vi.hoisted(() => ({
    getAvailableUsers: vi.fn(),
}));

vi.mock('../../api/groupSettings', () => ({
    getAvailableUsers,
}));

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('AddMemberDialog', () => {
    it('shows an explicit error state when member search fails', async () => {
        vi.useFakeTimers();
        getAvailableUsers.mockRejectedValueOnce(new Error('network down'));

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));
        fireEvent.change(dialog.getByPlaceholderText('搜索用户名或展示名'), {
            target: { value: 'alice' },
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(dialog.getByText('搜索失败，请稍后重试')).toBeTruthy();
        });
        expect(dialog.queryByText('未找到匹配的用户')).toBeNull();
    });

    it('clears the search error immediately when the input is cleared', async () => {
        vi.useFakeTimers();
        getAvailableUsers.mockRejectedValueOnce(new Error('network down'));

        render(
            <AddMemberDialog
                open
                groupId={12}
                onOpenChange={() => {}}
                onSuccess={() => {}}
            />,
        );

        const dialog = within(screen.getByRole('dialog'));
        const input = dialog.getByPlaceholderText('搜索用户名或展示名');

        fireEvent.change(input, { target: { value: 'alice' } });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
            await Promise.resolve();
        });

        expect(dialog.getByText('搜索失败，请稍后重试')).toBeTruthy();

        fireEvent.change(input, { target: { value: '' } });

        expect(dialog.queryByText('搜索失败，请稍后重试')).toBeNull();
    });
});
```

- [ ] **Step 2: Run the dialog tests to verify they fail**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/group-settings/AddMemberDialog.test.tsx
```

Expected: FAIL because the dialog still renders the empty-state copy after request failure and does not track a dedicated search error.

- [ ] **Step 3: Write the minimal implementation**

```tsx
const [searchError, setSearchError] = useState<string | null>(null);

useEffect(() => {
    if (!open) {
        setSearchKeyword('');
        setUsers([]);
        setSelectedUser(null);
        setRole('DEVELOPER');
        setSubmitting(false);
        setShowDropdown(false);
        setSearchError(null);
    }
}, [open]);

searchTimerRef.current = window.setTimeout(() => {
    searchTimerRef.current = null;
    if (!searchKeyword.trim()) {
        setUsers([]);
        setShowDropdown(false);
        setSearchError(null);
        return;
    }
    setLoading(true);
    getAvailableUsers(groupId, searchKeyword.trim())
        .then((result) => {
            setUsers(result);
            setShowDropdown(true);
            setSearchError(null);
        })
        .catch(() => {
            setUsers([]);
            setShowDropdown(true);
            setSearchError('搜索失败，请稍后重试');
        })
        .finally(() => setLoading(false));
}, 300);

const handleSearchChange = (value: string) => {
    setSearchKeyword(value);
    setSearchError(null);
};

const handleClearUser = () => {
    setSelectedUser(null);
    setSearchKeyword('');
    setUsers([]);
    setSearchError(null);
};

{loading ? (
    <div className="gs-user-dropdown-loading">搜索中...</div>
) : searchError ? (
    <div className="gs-user-dropdown-empty">{searchError}</div>
) : users.length === 0 ? (
    <div className="gs-user-dropdown-empty">未找到匹配的用户</div>
) : (
    users.map((user) => (
        /* existing option rendering */
    ))
)}
```

- [ ] **Step 4: Re-run the dialog tests**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/group-settings/AddMemberDialog.test.tsx
```

Expected: PASS with both tests green.

- [ ] **Step 5: Commit the dialog fix**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx \
        wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx
git commit -m "fix: surface add member search failures"
```

### Task 2: Surface query export download failures to users

**Files:**
- Modify: `wb-data-frontend/src/views/query/Query.tsx`
- Modify: `wb-data-frontend/src/views/query/hooks/useQueryExecution.ts`
- Create: `wb-data-frontend/src/views/query/hooks/useQueryExecution.test.ts`

- [ ] **Step 1: Write the failing hook test**

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQueryExecution } from './useQueryExecution';

const getTokenMock = vi.hoisted(() => vi.fn(() => 'token-1'));

vi.mock('../../../utils/auth', () => ({
    getToken: getTokenMock,
}));

describe('useQueryExecution download feedback', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows user-visible feedback when export download fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: vi.fn().mockResolvedValue({ message: '下载地址已失效' }),
        }));

        const showFeedback = vi.fn();

        const { result } = renderHook(() => useQueryExecution({
            sql: 'select 1',
            result: null,
            queryError: '',
            loadingQuery: false,
            setResult: vi.fn(),
            setQueryError: vi.fn(),
            setLoadingQuery: vi.fn(),
            setSql: vi.fn(),
            selectedDsId: '1',
            selectedDb: '',
            getActiveDataSource: () => null,
            resultAutoOpen: false,
            resultCollapsed: false,
            setResultPanelState: vi.fn(),
            editorRef: { current: null },
            monacoRef: { current: null },
            showFeedback,
        }));

        await act(async () => {
            await result.current.downloadExportTask('task-1');
        });

        expect(showFeedback).toHaveBeenCalledWith({
            tone: 'error',
            title: '下载失败',
            detail: '下载地址已失效',
        });
    });
});
```

- [ ] **Step 2: Run the hook test to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/query/hooks/useQueryExecution.test.ts
```

Expected: FAIL because `useQueryExecution` does not yet accept a feedback dependency and still only logs download errors to the console.

- [ ] **Step 3: Write the minimal implementation**

```ts
interface UseQueryExecutionParams {
    // existing fields...
    showFeedback: (payload: { tone: 'success' | 'error' | 'info'; title: string; detail: string }) => void;
}

async function resolveDownloadErrorMessage(response: Response) {
    try {
        const data = await response.clone().json() as { message?: string };
        if (typeof data.message === 'string' && data.message.trim()) {
            return data.message;
        }
    } catch {}

    try {
        const text = await response.text();
        if (text.trim()) {
            return text;
        }
    } catch {}

    return '导出文件下载失败，请稍后重试。';
}

const downloadExportTask = useCallback(async (taskId: string) => {
    try {
        const response = await fetch(getQueryExportTaskDownloadUrl(taskId), {
            headers: {
                Authorization: `Bearer ${getToken()}`,
            },
        });
        if (!response.ok) {
            throw new Error(await resolveDownloadErrorMessage(response));
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        const detail = error instanceof Error && error.message
            ? error.message
            : '导出文件下载失败，请稍后重试。';
        showFeedback({
            tone: 'error',
            title: '下载失败',
            detail,
        });
    }
}, [showFeedback]);
```

And thread the dependency from `Query.tsx`:

```tsx
const { showFeedback } = useOperationFeedback();

const execution = useQueryExecution({
    sql, result, queryError, loadingQuery,
    setSql, setResult, setQueryError, setLoadingQuery,
    selectedDsId, selectedDb, getActiveDataSource,
    resultAutoOpen, resultCollapsed, setResultPanelState,
    editorRef, monacoRef,
    showFeedback,
});
```

- [ ] **Step 4: Re-run the hook test**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run src/views/query/hooks/useQueryExecution.test.ts
```

Expected: PASS with the feedback assertion green.

- [ ] **Step 5: Commit the query feedback fix**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/query/Query.tsx \
        wb-data-frontend/src/views/query/hooks/useQueryExecution.ts \
        wb-data-frontend/src/views/query/hooks/useQueryExecution.test.ts
git commit -m "fix: surface query export download failures"
```

### Task 3: Verify, ship, and close issue #14

**Files:**
- Modify: none
- Test: `wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx`
- Test: `wb-data-frontend/src/views/query/hooks/useQueryExecution.test.ts`

- [ ] **Step 1: Run targeted tests together**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm test -- --run \
  src/views/group-settings/AddMemberDialog.test.tsx \
  src/views/query/hooks/useQueryExecution.test.ts
```

Expected: PASS with both new regression tests green.

- [ ] **Step 2: Run full frontend verification**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run lint
npm run build
npm test
```

Expected: all three commands exit 0.

- [ ] **Step 3: Commit the finished issue batch**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend
git commit -m "fix: resolve issue14 feedback gaps"
```

- [ ] **Step 4: Push the branch**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
git push origin main
```

Expected: push succeeds and the remote `main` points to the new fix commit.

- [ ] **Step 5: Close issue #14 with a summary comment**

Run:

```bash
cd /Users/wenbin/Projects/wb-data
gh issue close 14 --comment $'已修复并推送到 main。\n\n- 添加成员搜索失败现在会明确显示“搜索失败，请稍后重试”，不再伪装成空结果\n- 查询导出任务下载失败现在会显示用户可见反馈，而不是只输出到控制台\n- 前端 lint / build / test 已重新通过'
```

Expected: GitHub issue #14 is closed with the shipped summary.
