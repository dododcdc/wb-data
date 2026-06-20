# Git Branch Sync Settings UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Git branch synchronization interface into a full list of available repository branches with inline status badges, error logs, and scheduling toggle switches.

**Architecture:** Retrieve both `availableBranches` and `configs` from the API, merge them dynamically on the client, and render all available branches. Each branch has an independent status switch and localized actions.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide Icons, TanStack React Query.

---

### Task 1: Refactor UI Component State Mapping in KestraSyncSettingsTab

**Files:**
- Modify: `wb-data-frontend/src/views/group-settings/KestraSyncSettingsTab.tsx`

- [ ] **Step 1: Write state mapping and Switch action logic**
  Update the main render of `KestraSyncSettingsTab` to dynamically compute `unsyncedBranches` (only for dropdown select if needed, though dropdown is disabled/hidden now) and map all `availableBranches` in the Git repository.
  Modify `KestraSyncSettingsTab.tsx` as follows:
  ```tsx
  import { useCallback, useEffect, useMemo, useState } from 'react';
  import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
  import { LoaderCircle } from 'lucide-react';

  import './GitSettings.css';
  import {
      createAllGitSyncConfigs,
      createGitSyncConfig,
      deleteGitSyncConfig,
      getGitConfig,
      getGitSyncConfigs,
      triggerGitSyncConfig,
      updateGitSyncConfigStatus,
      type GitSyncConfig,
  } from './gitSettingsApi';
  import { Button } from '../../components/ui/button';
  import { SimpleSelect } from '../../components/SimpleSelect';
  import { useOperationFeedback } from '../../hooks/useOperationFeedback';

  interface KestraSyncSettingsTabProps {
      groupId: number;
      canEdit: boolean;
      onConfigureGit?: () => void;
  }

  export default function KestraSyncSettingsTab({ groupId, canEdit, onConfigureGit }: KestraSyncSettingsTabProps) {
      const { showFeedback } = useOperationFeedback();
      const queryClient = useQueryClient();
      const [selectedSyncBranch, setSelectedSyncBranch] = useState('');

      const { data: config, isLoading: configLoading } = useQuery({
          queryKey: ['git-config', groupId],
          queryFn: () => getGitConfig(groupId),
          enabled: groupId != null,
      });

      const { data: syncData, isLoading: syncLoading } = useQuery({
          queryKey: ['git-sync-config', groupId],
          queryFn: () => getGitSyncConfigs(groupId),
          enabled: groupId != null && !!config,
      });

      const unsyncedBranches = useMemo(() => {
          const configured = new Set((syncData?.configs ?? []).map((item) => item.branch));
          return (syncData?.availableBranches ?? []).filter((branch) => !configured.has(branch));
      }, [syncData]);

      useEffect(() => {
          if (unsyncedBranches.length === 0) {
              setSelectedSyncBranch('');
              return;
          }
          setSelectedSyncBranch((current) => unsyncedBranches.includes(current) ? current : unsyncedBranches[0]);
      }, [unsyncedBranches]);

      const invalidateSyncConfigs = useCallback(() => {
          void queryClient.invalidateQueries({ queryKey: ['git-sync-config', groupId] });
      }, [groupId, queryClient]);

      const createSyncMutation = useMutation({
          mutationFn: (branch: string) => createGitSyncConfig(groupId, branch),
          onSuccess: () => {
              showFeedback({ tone: 'success', title: '同步分支已添加', detail: '' });
              invalidateSyncConfigs();
          },
          onError: () => {
              showFeedback({ tone: 'error', title: '添加同步分支失败', detail: '' });
          },
      });

      const createAllSyncMutation = useMutation({
          mutationFn: () => createAllGitSyncConfigs(groupId),
          onSuccess: (result) => {
              showFeedback({ tone: 'success', title: '同步分支已更新', detail: `新增 ${result.created} 个，已有 ${result.existing} 个` });
              invalidateSyncConfigs();
          },
          onError: () => {
              showFeedback({ tone: 'error', title: '同步全部分支失败', detail: '' });
          },
      });

      const triggerSyncMutation = useMutation({
          mutationFn: (id: number) => triggerGitSyncConfig(groupId, id),
          onSuccess: () => {
              showFeedback({ tone: 'success', title: '同步已触发', detail: '' });
              invalidateSyncConfigs();
          },
          onError: () => {
              showFeedback({ tone: 'error', title: '触发同步失败', detail: '' });
          },
      });

      const deleteSyncMutation = useMutation({
          mutationFn: (id: number) => deleteGitSyncConfig(groupId, id),
          onSuccess: () => {
              showFeedback({ tone: 'success', title: '已移出同步', detail: '' });
              invalidateSyncConfigs();
          },
          onError: () => {
              showFeedback({ tone: 'error', title: '移出同步失败', detail: '' });
          },
      });

      const updateStatusMutation = useMutation({
          mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateGitSyncConfigStatus(groupId, id, enabled),
          onSuccess: () => {
              showFeedback({ tone: 'success', title: '自动同步状态已更新', detail: '' });
              invalidateSyncConfigs();
          },
          onError: () => {
              showFeedback({ tone: 'error', title: '更新同步状态失败', detail: '' });
          },
      });

      const handleAddSyncBranch = useCallback(() => {
          if (!selectedSyncBranch) {
              showFeedback({ tone: 'error', title: '请选择分支', detail: '' });
              return;
          }
          createSyncMutation.mutate(selectedSyncBranch);
      }, [createSyncMutation, selectedSyncBranch, showFeedback]);

      const isLoading = configLoading || (!!config && syncLoading);

      return (
          <div className="kestra-sync-settings-page">
              <section className="git-settings-section">
                  <div className="git-settings-section-header">
                      <div>
                          <h2 className="git-settings-title">自动同步</h2>
                          <p className="git-settings-description">
                              按分支同步远程仓库中的任务与脚本。
                              {syncData?.syncCron ? `当前定时调度周期为：${syncData.syncCron}。` : '默认每 5 分钟自动同步一次。'}
                          </p>
                      </div>
                  </div>

                  {isLoading ? (
                      <div className="git-settings-loading">
                          <LoaderCircle size={20} className="offline-spin" />
                      </div>
                  ) : !config ? (
                      <div className="git-sync-empty-state">
                          <p>{canEdit ? '先连接远程仓库，再选择需要自动同步的分支。' : '尚未配置远程仓库，请联系项目组管理员处理。'}</p>
                          {canEdit && onConfigureGit ? (
                              <Button type="button" size="sm" variant="outline" onClick={onConfigureGit}>
                                  配置远程仓库
                              </Button>
                          ) : null}
                      </div>
                  ) : (
                      <>
                          {canEdit ? (
                              <div className="git-sync-toolbar">
                                  <SimpleSelect
                                      value={selectedSyncBranch}
                                      options={unsyncedBranches.map((branch) => ({ value: branch, label: branch }))}
                                      onChange={setSelectedSyncBranch}
                                      className="git-sync-branch-select"
                                      placeholder={unsyncedBranches.length === 0 ? '所有分支已同步' : '选择分支'}
                                      disabled={unsyncedBranches.length === 0 || createSyncMutation.isPending}
                                  />
                                  <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={handleAddSyncBranch}
                                      disabled={!selectedSyncBranch || createSyncMutation.isPending}
                                  >
                                      {createSyncMutation.isPending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                      添加分支
                                  </Button>
                                  <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => createAllSyncMutation.mutate()}
                                      disabled={createAllSyncMutation.isPending || unsyncedBranches.length === 0}
                                  >
                                      {createAllSyncMutation.isPending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                      同步全部分支
                                  </Button>
                              </div>
                          ) : null}

                          {(syncData?.availableBranches.length ?? 0) === 0 ? (
                              <p className="git-settings-ro-empty">尚未添加同步分支</p>
                          ) : (
                              <div className="git-sync-list">
                                  {syncData?.availableBranches.map((branch) => {
                                      const item = syncData.configs.find((c) => c.branch === branch);
                                      const isTriggering = item ? triggerSyncMutation.isPending && triggerSyncMutation.variables === item.id : false;
                                      const isDeleting = item ? deleteSyncMutation.isPending && deleteSyncMutation.variables === item.id : false;
                                      const isToggling = item ? updateStatusMutation.isPending && updateStatusMutation.variables?.id === item.id : false;
                                      const isAdding = createSyncMutation.isPending && createSyncMutation.variables === branch;

                                      return (
                                          <SyncConfigRow
                                              key={branch}
                                              branch={branch}
                                              item={item}
                                              canEdit={canEdit}
                                              onTrigger={() => item && triggerSyncMutation.mutate(item.id)}
                                              onDelete={() => item && deleteSyncMutation.mutate(item.id)}
                                              onToggle={(enabled) => {
                                                  if (item) {
                                                      updateStatusMutation.mutate({ id: item.id, enabled });
                                                  } else if (enabled) {
                                                      createSyncMutation.mutate(branch);
                                                  }
                                              }}
                                              isTriggering={isTriggering}
                                              isDeleting={isDeleting}
                                              isToggling={isToggling || isAdding}
                                          />
                                      );
                                  })}
                              </div>
                          )}
                      </>
                  )}
              </section>
          </div>
      );
  }
  ```

- [ ] **Step 2: Rewrite SyncConfigRow for 3 lifecycle states**
  Implement the exact UI conditions in the row component based on State A (Not Enabled), State B (Active Syncing), and State C (Paused):
  ```tsx
  function SyncConfigRow({
      branch,
      item,
      canEdit,
      onTrigger,
      onDelete,
      onToggle,
      isTriggering,
      isDeleting,
      isToggling,
  }: {
      branch: string;
      item: GitSyncConfig | undefined;
      canEdit: boolean;
      onTrigger: () => void;
      onDelete: () => void;
      onToggle: (enabled: boolean) => void;
      isTriggering: boolean;
      isDeleting: boolean;
      isToggling: boolean;
  }) {
      const [showError, setShowError] = useState(false);

      const formattedTime = item?.lastSyncAt
          ? new Date(item.lastSyncAt).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            })
          : '无';

      const isEnabled = item ? item.enabled : false;
      const isSuccess = item?.lastSyncStatus === 'SUCCESS';
      const isFailed = item?.lastSyncStatus === 'FAILED';
      const disabledAction = isTriggering || isDeleting || isToggling;

      return (
          <div className={`git-sync-row ${item && !isEnabled ? 'git-sync-row--disabled' : ''} ${!item ? 'git-sync-row--new' : ''}`}>
              <div className="git-sync-row-main">
                  <div className="git-sync-branch-header">
                      <strong>{branch}</strong>
                      {item ? (
                          <>
                              {isSuccess && (
                                  <span className="git-sync-status-badge git-sync-status-badge--success">
                                      同步成功
                                  </span>
                              )}
                              {isFailed && (
                                  <span className="git-sync-status-badge git-sync-status-badge--failed">
                                      同步失败
                                  </span>
                              )}
                          </>
                      ) : null}
                  </div>

                  <div className="git-sync-metadata">
                      {item ? (
                          <>
                              <span>上次同步时间: {formattedTime}</span>
                          </>
                      ) : (
                          <span>未开启自动同步</span>
                      )}
                  </div>

                  {item && isFailed && item.lastSyncMessage && (
                      <div className="git-sync-error-container">
                          <button
                              type="button"
                              className="git-sync-error-toggle"
                              onClick={() => setShowError(!showError)}
                          >
                              {showError ? '隐藏同步报错详情' : '查看同步报错详情'}
                          </button>
                          {showError && (
                              <pre className="git-sync-error-details">
                                  {item.lastSyncMessage}
                              </pre>
                          )}
                      </div>
                  )}
              </div>

              {canEdit ? (
                  <div className="git-sync-row-actions-group">
                      {/* Status Toggle Switch */}
                      <div className="git-sync-toggle-wrapper">
                          <label className="git-sync-switch" aria-label="启用/禁用自动同步">
                              <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  disabled={isToggling}
                                  onChange={(e) => onToggle(e.target.checked)}
                              />
                              <span className="git-sync-slider"></span>
                          </label>
                          <span className="git-sync-toggle-label">
                              {isToggling
                                  ? '更新中...'
                                  : isEnabled
                                  ? '自动同步中'
                                  : item
                                  ? '自动同步已暂停'
                                  : '未开启自动同步'}
                          </span>
                      </div>

                      {item ? (
                          <div className="git-sync-row-actions">
                              <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-label={`同步一次 ${branch}`}
                                  onClick={onTrigger}
                                  disabled={disabledAction || !isEnabled}
                              >
                                  {isTriggering ? <LoaderCircle size={14} className="offline-spin mr-1" /> : null}
                                  同步一次
                              </Button>
                              {!isEnabled ? (
                                  <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      aria-label={`移出同步 ${branch}`}
                                      onClick={onDelete}
                                      disabled={disabledAction}
                                  >
                                      {isDeleting ? <LoaderCircle size={14} className="offline-spin mr-1" /> : null}
                                      移出同步
                                  </Button>
                              ) : null}
                          </div>
                      ) : null}
                  </div>
              ) : (
                  <div className="git-sync-row-status-ro">
                      <span className={`git-sync-status-indicator ${isEnabled ? 'active' : 'inactive'}`}>
                          {isEnabled ? '自动同步中' : item ? '自动同步已暂停' : '自动同步未开启'}
                      </span>
                  </div>
              )}
          </div>
      );
  }
  ```

---

### Task 2: Validate Implementation and Styling

**Files:**
- Modify: `wb-data-frontend/src/views/group-settings/GitSettings.css`

- [ ] **Step 1: Check CSS style definitions**
  Ensure CSS classes `.git-sync-row--new`, `.git-sync-row--disabled`, and toggle switch animations in `GitSettings.css` render correctly.
  Verify code:
  ```css
  .git-sync-row--new {
      border-style: dashed;
      background: transparent;
  }
  ```

- [ ] **Step 2: Run verification scripts**
  Execute lint checks:
  ```bash
  npm run lint
  ```
  Expected output: 0 errors.

  Execute tests:
  ```bash
  npm run test
  ```
  Expected output: 117 tests passed.

  Execute build:
  ```bash
  npm run build
  ```
  Expected output: production assets built successfully.
