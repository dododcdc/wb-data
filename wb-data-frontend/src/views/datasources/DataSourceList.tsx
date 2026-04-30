import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseZap, Search } from 'lucide-react';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { useSearchParams } from 'react-router-dom';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import {
    DataSource,
    deleteDataSource,
    getDataSourcePage,
    PageResult,
    updateDataSourceStatus,
} from '../../api/datasource';
import { useAuthStore } from '../../utils/auth';
import DataSourceForm from './DataSourceForm';
import DataSourceListSkeleton from './DataSourceListSkeleton';
import { buildDataSourcePageQueryKey, DEFAULT_PAGE_SIZE, parsePageParam, parsePageSizeParam } from './config';
import { DataSourcePagination } from './DataSourcePagination';
import { DataSourceTable } from './DataSourceTable';
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
    const { showFeedback } = useOperationFeedback();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentGroup = useAuthStore((s) => s.currentGroup);
    const permissions = useAuthStore((s) => s.permissions);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);
    const canWrite = systemAdmin || permissions.includes('datasource.write');
    const groupId = currentGroup?.id;
    const [keywordInput, setKeywordInput] = useState(searchParams.get('keyword') ?? '');
    const [isComposing, setIsComposing] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [suppressPaginationHover, setSuppressPaginationHover] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [pendingStatusId, setPendingStatusId] = useState<number | null>(null);
    const [pendingDeleteTarget, setPendingDeleteTarget] = useState<DataSource | null>(null);

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
        queryKey: buildDataSourcePageQueryKey({ currentPage, pageSize, keyword, groupId }),
        queryFn: () =>
            getDataSourcePage({
                page: currentPage,
                size: pageSize,
                keyword: keyword || undefined,
                groupId,
            }),
        placeholderData: (previousData) => previousData,
        enabled: groupId != null,
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

    const deleteMutation = useMutation({
        mutationFn: deleteDataSource,
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
        onSuccess: (_response, id) => {
            const deletedName = pendingDeleteTarget?.name ?? `#${id}`;
            setPendingDeleteTarget(null);
            showFeedback({
                tone: 'success',
                title: '数据源已删除',
                detail: `${deletedName} 已从列表移除。`,
            });
            void queryClient.invalidateQueries({ queryKey: ['dataSources'] });
        },
        onError: (error, _id, context) => {
            context?.previousPages.forEach(([queryKey, page]) => {
                queryClient.setQueryData(queryKey, page);
            });
            showFeedback({
                tone: 'error',
                title: '删除失败',
                detail: (error as { message?: string } | null)?.message ?? '数据源删除失败，请稍后重试。',
            }, 5000);
        },
        onSettled: () => {
            setPendingDeleteId(null);
        },
    });

    const toggleStatusMutation = useMutation({
        mutationFn: ({ id, status }: { id: number; status: string }) => updateDataSourceStatus(id, status),
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
            showFeedback({
                tone: 'success',
                title: variables.status === 'ENABLED' ? '数据源已启用' : '数据源已停用',
                detail: '列表状态已即时更新，并已在后台同步最新数据。',
            });
            void queryClient.invalidateQueries({ queryKey: ['dataSources'] });
        },
        onError: (error, _variables, context) => {
            context?.previousPages.forEach(([queryKey, page]) => {
                queryClient.setQueryData(queryKey, page);
            });
            showFeedback({
                tone: 'error',
                title: '状态更新失败',
                detail: (error as { message?: string } | null)?.message ?? '数据源状态更新失败，请稍后重试。',
            }, 5000);
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
                <div className="datasource-toolbar-actions">
                    {canWrite && (
                        <Button variant="default" onClick={() => { setEditingId(null); setIsFormOpen(true); }} type="button">
                            <DatabaseZap size={16} />
                            新建数据源
                        </Button>
                    )}
                </div>
            </section>

            <section className="datasource-table-panel animate-enter animate-enter-delay-1">
                <DataSourceTable
                    data={records}
                    canWrite={canWrite}
                    deletePendingId={pendingDeleteId}
                    errorMessage={errorMessage}
                    isRefreshing={isRefreshing}
                    onDelete={handleDelete}
                    onEdit={(id) => {
                        setEditingId(id);
                        setIsFormOpen(true);
                    }}
                    onToggleStatus={handleToggleStatus}
                    statusPendingId={pendingStatusId}
                />
                <DataSourcePagination
                    currentPage={currentPage}
                    hoverLocked={suppressPaginationHover}
                    isFetching={pageQuery.isFetching}
                    onPageChange={handlePageChange}
                    onPageSizeChange={handlePageSizeChange}
                    pageSize={pageSize}
                    total={total}
                />
            </section>

            <DataSourceForm
                open={isFormOpen}
                onOpenChange={(details) => setIsFormOpen(details.open)}
                dataSourceId={editingId}
                groupId={groupId}
                onSuccess={(details) => {
                    setIsFormOpen(false);
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

                    showFeedback({
                        tone: 'success',
                        title: details.action === 'create' ? '数据源已创建' : '数据源已更新',
                        detail: details.action === 'create'
                            ? `${details.payload.name} 已保存，列表正在同步最新记录。`
                            : `${details.payload.name} 的配置已更新。`,
                    });

                    void queryClient.invalidateQueries({ queryKey: ['dataSources'] });
                    if (details.action === 'create') {
                        patchSearchParams((params) => {
                            params.delete('page');
                        });
                    }
                }}
            />

            <Dialog open={Boolean(pendingDeleteTarget)} onOpenChange={(nextOpen) => {
                if (!nextOpen && pendingDeleteId == null) {
                    setPendingDeleteTarget(null);
                }
            }}>
                <DialogPortal>
                    <DialogOverlay className="dialog-backdrop" />
                    <DialogContent className="dialog-positioner">
                        <div className="datasource-confirm-dialog">
                            <DialogTitle className="datasource-confirm-title">删除数据源</DialogTitle>
                            <DialogDescription className="datasource-confirm-description">
                                {pendingDeleteTarget ? (
                                    <>
                                        你将删除数据源 <strong>{pendingDeleteTarget.name}</strong>。删除后该连接配置将不再出现在目录里，请确认当前没有人继续依赖它。
                                    </>
                                ) : ''}
                            </DialogDescription>
                            <div className="datasource-confirm-meta">
                                <span>{pendingDeleteTarget?.type ?? '--'}</span>
                                <span>{pendingDeleteTarget?.host ?? '--'}</span>
                                <span>{pendingDeleteTarget?.databaseName || '未配置默认库'}</span>
                            </div>
                            <div className="datasource-confirm-actions">
                                <Button
                                    variant="outline"
                                    disabled={pendingDeleteId != null}
                                    onClick={() => setPendingDeleteTarget(null)}
                                    type="button"
                                >
                                    取消
                                </Button>
                                <Button
                                    variant="destructive"
                                    disabled={!pendingDeleteTarget || pendingDeleteId != null}
                                    onClick={handleConfirmDelete}
                                    type="button"
                                >
                                    {pendingDeleteId != null ? '删除中...' : '确认删除'}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>
        </div>
    );
}
