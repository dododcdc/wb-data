# Kestra Git Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register per-branch Kestra SyncFlows jobs for project groups so pushed offline flows are synced from GitHub/GitLab into branch-specific Kestra namespaces and scheduled by Kestra.

**Architecture:** Keep wb-data as the configuration owner and Kestra as the scheduler. wb-data stores desired sync configs per group and branch, generates `system/sync-flows-g{groupId}-{branchKey}` flows, triggers the current branch after push, and exposes a project-group settings UI for adding one branch or all branches.

**Tech Stack:** Spring Boot 3, MyBatis-Plus, Flyway, Kestra REST API, React 18, TanStack Query, Vitest, Maven/JUnit/Mockito.

---

### Task 1: Backend Sync Config Model

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/resources/db/migration/V12__create_wb_git_sync_config.sql`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/git/entity/WbGitSyncConfig.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/git/mapper/WbGitSyncConfigMapper.java`
- Create DTOs under `wb-data-server/wb-data-backend/src/main/java/com/wbdata/git/dto/`

- [x] Add Flyway table `wb_git_sync_config` with `group_id`, `git_config_id`, `branch`, `enabled`, `last_sync_at`, `last_sync_status`, `last_sync_message`, and unique `(group_id, branch)`.
- [x] Add MyBatis entity and mapper.
- [x] Add request/response records for list, create, enable/disable, trigger, and add-all results.
- [x] Verify backend compiles with `mvn -pl wb-data-backend -DskipTests compile`.

### Task 2: Kestra API Surface

**Files:**
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/KestraClient.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/KestraHttpClient.java`
- Test: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/KestraHttpClientTest.java`

- [x] Add `deleteFlow(namespace, flowId)` and `validateFlow(source)`.
- [x] Keep existing `createExecution(namespace, flowId)` as the manual sync trigger.
- [x] Add tests proving validate hits `/api/v1/{tenant}/flows/validate` with `application/x-yaml`.
- [x] Add tests proving delete hits `/api/v1/{tenant}/flows/{namespace}/{flowId}`.

### Task 3: Sync Flow Generation Service

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/git/service/GitSyncConfigService.java`
- Create: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/git/service/GitSyncConfigServiceTest.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/config/OfflineKestraProperties.java`
- Modify: `wb-data-server/wb-data-backend/src/main/resources/application.yml`

- [x] Add `wbdata.git.sync-cron` defaulting to `*/5 * * * *`.
- [x] Generate stable branch keys using lowercase slug + hash suffix under Kestra namespace limits.
- [x] Generate Sync YAML with `SyncFlows`, `SyncNamespaceFiles`, credentials as input defaults, `delete: true`, `SyncFlows.targetNamespace`, and `SyncNamespaceFiles.namespace`.
- [x] Add service methods: list, create, createAllKnownBranches, setEnabled, delete, trigger.
- [x] Validate branch names against known local/remote branches from `GitCommandService.listBranches`.
- [x] Upsert Kestra sync flow whenever config is created or enabled state changes.
- [x] Trigger sets latest sync metadata from the created Kestra execution.

### Task 4: Controller And Push Integration

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/git/controller/GitSyncConfigController.java`
- Test: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/git/controller/GitSyncConfigControllerPermissionTest.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/GitCommandService.java`

- [x] Expose `/api/v1/git/sync-config` endpoints with `OFFLINE_READ` for list and `GROUP_SETTINGS` for mutations.
- [x] Add `POST /api/v1/git/sync-config/all-known-branches`.
- [x] Add `POST /api/v1/git/sync-config/{id}/trigger`.
- [x] After successful `GitCommandService.push`, trigger the current branch sync config if one exists; do not fail the push if Kestra sync trigger fails.

### Task 5: Frontend Group Settings UI

**Files:**
- Modify: `wb-data-frontend/src/views/group-settings/gitSettingsApi.ts`
- Create: `wb-data-frontend/src/views/group-settings/KestraSyncSettingsTab.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.tsx`
- Modify: `wb-data-frontend/src/views/group-settings/GitSettings.css`
- Test: `wb-data-frontend/src/views/group-settings/KestraSyncSettingsTab.test.tsx`
- Test: `wb-data-frontend/src/views/group-settings/GroupSettingsPage.test.tsx`

- [x] Keep remote repository connection settings focused in the `远程仓库` tab.
- [x] Add an independent `调度同步` tab with an `自动同步` section.
- [x] Fetch sync configs when Git config exists.
- [x] Render a compact list of branches that are included in automatic sync without exposing Kestra internals.
- [x] Add a branch dropdown for a single branch and a `同步全部分支` action.
- [x] Add `同步一次` and `移出同步` row actions; `移出同步` removes the sync config and Kestra flow, not the Git branch.
- [x] Hide mutation controls for read-only users.

### Task 6: Verification

**Commands:**
- `cd wb-data-server && mvn clean install`
- `cd wb-data-frontend && npm run lint`
- `cd wb-data-frontend && npm run build`
- `cd wb-data-frontend && npm run test`

- [x] Log in as `admin/admin123`, switch to policy group.
- [x] Add all known branches to Kestra sync.
- [x] Cover push-trigger behavior with `GitCommandServiceTest`; skip live push to avoid creating/updating a remote branch during verification.
- [x] Confirm Kestra contains `system/sync-flows-g{groupId}-{branchKey}` and target namespace `g{groupId}-{branchKey}` via live manual trigger.
