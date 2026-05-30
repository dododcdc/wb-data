# Bulk Member Addition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add batch member selection to Group Settings so operators can search usernames, select multiple users, assign one shared role, and submit the whole batch atomically without affecting existing single-select searchable dropdowns.

**Architecture:** Keep the current `SearchSelect` single-select API unchanged and add a separate `MultiSearchSelect` for the new selection model. Update `AddMemberDialog` and `GroupSettingsPage` to use batch payloads on the frontend, and add a dedicated batch-add request/service path on the backend so validation and inserts happen in one transaction.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, TanStack Query, Spring Boot 3, MyBatis-Plus, JUnit 5, Mockito

---

## File Map

- Create: `wb-data-frontend/src/components/ui/multi-search-select.tsx`
  Multi-select searchable dropdown with selected-member tags, remove-one, clear-all, and keep-open repeated selection behavior.

- Create: `wb-data-frontend/src/components/ui/multi-search-select.test.tsx`
  Focused regression tests for the new multi-select interaction model.

- Modify: `wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx`
  Replace single selected-user flow with multi-select batch flow and quantity-based submit copy.

- Modify: `wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx`
  Cover batch selection payloads, username-only rendering, remove/clear behavior, and empty-state button logic.

- Modify: `wb-data-frontend/src/api/groupSettings.ts`
  Add a batch payload type and batch add API function.

- Create: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.test.tsx`
  Minimal page-level mutation/feedback test for the new batch payload path.

- Modify: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx`
  Switch from single add mutation to batch add mutation and quantity-based success feedback.

- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/dto/AddMembersRequest.java`
  Validated request DTO for `userIds[] + role`.

- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/controller/GroupSettingsController.java`
  Add a dedicated batch add endpoint.

- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/service/GroupSettingsService.java`
  Add transactional batch validation/insertion logic.

- Modify: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/group/service/GroupSettingsServiceTest.java`
  Add red/green tests for successful batch add and atomic rejection rules.

## Task 1: Build `MultiSearchSelect`

**Files:**
- Create: `wb-data-frontend/src/components/ui/multi-search-select.tsx`
- Test: `wb-data-frontend/src/components/ui/multi-search-select.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiSearchSelect } from './multi-search-select';

describe('MultiSearchSelect', () => {
    it('adds multiple users, supports remove-one, and clears all selections', async () => {
        const onChange = vi.fn();

        render(
            <MultiSearchSelect
                options={[
                    { label: 'dev_alpha', value: '2' },
                    { label: 'ga_alpha', value: '3' },
                ]}
                values={[]}
                placeholder="搜索用户名"
                onChange={onChange}
                onInputChange={() => {}}
            />,
        );

        const input = screen.getByPlaceholderText('搜索用户名');
        fireEvent.click(input);
        fireEvent.change(input, { target: { value: 'a' } });

        fireEvent.click(await screen.findByRole('option', { name: 'dev_alpha' }));
        expect(onChange).toHaveBeenLastCalledWith(['2'], [{ label: 'dev_alpha', value: '2' }]);

        fireEvent.change(input, { target: { value: 'ga' } });
        fireEvent.click(await screen.findByRole('option', { name: 'ga_alpha' }));
        expect(onChange).toHaveBeenLastCalledWith(
            ['2', '3'],
            [
                { label: 'dev_alpha', value: '2' },
                { label: 'ga_alpha', value: '3' },
            ],
        );

        fireEvent.click(screen.getByRole('button', { name: '移除 dev_alpha' }));
        fireEvent.click(screen.getByRole('button', { name: '清空全部已选成员' }));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- src/components/ui/multi-search-select.test.tsx
```

Expected: FAIL with module-not-found or `MultiSearchSelect` not exported.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
} from './combobox';

import { cn } from '@/lib/utils';
import type { SearchSelectOption } from './search-select';

type MultiSearchSelectProps<T extends SearchSelectOption> = {
    options: T[];
    values: string[];
    placeholder?: string;
    emptyText?: string;
    disabled?: boolean;
    loading?: boolean;
    onInputChange?: (value: string) => void;
    onChange?: (values: string[], options: T[]) => void;
};

export function MultiSearchSelect<T extends SearchSelectOption>({
    options,
    values,
    placeholder = '搜索...',
    emptyText = '未找到匹配项',
    disabled,
    loading,
    onInputChange,
    onChange,
}: MultiSearchSelectProps<T>) {
    const [inputValue, setInputValue] = useState('');
    const selectedOptions = useMemo(
        () => values.map((value) => options.find((option) => option.value === value)).filter(Boolean) as T[],
        [options, values],
    );

    const emit = (nextValues: string[]) => {
        const nextOptions = nextValues
            .map((value) => options.find((option) => option.value === value))
            .filter(Boolean) as T[];
        onChange?.(nextValues, nextOptions);
    };

    return (
        <div className="space-y-2">
            {selectedOptions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {selectedOptions.map((option) => (
                        <button key={option.value} type="button" aria-label={`移除 ${option.label}`} onClick={() => emit(values.filter((value) => value !== option.value))}>
                            {option.label}
                            <X size={12} />
                        </button>
                    ))}
                    <button type="button" aria-label="清空全部已选成员" onClick={() => emit([])}>
                        清空全部
                    </button>
                </div>
            )}

            <Combobox<string>
                value={null}
                open
                disabled={disabled}
                inputValue={inputValue}
                onInputValueChange={(value) => {
                    setInputValue(value);
                    onInputChange?.(value);
                }}
                onValueChange={(value) => {
                    if (!value || values.includes(value)) return;
                    emit([...values, value]);
                    setInputValue('');
                    onInputChange?.('');
                }}
            >
                <div className={cn('relative flex items-center rounded-md border border-input')}>
                    <ComboboxInput placeholder={placeholder} className="w-full border-0 bg-transparent px-3 py-2 text-sm shadow-none outline-none" />
                    <ComboboxTrigger className="absolute right-0 top-0 h-full w-8" />
                </div>
                <ComboboxContent className="w-[var(--anchor-width)] max-h-[300px]">
                    {loading ? (
                        <div className="p-3 text-sm text-muted-foreground">加载中...</div>
                    ) : options.length === 0 ? (
                        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
                    ) : (
                        <div className="p-1">
                            {options.map((option) => (
                                <ComboboxItem key={option.value} value={option.value}>
                                    <span>{option.label}</span>
                                </ComboboxItem>
                            ))}
                        </div>
                    )}
                </ComboboxContent>
            </Combobox>
        </div>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- src/components/ui/multi-search-select.test.tsx
```

Expected: PASS for the new multi-select interaction test.

- [ ] **Step 5: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/components/ui/multi-search-select.tsx \
        wb-data-frontend/src/components/ui/multi-search-select.test.tsx
git commit -m "feat: add multi search select for batch member picks"
```

## Task 2: Convert `AddMemberDialog` to batch selection

**Files:**
- Modify: `wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx`
- Test: `wb-data-frontend/src/components/ui/multi-search-select.test.tsx`

- [ ] **Step 1: Write the failing dialog tests**

```tsx
it('submits selected user ids with one shared role and username-only options', async () => {
    getAvailableUsers.mockResolvedValueOnce([
        { id: 7, username: 'bob', displayName: 'Bob 管理员' },
        { id: 8, username: 'alice', displayName: 'Alice 开发者' },
    ]);

    const onSuccess = vi.fn();

    render(
        <AddMemberDialog
            open
            groupId={12}
            onOpenChange={() => {}}
            onSuccess={onSuccess}
        />,
    );

    await userEvent.type(screen.getByPlaceholderText('搜索用户名'), 'a');
    expect(await screen.findByRole('option', { name: 'bob' })).toBeInTheDocument();
    expect(screen.queryByText('Bob 管理员')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'bob' }));
    await userEvent.click(screen.getByRole('option', { name: 'alice' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /角色/i }), 'GROUP_ADMIN');
    await userEvent.click(screen.getByRole('button', { name: '添加 2 名成员' }));

    expect(onSuccess).toHaveBeenCalledWith(
        { userIds: [7, 8], role: 'GROUP_ADMIN' },
        ['bob', 'alice'],
    );
});

it('supports removing one member and clearing all members', async () => {
    getAvailableUsers.mockResolvedValueOnce([
        { id: 7, username: 'bob', displayName: 'Bob 管理员' },
        { id: 8, username: 'alice', displayName: 'Alice 开发者' },
    ]);

    render(
        <AddMemberDialog
            open
            groupId={12}
            onOpenChange={() => {}}
            onSuccess={vi.fn()}
        />,
    );

    await userEvent.type(screen.getByPlaceholderText('搜索用户名'), 'a');
    await userEvent.click(await screen.findByRole('option', { name: 'bob' }));
    await userEvent.click(screen.getByRole('option', { name: 'alice' }));

    await userEvent.click(screen.getByRole('button', { name: '移除 bob' }));
    expect(screen.getByRole('button', { name: '添加 1 名成员' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '清空全部已选成员' }));
    expect(screen.getByRole('button', { name: '添加 0 名成员' })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- src/views/group-settings/AddMemberDialog.test.tsx
```

Expected: FAIL because the dialog still expects a single user payload and still exposes `displayName`.

- [ ] **Step 3: Write minimal implementation**

```tsx
type AddMembersPayload = {
    userIds: number[];
    role: string;
};

interface AddMemberDialogProps {
    open: boolean;
    groupId: number;
    onOpenChange: (details: { open: boolean }) => void;
    onSuccess: (payload: AddMembersPayload, usernames: string[]) => void;
}

const [selectedUsers, setSelectedUsers] = useState<AvailableUser[]>([]);

const userOptions: SearchSelectOption[] = users.map((user) => ({
    label: user.username,
    value: String(user.id),
    raw: user,
}));

const handleSubmit = () => {
    if (selectedUsers.length === 0 || submitting) return;
    setSubmitting(true);
    onSuccess(
        { userIds: selectedUsers.map((user) => user.id), role },
        selectedUsers.map((user) => user.username),
    );
};

<MultiSearchSelect
    options={userOptions}
    values={selectedUsers.map((user) => String(user.id))}
    placeholder="搜索用户名"
    emptyText={searchError || '请输入关键词搜索'}
    onInputChange={setSearchKeyword}
    onChange={(_, selectedOptions) => {
        setSelectedUsers(selectedOptions.map((option) => option.raw as AvailableUser));
    }}
/>

<Button
    variant="default"
    type="button"
    disabled={selectedUsers.length === 0 || submitting}
    onClick={handleSubmit}
>
    {submitting ? '添加中...' : `添加 ${selectedUsers.length} 名成员`}
</Button>
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- src/components/ui/multi-search-select.test.tsx src/views/group-settings/AddMemberDialog.test.tsx
```

Expected: PASS for the component and dialog batch-selection tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/views/group-settings/AddMemberDialog.tsx \
        wb-data-frontend/src/views/group-settings/AddMemberDialog.test.tsx
git commit -m "feat: support batch member selection in add dialog"
```

## Task 3: Wire the frontend batch API and page mutation

**Files:**
- Modify: `wb-data-frontend/src/api/groupSettings.ts`
- Create: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.test.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx`

- [ ] **Step 1: Write the failing page-level mutation test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

import GroupSettingsPage from './GroupSettingsPage';

const showFeedback = vi.fn();

const addMembers = vi.fn().mockResolvedValue(undefined);

vi.mock('../../api/groupSettings', async () => {
    const actual = await vi.importActual<typeof import('../../api/groupSettings')>('../../api/groupSettings');
    return {
        ...actual,
        addMembers,
        getGroupSettings: vi.fn().mockResolvedValue({ id: 1, name: 'policy', description: '' }),
        getMemberPage: vi.fn().mockResolvedValue({ records: [], total: 0, pages: 1, current: 1 }),
    };
});

vi.mock('../../components/ui/use-operation-feedback', () => ({
    useOperationFeedback: () => ({ showFeedback }),
}));

vi.mock('./AddMemberDialog', () => ({
    default: ({ open, onSuccess }: { open: boolean; onSuccess: (payload: { userIds: number[]; role: string }, usernames: string[]) => void }) =>
        open ? <button onClick={() => onSuccess({ userIds: [7, 8], role: 'DEVELOPER' }, ['bob', 'alice'])}>提交批量成员</button> : null,
}));

it('submits the batch payload and shows quantity-based success copy', async () => {
    render(
        <QueryClientProvider client={new QueryClient()}>
            <GroupSettingsPage />
        </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: '添加成员' }));
    await userEvent.click(screen.getByRole('button', { name: '提交批量成员' }));

    await waitFor(() => expect(addMembers).toHaveBeenCalledWith(1, { userIds: [7, 8], role: 'DEVELOPER' }));
    expect(showFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
            tone: 'success',
            detail: '2 名成员已加入项目组。',
        }),
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- src/views/group-settings/GroupSettingsPage.test.tsx
```

Expected: FAIL because `addMembers` does not exist yet and the page still calls `addMember`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface AddMembersPayload {
    userIds: number[];
    role: string;
}

export const addMembers = (groupId: number, data: AddMembersPayload) => {
    return request.post<unknown, void>('/api/v1/group-settings/members/batch', data, { params: { groupId } });
};
```

```tsx
const addMemberSummaryRef = useRef<string>('');

const addMembersMutation = useMutation({
    mutationFn: (payload: AddMembersPayload) => addMembers(groupId!, payload),
    onSuccess: () => {
        setIsAddMemberOpen(false);
        showFeedback({
            tone: 'success',
            title: '成员已添加',
            detail: addMemberSummaryRef.current || '成员已加入项目组。',
        });
        void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
    },
});

const handleAddMemberSuccess = (payload: AddMembersPayload, usernames: string[]) => {
    addMemberSummaryRef.current = `${usernames.length} 名成员已加入项目组。`;
    addMembersMutation.mutate(payload);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- src/views/group-settings/GroupSettingsPage.test.tsx src/views/group-settings/AddMemberDialog.test.tsx
```

Expected: PASS for the new batch mutation path and dialog integration.

- [ ] **Step 5: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-frontend/src/api/groupSettings.ts \
        wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx \
        wb-data-frontend/src/views/group-settings/GroupSettingsPage.test.tsx
git commit -m "feat: wire group settings batch member add flow"
```

## Task 4: Add transactional backend batch add support

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/dto/AddMembersRequest.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/controller/GroupSettingsController.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/service/GroupSettingsService.java`
- Modify: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/group/service/GroupSettingsServiceTest.java`

- [ ] **Step 1: Write the failing backend tests**

```java
@Test
void addMembers_addsAllUsersWhenEveryUserIsValid() {
    AddMembersRequest request = new AddMembersRequest();
    request.setUserIds(List.of(2L, 3L));
    request.setRole(GroupRole.DEVELOPER.name());

    when(userMapper.selectBatchIds(List.of(2L, 3L))).thenReturn(List.of(
            activeUser(2L, "dev_alpha", "Alpha", SystemRole.USER.name()),
            activeUser(3L, "ga_alpha", "GA", SystemRole.USER.name())
    ));
    when(memberMapper.exists(any())).thenReturn(false);

    groupSettingsService.addMembers(12L, request, 99L);

    verify(memberMapper, times(2)).insert(any(WbProjectGroupMember.class));
}

@Test
void addMembers_rejectsEntireBatchWhenOneUserIsAlreadyMember() {
    AddMembersRequest request = new AddMembersRequest();
    request.setUserIds(List.of(2L, 3L));
    request.setRole(GroupRole.DEVELOPER.name());

    when(userMapper.selectBatchIds(List.of(2L, 3L))).thenReturn(List.of(
            activeUser(2L, "dev_alpha", "Alpha", SystemRole.USER.name()),
            activeUser(3L, "ga_alpha", "GA", SystemRole.USER.name())
    ));
    when(memberMapper.exists(any())).thenReturn(true);

    assertThrows(ResponseStatusException.class, () -> groupSettingsService.addMembers(12L, request, 99L));
    verify(memberMapper, never()).insert(any(WbProjectGroupMember.class));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend
mvn -q -Dtest=GroupSettingsServiceTest test
```

Expected: FAIL because `AddMembersRequest` and `addMembers(...)` do not exist.

- [ ] **Step 3: Write minimal implementation**

```java
@Data
public class AddMembersRequest {

    @NotEmpty(message = "请选择至少一个用户")
    private List<@NotNull(message = "用户不能为空") Long> userIds;

    @NotBlank(message = "请选择项目组角色")
    @Pattern(regexp = "^(GROUP_ADMIN|DEVELOPER)$", message = "角色必须为 GROUP_ADMIN 或 DEVELOPER")
    private String role;
}
```

```java
@PostMapping("/members/batch")
public Result<Void> addMembers(
        @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
        @Validated @RequestBody AddMembersRequest req) {
    groupSettingsService.addMembers(context.currentGroup().id(), req, context.user().id());
    return Result.success(null);
}
```

```java
@Transactional
public void addMembers(Long groupId, AddMembersRequest req, Long operatorId) {
    List<Long> userIds = req.getUserIds().stream().distinct().toList();
    List<WbUser> users = userMapper.selectBatchIds(userIds);

    if (users.size() != userIds.size()) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "存在无效用户");
    }

    for (WbUser user : users) {
        if (!"ACTIVE".equals(user.getStatus())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "存在已禁用用户");
        }
        if (SystemRole.SYSTEM_ADMIN.name().equals(user.getSystemRole())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SYSTEM_ADMIN 无需加入项目组");
        }
        boolean alreadyMember = memberMapper.exists(new LambdaQueryWrapper<WbProjectGroupMember>()
                .eq(WbProjectGroupMember::getGroupId, groupId)
                .eq(WbProjectGroupMember::getUserId, user.getId()));
        if (alreadyMember) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "所选用户中存在已加入项目组的成员");
        }
    }

    for (WbUser user : users) {
        WbProjectGroupMember member = new WbProjectGroupMember();
        member.setGroupId(groupId);
        member.setUserId(user.getId());
        member.setRole(req.getRole());
        member.setCreatedBy(operatorId);
        member.setUpdatedBy(operatorId);
        memberMapper.insert(member);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend
mvn -q -Dtest=GroupSettingsServiceTest test
```

Expected: PASS for the new batch add service rules.

- [ ] **Step 5: Commit**

```bash
cd /Users/wenbin/Projects/wb-data
git add wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/dto/AddMembersRequest.java \
        wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/controller/GroupSettingsController.java \
        wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/service/GroupSettingsService.java \
        wb-data-server/wb-data-backend/src/test/java/com/wbdata/group/service/GroupSettingsServiceTest.java
git commit -m "feat: add transactional batch member add endpoint"
```

## Task 5: End-to-end verification and regression check

**Files:**
- Verify only; no planned source changes unless a test fails

- [ ] **Step 1: Run targeted frontend tests**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run test -- src/components/ui/multi-search-select.test.tsx \
               src/views/group-settings/AddMemberDialog.test.tsx \
               src/views/group-settings/GroupSettingsPage.test.tsx \
               src/components/ui/search-select.test.tsx
```

Expected: PASS for batch add and prior popup pointer-interaction regressions.

- [ ] **Step 2: Run backend tests**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend
mvn -q test
```

Expected: PASS for backend module tests.

- [ ] **Step 3: Run manual browser verification**

```text
1. 登录 policy 项目
2. 打开“添加成员”
3. 输入 a，确认候选只显示用户名
4. 连续选择至少 2 个用户
5. 在已选标签区移除 1 个，再重新添加
6. 使用“清空全部”验证按钮禁用恢复
7. 再次选择 2 个用户并提交
8. 确认成功提示显示“2 名成员已加入项目组。”
9. 刷新成员列表，确认 2 个成员都已加入且角色一致
```

- [ ] **Step 4: Check for unrelated frontend build/lint noise before escalating**

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend
npm run lint || true
npm run build || true
```

Expected: If failures remain, confirm they are still the pre-existing unrelated issues already known on current `main`, not regressions from this feature.

- [ ] **Step 5: Final commit if verification required small follow-up fixes**

```bash
cd /Users/wenbin/Projects/wb-data
git status --short
```

Expected: clean tree, or only intentional follow-up fixes staged for a final small commit.
