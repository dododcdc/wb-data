# Multi-Branch Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-group local Git branch management for offline flows, with safe branch switching, branch-aware push, and frontend branch controls.

**Architecture:** Keep the existing single working-tree model under `offline.repo-root/{groupId}`. Add a shared per-group lock for all working-tree reads/writes that can race with checkout, refactor Git operations into a branch-aware command service, then expose branch APIs and connect the offline UI.

**Tech Stack:** Java 21, Spring Boot 3, JUnit 5, Mockito, React 18, TypeScript, Vite, Vitest.

---

## Checkpoints

- Backend-only checkpoint after Tasks 1-4: run `mvn test` from `wb-data-server`.
- Frontend checkpoint after Tasks 5-6: run `npm run test` from `wb-data-frontend`, then ask for UI smoke testing.
- Final checkpoint after Task 7: run backend + frontend tests and perform manual browser workflow with a group admin account.

## Files

- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/RepoLockManager.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/BranchItemResponse.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/BranchListResponse.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/CreateBranchRequest.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/SwitchBranchRequest.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/MergeBranchRequest.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/DeleteBranchRequest.java`
- Rename/Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/GitPushService.java` -> `GitCommandService.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineRepoStatusService.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowContentService.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowDocumentService.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineRepoTreeService.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/controller/OfflineRepoController.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/OfflineRepoStatusResponse.java`
- Modify/Test: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/GitPushServiceTest.java`
- Create/Test: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/GitCommandServiceBranchTest.java`
- Modify/Test: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/controller/OfflineRepoControllerPermissionTest.java`
- Modify: `wb-data-frontend/src/api/offline.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css`
- Modify/Test: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`

---

### Task 1: Shared Repo Lock

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/RepoLockManager.java`
- Modify: `OfflineFlowContentService.java`
- Modify: `OfflineFlowDocumentService.java`
- Modify: `OfflineRepoTreeService.java`
- Modify: `GitPushService.java`

- [ ] **Step 1: Write failing tests or targeted review cases**

Add unit-level assertions where practical around services that call file mutations. For methods that are difficult to unit-test without broad refactor, keep the implementation small and verify with integration tests in later tasks.

- [ ] **Step 2: Add shared lock manager**

```java
@Component
public class RepoLockManager {
    private final ConcurrentHashMap<Long, ReentrantLock> locks = new ConcurrentHashMap<>();

    public <T> T withLock(Long groupId, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(groupId, ignored -> new ReentrantLock());
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }

    public void withLock(Long groupId, Runnable action) {
        withLock(groupId, () -> {
            action.run();
            return null;
        });
    }
}
```

- [ ] **Step 3: Wrap working-tree reads/writes**

Use `repoLockManager.withLock(groupId, ...)` around:

- `OfflineFlowContentService`: `getFlowContent`, `saveFlowContent`, `deleteFlow`, `renameFlow`
- `OfflineFlowDocumentService`: `getFlowDocument`, `saveFlowDocument`, `resolveManagedFiles`, `compileFlowDraft`
- `OfflineRepoTreeService`: `getRepoTree`, `createFolder`, `deleteFolder`, `renameFolder`
- Existing Git commit/push methods until the service is renamed in Task 2

- [ ] **Step 4: Verify**

Run:

```bash
mvn -pl wb-data-backend -Dtest=OfflineFlowDocumentServiceTest test
```

Expected: existing tests still pass.

---

### Task 2: Branch-Aware Git Command Service

**Files:**
- Rename/Modify: `GitPushService.java` -> `GitCommandService.java`
- Modify: `OfflineRepoController.java`
- Modify/Test: `GitPushServiceTest.java` -> `GitCommandServiceTest.java`

- [ ] **Step 1: Write failing tests for push command behavior**

Update the Git service tests to verify push commands use `HEAD` instead of hard-coded `main`. The test should fail while the service still runs:

```text
git push -u origin main --force
```

Expected new behavior:

```text
git push -u origin HEAD
```

- [ ] **Step 2: Rename service and preserve existing commit behavior**

Rename `GitPushService` to `GitCommandService`; update controller injection and nested result references. Keep commit APIs and response records compatible:

```java
public record PushResult(boolean success, String message, String remoteUrl, boolean remoteCreated, boolean remoteDeleted) {}
public record CommitResult(boolean success, String message) {}
```

- [ ] **Step 3: Replace hard-coded push/pull branch**

Change push and rebuild to use:

```java
runGit(repoPath, "push", "-u", "origin", "HEAD");
```

If fallback pull remains, it must operate against the current upstream only when an upstream exists. Do not `pull --rebase origin main`.

- [ ] **Step 4: Verify**

Run:

```bash
mvn -pl wb-data-backend -Dtest=GitCommandServiceTest test
```

Expected: push tests pass and no command references `origin main` for push/pull.

---

### Task 3: Repo Status With Upstream

**Files:**
- Modify: `OfflineRepoStatusService.java`
- Modify: `OfflineRepoStatusResponse.java`
- Test: create or extend `OfflineRepoStatusServiceTest.java`

- [ ] **Step 1: Write failing status tests**

Create tests using a temporary Git repository:

- branch with upstream returns `hasUpstream=true`
- branch without upstream returns `hasUpstream=false`
- existing `ahead` behavior remains intact

- [ ] **Step 2: Add field to DTO**

Add `boolean hasUpstream` to `OfflineRepoStatusResponse` after `hasRemote`.

- [ ] **Step 3: Implement upstream detection**

Use:

```java
String upstream = tryRunGitCommand(repoPath, "rev-parse", "--abbrev-ref", "@{upstream}");
boolean hasUpstream = upstream != null && !upstream.isBlank();
```

Treat missing upstream as normal, not an error.

- [ ] **Step 4: Verify**

Run:

```bash
mvn -pl wb-data-backend -Dtest=OfflineRepoStatusServiceTest test
```

Expected: upstream tests pass.

---

### Task 4: Branch CRUD APIs

**Files:**
- Create DTOs listed in the Files section
- Modify: `GitCommandService.java`
- Modify: `OfflineRepoController.java`
- Test: `GitCommandServiceBranchTest.java`
- Test: `OfflineRepoControllerPermissionTest.java`

- [ ] **Step 1: Write failing branch service tests**

Use temporary local Git repositories to cover:

- `listBranches` returns current local branch and remote-only branch using short names
- `createBranch` rejects dirty working tree with changed file paths
- `createBranch` switches to the new branch when clean
- `switchBranch` rejects dirty working tree
- `switchBranch` creates local tracking branch for remote-only branch
- `deleteBranch` refuses current branch and `main`
- `deleteBranch` uses safe delete by default

- [ ] **Step 2: Add DTOs**

Use short branch names only:

```java
public record BranchItemResponse(String name, boolean current, boolean local, boolean remote, String remoteName, String trackingBranch) {}
public record BranchListResponse(List<BranchItemResponse> branches) {}
public record CreateBranchRequest(@NotBlank String name, @NotBlank String baseBranch) {}
public record SwitchBranchRequest(@NotBlank String branch) {}
public record MergeBranchRequest(@NotBlank String source, @NotBlank String target) {}
public record DeleteBranchRequest(@NotBlank String name, boolean force) {}
```

- [ ] **Step 3: Implement validation**

Validate each branch name before Git operations:

```java
runGit(repoPath, "check-ref-format", "--branch", branch);
if (branch.startsWith("-") || branch.isBlank()) {
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支名称不合法");
}
```

- [ ] **Step 4: Implement branch operations**

Required behavior:

- dirty tree returns `409 Conflict` and changed path list in the message or a structured error body if existing error handling supports it
- local branch switch uses `git switch <branch>`
- remote-only switch uses:

```bash
git fetch origin <branch>:refs/remotes/origin/<branch>
git switch --track -c <branch> origin/<branch>
```

- merge checks dirty state first and restores the remembered branch after conflicts
- safe delete uses `git branch -d`; force delete uses `git branch -D` only when `force=true`

- [ ] **Step 5: Add controller endpoints**

Add to `OfflineRepoController`:

```text
GET    /api/v1/offline/repo/branches
POST   /api/v1/offline/repo/branch
PUT    /api/v1/offline/repo/branch/switch
POST   /api/v1/offline/repo/branch/merge
DELETE /api/v1/offline/repo/branch
```

Permissions:

- list: `OFFLINE_READ`
- create/switch/merge/delete: `GROUP_SETTINGS`

- [ ] **Step 6: Verify**

Run:

```bash
mvn -pl wb-data-backend -Dtest=GitCommandServiceBranchTest,OfflineRepoControllerPermissionTest test
```

Expected: branch behavior and permission tests pass.

---

### Task 5: Frontend API and Push State

**Files:**
- Modify: `wb-data-frontend/src/api/offline.ts`
- Modify/Test: `OfflineWorkbench.test.tsx`

- [ ] **Step 1: Write failing frontend tests**

Add or update tests so a group admin sees push enabled when:

```ts
repoStatus.hasRemote === true
repoStatus.ahead === false
repoStatus.hasUpstream === false
repoStatus.headCommitId !== null
```

- [ ] **Step 2: Update TypeScript types**

Add to `OfflineRepoStatus`:

```ts
hasUpstream: boolean;
```

Add branch types and API functions:

```ts
export interface BranchItem {
  name: string;
  current: boolean;
  local: boolean;
  remote: boolean;
  remoteName: string | null;
  trackingBranch: string | null;
}

export interface BranchListResponse {
  branches: BranchItem[];
}
```

- [ ] **Step 3: Add API functions**

Add:

```ts
fetchOfflineBranches(groupId)
createOfflineBranch(groupId, name, baseBranch)
switchOfflineBranch(groupId, branch)
mergeOfflineBranch(groupId, source, target)
deleteOfflineBranch(groupId, name, force)
```

- [ ] **Step 4: Fix push disabled logic**

Replace:

```ts
repoStatus?.hasRemote && !repoStatus?.ahead
```

with:

```ts
repoStatus?.hasRemote && !repoStatus?.ahead && repoStatus?.hasUpstream
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run test -- OfflineWorkbench.test.tsx
```

Expected: push state tests pass.

---

### Task 6: Branch UI

**Files:**
- Modify: `OfflineWorkbench.tsx`
- Modify: `OfflineWorkbench.css`
- Test: `OfflineWorkbench.test.tsx`

- [ ] **Step 1: Add branch dialog state and loading**

Add state for:

- branch list
- branch dialog open
- create branch form
- merge form
- pending action
- dirty error file list

- [ ] **Step 2: Make branch capsule actionable for group admins**

When `isGroupAdmin`, render the branch capsule as a button with `aria-label="管理分支"`. Developers should see the branch label but not branch action controls.

- [ ] **Step 3: Add branch management dialog**

Dialog must show:

- current branch
- local/remote branch list
- create branch form
- switch action
- merge action
- safe delete action
- dirty file warning when backend returns 409

- [ ] **Step 4: Refresh workspace after branch-changing actions**

After create/switch/merge/delete success:

```ts
await refreshRepoStatus();
await refreshRepoTree();
if (activeFlowPath) await openFlowDocument(activeFlowPath);
```

If the current flow no longer exists on the new branch, clear the active flow and show the empty state.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test -- OfflineWorkbench.test.tsx
```

Expected: branch controls render only for group admins and refresh callbacks run after switch.

---

### Task 7: Full Verification and Manual Test

**Files:**
- No required source changes unless tests expose defects.

- [ ] **Step 1: Backend tests**

Run:

```bash
mvn test
```

Expected: all backend modules pass.

- [ ] **Step 2: Frontend tests**

Run:

```bash
npm run test
```

Expected: all frontend tests pass.

- [ ] **Step 3: Manual UI smoke test with group admin**

Use a test project group with Git configured:

1. Open offline workbench.
2. Create branch `feature/branch-smoke`.
3. Confirm branch capsule updates.
4. Edit and save a Flow.
5. Commit current Flow.
6. Push branch for the first time.
7. Switch back to `main`.
8. Confirm tree/document refreshes.
9. Merge `feature/branch-smoke` into `main`.

- [ ] **Step 4: Manual permission test with developer**

1. Login as developer in same group.
2. Confirm branch label is visible.
3. Confirm branch management, push, and repo commit controls are not available.
4. Confirm developer can still edit/save and commit current Flow if they have `OFFLINE_WRITE`.

---

## Execution Recommendation

Use two implementation checkpoints:

1. Backend checkpoint after Tasks 1-4. No user UI testing required.
2. Frontend/manual checkpoint after Tasks 5-7. User should test with group admin and developer accounts.
