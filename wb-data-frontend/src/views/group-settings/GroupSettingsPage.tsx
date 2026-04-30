import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Search,
    UserPlus,
    GitBranch,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { useAuthStore } from '../../utils/auth';
import {
    addMember,
    getMemberPage,
    getGroupSettings,
    removeMember,
    updateGroupSettings,
    updateMemberRole,
} from '../../api/groupSettings';
import type { AddMemberPayload, MemberRecord } from '../../api/groupSettings';
import GroupInfoCard from './GroupInfoCard';
import MemberTable from './MemberTable';
import AddMemberDialog from './AddMemberDialog';
import ChangeRoleDialog from './ChangeRoleDialog';
import GitSettingsTab from './GitSettingsTab';
import {
    buildMemberPageQueryKey,
    DEFAULT_PAGE_SIZE,
    getRoleLabel,
    PAGE_SIZE_OPTIONS,
    parsePageParam,
    parsePageSizeParam,
} from './config';
import './GroupSettings.css';
import { Button } from '../../components/ui/button';

function buildNextSearchParams(currentSearchParams: URLSearchParams, mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(currentSearchParams);
    mutate(next);

    if (next.get('page') === '1') next.delete('page');
    if (next.get('size') === String(DEFAULT_PAGE_SIZE)) next.delete('size');
    if (!next.get('keyword')) next.delete('keyword');

    return next;
}

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

    const [searchParams, setSearchParams] = useSearchParams();
    const [keywordInput, setKeywordInput] = useState(searchParams.get('keyword') ?? '');
    const [isComposing, setIsComposing] = useState(false);
    const [suppressPaginationHover, setSuppressPaginationHover] = useState(false);
    const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
    const [changeRoleMember, setChangeRoleMember] = useState<MemberRecord | null>(null);
    const [pendingRemoveTarget, setPendingRemoveTarget] = useState<MemberRecord | null>(null);
    const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null);
    const addMemberDisplayNameRef = useRef<string>('');
    const [activeTab, setActiveTab] = useState<'members' | 'git'>('members');

    const currentPage = parsePageParam(searchParams.get('page'));
    const pageSize = parsePageSizeParam(searchParams.get('size'));
    const keyword = (searchParams.get('keyword') ?? '').trim();

    useEffect(() => {
        setKeywordInput(keyword);
    }, [keyword]);

    useEffect(() => {
        if (isComposing) return;

        const normalizedKeyword = keywordInput.trim();
        if (normalizedKeyword === keyword) return;

        const timer = window.setTimeout(() => {
            const next = buildNextSearchParams(searchParams, (params) => {
                if (normalizedKeyword) {
                    params.set('keyword', normalizedKeyword);
                } else {
                    params.delete('keyword');
                }
                params.set('page', '1');
            });

            setSearchParams(next, { replace: true });
        }, 350);

        return () => window.clearTimeout(timer);
    }, [isComposing, keyword, keywordInput, searchParams, setSearchParams]);

    useEffect(() => {
        if (!suppressPaginationHover) return;

        const releaseHoverLock = () => {
            setSuppressPaginationHover(false);
            window.removeEventListener('mousemove', releaseHoverLock);
            window.removeEventListener('pointermove', releaseHoverLock);
            window.removeEventListener('touchmove', releaseHoverLock);
        };

        window.addEventListener('mousemove', releaseHoverLock);
        window.addEventListener('pointermove', releaseHoverLock);
        window.addEventListener('touchmove', releaseHoverLock);

        return () => {
            window.removeEventListener('mousemove', releaseHoverLock);
            window.removeEventListener('pointermove', releaseHoverLock);
            window.removeEventListener('touchmove', releaseHoverLock);
        };
    }, [suppressPaginationHover]);

    const groupInfoQuery = useQuery({
        queryKey: ['group-settings-info', groupId],
        queryFn: () => getGroupSettings(groupId!),
        enabled: groupId != null,
    });

    const memberQuery = useQuery({
        queryKey: buildMemberPageQueryKey({ groupId, currentPage, pageSize, keyword }),
        queryFn: () => getMemberPage({ groupId: groupId!, page: currentPage, size: pageSize, keyword: keyword || undefined }),
        enabled: groupId != null,
        placeholderData: (previousData) => previousData,
    });

    const memberData = memberQuery.data;
    const records = memberData?.records ?? [];
    const total = memberData?.total ?? 0;
    const totalPages = memberData?.pages ?? Math.max(1, Math.ceil(total / pageSize) || 1);
    const isRefreshing = useDelayedBusy(memberQuery.isFetching && Boolean(memberData), { delayMs: 140, minVisibleMs: 320 });

    useEffect(() => {
        if (!memberData) return;
        if (memberData.pages > 0 && currentPage > memberData.pages) {
            const next = buildNextSearchParams(searchParams, (params) => {
                params.set('page', String(memberData.pages));
            });
            setSearchParams(next, { replace: true });
        }
    }, [currentPage, memberData, searchParams, setSearchParams]);

    const addMemberMutation = useMutation({
        mutationFn: (payload: AddMemberPayload) => addMember(groupId!, payload),
        onSuccess: () => {
            setIsAddMemberOpen(false);
            showFeedback({
                tone: 'success',
                title: '成员已添加',
                detail: `${addMemberDisplayNameRef.current || '新成员'} 已加入项目组。`,
            });
            void queryClient.invalidateQueries({ queryKey: ['group-settings-members'] });
        },
        onError: (error) => {
            setIsAddMemberOpen(false);
            showFeedback(
                {
                    tone: 'error',
                    title: '添加成员失败',
                    detail: (error as { message?: string } | null)?.message ?? '无法添加成员，请稍后重试。',
                },
                5000,
            );
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
            showFeedback(
                {
                    tone: 'error',
                    title: '角色变更失败',
                    detail: (error as { message?: string } | null)?.message ?? '角色变更失败，请稍后重试。',
                },
                5000,
            );
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
            showFeedback(
                {
                    tone: 'error',
                    title: '移除成员失败',
                    detail: (error as { message?: string } | null)?.message ?? '无法移除该成员，请稍后重试。',
                },
                5000,
            );
        },
        onSettled: () => {
            setPendingRemoveId(null);
        },
    });

    const patchSearchParams = (mutate: (next: URLSearchParams) => void) => {
        const next = buildNextSearchParams(searchParams, mutate);
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true });
        }
    };

    const handlePageChange = (page: number) => {
        if (page < 1 || page > totalPages || page === currentPage || memberQuery.isFetching) return;
        setSuppressPaginationHover(true);
        patchSearchParams((params) => {
            params.set('page', String(page));
        });
    };

    const handlePageSizeChange = (nextPageSize: number) => {
        if (nextPageSize === pageSize || memberQuery.isFetching) return;
        patchSearchParams((params) => {
            params.set('size', String(nextPageSize));
            params.set('page', '1');
        });
    };

    const handleAddMemberSuccess = (payload: AddMemberPayload, displayName: string) => {
        addMemberDisplayNameRef.current = displayName;
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

    const queryError = memberQuery.error as { message?: string } | null;
    const errorMessage = queryError?.message ?? '';
    const prevDisabled = currentPage === 1 || memberQuery.isFetching;
    const nextDisabled = currentPage >= totalPages || memberQuery.isFetching;
    const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const pageEnd = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
    const pageCount = total === 0 ? 0 : pageEnd - pageStart + 1;
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
                            <GitBranch size={14} />
                            远程仓库
                        </button>
                    </div>
                </div>

                {activeTab === 'git' ? (
                    <GitSettingsTab groupId={groupId!} />
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
                                <div className={`gs-pagination ${suppressPaginationHover ? 'hover-locked' : ''}`}>
                                    <div className="gs-page-info">本页 {pageCount} 条，共 {total} 条</div>

                                    <div className="gs-pagination-controls" aria-label="成员分页导航">
                                        <div className="gs-page-size-group">
                                            <span className="gs-pagination-label">每页</span>
                                            <div className="gs-page-size-select">
                                                <SimpleSelect
                                                    id="gs-page-size"
                                                    value={String(pageSize)}
                                                    options={pageSizeOptions}
                                                    disabled={memberQuery.isFetching}
                                                    menuPlacement="up"
                                                    onChange={(value) => {
                                                        const parsed = Number(value);
                                                        if (Number.isFinite(parsed) && parsed !== pageSize) {
                                                            handlePageSizeChange(parsed);
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        <div className="gs-page-status">
                                            第 {currentPage} / {totalPages} 页
                                        </div>

                                        <div className="gs-page-actions">
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="第一页"
                                                aria-disabled={prevDisabled}
                                                disabled={prevDisabled}
                                                onClick={() => handlePageChange(1)}
                                            >
                                                <ChevronsLeft size={16} />
                                            </Button>
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="上一页"
                                                aria-disabled={prevDisabled}
                                                disabled={prevDisabled}
                                                onClick={() => handlePageChange(currentPage - 1)}
                                            >
                                                <ChevronLeft size={16} />
                                            </Button>
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="下一页"
                                                aria-disabled={nextDisabled}
                                                disabled={nextDisabled}
                                                onClick={() => handlePageChange(currentPage + 1)}
                                            >
                                                <ChevronRight size={16} />
                                            </Button>
                                            <Button
                                                variant="outline" size="icon"
                                                type="button"
                                                aria-label="最后一页"
                                                aria-disabled={nextDisabled}
                                                disabled={nextDisabled}
                                                onClick={() => handlePageChange(totalPages)}
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

            <Dialog
                open={Boolean(pendingRemoveTarget)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && pendingRemoveId == null) {
                        setPendingRemoveTarget(null);
                    }
                }}
            >
                <DialogPortal>
                    <DialogOverlay className="dialog-backdrop" />
                    <DialogContent className="dialog-positioner">
                        <div className="gs-confirm-dialog">
                            <DialogTitle className="gs-confirm-title">移除成员</DialogTitle>
                            <DialogDescription className="gs-confirm-description">
                                {pendingRemoveTarget ? (
                                    <>
                                        确定要将 <strong>{pendingRemoveTarget.displayName}</strong> 从项目组中移除吗？
                                        <br />
                                        移除后该成员将无法访问此项目组的资源。
                                    </>
                                ) : (
                                    ''
                                )}
                            </DialogDescription>
                            <div className="gs-confirm-actions">
                                <Button
                                    variant="outline"
                                    disabled={pendingRemoveId != null}
                                    onClick={() => setPendingRemoveTarget(null)}
                                    type="button"
                                >
                                    取消
                                </Button>
                                <Button
                                    variant="destructive"
                                    disabled={!pendingRemoveTarget || pendingRemoveId != null}
                                    onClick={() => {
                                        if (!pendingRemoveTarget) return;
                                        removeMemberMutation.mutate(pendingRemoveTarget.id);
                                    }}
                                    type="button"
                                >
                                    {pendingRemoveId != null ? '移除中...' : '确认移除'}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>
        </div>
    );
}
