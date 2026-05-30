# P1 UI Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the P1 UI consistency batch by removing the remaining destructive `window.confirm`, unifying the async search picker path, fixing the silent member-search failure, and replacing interaction-only `title=` hints with the shared Tooltip system.

**Architecture:** Keep the existing frontend structure and improve the shared primitives already present in the repo. Reuse `ConfirmDialog` and evolve `DataSourceSelect` into the shared async-search base, then migrate `GitSettingsTab`, `OfflineDataSourcePicker`, and `AddMemberDialog` onto those primitives. Keep the Tooltip change intentionally narrow: standardize the provider defaults and replace only interaction-hint `title=` call sites in the targeted P1 files.

**Tech Stack:** React 18, TypeScript, `@tanstack/react-query`, Radix Dialog/Tooltip, Base UI Combobox, Vitest, `@testing-library/react`

---

## File map

- Create: `wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx`
- Create: `wb-data-frontend/src/components/DataSourceSelect.test.tsx`
- Create: `wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx`
- Create: `wb-data-frontend/src/components/ui/tooltip.test.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx`
- Modify: `wb-data-frontend/src/components/ui/confirm-dialog.tsx`
- Modify: `wb-data-frontend/src/components/DataSourceSelect.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineDataSourcePicker.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx`
- Modify: `wb-data-frontend/src/components/ui/tooltip.tsx`
- Modify: `wb-data-frontend/src/views/layout/Layout.tsx`
- Modify: `wb-data-frontend/src/views/query/components/QueryResultsPanel.tsx`
- Modify: `wb-data-frontend/src/views/users/UserList.tsx`
- Modify: `wb-data-frontend/src/views/datasources/DataSourceList.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx`
- Modify: `wb-data-frontend/src/views/offline/FlowCanvas.tsx`
- Test: `wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx`

## Notes before coding

- The current repository root is dirty. Execute this plan from a **fresh worktree** so the unrelated local changes do not get mixed into the P1 branch.
- Keep scope locked to issue `#14 #15 #21 #22`. Do not widen into dialog-wide polish (`#19`), plain select cleanup (`#20`), or the full feedback-governance pass (`#23`).
- Frontend verification commands already exist in `wb-data-frontend/package.json`:
  - `npm run test`
  - `npm run build`
  - `npm run lint`

### Task 1: Replace the remaining destructive browser confirm

**Files:**
- Create: `wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx`
- Modify: `wb-data-frontend/src/components/ui/confirm-dialog.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import GitSettingsTab from './GitSettingsTab';

const deleteGitConfig = vi.fn().mockResolvedValue(undefined);
const getGitConfig = vi.fn().mockResolvedValue({
    provider: 'github',
    username: 'octocat',
    tokenMasked: '***',
    baseUrl: 'https://github.com',
});

vi.mock('./gitSettingsApi', () => ({
    getGitConfig,
    saveGitConfig: vi.fn(),
    deleteGitConfig,
    testGitConnection: vi.fn(),
}));

vi.mock('../../hooks/useOperationFeedback', () => ({
    useOperationFeedback: () => ({ showFeedback: vi.fn() }),
}));

describe('GitSettingsTab', () => {
    it('routes delete through ConfirmDialog before mutating', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <GitSettingsTab groupId={1} />
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: '删除配置' }));
        expect(deleteGitConfig).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

        await waitFor(() => {
            expect(deleteGitConfig).toHaveBeenCalledWith(1);
        });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd wb-data-frontend
npx vitest run src/views/group-settings/GitSettingsTab.test.tsx
```

Expected: FAIL because the current component still deletes through `window.confirm(...)`, so no in-app confirm button is rendered.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx
import { ConfirmDialog } from '../../components/ui/confirm-dialog';

const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

<Button
    variant="destructive"
    size="sm"
    onClick={() => setDeleteDialogOpen(true)}
    disabled={deleteMutation.isPending}
>
    删除配置
</Button>

<ConfirmDialog
    open={deleteDialogOpen}
    onOpenChange={(nextOpen) => {
        if (!deleteMutation.isPending) {
            setDeleteDialogOpen(nextOpen);
        }
    }}
    title="删除 Git 配置"
    description="确定要删除此 Git 配置吗？删除后如需再次使用需重新填写凭证。"
    confirmText={deleteMutation.isPending ? '删除中...' : '确认删除'}
    cancelText="取消"
    variant="destructive"
    icon="warning"
    isLoading={deleteMutation.isPending}
    onConfirm={() => {
        deleteMutation.mutate();
    }}
/>
```

```tsx
// wb-data-frontend/src/components/ui/confirm-dialog.tsx
<Button
    variant={variant === 'warning' ? 'default' : variant}
    onClick={async () => {
        await onConfirm();
    }}
    disabled={isLoading}
    type="button"
>
    {isLoading ? '处理中...' : confirmText}
</Button>
```

Keep `ConfirmDialog` focused on the current API; do not turn this task into a broad dialog redesign.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd wb-data-frontend
npx vitest run src/views/group-settings/GitSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx \
  wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx \
  wb-data-frontend/src/components/ui/confirm-dialog.tsx
git commit -m "feat: unify git settings delete confirmation" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Teach the shared async picker to represent error and rich option content

**Files:**
- Create: `wb-data-frontend/src/components/DataSourceSelect.test.tsx`
- Modify: `wb-data-frontend/src/components/DataSourceSelect.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// wb-data-frontend/src/components/DataSourceSelect.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataSourceSelect } from './DataSourceSelect';

describe('DataSourceSelect', () => {
    it('shows an explicit error state instead of empty text', () => {
        render(
            <DataSourceSelect
                options={[]}
                errorText="搜索失败，请稍后重试"
                loading={false}
                onInputChange={vi.fn()}
                placeholder="搜索..."
            />,
        );

        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('搜索失败，请稍后重试')).toBeInTheDocument();
        expect(screen.queryByText('未找到匹配项')).toBeNull();
    });

    it('renders the option description when present', () => {
        render(
            <DataSourceSelect
                options={[
                    {
                        value: '7',
                        label: 'alice',
                        description: 'Alice Zhang',
                    },
                ]}
                loading={false}
                onInputChange={vi.fn()}
                placeholder="搜索用户"
            />,
        );

        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd wb-data-frontend
npx vitest run src/components/DataSourceSelect.test.tsx
```

Expected: FAIL because the shared picker currently has no `errorText` support and does not render secondary descriptions.

- [ ] **Step 3: Write the minimal shared implementation**

```tsx
// wb-data-frontend/src/components/DataSourceSelect.tsx
interface Option {
    label: string;
    value: string;
    description?: string;
    type?: string;
    raw?: unknown;
}

type DataSourceSelectProps = {
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string, option?: Option) => void;
    onInputChange?: (value: string) => void;
    loading?: boolean;
    loadingMore?: boolean;
    value?: string;
    selectedOption?: Option | null;
    hasMore?: boolean;
    onLoadMore?: () => void;
    onOpenChange?: (open: boolean) => void;
    inputId?: string;
    ariaLabel?: string;
    ariaLabelledby?: string;
    virtualize?: boolean;
    virtualItemSize?: number;
    virtualOverscan?: number;
    theme?: 'light' | 'dark';
    multiple?: boolean;
    disableClientFilter?: boolean;
    emptyText?: string;
    loadingText?: string;
    loadingMoreText?: string;
    loadMoreText?: string;
    errorText?: string | null;
};

export function DataSourceSelect({
    options,
    placeholder = '搜索...',
    disabled,
    value,
    selectedOption,
    onChange,
    onInputChange,
    loading,
    loadingMore,
    hasMore,
    onLoadMore,
    onOpenChange,
    inputId,
    ariaLabel,
    ariaLabelledby,
    virtualize = false,
    virtualItemSize = 32,
    virtualOverscan = 6,
    theme = 'light',
    disableClientFilter,
    emptyText = '未找到匹配项',
    loadingText = '加载中...',
    loadingMoreText = '加载更多...',
    loadMoreText = '继续滚动加载更多',
    errorText = null,
}: DataSourceSelectProps) {
    return (
        <Combobox<Option>
            value={selectedOption ?? options.find((opt) => opt.value === value) ?? null}
            onValueChange={(nextOption) => {
                if (nextOption && onChange) {
                    onChange(nextOption.value, nextOption);
                }
            }}
            onInputValueChange={(nextValue) => {
                onInputChange?.(nextValue);
            }}
            onOpenChange={onOpenChange}
            disabled={disabled}
            itemToStringLabel={(item) => (item ? item.label : '')}
            itemToStringValue={(item) => (item ? item.value : '')}
            isItemEqualToValue={(item, current) => item.value === current.value}
            filter={disableClientFilter ? null : undefined}
        >
            <ComboboxContent
                sideOffset={4}
                align="start"
                className="w-[var(--anchor-width)] max-h-[300px]"
            >
                {loading ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">{loadingText}</div>
                ) : errorText ? (
                    <div className="p-3 text-sm text-destructive text-center">{errorText}</div>
                ) : options.length === 0 ? (
                    <ComboboxEmpty>{emptyText}</ComboboxEmpty>
                ) : (
                    options.map((item) => (
                        <ComboboxItem key={item.value} value={item}>
                            <div className="min-w-0 flex-1">
                                <div className="truncate">{item.label}</div>
                                {item.description ? (
                                    <div className="truncate text-xs text-muted-foreground">
                                        {item.description}
                                    </div>
                                ) : null}
                            </div>
                        </ComboboxItem>
                    ))
                )}
            </ComboboxContent>
        </Combobox>
    );
}
```

Do not add retry buttons or unrelated visualization in this task; the only new contract is “rich option content” plus “error vs empty.”

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd wb-data-frontend
npx vitest run src/components/DataSourceSelect.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/components/DataSourceSelect.tsx \
  wb-data-frontend/src/components/DataSourceSelect.test.tsx
git commit -m "feat: extend shared async picker states" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Migrate AddMemberDialog and the offline picker onto the shared async picker

**Files:**
- Create: `wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineDataSourcePicker.tsx`
- Test: `wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AddMemberDialog from './AddMemberDialog';

const getAvailableUsers = vi.fn();

vi.mock('../../api/groupSettings', () => ({
    getAvailableUsers,
}));

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

        fireEvent.change(screen.getByPlaceholderText('搜索用户名或展示名'), {
            target: { value: 'alice' },
        });

        await act(async () => {
            vi.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText('搜索失败，请稍后重试')).toBeInTheDocument();
        });
        expect(screen.queryByText('未找到匹配的用户')).toBeNull();
    });
});
```

Keep the existing `NodeEditorDialog.test.tsx` as the regression test for the offline SQL editor path.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd wb-data-frontend
npx vitest run \
  src/views/group-settings/AddMemberDialog.test.tsx \
  src/views/offline/NodeEditorDialog.test.tsx
```

Expected: FAIL because `AddMemberDialog` still renders its own dropdown and collapses failures into an empty state.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// wb-data-frontend/src/views/offline/OfflineDataSourcePicker.tsx
import { DataSourceSelect } from '../../components/DataSourceSelect';

export function OfflineDataSourcePicker(props: OfflineDataSourcePickerProps) {
    const { options, selectedOption, loading, loadingMore, hasMore, placeholder, emptyText, onSearch, onLoadMore, onSelect } = props;

    return (
        <DataSourceSelect
            options={options}
            selectedOption={selectedOption}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            placeholder={placeholder}
            emptyText={emptyText}
            loadMoreText="继续滚动加载更多"
            loadingText="加载数据源..."
            loadingMoreText="加载更多..."
            onInputChange={onSearch}
            onLoadMore={onLoadMore}
            onChange={(_, option) => {
                if (option) {
                    onSelect(option);
                }
            }}
            disableClientFilter
        />
    );
}
```

```tsx
// wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx
import { DataSourceSelect } from '../../components/DataSourceSelect';

const [searchError, setSearchError] = useState<string | null>(null);

const userOptions = users.map((user) => ({
    value: String(user.id),
    label: user.username,
    description: user.displayName,
    raw: user,
}));

getAvailableUsers(groupId, searchKeyword.trim() || undefined)
    .then((result) => {
        setUsers(result);
        setSearchError(null);
    })
    .catch(() => {
        setUsers([]);
        setSearchError('搜索失败，请稍后重试');
    })
    .finally(() => setLoading(false));

<DataSourceSelect
    options={userOptions}
    selectedOption={selectedUser ? {
        value: String(selectedUser.id),
        label: selectedUser.username,
        description: selectedUser.displayName,
        raw: selectedUser,
    } : null}
    placeholder="搜索用户名或展示名"
    loading={loading}
    errorText={searchError}
    emptyText="未找到匹配的用户"
    onInputChange={(value) => {
        setSearchKeyword(value);
        setSearchError(null);
    }}
    onChange={(_, option) => {
        const nextUser = option?.raw as AvailableUser | undefined;
        if (nextUser) {
            setSelectedUser(nextUser);
            setSearchKeyword('');
            setSearchError(null);
        }
    }}
    disableClientFilter
/>
```

Also remove the obsolete local dropdown-only state in `AddMemberDialog` (`showDropdown`, outside click handler, ad-hoc option buttons) once the shared picker is wired in.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd wb-data-frontend
npx vitest run \
  src/components/DataSourceSelect.test.tsx \
  src/views/group-settings/AddMemberDialog.test.tsx \
  src/views/offline/NodeEditorDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx \
  wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx \
  wb-data-frontend/src/views/offline/OfflineDataSourcePicker.tsx \
  wb-data-frontend/src/components/DataSourceSelect.tsx \
  wb-data-frontend/src/components/DataSourceSelect.test.tsx \
  wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx
git commit -m "feat: unify async member and datasource pickers" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Standardize Tooltip defaults and remove interaction-only `title=` usage in the P1 targets

**Files:**
- Create: `wb-data-frontend/src/components/ui/tooltip.test.tsx`
- Modify: `wb-data-frontend/src/components/ui/tooltip.tsx`
- Modify: `wb-data-frontend/src/views/layout/Layout.tsx`
- Modify: `wb-data-frontend/src/views/query/components/QueryResultsPanel.tsx`
- Modify: `wb-data-frontend/src/views/users/UserList.tsx`
- Modify: `wb-data-frontend/src/views/datasources/DataSourceList.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx`
- Modify: `wb-data-frontend/src/views/offline/FlowCanvas.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// wb-data-frontend/src/components/ui/tooltip.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const providerSpy = vi.fn(({ children, delayDuration }) => (
    <div data-testid="provider" data-delay={String(delayDuration)}>
        {children}
    </div>
));

vi.mock('@radix-ui/react-tooltip', async () => {
    const actual = await vi.importActual<typeof import('@radix-ui/react-tooltip')>('@radix-ui/react-tooltip');
    return {
        ...actual,
        Provider: providerSpy,
    };
});

import { TooltipProvider } from './tooltip';

describe('TooltipProvider', () => {
    it('uses a 300ms default delay', () => {
        render(
            <TooltipProvider>
                <button type="button">hello</button>
            </TooltipProvider>,
        );

        expect(screen.getByTestId('provider')).toHaveAttribute('data-delay', '300');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd wb-data-frontend
npx vitest run src/components/ui/tooltip.test.tsx
```

Expected: FAIL because the current `TooltipProvider` is just a re-export without a standardized default.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// wb-data-frontend/src/components/ui/tooltip.tsx
const TooltipProvider = ({
    delayDuration = 300,
    ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) => (
    <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
);
```

```tsx
// wb-data-frontend/src/views/layout/Layout.tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';

<TooltipProvider>
    <Tooltip>
        <TooltipTrigger asChild>
            <button className="logout-btn" onClick={handleLogout} aria-label="退出登录">
                <LogOut size={16} />
            </button>
        </TooltipTrigger>
        <TooltipContent>退出登录</TooltipContent>
    </Tooltip>
</TooltipProvider>
```

```tsx
// wb-data-frontend/src/views/query/components/QueryResultsPanel.tsx
<TooltipProvider>
    <Tooltip>
        <TooltipTrigger asChild>
            <button type="button" className="export-button result-secondary-action" onClick={handleFillSavedSql}>
                <Code2 size={14} />
                <span>回填 SQL</span>
            </button>
        </TooltipTrigger>
        <TooltipContent>回填 SQL 到编辑器</TooltipContent>
    </Tooltip>
</TooltipProvider>
```

Apply the same pattern to the remaining interaction-only `title=` call sites in:

```txt
wb-data-frontend/src/views/users/UserList.tsx
wb-data-frontend/src/views/datasources/DataSourceList.tsx
wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx
wb-data-frontend/src/views/offline/FlowCanvas.tsx
```

Do **not** touch table-cell value tooltips or other text-overflow `title=` uses in this task.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd wb-data-frontend
npx vitest run src/components/ui/tooltip.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/components/ui/tooltip.tsx \
  wb-data-frontend/src/components/ui/tooltip.test.tsx \
  wb-data-frontend/src/views/layout/Layout.tsx \
  wb-data-frontend/src/views/query/components/QueryResultsPanel.tsx \
  wb-data-frontend/src/views/users/UserList.tsx \
  wb-data-frontend/src/views/datasources/DataSourceList.tsx \
  wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx \
  wb-data-frontend/src/views/offline/FlowCanvas.tsx
git commit -m "feat: standardize interaction tooltips" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Run the full frontend verification pass and prepare the handoff

**Files:**
- Test only: `wb-data-frontend/package.json`

- [ ] **Step 1: Run the targeted P1 tests together**

Run:

```bash
cd wb-data-frontend
npx vitest run \
  src/views/group-settings/GitSettingsTab.test.tsx \
  src/components/DataSourceSelect.test.tsx \
  src/views/group-settings/AddMemberDialog.test.tsx \
  src/components/ui/tooltip.test.tsx \
  src/views/offline/NodeEditorDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the repo-level frontend verification**

Run:

```bash
cd wb-data-frontend
npm run test
npm run build
npm run lint
```

Expected: all three commands PASS.

- [ ] **Step 3: Check the intended scope only**

Run:

```bash
git --no-pager diff --stat
git --no-pager diff -- \
  wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx \
  wb-data-frontend/src/components/ui/confirm-dialog.tsx \
  wb-data-frontend/src/components/DataSourceSelect.tsx \
  wb-data-frontend/src/views/offline/OfflineDataSourcePicker.tsx \
  wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx \
  wb-data-frontend/src/components/ui/tooltip.tsx
```

Expected: only the planned P1 files and their tests are changed; no unrelated UI cleanup has slipped in.

- [ ] **Step 4: Commit the verification-safe branch tip**

```bash
git add \
  wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx \
  wb-data-frontend/src/views/group-settings/GitSettingsTab.test.tsx \
  wb-data-frontend/src/components/ui/confirm-dialog.tsx \
  wb-data-frontend/src/components/DataSourceSelect.tsx \
  wb-data-frontend/src/components/DataSourceSelect.test.tsx \
  wb-data-frontend/src/views/offline/OfflineDataSourcePicker.tsx \
  wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx \
  wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx \
  wb-data-frontend/src/components/ui/tooltip.tsx \
  wb-data-frontend/src/components/ui/tooltip.test.tsx \
  wb-data-frontend/src/views/layout/Layout.tsx \
  wb-data-frontend/src/views/query/components/QueryResultsPanel.tsx \
  wb-data-frontend/src/views/users/UserList.tsx \
  wb-data-frontend/src/views/datasources/DataSourceList.tsx \
  wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx \
  wb-data-frontend/src/views/offline/FlowCanvas.tsx
git commit -m "feat: deliver p1 ui consistency cleanup" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 5: Prepare the issue follow-up notes**

```txt
- #14 is covered by the AddMemberDialog error-state change.
- #15 is covered by the GitSettingsTab confirm-dialog migration.
- #21 is covered by the shared DataSourceSelect migration.
- #22 is partially covered by the targeted interaction-tooltip sweep; remaining text-overflow title usage stays for later governance work.
```
