import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseZap, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
    DataSource,
    deleteDataSource,
    getDataSourcePage,
    updateDataSourceStatus,
} from '../api/datasource';
import DataSourceForm from './DataSourceForm';
import { DEFAULT_PAGE_SIZE, parsePageParam, parsePageSizeParam } from './datasources/config';
import { DataSourcePagination } from './datasources/DataSourcePagination';
import { DataSourceTable } from './datasources/DataSourceTable';
import './DataSourceList.css';

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

export default function DataSourceList() {
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keywordInput, setKeywordInput] = useState(searchParams.get('keyword') ?? '');
    const [isComposing, setIsComposing] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [suppressPaginationHover, setSuppressPaginationHover] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [pendingStatusId, setPendingStatusId] = useState<number | null>(null);

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
        queryKey: ['dataSources', { currentPage, pageSize, keyword }],
        queryFn: () =>
            getDataSourcePage({
                page: currentPage,
                size: pageSize,
                keyword: keyword || undefined,
            }),
        placeholderData: (previousData) => previousData,
    });

    const pageData = pageQuery.data;
    const records = pageData?.records ?? [];
    const total = pageData?.total ?? 0;
    const totalPages = pageData?.pages ?? Math.max(1, Math.ceil(total / pageSize) || 1);

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
        onMutate: (id) => {
            setPendingDeleteId(id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dataSources'] });
        },
        onSettled: () => {
            setPendingDeleteId(null);
        },
    });

    const toggleStatusMutation = useMutation({
        mutationFn: ({ id, status }: { id: number; status: string }) => updateDataSourceStatus(id, status),
        onMutate: ({ id }) => {
            setPendingStatusId(id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dataSources'] });
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

    const handleDelete = (id: number) => {
        if (!window.confirm('确认删除这个数据源吗？')) return;
        deleteMutation.mutate(id);
    };

    const handleToggleStatus = (item: DataSource) => {
        const nextStatus = item.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
        toggleStatusMutation.mutate({ id: item.id, status: nextStatus });
    };

    const queryError = pageQuery.error as { message?: string } | null;
    const errorMessage = queryError?.message ?? '';

    return (
        <div className="datasource-page">
            <section className="datasource-toolbar">
                <div className="datasource-search-shell">
                    <Search size={16} />
                    <input
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
                    <button className="datasource-primary-btn" onClick={() => { setEditingId(null); setIsFormOpen(true); }} type="button">
                        <DatabaseZap size={16} />
                        新建数据源
                    </button>
                </div>
            </section>

            <section className="datasource-table-panel">
                <DataSourceTable
                    data={records}
                    deletePendingId={pendingDeleteId}
                    errorMessage={errorMessage}
                    isFetching={pageQuery.isFetching}
                    isLoading={pageQuery.isLoading}
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
                    pageSize={pageSize}
                    total={total}
                />
            </section>

            <DataSourceForm
                open={isFormOpen}
                onOpenChange={(details) => setIsFormOpen(details.open)}
                dataSourceId={editingId}
                onSuccess={(action) => {
                    setIsFormOpen(false);
                    queryClient.invalidateQueries({ queryKey: ['dataSources'] });
                    if (action === 'create') {
                        patchSearchParams((params) => {
                            params.delete('page');
                        });
                    }
                }}
            />
        </div>
    );
}
