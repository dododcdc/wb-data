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
                        <p className="git-settings-description">按分支同步远程仓库中的任务与脚本，默认每 5 分钟自动同步一次。</p>
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
                                    disabled={createAllSyncMutation.isPending || (syncData?.availableBranches.length ?? 0) === 0}
                                >
                                    {createAllSyncMutation.isPending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                    同步全部分支
                                </Button>
                            </div>
                        ) : null}

                        {(syncData?.configs.length ?? 0) === 0 ? (
                            <p className="git-settings-ro-empty">尚未添加同步分支</p>
                        ) : (
                            <div className="git-sync-list">
                                {syncData?.configs.map((item) => (
                                    <SyncConfigRow
                                        key={item.id}
                                        item={item}
                                        canEdit={canEdit}
                                        onTrigger={() => triggerSyncMutation.mutate(item.id)}
                                        onDelete={() => deleteSyncMutation.mutate(item.id)}
                                        busy={triggerSyncMutation.isPending || deleteSyncMutation.isPending}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

function SyncConfigRow({
    item,
    canEdit,
    onTrigger,
    onDelete,
    busy,
}: {
    item: GitSyncConfig;
    canEdit: boolean;
    onTrigger: () => void;
    onDelete: () => void;
    busy: boolean;
}) {
    return (
        <div className="git-sync-row">
            <div className="git-sync-row-main">
                <strong>{item.branch}</strong>
            </div>
            {canEdit ? (
                <div className="git-sync-row-actions">
                    <Button type="button" size="sm" variant="outline" aria-label={`同步一次 ${item.branch}`} onClick={onTrigger} disabled={busy || !item.enabled}>
                        同步一次
                    </Button>
                    <Button type="button" size="sm" variant="destructive" aria-label={`移出同步 ${item.branch}`} onClick={onDelete} disabled={busy}>
                        移出同步
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
