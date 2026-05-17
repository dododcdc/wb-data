# Multi-Branch Support Design

## Purpose

Enable per-group Git branch management so each branch maps to a Kestra environment (synced via `kestra-git-sync-plan.md`). The group admin controls which branch is active; all offline-flow commit and push operations target the currently checked-out branch.

## Scope

Local Git branch CRUD through the backend — no remote branch CRUD, no conflict resolution in the UI, no per-branch DB isolation.

## Non-Goals

- Stash / rebase / cherry-pick / diff / log browsing
- In-UI merge conflict resolution
- Automatic push after merge

---

## Architecture

### Single Working Directory + `git checkout`

Each group has exactly one local Git repository at `offline.repo-root/{groupId}/`. Branch switching runs `git checkout <branch>` in that directory. Because flows are stored as files in the working tree (YAML in `_flows/`, scripts in `scripts/`), switching branches naturally replaces all flow content — no database involvement.

Switching is blocked when unstaged or uncommitted changes exist — the admin must resolve them first.

```
GitCommandService (refactored from GitPushService)
├── getCurrentBranch(groupId)
├── listBranches(groupId)            // local + remote heads
├── createBranch(groupId, name, base)
├── switchBranch(groupId, branch)
├── mergeBranch(groupId, source, target)
├── deleteBranch(groupId, branch)
│
├── commitCurrentFlow(groupId, flowPath, message)
├── commitRepo(groupId, message)
├── push(groupId)                    // pushes HEAD to remote
└── rebuild(groupId)                 // pushes HEAD to remote
```

Push and pull commands no longer hard-code `main`. They operate on HEAD.

### Concurrency: Per-Group Lock

All operations that mutate the Git working tree on the same group must be serialized. Spring Boot handles concurrent requests on separate threads, and concurrent mutations can corrupt repository state (e.g. saving a flow while switching branches could land file writes on the wrong branch).

The lock must be shared across all services that touch the working tree:

| Service | Mutations |
|---------|-----------|
| `GitCommandService` | git checkout, commit, merge, push |
| `OfflineFlowContentService` | save/delete/rename `_flows/**/flow.yaml` |
| `OfflineFlowDocumentService` | save `_flows/**/flow.yaml`, write `scripts/**/*` |
| `OfflineRepoTreeService` | create/delete/rename folders, write `.gitkeep` |

**Implementation**: extract a shared lock manager as a Spring bean, injected into all four services:

```java
@Component
public class RepoLockManager {
    private final ConcurrentHashMap<Long, ReentrantLock> locks = new ConcurrentHashMap<>();

    public <T> T withLock(Long groupId, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(groupId, k -> new ReentrantLock());
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }
}
```

All write methods in the four services acquire this lock via `repoLockManager.withLock(groupId, () -> { ... })`.

---

## Flow Storage: File System (Not DB)

Flows are stored directly in the Git working tree, not in a database table:

| What | Where |
|------|-------|
| Flow YAML | `_flows/{folder}/{name}/flow.yaml` |
| Layout | `_flows/{folder}/{name}/.layout.json` |
| Scripts | `scripts/{folder}/{name}/{taskId}.{sql\|hql}` |

`OfflineFlowContentService` reads/writes these files directly. `OfflineFlowDocumentService` parses the YAML and manages scripts in `scripts/`.

Because `git checkout <branch>` replaces all files in the working tree, flow content switches atomically with the branch. No per-branch DB migration is needed.

---

## API

All endpoints live in `OfflineRepoController`.

### Branch Management

| Method | Path | Permission | Body / Params |
|--------|------|------------|---------------|
| `GET` | `/api/v1/offline/repo/branches` | `OFFLINE_READ` | — |
| `POST` | `/api/v1/offline/repo/branch` | `GROUP_SETTINGS` | `{ name, baseBranch }` |
| `PUT` | `/api/v1/offline/repo/branch/switch` | `GROUP_SETTINGS` | `{ branch }` |
| `POST` | `/api/v1/offline/repo/branch/merge` | `GROUP_SETTINGS` | `{ source, target }` |
| `DELETE` | `/api/v1/offline/repo/branch` | `GROUP_SETTINGS` | `?name=xxx` |

### Branch Name Validation (DTO Rules)

Branch names are validated before any git operation:

```
1. Must pass `git check-ref-format --branch <name>`
2. Must not start with `-`
3. Must not be empty or whitespace-only
```

The branch list response distinguishes local and remote branches:

```java
record BranchItem(
    String name,           // short name (e.g. "main", "feature/pipeline")
    boolean isCurrent,     // currently checked out
    boolean isLocal,       // exists as a local branch
    boolean isRemote,      // exists as a remote tracking branch
    String remoteName,     // e.g. "origin/main" — null if not a remote tracking branch
    String trackingBranch  // local branch this remote ref tracks — null if local-only
) {}
```

Names are always the short form (`main`, `feature/x`), never including `origin/`. Remote branches that do not have a local counterpart appear as `isLocal=false, isRemote=true`.

### Existing Endpoints (unchanged signature, behaviour adapted)

`GET /repo/status` already returns `branch`. No signature change.

`POST /repo/push`, `POST /repo/push/rebuild` — internal implementations drop `main` and use `git push -u origin HEAD`. No signature change.

`POST /repo/commit/flow`, `POST /repo/commit` — no change.

---

## Git Operations Detail

### Create Branch

```
1. git checkout <baseBranch>
   → if baseBranch absent locally: git fetch origin <baseBranch> && git checkout <baseBranch>
2. git checkout -b <newBranch>
```

### Switch Branch

```
1. Check dirty: git status --porcelain
2. If dirty → return HTTP 409 + list of changed file paths
3. git checkout <branch>
   → if branch absent locally: git fetch origin <branch> && git checkout <branch>
```

The frontend shows the dirty file list and lets the admin commit or discard before retrying.

### Merge Branch

```
1. Check dirty: git status --porcelain
   If dirty → return error, refuse to merge
2. Remember current branch
3. git checkout <target>
4. git merge <source>
5. On success → done
6. On conflict →
   git merge --abort
   git checkout <remembered branch>
   return error: "合并冲突，请在本地解决后重新推送"
   On checkout failure → return error: "合并后恢复分支失败，请手动检查仓库状态"
```

### Delete Branch

```
- Refuse if branch is currently checked out
- Refuse if branch is main
- git branch -d <branch>  (safe delete, rejects unmerged)
- If user confirms force: git branch -D <branch>  (separate request)
```

### Push (adapted)

```
git push -u origin HEAD
```

Using `-u` sets upstream tracking on first push, so the repo status `ahead` detection works for newly created branches. Push always targets the current HEAD, not a hard-coded branch name.

### Repo Status Semantics with Branches

`GET /repo/status` returns `ahead` based on `git status --short --branch`. For branches without an upstream, the status line will not show `[ahead]`. The `hasRemote` flag is derived from `git remote -v` and indicates whether the group has any remote configured — it does not guarantee the current branch has an upstream.

Add a new field to `OfflineRepoStatusResponse`:

```java
boolean hasUpstream,  // true if current branch tracks a remote branch
```

`hasUpstream` is derived from `git rev-parse --abbrev-ref @{upstream}` (empty output → no upstream).

### Push Button Logic (Frontend)

Current disable condition:

```ts
// ❌ blocks first push for branches without upstream
disabled = hasRemote && !ahead
```

For a new branch without upstream: `hasRemote=true`, `ahead=false` → button disabled → admin can never push it.

Fixed logic using the new `hasUpstream` field:

```ts
// ✅ allows first push on new branches
disabled = hasRemote && !ahead && hasUpstream
```

If `hasRemote && !ahead && !hasUpstream` → new branch ready for first push → button ENABLED.

---

## Permission Model (No Changes)

| Role | Permissions | Branch Ops |
|------|-------------|------------|
| System Admin | all groups, all permissions | same as group admin |
| Group Admin | `GROUP_SETTINGS` + `OFFLINE_WRITE/READ` | create, switch, merge, delete branches; push |
| Developer | `OFFLINE_WRITE/READ` | view branches; edit/commit flows; **cannot push or switch** |

Pushes remain `GROUP_SETTINGS`-only. Developers push nothing to remote; the group admin pushes when the iteration is ready.

---

## Data Flow

```
Working tree (Git repo on disk)
  ├── _flows/{folder}/{name}/flow.yaml
  ├── _flows/{folder}/{name}/.layout.json
  └── scripts/{folder}/{name}/*.sql|*.hql

  ├── edit/save ──→ writes flow.yaml + scripts directly to working tree
  ├── commit ─────→ git add (scoped or repo-wide) → git commit
  └── push ───────→ git push -u origin HEAD (admin only)
```

Branch switching (`git checkout`) replaces all working tree files, so flow content changes atomically with the branch. The Kestra SyncFlows Flow pulls from the remote branch into the corresponding Kestra namespace.

---

## Frontend Changes

| Location | Change |
|----------|--------|
| Directory-tree capsule (already shows branch) | When user has `GROUP_SETTINGS`, make it clickable → show branch switcher dialog |
| `GitSettingsTab.tsx` | New "Branch Management" panel: table listing branches (current marked, main locked), create / switch / merge / delete buttons |
| `offline.ts` (API layer) | Add `fetchBranches`, `createBranch`, `switchBranch`, `mergeBranch`, `deleteBranch` functions |

## Merge / Conflict Flow (UI)

```
Admin clicks "Merge" on the branch panel
  → Source / Target dropdowns (source defaults to current branch)
  → Submit
  → Backend runs merge (with dirty check before)
  → Success toast OR conflict error message
```

## Dependencies

- No new database tables or migrations
- No new dependencies (git CLI already in use)
- No change to Kestra integration
- Blocked by: nothing
- Unblocks: `kestra-git-sync-plan.md` (branch-to-environment mapping)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Concurrent git operations race | Per-group `ReentrantLock` serializes all git commands |
| New branch has no upstream, push/status confusion | Push uses `git push -u origin HEAD`; status endpoint clarified |
| Destructive branch delete | Default `-d` (safe); `-D` only on explicit force request |
| Merge leaves repo in wrong branch on failure | Try/finally pattern restores original branch after abort |
| Dirty working tree blocks branch switch | Return dirty file list to UI, let admin resolve |
| Relying on filesystem state instead of DB for Flow storage | This is the existing architecture. Switching branches naturally switches flows. No change in behavior. |

## Implementation Order

1. Rename `GitPushService` → `GitCommandService`, extract shared `runGit`, add per-group `ReentrantLock`
2. Implement `listBranches`, `getCurrentBranch`
3. Implement `createBranch`, `switchBranch` (with dirty check)
4. Implement `mergeBranch` (with dirty check + restore on failure), `deleteBranch` (`-d` safe default)
5. Replace `main` hard-coding in push/pull with `HEAD`; use `-u` flag
6. Add 5 controller endpoints with DTO branch name validation
7. Frontend: branch switcher capsule + branch management panel
8. End-to-end smoke test: create branch → switch → edit flow → commit → push → merge to main
