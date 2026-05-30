import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Search,
    UserPlus,
} from 'lucide-react';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
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
import {
    DEFAULT_PAGE_SIZE,
    getRoleLabel,
    PAGE_SIZE_OPTIONS,
} from './config';
import './GroupSettings.css';
import { Button } from '../../components/ui/button';
import { useDataTable } from '../../hooks/useDataTable';

export default function GroupSettingsPage() {
    const queryClient = useQueryClient();
    const { showFeedback } = useOperationFeedback();
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
    const [activeTab, setActiveTab] = useState<'members' | 'git' | 'local'>('members');

    const {
        data: records,
        total,
        isFetching: memberFetching,
        error: memberError,
        pagination,
        search,
    } = useDataTable<MemberRecord, { groupId: number }>({
        queryKey: ['group-settings-members'],
        fetchFn: getMemberPage,
        defaultParams: { groupId: groupId! },
        initialPageSize: DEFAULT_PAGE_SIZE,
        syncWithUrl: true,
    });

    // 监听 groupId 变化
    useEffect(() => {
        if (groupId) {
            // useDataTable doesn't automatically react to defaultParams change in current implementation
            // but we can pass it as a separate param if we wanted.
            // For now, assume groupId is stable or handle it via setExtraParams if needed.
        }
    }, [groupId]);

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
            showFeedback({
                tone: 'success',
                title: '成员已添加',
                detail: `已添加 ${addedMemberCountRef.current} 名成员。`,
            });
            void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
        },
        onError: (error) => {
            setIsAddMemberOpen(false);
            showFeedback({
                tone: 'error',
                title: '添加成员失败',
                detail: (error as { message?: string } | null)?.message ?? '无法添加成员，请稍后重试。',
            });
        },
    });

    const updateRoleMutation = useMutation({
        mutationFn: ({ memberId, role }: { memberId: number; role: string }) =>
            updateMemberRole(groupId!, memberId, { role }),
        onSuccess: (_result, variables) => {
            const member = changeRoleMember;
            setChangeRoleMember(null);
            showFeedback({
                tone: 'success',
                title: '角色已变更',
                detail: `${member?.displayName ?? '成员'} 的角色已变更为 ${getRoleLabel(variables.role)}。`,
            });
            void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
        },
        onError: (error) => {
            setChangeRoleMember(null);
            showFeedback({
                tone: 'error',
                title: '角色变更失败',
                detail: (error as { message?: string } | null)?.message ?? '角色变更失败，请稍后重试。',
            });
        },
    });

    const removeMemberMutation = useMutation({
        mutationFn: (memberId: number) => removeMember(groupId!, memberId),
        onMutate: (memberId) => {
            setPendingRemoveId(memberId);
        },
        onSuccess: () => {
            showFeedback({
                tone: 'success',
                title: '成员已移除',
                detail: `${pendingRemoveTarget?.displayName ?? '成员'} 已从项目组移除。`,
            });
            void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
            setPendingRemoveTarget(null);
        },
        onError: (error) => {
            showFeedback({
                tone: 'error',
                title: '移除成员失败',
                detail: (error as { message?: string } | null)?.message ?? '无法移除该成员，请稍后重试。',
            });
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
    const { page, pageSize, setPage, setPageSize, totalPages } = pagination;

    const prevDisabled = page === 1 || memberFetching;
    const nextDisabled = page >= totalPages || memberFetching;
    const pageCount = records.length;
    const pageSizeOptions = PAGE_SIZE_OPTIONS.map((value) => ({ label: `${value} 条`, value: String(value) }));

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
                    </div>
                </div>

                {activeTab === 'git' ? (
                    <GitSettingsTab groupId={groupId!} canEdit={canEdit} />
                ) : (activeTab === 'local' && canEdit) ? (
                    <LocalSettingsTab groupId={groupId!} canEdit={canEdit} />
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
                                isRefreshing={isRefreshing}
                                errorMessage={errorMessage}
                                canManage={canManage}
                                currentUserId={userInfo?.id ?? null}
                                onChangeRole={(member) => setChangeRoleMember(member)}
                                onRemove={handleRemove}
                            />

                            {total > 0 ? (
                                <div className="gs-pagination">
                                    <div className="gs-page-info">本页 {pageCount} 条，共 {total} 条</div>

                                    <div className="gs-pagination-controls" aria-label="成员分页导航">
                                        <div className="gs-page-size-group">
                                            <span className="gs-pagination-label">每页</span>
                                            <div className="gs-page-size-select">
                                                <SimpleSelect
                                                    id="gs-page-size"
                                                    value={String(pageSize)}
                                                    options={pageSizeOptions}
                                                    disabled={memberFetching}
                                                    menuPlacement="up"
                                                    onChange={(value) => {
                                                        const parsed = Number(value);
                                                        if (Number.isFinite(parsed) && parsed !== pageSize) {
                                                            setPageSize(parsed);
                                                            setPage(1);
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        <div className="gs-page-status">
                                            第 {page} / {totalPages} 页
                                        </div>

                                        <div className="gs-page-actions">
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="第一页"
                                                aria-disabled={prevDisabled}
                                                disabled={prevDisabled}
                                                onClick={() => setPage(1)}
                                            >
                                                <ChevronsLeft size={16} />
                                            </Button>
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="上一页"
                                                aria-disabled={prevDisabled}
                                                disabled={prevDisabled}
                                                onClick={() => setPage(Math.max(1, page - 1))}
                                            >
                                                <ChevronLeft size={16} />
                                            </Button>
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="下一页"
                                                aria-disabled={nextDisabled}
                                                disabled={nextDisabled}
                                                onClick={() => setPage(Math.min(totalPages, page + 1))}
                                            >
                                                <ChevronRight size={16} />
                                            </Button>
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="最后一页"
                                                aria-disabled={nextDisabled}
                                                disabled={nextDisabled}
                                                onClick={() => setPage(totalPages)}
                                            >
                                                <ChevronsRight size={16} />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
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
