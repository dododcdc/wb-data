import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';

import './GitSettings.css';
import {
    createGitSyncConfig,
    deleteGitSyncConfig,
    getGitConfig,
    getGitSyncConfigs,
    triggerGitSyncConfig,
    updateGitSyncConfigStatus,
    type GitSyncConfig,
} from '../../api/gitSettings';
import { Button } from '../../components/ui/button';
import { DataList, type DataListColumn } from '../../components/ui/list/DataList';
import { RowActions, type RowActionItem } from '../../components/ui/list/RowActions';
import { StatusPill } from '../../components/ui/list/StatusPill';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';

interface KestraSyncSettingsTabProps {
    groupId: number;
    canEdit: boolean;
    onConfigureGit?: () => void;
}

export default function KestraSyncSettingsTab({ groupId, canEdit, onConfigureGit }: KestraSyncSettingsTabProps) {
    const { showSuccess, showError } = useOperationFeedback();
    const queryClient = useQueryClient();

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

    const invalidateSyncConfigs = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ['git-sync-config', groupId] });
    }, [groupId, queryClient]);

    const createSyncMutation = useMutation({
        mutationFn: (branch: string) => createGitSyncConfig(groupId, branch),
        onSuccess: () => {
            showSuccess('同步分支已添加');
            invalidateSyncConfigs();
        },
        onError: (error) => {
            showError(error, '添加同步分支失败');
        },
    });


    const triggerSyncMutation = useMutation({
        mutationFn: (id: number) => triggerGitSyncConfig(groupId, id),
        onSuccess: () => {
            showSuccess('同步已触发');
            invalidateSyncConfigs();
        },
        onError: (error) => {
            showError(error, '触发同步失败');
        },
    });

    const deleteSyncMutation = useMutation({
        mutationFn: (id: number) => deleteGitSyncConfig(groupId, id),
        onSuccess: () => {
            showSuccess('已移出同步');
            invalidateSyncConfigs();
        },
        onError: (error) => {
            showError(error, '移出同步失败');
        },
    });

    const updateStatusMutation = useMutation({
        mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateGitSyncConfigStatus(groupId, id, enabled),
        onSuccess: () => {
            showSuccess('自动同步状态已更新');
            invalidateSyncConfigs();
        },
        onError: (error) => {
            showError(error, '更新同步状态失败');
        },
    });


    const isLoading = configLoading || (!!config && syncLoading);
    const syncRows: SyncBranchRow[] = (syncData?.availableBranches ?? []).map((branch) => {
        const item = syncData?.configs.find((configItem) => configItem.branch === branch);
        return {
            branch,
            item,
            onTrigger: () => item && triggerSyncMutation.mutate(item.id),
            onDelete: () => item && deleteSyncMutation.mutate(item.id),
            onToggle: (enabled) => {
                if (item) {
                    updateStatusMutation.mutate({ id: item.id, enabled });
                } else if (enabled) {
                    createSyncMutation.mutate(branch);
                }
            },
            isTriggering: item ? triggerSyncMutation.isPending && triggerSyncMutation.variables === item.id : false,
            isDeleting: item ? deleteSyncMutation.isPending && deleteSyncMutation.variables === item.id : false,
            isToggling: item
                ? updateStatusMutation.isPending && updateStatusMutation.variables?.id === item.id
                : createSyncMutation.isPending && createSyncMutation.variables === branch,
        };
    });

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
                    <KestraSyncTable rows={[]} canEdit={canEdit} isLoading />
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
                    <KestraSyncTable rows={syncRows} canEdit={canEdit} />
                )}
            </section>
        </div>
    );
}

interface SyncBranchRow {
    branch: string;
    item: GitSyncConfig | undefined;
    onTrigger: () => void;
    onDelete: () => void;
    onToggle: (enabled: boolean) => void;
    isTriggering: boolean;
    isDeleting: boolean;
    isToggling: boolean;
}

function KestraSyncTable({ rows, canEdit, isLoading = false }: { rows: SyncBranchRow[]; canEdit: boolean; isLoading?: boolean }) {
    const [expandedErrorBranch, setExpandedErrorBranch] = useState<string | null>(null);
    const columns: DataListColumn<SyncBranchRow>[] = [
        {
            key: 'branch',
            header: '分支',
            primary: true,
            width: '26%',
            cell: (row) => <strong>{row.branch}</strong>,
        },
        {
            key: 'lastSyncStatus',
            header: '最近结果',
            width: 150,
            cell: (row) => {
                const status = row.item?.lastSyncStatus;
                return (
                    <div className="git-sync-result-cell">
                        {status === 'SUCCESS' ? <StatusPill tone="success" dot={false}>同步成功</StatusPill> : null}
                        {status === 'FAILED' ? <StatusPill tone="danger" dot={false}>同步失败</StatusPill> : null}
                        {status !== 'SUCCESS' && status !== 'FAILED' ? <span className="wb-list-action-note">—</span> : null}
                        {status === 'FAILED' && row.item?.lastSyncMessage ? (
                            <div className="git-sync-error-container">
                                <button
                                    type="button"
                                    className="git-sync-error-toggle"
                                    onClick={() => setExpandedErrorBranch((current) => current === row.branch ? null : row.branch)}
                                >
                                    {expandedErrorBranch === row.branch ? '隐藏同步报错详情' : '查看同步报错详情'}
                                </button>
                                {expandedErrorBranch === row.branch ? <pre className="git-sync-error-details">{row.item.lastSyncMessage}</pre> : null}
                            </div>
                        ) : null}
                    </div>
                );
            },
        },
        {
            key: 'lastSyncAt',
            header: '上次同步时间',
            mono: true,
            width: 220,
            cell: (row) => row.item?.lastSyncAt
                ? new Date(row.item.lastSyncAt).toLocaleString('zh-CN', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                })
                : row.item ? '无' : '未开启自动同步',
        },
        {
            key: 'autoSync',
            header: '自动同步',
            width: 190,
            cell: (row) => {
                const enabled = row.item?.enabled ?? false;
                return canEdit ? (
                    <div className="git-sync-toggle-wrapper">
                        <label className="git-sync-switch">
                            <input
                                type="checkbox"
                                aria-label="启用/禁用自动同步"
                                checked={enabled}
                                disabled={row.isToggling}
                                onChange={(event) => row.onToggle(event.target.checked)}
                            />
                            <span className="git-sync-slider" />
                        </label>
                        <span className="git-sync-toggle-label">
                            {row.isToggling ? '更新中...' : enabled ? '自动同步中' : row.item ? '自动同步已暂停' : '未开启自动同步'}
                        </span>
                    </div>
                ) : (
                    <span className={`git-sync-status-indicator ${enabled ? 'active' : 'inactive'}`}>
                        {enabled ? '自动同步中' : row.item ? '自动同步已暂停' : '自动同步未开启'}
                    </span>
                );
            },
        },
    ];

    if (canEdit) {
        columns.push({
            key: 'actions',
            header: '操作',
            align: 'right',
            width: 110,
            cell: (row) => {
                if (!row.item) return null;
                const enabled = row.item.enabled;
                const disabledAction = row.isTriggering || row.isDeleting || row.isToggling;
                const actions: RowActionItem[] = [
                    {
                        key: 'trigger',
                        label: `同步一次 ${row.branch}`,
                        icon: RefreshCw,
                        pending: row.isTriggering,
                        disabled: disabledAction || !enabled,
                        onClick: row.onTrigger,
                    },
                ];
                if (!enabled) {
                    actions.push({
                        key: 'delete',
                        label: `移出同步 ${row.branch}`,
                        icon: Trash2,
                        tone: 'danger',
                        pending: row.isDeleting,
                        disabled: disabledAction,
                        onClick: row.onDelete,
                    });
                }
                return <RowActions items={actions} maxVisible={1} menuLabel={`${row.branch}的更多操作`} />;
            },
        });
    }

    return (
        <DataList
            rows={rows}
            columns={columns}
            rowKey={(row) => row.branch}
            ariaLabel="调度同步分支列表"
            minWidth="960px"
            className="wb-kestra-sync-grid wb-list-compact"
            state={isLoading ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}
            emptyTitle="尚未添加同步分支"
            emptyDescription="选择分支后开启自动同步。"
        />
    );
}
