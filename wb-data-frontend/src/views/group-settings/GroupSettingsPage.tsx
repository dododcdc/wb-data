import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ListPagination } from '../../components/ui/list/ListPagination';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { useAuthStore } from '../../utils/auth';
import {
    addMembers,
    getMemberPage,
    getGroupSettings,
    removeMember,
    updateGroupSettings,
    updateMemberRole,
} from '../../api/groupSettings';
import type { AddMembersPayload, MemberRecord } from '../../api/groupSettings';
import GroupInfoCard from './GroupInfoCard';
import MemberTable from './MemberTable';
import AddMemberDialog from './AddMemberDialog';
import ChangeRoleDialog from './ChangeRoleDialog';
import GitSettingsTab from './GitSettingsTab';
import LocalSettingsTab from './LocalSettingsTab';
import KestraSyncSettingsTab from './KestraSyncSettingsTab';
import {
    DEFAULT_PAGE_SIZE,
    getRoleLabel,
} from './config';
import './GroupSettings.css';
import { Button } from '../../components/ui/button';
import { useDataTable } from '../../hooks/useDataTable';

export default function GroupSettingsPage() {
    const queryClient = useQueryClient();
    const { showSuccess, showError } = useOperationFeedback();
    const currentGroup = useAuthStore((s) => s.currentGroup);
    const permissions = useAuthStore((s) => s.permissions);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);
    const userInfo = useAuthStore((s) => s.userInfo);
    const groupId = currentGroup?.id;

    const canEdit = systemAdmin || permissions.includes('group.settings');
    const canManage = systemAdmin || permissions.includes('member.manage');

    const [keywordInput, setKeywordInput] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
    const [changeRoleMember, setChangeRoleMember] = useState<MemberRecord | null>(null);
    const [pendingRemoveTarget, setPendingRemoveTarget] = useState<MemberRecord | null>(null);
    const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null);
    const addedMemberCountRef = useRef(0);
    const [activeTab, setActiveTab] = useState<'members' | 'git' | 'local' | 'kestra'>('members');

    const memberTableParams = useMemo(() => (
        groupId == null ? undefined : { groupId }
    ), [groupId]);

    const {
        data: records,
        total,
        isFetching: memberFetching,
        isLoading: memberLoading,
        error: memberError,
        pagination,
        search,
        refresh: refreshMembers,
    } = useDataTable<MemberRecord, { groupId: number }>({
        queryKey: ['group-settings-members', groupId],
        fetchFn: getMemberPage,
        defaultParams: memberTableParams,
        initialPageSize: DEFAULT_PAGE_SIZE,
        syncWithUrl: true,
    });

    // 处理搜索框本地输入与同步
    useEffect(() => {
        setKeywordInput(search.keyword);
    }, [search.keyword]);

    useEffect(() => {
        if (isComposing) return;
        const timer = setTimeout(() => {
            if (keywordInput.trim() !== search.keyword) {
                search.setKeyword(keywordInput.trim());
            }
        }, 350);
        return () => clearTimeout(timer);
    }, [keywordInput, isComposing, search]);

    const isRefreshing = useDelayedBusy(memberFetching && records.length > 0, { delayMs: 140, minVisibleMs: 320 });

    const groupInfoQuery = useQuery({
        queryKey: ['group-settings-info', groupId],
        queryFn: () => getGroupSettings(groupId!),
        enabled: groupId != null,
    });


    const addMemberMutation = useMutation({
        mutationFn: (payload: AddMembersPayload) => addMembers(groupId!, payload),
        onSuccess: () => {
            setIsAddMemberOpen(false);
            showSuccess(`已添加 ${addedMemberCountRef.current} 名成员`);
            void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
        },
        onError: (error) => {
            setIsAddMemberOpen(false);
            showError(error, '添加成员失败');
        },
    });

    const updateRoleMutation = useMutation({
        mutationFn: ({ memberId, role }: { memberId: number; role: string }) =>
            updateMemberRole(groupId!, memberId, { role }),
        onSuccess: (_result, variables) => {
            const member = changeRoleMember;
            setChangeRoleMember(null);
            const name = member?.displayName ?? '成员';
            const roleLabel = getRoleLabel(variables.role);
            showSuccess(`${name} 已设为${roleLabel}`);
            void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
        },
        onError: (error) => {
            setChangeRoleMember(null);
            showError(error, '角色变更失败');
        },
    });

    const removeMemberMutation = useMutation({
        mutationFn: (memberId: number) => removeMember(groupId!, memberId),
        onMutate: (memberId) => {
            setPendingRemoveId(memberId);
        },
        onSuccess: () => {
            const name = pendingRemoveTarget?.displayName ?? '成员';
            showSuccess(`${name} 已移除`);
            void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
            setPendingRemoveTarget(null);
        },
        onError: (error) => {
            showError(error, '移除成员失败');
        },
        onSettled: () => {
            setPendingRemoveId(null);
        },
    });

    const handleAddMemberSuccess = (payload: AddMembersPayload, usernames: string[]) => {
        addedMemberCountRef.current = usernames.length;
        addMemberMutation.mutate(payload);
    };

    const handleChangeRoleConfirm = (memberId: number, role: string) => {
        updateRoleMutation.mutate({ memberId, role });
    };

    const handleRemove = (member: MemberRecord) => {
        setPendingRemoveTarget(member);
    };

    const handleInfoSave = (payload: Parameters<typeof updateGroupSettings>[1]) => {
        return updateGroupSettings(groupId!, payload);
    };

    const handleInfoSaveSuccess = () => {
        void queryClient.invalidateQueries({ queryKey: ['group-settings-info', groupId] });
    };

    const errorMessage = memberError instanceof Error ? memberError.message : String(memberError || '');
    const { page, pageSize, setPage, setPageSize } = pagination;

    return (
        <div className="gs-page">
            <GroupInfoCard
                data={groupInfoQuery.data ?? null}
                canEdit={canEdit}
                onSave={handleInfoSave}
                onSaveSuccess={handleInfoSaveSuccess}
            />

            <section className="gs-members-panel animate-enter animate-enter-delay-1">
                <div className="gs-members-header">
                    <div className="gs-tab-group">
                        <button
                            type="button"
                            className={`gs-tab-btn ${activeTab === 'members' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('members')}
                        >
                            成员管理
                        </button>
                        <button
                            type="button"
                            className={`gs-tab-btn ${activeTab === 'git' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('git')}
                        >
                            远程仓库
                        </button>
                        {canEdit && (
                            <button
                                type="button"
                                className={`gs-tab-btn ${activeTab === 'local' ? 'is-active' : ''}`}
                                onClick={() => setActiveTab('local')}
                            >
                                本地仓库
                            </button>
                        )}
                        <button
                            type="button"
                            className={`gs-tab-btn ${activeTab === 'kestra' ? 'is-active' : ''}`}
                            onClick={() => setActiveTab('kestra')}
                        >
                            调度同步
                        </button>
                    </div>
                </div>

                {activeTab === 'git' ? (
                    <GitSettingsTab groupId={groupId!} canEdit={canEdit} />
                ) : (activeTab === 'local' && canEdit) ? (
                    <LocalSettingsTab groupId={groupId!} canEdit={canEdit} />
                ) : activeTab === 'kestra' ? (
                    <KestraSyncSettingsTab
                        groupId={groupId!}
                        canEdit={canEdit}
                        onConfigureGit={() => setActiveTab('git')}
                    />
                ) : (
                    <div className="gs-members-content">
                        <div className="gs-members-search-row">
                            <div className="gs-search-shell">
                                <Search size={16} />
                                <input
                                    aria-label="搜索成员"
                                    placeholder="搜索用户名、展示名"
                                    value={keywordInput}
                                    onChange={(event) => setKeywordInput(event.target.value)}
                                    onCompositionStart={() => {
                                        setIsComposing(true);
                                    }}
                                    onCompositionEnd={(event) => {
                                        setIsComposing(false);
                                        setKeywordInput(event.currentTarget.value);
                                    }}
                                />
                            </div>
                            {canManage ? (
                                <Button
                                    variant="default"
                                    onClick={() => setIsAddMemberOpen(true)}
                                    type="button"
                                >
                                    <UserPlus size={16} />
                                    添加成员
                                </Button>
                            ) : null}
                        </div>

                        <div className="gs-members-body">
                            <MemberTable
                                data={records}
                                errorMessage={errorMessage}
                                hasActiveFilter={Boolean(search.keyword)}
                                hasFooter={total > 0}
                                isLoading={memberLoading}
                                isRefreshing={isRefreshing}
                                canManage={canManage}
                                currentUserId={userInfo?.id ?? null}
                                onAddMember={() => setIsAddMemberOpen(true)}
                                onClearFilters={() => search.setKeyword('')}
                                onRetry={() => void refreshMembers()}
                                onChangeRole={(member) => setChangeRoleMember(member)}
                                onRemove={handleRemove}
                            />

                            <ListPagination
                                currentPage={page}
                                isFetching={memberFetching}
                                onPageChange={setPage}
                                onPageSizeChange={(nextPageSize) => {
                                    setPageSize(nextPageSize);
                                    setPage(1);
                                }}
                                pageSize={pageSize}
                                total={total}
                                ariaLabel="成员分页导航"
                            />
                        </div>
                    </div>
                )}
            </section>

            {groupId != null ? (
                <AddMemberDialog
                    open={isAddMemberOpen}
                    groupId={groupId}
                    onOpenChange={(details) => setIsAddMemberOpen(details.open)}
                    onSuccess={handleAddMemberSuccess}
                />
            ) : null}

            <ChangeRoleDialog
                open={Boolean(changeRoleMember)}
                member={changeRoleMember}
                onOpenChange={(details) => {
                    if (!details.open) setChangeRoleMember(null);
                }}
                onConfirm={handleChangeRoleConfirm}
                submitting={updateRoleMutation.isPending}
            />

            <ConfirmDialog
                open={Boolean(pendingRemoveTarget)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && pendingRemoveId == null) {
                        setPendingRemoveTarget(null);
                    }
                }}
                title="移除成员"
                description={pendingRemoveTarget ? (
                    <>
                        确定要将 <strong>{pendingRemoveTarget.displayName}</strong> 从项目组中移除吗？
                        <br />
                        移除后该成员将无法访问此项目组的资源。
                    </>
                ) : ''}
                variant="destructive"
                confirmText={pendingRemoveId != null ? '移除中...' : '确认移除'}
                onConfirm={() => {
                    if (pendingRemoveTarget) {
                        removeMemberMutation.mutate(pendingRemoveTarget.id);
                    }
                }}
                isLoading={pendingRemoveId != null}
                icon="warning"
            />
        </div>
    );
}
