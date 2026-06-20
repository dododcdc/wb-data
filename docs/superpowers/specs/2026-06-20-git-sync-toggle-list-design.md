# Git Branch Sync Settings UI/UX Redesign Specification

## 1. Overview
The target of this spec is to refactor the branch scheduling synchronization tab (`KestraSyncSettingsTab.tsx`) inside the Project Group Settings view. The goal is to provide a clean, modern, and state-of-the-art interactive list mapping Git branches to automatic Kestra flow synchronizations.

---

## 2. Interactive Lifecycle Design
Instead of using a dropdown box to "add" branches, the UI will list **all available branches** in the Git repository. Each branch row will have an independent Switch toggle representing auto-sync status.

The configuration lifecycle consists of three states:

### State A: 未开启 (Not Enabled)
*   **Trigger Condition**: No configuration exists in the database for this branch.
*   **UI Elements**:
    *   Branch name (standard text).
    *   Switch toggle is **OFF**.
    *   Status label: `未开启自动同步` (Auto-sync not enabled).
    *   No action buttons (e.g. no "Sync once", no "Remove").
*   **Action**: Toggling the Switch to **ON** calls `createGitSyncConfig` to initialize the sync record in the database.

### State B: 自动同步中 (Active Syncing)
*   **Trigger Condition**: Configuration exists in the database and `config.enabled === true`.
*   **UI Elements**:
    *   Branch name (bold text).
    *   Switch toggle is **ON**.
    *   Status badge: Green badge displaying `同步成功` (Sync Success) or red badge displaying `同步失败` (Sync Failed), alongside `上次同步时间` (Last Sync Time).
    *   Action button: `同步一次` (Sync Once).
    *   No delete button (disabled/hidden to prevent accidental deletion of active sync configs).
*   **Action**:
    *   Toggling the Switch to **OFF** calls `updateGitSyncConfigStatus(id, false)` to pause the sync without deleting history.
    *   Clicking `同步一次` triggers manual synchronization.

### State C: 自动同步已暂停 (Paused)
*   **Trigger Condition**: Configuration exists in the database and `config.enabled === false`.
*   **UI Elements**:
    *   Branch name (muted text, row has a slightly disabled opacity).
    *   Switch toggle is **OFF**.
    *   Status label: `自动同步已暂停` (Auto-sync paused).
    *   History details: Displays last sync time, status badge, and **expandable sync error message** if last sync failed.
    *   Action buttons:
        *   `同步一次` (Sync Once) - enabled for manual debugging.
        *   `移出同步` (Remove) - a destructive text link/button to completely delete the configuration and history.
*   **Action**:
    *   Toggling the Switch to **ON** calls `updateGitSyncConfigStatus(id, true)` to resume auto-scheduling.
    *   Clicking `移出同步` calls `deleteGitSyncConfig(id)` to delete the config and reset the row to **State A**.

---

## 3. UI/UX Polishing Details
1.  **Fine-grained Loading Indicators**:
    *   Mutating state (triggering sync, deleting config, toggling switch) is tracked *per row* instead of globally blocking the page.
    *   Inline loading spinner (`LoaderCircle` animation) is displayed inside the clicked button or next to the toggle switch.
2.  **Expandable Compiler Errors**:
    *   If a sync config is in `FAILED` state, an expandable details link "查看同步报错详情" (View Error Details) is rendered.
    *   Expanding it displays the compiler traceback/error (`lastSyncMessage`) in a code snippet block (`pre`), enabling developers to troubleshoot Kestra flow YAML syntax errors directly.
3.  **Dynamic Schedule Description**:
    *   The cron scheduling explanation dynamically prints `syncCron` (e.g. `*/5 * * * *`) fetched from the backend, instead of hardcoding "every 5 minutes".

---

## 4. Technical Specifications
### Frontend Components
*   [KestraSyncSettingsTab.tsx](file:///Users/wenbin/Projects/wb-data/.worktrees/operations-center/wb-data-frontend/src/views/group-settings/KestraSyncSettingsTab.tsx)
*   [GitSettings.css](file:///Users/wenbin/Projects/wb-data/.worktrees/operations-center/wb-data-frontend/src/views/group-settings/GitSettings.css)

### API Methods
*   `createGitSyncConfig(groupId, branch)` (POST) -> Create configuration
*   `deleteGitSyncConfig(groupId, id)` (DELETE) -> Delete configuration
*   `updateGitSyncConfigStatus(groupId, id, enabled)` (PATCH) -> Enable/disable scheduler
*   `triggerGitSyncConfig(groupId, id)` (POST) -> Manual execution
