import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, DatabaseZap, Search } from 'lucide-react';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import {
    DataSource,
    deleteDataSource,
    getDataSourceOwners,
    getDataSourcePage,
    PageResult,
    testExistingConnection,
    transferDataSourceOwner,
    updateDataSourceStatus,
} from '../../api/datasource';
import type { TransferOwnerPayload } from '../../api/groupSettings';
import { useAuthStore } from '../../utils/auth';
import DataSourceForm from './DataSourceForm';
import DataSourceListSkeleton from './DataSourceListSkeleton';
import {
    buildDataSourcePageQueryKey,
    DEFAULT_PAGE_SIZE,
    parseOwnerParam,
    parsePageParam,
    parsePageSizeParam,
} from './config';
import { ListPagination } from '../../components/ui/list/ListPagination';
import { DataSourceTable } from './DataSourceTable';
import { SimpleSelect } from '../../components/SimpleSelect';
import { formatCandidateLabel } from '../../components/owner/ownerUtils';
import { TransferOwnerDialog } from '../../components/owner/TransferOwnerDialog';
import { getErrorMessage } from '../../utils/error';
import './DataSourceList.css';
import { Button } from '../../components/ui/button';

function buildNextSearchParams(
    currentSearchParams: URLSearchParams,
    mutate: (next: URLSearchParams) => void,
) {
    const next = new URLSearchParams(currentSearchParams);
    mutate(next);

    if (next.get('page') === '1') next.delete('page');
    if (next.get('size') === String(DEFAULT_PAGE_SIZE)) next.delete('size');
    if (!next.get('keyword')) next.delete('keyword');
    if (!next.get('owner')) next.delete('owner');

    return next;
}

function patchCachedDataSourcePages(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (page: PageResult<DataSource>) => PageResult<DataSource>,
) {
    queryClient.setQueriesData<PageResult<DataSource>>({ queryKey: ['dataSources'] }, (current) => {
        if (!current) {
            return current;
        }

        return updater(current);
    });
}

export default function DataSourceList() {
    const queryClient = useQueryClient();
    const { showFeedback, showSuccess, showError } = useOperationFeedback();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentGroup = useAuthStore((s) => s.currentGroup);
    const userInfo = useAuthStore((s) => s.userInfo);
    const permissions = useAuthStore((s) => s.permissions);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);
    const canWrite = systemAdmin || permissions.includes('datasource.write');
    const groupId = currentGroup?.id;
    const [keywordInput, setKeywordInput] = useState(searchParams.get('keyword') ?? '');
    const [isComposing, setIsComposing] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [formMode, setFormMode] = useState<'create' | 'edit' | 'view'>('create');
    const [suppressPaginationHover, setSuppressPaginationHover] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [pendingStatusId, setPendingStatusId] = useState<number | null>(null);
    const [pendingTestId, setPendingTestId] = useState<number | null>(null);
    const [pendingDeleteTarget, setPendingDeleteTarget] = useState<DataSource | null>(null);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [transferState, setTransferState] = useState<{
        open: boolean;
        mode: 'selected' | 'by-owner';
        targetIds: number[];
        targetNames: string[];
        initialFromOwnerUserId: number | null;
    }>({
        open: false,
        mode: 'selected',
        targetIds: [],
        targetNames: [],
        initialFromOwnerUserId: null,
    });
    const [transferError, setTransferError] = useState('');

    const currentPage = parsePageParam(searchParams.get('page'));
    const pageSize = parsePageSizeParam(searchParams.get('size'));
    const keyword = (searchParams.get('keyword') ?? '').trim();
    const ownerUserId = parseOwnerParam(searchParams.get('owner'));

    useEffect(() => {
        setSelectedIds([]);
    }, [groupId]);

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
        queryKey: buildDataSourcePageQueryKey({ currentPage, pageSize, keyword, groupId, ownerUserId }),
        queryFn: () =>
            getDataSourcePage({
                page: currentPage,
                size: pageSize,
                keyword: keyword || undefined,
                groupId,
                ownerUserId,
            }),
        placeholderData: (previousData, previousQuery) =>
            groupId != null && previousQuery?.queryKey[1].groupId === groupId ? previousData : undefined,
        enabled: groupId != null,
    });

    const ownerSummaryQuery = useQuery({
        queryKey: ['datasource-owners', groupId],
        queryFn: () => getDataSourceOwners(groupId!).then((res) => res ?? []),
        enabled: groupId != null,
        staleTime: 30_000,
    });

    const ownerSummaries = useMemo(() => ownerSummaryQuery.data ?? [], [ownerSummaryQuery.data]);
    const ownerFilterOptions = useMemo(() => {
        const myId = userInfo?.id;
        const mySummary = myId != null ? ownerSummaries.find((owner) => owner.userId === myId) : undefined;
        const options = [{ value: 'all', label: '全部负责人' }];
        if (myId != null) {
            options.push({
                value: String(myId),
                label: mySummary ? `我负责的 (${mySummary.count})` : '我负责的',
            });
        }
        ownerSummaries.forEach((owner) => {
            if (owner.userId === myId) return;
            const statusHint = owner.status === 'DISABLED'
                ? ' [已停用]'
                : owner.status === 'LEFT_GROUP'
                    ? ' [已离组]'
                    : '';
            options.push({
                value: String(owner.userId),
                label: `${formatCandidateLabel(owner.displayName, owner.username)}${statusHint} (${owner.count})`,
            });
        });
        if (ownerUserId != null && !options.some((opt) => opt.value === String(ownerUserId))) {
            options.push({ value: String(ownerUserId), label: `用户 #${ownerUserId}` });
        }
        return options;
    }, [ownerSummaries, ownerUserId, userInfo?.id]);

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

    const deleteMutation = useMutation({
        mutationFn: (id: number) => deleteDataSource(id, groupId!),
        onMutate: async (id) => {
            setPendingDeleteId(id);
            await queryClient.cancelQueries({ queryKey: ['dataSources'] });

            patchCachedDataSourcePages(queryClient, (current) => {
                const nextRecords = current.records.filter((record) => record.id !== id);
                if (nextRecords.length === current.records.length) {
                    return current;
                }

                const nextTotal = Math.max(0, current.total - 1);

                return {
                    ...current,
                    records: nextRecords,
                    total: nextTotal,
                    pages: Math.max(1, Math.ceil(nextTotal / current.size) || 1),
                };
            });

            return {
                previousPages: queryClient.getQueriesData<PageResult<DataSource>>({ queryKey: ['dataSources'] }),
            };
        },
        onSuccess: (_data, id) => {
            setPendingDeleteTarget(null);
            setSelectedIds((prev) => prev.filter((item) => item !== id));
            showSuccess('数据源已删除');
            void queryClient.invalidateQueries({ queryKey: ['dataSources'] });
            void queryClient.invalidateQueries({ queryKey: ['datasource-owners', groupId] });
        },
        onError: (error, _id, context) => {
            context?.previousPages.forEach(([queryKey, page]) => {
                queryClient.setQueryData(queryKey, page);
            });
            showError(error, '删除失败');
        },
        onSettled: () => {
            setPendingDeleteId(null);
        },
    });

    const toggleStatusMutation = useMutation({
        mutationFn: ({ id, status }: { id: number; status: string }) => updateDataSourceStatus(id, status, groupId!),
        onMutate: async ({ id, status }) => {
            setPendingStatusId(id);
            await queryClient.cancelQueries({ queryKey: ['dataSources'] });

            patchCachedDataSourcePages(queryClient, (current) => ({
                ...current,
                records: current.records.map((record) => record.id === id
                    ? { ...record, status, updatedAt: new Date().toISOString() }
                    : record),
            }));

            return {
                nextStatus: status,
                previousPages: queryClient.getQueriesData<PageResult<DataSource>>({ queryKey: ['dataSources'] }),
            };
        },
        onSuccess: (_response, variables) => {
            showSuccess(variables.status === 'ENABLED' ? '数据源已启用' : '数据源已停用');
            void queryClient.invalidateQueries({ queryKey: ['dataSources'] });
        },
        onError: (error, _variables, context) => {
            context?.previousPages.forEach(([queryKey, page]) => {
                queryClient.setQueryData(queryKey, page);
            });
            showError(error, '状态更新失败');
        },
        onSettled: () => {
            setPendingStatusId(null);
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

    const handleDelete = (item: DataSource) => {
        setPendingDeleteTarget(item);
    };

    const handleConfirmDelete = () => {
        if (!pendingDeleteTarget) return;
        deleteMutation.mutate(pendingDeleteTarget.id);
    };

    const handleToggleStatus = (item: DataSource) => {
        const nextStatus = item.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
        toggleStatusMutation.mutate({ id: item.id, status: nextStatus });
    };

    const handleView = (id: number) => {
        setEditingId(id);
        setFormMode('view');
        setIsFormOpen(true);
    };

    const handleEdit = (id: number) => {
        setEditingId(id);
        setFormMode('edit');
        setIsFormOpen(true);
    };

    const handleCreate = () => {
        setEditingId(null);
        setFormMode('create');
        setIsFormOpen(true);
    };

    const handleTestConnection = async (item: DataSource) => {
        if (groupId == null || pendingTestId != null) {
            return;
        }

        setPendingTestId(item.id);
        try {
            const result = await testExistingConnection(item.id, groupId);
            showFeedback({
                tone: result.success ? 'success' : 'error',
                title: result.message?.trim()
                    || (result.success ? '连接测试成功' : '连接测试失败'),
                detail: '',
            });
        } catch (error) {
            showError(error, '连接测试失败');
        } finally {
            setPendingTestId(null);
        }
    };

    const transferMutation = useMutation({
        mutationFn: (payload: TransferOwnerPayload) => transferDataSourceOwner(groupId!, payload),
        onSuccess: (result) => {
            setTransferError('');
            setTransferState((prev) => ({ ...prev, open: false }));
            if (transferState.mode === 'selected') {
                const transferredSet = new Set(transferState.targetIds);
                setSelectedIds((prev) => prev.filter((id) => !transferredSet.has(id)));
            } else {
                setSelectedIds([]);
            }
            showSuccess(`已转移 ${result.updatedCount} 个数据源的负责人至 ${result.targetOwnerName}`);
            void queryClient.invalidateQueries({ queryKey: ['dataSources'] });
            void queryClient.invalidateQueries({ queryKey: ['datasource-owners', groupId] });
        },
        onError: (error) => {
            setTransferError(getErrorMessage(error, '转移负责人失败'));
        },
    });

    const handleToggleRow = (id: number) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    };

    const handleToggleAll = (checked: boolean) => {
        const pageIds = records.map((item) => item.id);
        if (checked) {
            setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
        } else {
            const pageIdSet = new Set(pageIds);
            setSelectedIds((prev) => prev.filter((id) => !pageIdSet.has(id)));
        }
    };

    const openSingleTransferDialog = (item: DataSource) => {
        setTransferError('');
        setTransferState({
            open: true,
            mode: 'selected',
            targetIds: [item.id],
            targetNames: [item.name],
            initialFromOwnerUserId: null,
        });
    };

    const openSelectedTransferDialog = () => {
        if (selectedIds.length === 0) return;
        setTransferError('');
        const nameMap = new Map(records.map((item) => [item.id, item.name]));
        setTransferState({
            open: true,
            mode: 'selected',
            targetIds: selectedIds,
            targetNames: selectedIds.map((id) => nameMap.get(id) ?? `#${id}`),
            initialFromOwnerUserId: null,
        });
    };

    const openBulkByOwnerDialog = () => {
        setTransferError('');
        setTransferState({
            open: true,
            mode: 'by-owner',
            targetIds: [],
            targetNames: [],
            initialFromOwnerUserId: ownerUserId ?? null,
        });
    };

    const queryError = pageQuery.error as { message?: string } | null;
    const errorMessage = queryError?.message ?? '';

    if (pageQuery.isLoading && !pageData) {
        return <DataSourceListSkeleton />;
    }

    return (
        <div className="datasource-page">
            <section className="datasource-toolbar animate-enter">
                <div className="datasource-search-shell">
                    <Search size={16} />
                    <input
                        aria-label="搜索数据源"
                        placeholder="搜索名称、描述、主机名"
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
                <SimpleSelect
                    className="datasource-owner-filter"
                    ariaLabel="按负责人筛选数据源"
                    value={ownerUserId != null ? String(ownerUserId) : 'all'}
                    options={ownerFilterOptions}
                    onChange={(nextValue) => {
                        patchSearchParams((params) => {
                            if (nextValue === 'all') {
                                params.delete('owner');
                            } else {
                                params.set('owner', nextValue);
                            }
                            params.set('page', '1');
                        });
                    }}
                />
                <div className="datasource-toolbar-actions">
                    {canWrite && (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                disabled={ownerSummaries.length === 0}
                                onClick={openBulkByOwnerDialog}
                            >
                                <ArrowLeftRight size={14} />
                                批量转移
                            </Button>
                            <Button variant="default" onClick={handleCreate} type="button">
                                <DatabaseZap size={16} />
                                新建数据源
                            </Button>
                        </>
                    )}
                </div>
            </section>

            <section className="datasource-table-panel animate-enter animate-enter-delay-1">
                {canWrite && selectedIds.length > 0 ? (
                    <div className="wb-list-selection-bar">
                        <span className="wb-list-selection-count">已选 {selectedIds.length} 个数据源</span>
                        <div className="wb-list-selection-actions">
                            <Button type="button" size="sm" variant="default" onClick={openSelectedTransferDialog}>
                                <ArrowLeftRight size={13} />
                                转移负责人
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                                清空选择
                            </Button>
                        </div>
                    </div>
                ) : null}
                <DataSourceTable
                    data={records}
                    canWrite={canWrite}
                    deletePendingId={pendingDeleteId}
                    errorMessage={errorMessage}
                    hasActiveFilter={Boolean(keyword || ownerUserId != null)}
                    hasFooter={total > 0}
                    isRefreshing={isRefreshing}
                    selectedIds={selectedIds}
                    onToggleRow={handleToggleRow}
                    onToggleAll={handleToggleAll}
                    onTransferOwner={openSingleTransferDialog}
                    onClearFilters={() => patchSearchParams((params) => {
                        params.delete('keyword');
                        params.delete('owner');
                        params.delete('page');
                    })}
                    onCreate={handleCreate}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    onRetry={() => void pageQuery.refetch()}
                    onTest={handleTestConnection}
                    onToggleStatus={handleToggleStatus}
                    onView={handleView}
                    statusPendingId={pendingStatusId}
                    testPendingId={pendingTestId}
                />
                <ListPagination
                    currentPage={currentPage}
                    className={suppressPaginationHover ? 'hover-locked' : ''}
                    isFetching={pageQuery.isFetching}
                    onPageChange={handlePageChange}
                    onPageSizeChange={handlePageSizeChange}
                    pageSize={pageSize}
                    total={total}
                    ariaLabel="数据源分页导航"
                />
            </section>

            <DataSourceForm
                open={isFormOpen}
                onOpenChange={(details) => {
                    setIsFormOpen(details.open);
                    if (!details.open) {
                        setFormMode('create');
                        setEditingId(null);
                    }
                }}
                dataSourceId={editingId}
                groupId={groupId}
                readOnly={formMode === 'view'}
                onSuccess={(details) => {
                    setIsFormOpen(false);
                    setFormMode('create');
                    setEditingId(null);
                    if (details.action === 'edit' && details.dataSourceId != null) {
                        patchCachedDataSourcePages(queryClient, (current) => ({
                            ...current,
                            records: current.records.map((record) => record.id === details.dataSourceId
                                ? {
                                    ...record,
                                    ...details.payload,
                                    updatedAt: new Date().toISOString(),
                                }
                                : record),
                        }));
                    }

                    showSuccess(details.action === 'create' ? '数据源已创建' : '数据源已更新');

                    void queryClient.invalidateQueries({ queryKey: ['dataSources'] });
                    void queryClient.invalidateQueries({ queryKey: ['datasource-owners', groupId] });
                    if (details.action === 'create') {
                        patchSearchParams((params) => {
                            params.delete('page');
                        });
                    }
                }}
            />

            {groupId != null ? (
                <TransferOwnerDialog
                    open={transferState.open}
                    onOpenChange={(nextOpen) => {
                        if (!nextOpen && !transferMutation.isPending) {
                            setTransferError('');
                            setTransferState((prev) => ({ ...prev, open: false }));
                        }
                    }}
                    groupId={groupId}
                    assetLabel="数据源"
                    mode={transferState.mode}
                    selectedIds={transferState.targetIds}
                    selectedNames={transferState.targetNames}
                    owners={ownerSummaries}
                    initialFromOwnerUserId={transferState.initialFromOwnerUserId}
                    pending={transferMutation.isPending}
                    errorMessage={transferError}
                    onConfirm={(payload) => transferMutation.mutate(payload)}
                />
            ) : null}

            <ConfirmDialog
                open={Boolean(pendingDeleteTarget)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && pendingDeleteId == null) {
                        setPendingDeleteTarget(null);
                    }
                }}
                title="删除数据源"
                description={
                    pendingDeleteTarget ? (
                        <>
                            你将删除数据源 <strong>{pendingDeleteTarget.name}</strong>。删除后该连接配置将不再出现在目录里，请确认当前没有人继续依赖它。
                        </>
                    ) : ''
                }
                onConfirm={handleConfirmDelete}
                confirmText={pendingDeleteId != null ? '删除中...' : '确认删除'}
                cancelText="取消"
                variant="destructive"
            />
        </div>
    );
}
