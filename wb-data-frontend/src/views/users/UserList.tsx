import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ListPagination } from '../../components/ui/list/ListPagination';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import {
    changeUserStatus,
    getUserPage,
    UserRecord,
} from '../../api/user';
import type { PageResult } from '../../api/datasource';
import UserForm, { UserFormSuccessDetails } from './UserForm';
import ResetPasswordDialog from './ResetPasswordDialog';
import { UserTable } from './UserTable';
import {
    buildUserPageQueryKey,
    DEFAULT_PAGE_SIZE,
    parsePageParam,
    parsePageSizeParam,
} from './config';
import './UserList.css';
import { Button } from '../../components/ui/button';

function buildNextSearchParams(currentSearchParams: URLSearchParams, mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(currentSearchParams);
    mutate(next);

    if (next.get('page') === '1') next.delete('page');
    if (next.get('size') === String(DEFAULT_PAGE_SIZE)) next.delete('size');
    if (!next.get('keyword')) next.delete('keyword');

    return next;
}

function patchCachedUserPages(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (page: PageResult<UserRecord>) => PageResult<UserRecord>,
) {
    queryClient.setQueriesData<PageResult<UserRecord>>({ queryKey: ['users'] }, (current) => {
        if (!current) {
            return current;
        }
        return updater(current);
    });
}

export default function UserList() {
    const queryClient = useQueryClient();
    const { showSuccess, showError } = useOperationFeedback();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keywordInput, setKeywordInput] = useState(searchParams.get('keyword') ?? '');
    const [isComposing, setIsComposing] = useState(false);
    const [suppressPaginationHover, setSuppressPaginationHover] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
    const [resetPasswordUser, setResetPasswordUser] = useState<UserRecord | null>(null);
    const [pendingStatusId, setPendingStatusId] = useState<number | null>(null);
    const [pendingDisableTarget, setPendingDisableTarget] = useState<UserRecord | null>(null);

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

    const pageQuery = useQuery({
        queryKey: buildUserPageQueryKey({ currentPage, pageSize, keyword }),
        queryFn: () => getUserPage({ page: currentPage, size: pageSize, keyword: keyword || undefined }),
        placeholderData: (previousData) => previousData,
    });

    const pageData = pageQuery.data;
    const records = pageData?.records ?? [];
    const total = pageData?.total ?? 0;
    const totalPages = pageData?.pages ?? Math.max(1, Math.ceil(total / pageSize) || 1);
    const isRefreshing = useDelayedBusy(pageQuery.isFetching && Boolean(pageData), { delayMs: 140, minVisibleMs: 320 });

    useEffect(() => {
        if (!pageData) return;
        if (pageData.pages > 0 && currentPage > pageData.pages) {
            const next = buildNextSearchParams(searchParams, (params) => {
                params.set('page', String(pageData.pages));
            });
            setSearchParams(next, { replace: true });
        }
    }, [currentPage, pageData, searchParams, setSearchParams]);

    const toggleStatusMutation = useMutation({
        mutationFn: ({ id, status }: { id: number; status: string }) => changeUserStatus(id, { status }),
        onMutate: async ({ id, status }) => {
            setPendingStatusId(id);
            await queryClient.cancelQueries({ queryKey: ['users'] });

            patchCachedUserPages(queryClient, (current) => ({
                ...current,
                records: current.records.map((record) => (record.id === id ? { ...record, status } : record)),
            }));

            return {
                previousPages: queryClient.getQueriesData<PageResult<UserRecord>>({ queryKey: ['users'] }),
            };
        },
        onSuccess: (_response, variables) => {
            showSuccess(variables.status === 'ACTIVE' ? '用户已启用' : '用户已禁用');
            void queryClient.invalidateQueries({ queryKey: ['users'] });
        },
        onError: (error, _variables, context) => {
            context?.previousPages.forEach(([queryKey, page]) => {
                queryClient.setQueryData(queryKey, page);
            });
            showError(error, '状态更新失败');
        },
        onSettled: () => {
            setPendingStatusId(null);
            setPendingDisableTarget(null);
        },
    });

    const patchSearchParams = (mutate: (next: URLSearchParams) => void) => {
        const next = buildNextSearchParams(searchParams, mutate);
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true });
        }
    };

    const handlePageChange = (page: number) => {
        if (page < 1 || page > totalPages || page === currentPage || pageQuery.isFetching) return;
        setSuppressPaginationHover(true);
        patchSearchParams((params) => {
            params.set('page', String(page));
        });
    };

    const handlePageSizeChange = (nextPageSize: number) => {
        if (nextPageSize === pageSize || pageQuery.isFetching) return;
        patchSearchParams((params) => {
            params.set('size', String(nextPageSize));
            params.set('page', '1');
        });
    };

    const handleToggleStatus = (item: UserRecord) => {
        const nextStatus = item.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
        if (nextStatus === 'DISABLED') {
            setPendingDisableTarget(item);
            return;
        }
        toggleStatusMutation.mutate({ id: item.id, status: nextStatus });
    };

    const queryError = pageQuery.error as { message?: string } | null;
    const errorMessage = queryError?.message ?? '';

    const handleCreate = () => {
        setEditingUser(null);
        setIsFormOpen(true);
    };

    const handleFormSuccess = (details: UserFormSuccessDetails) => {
        setIsFormOpen(false);
        if (details.action === 'edit' && details.userId != null) {
            patchCachedUserPages(queryClient, (current) => ({
                ...current,
                records: current.records.map((record) =>
                    record.id === details.userId
                        ? {
                            ...record,
                            username: details.payload.username,
                            displayName: details.payload.displayName,
                            systemRole: details.payload.systemRole,
                        }
                        : record,
                ),
            }));
        }

        showSuccess(details.action === 'create' ? '用户已创建' : '用户已更新');

        void queryClient.invalidateQueries({ queryKey: ['users'] });
        if (details.action === 'create') {
            patchSearchParams((params) => {
                params.delete('page');
            });
        }
    };

    return (
        <div className="user-page">
            <section className="user-toolbar animate-enter">
                <div className="user-search-shell">
                    <Search size={16} />
                    <input
                        aria-label="搜索用户"
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
                <div className="user-toolbar-actions">
                    <Button
                        variant="default"
                        onClick={handleCreate}
                        type="button"
                    >
                        <UserPlus size={16} />
                        新建用户
                    </Button>
                </div>
            </section>

            <section className="user-table-panel animate-enter animate-enter-delay-1">
                <UserTable
                    data={records}
                    errorMessage={errorMessage}
                    hasActiveFilter={Boolean(keyword)}
                    hasFooter={total > 0}
                    isLoading={pageQuery.isLoading && !pageData}
                    isRefreshing={isRefreshing}
                    onClearFilters={() => patchSearchParams((params) => {
                        params.delete('keyword');
                        params.delete('page');
                    })}
                    onCreate={handleCreate}
                    onEdit={(user) => {
                        setEditingUser(user);
                        setIsFormOpen(true);
                    }}
                    onRetry={() => void pageQuery.refetch()}
                    onToggleStatus={handleToggleStatus}
                    onResetPassword={(user) => setResetPasswordUser(user)}
                    statusPendingId={pendingStatusId}
                />

                <ListPagination
                    currentPage={currentPage}
                    className={suppressPaginationHover ? 'hover-locked' : ''}
                    isFetching={pageQuery.isFetching}
                    onPageChange={handlePageChange}
                    onPageSizeChange={handlePageSizeChange}
                    pageSize={pageSize}
                    total={total}
                    ariaLabel="用户分页导航"
                />
            </section>

            <UserForm
                open={isFormOpen}
                editingUser={editingUser}
                onOpenChange={(details) => setIsFormOpen(details.open)}
                onSuccess={handleFormSuccess}
            />

            <ResetPasswordDialog
                open={Boolean(resetPasswordUser)}
                user={resetPasswordUser}
                onOpenChange={(details) => {
                    if (!details.open) {
                        setResetPasswordUser(null);
                    }
                }}
                onSuccess={() => {
                    setResetPasswordUser(null);
                    showSuccess('密码已重置');
                }}
            />

            <ConfirmDialog
                open={Boolean(pendingDisableTarget)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && pendingStatusId == null) {
                        setPendingDisableTarget(null);
                    }
                }}
                title="禁用用户"
                description={
                    pendingDisableTarget ? (
                        <>
                            确定要禁用用户 <strong>{pendingDisableTarget.username}</strong> 吗？
                            <br />
                            禁用后该用户将无法登录系统，但其已有数据不会被删除。
                        </>
                    ) : ''
                }
                onConfirm={() => {
                    if (!pendingDisableTarget) return;
                    toggleStatusMutation.mutate({ id: pendingDisableTarget.id, status: 'DISABLED' });
                }}
                confirmText={pendingStatusId != null ? '禁用中...' : '确认禁用'}
                cancelText="取消"
                variant="destructive"
            />
        </div>
    );
}
