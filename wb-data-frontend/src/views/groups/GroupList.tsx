import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Search,
    FolderPlus,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../utils/error';
import { SimpleSelect } from '../../components/SimpleSelect';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { getAuthContext } from '../../api/auth';
import { useAuthStore } from '../../utils/auth';
import {
    disableGroup,
    enableGroup,
    getGroupPage,
    GroupDetail,
} from '../../api/group';
import GroupForm from './GroupForm';
import { GroupTable } from './GroupTable';
import {
    buildGroupPageQueryKey,
    DEFAULT_PAGE_SIZE,
    PAGE_SIZE_OPTIONS,
    parsePageParam,
    parsePageSizeParam,
} from './config';
import './GroupList.css';
import { Button } from '../../components/ui/button';

function buildNextSearchParams(currentSearchParams: URLSearchParams, mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(currentSearchParams);
    mutate(next);

    if (next.get('page') === '1') next.delete('page');
    if (next.get('size') === String(DEFAULT_PAGE_SIZE)) next.delete('size');
    if (!next.get('keyword')) next.delete('keyword');

    return next;
}

export default function GroupList() {
    const queryClient = useQueryClient();
    const { showFeedback } = useOperationFeedback();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keywordInput, setKeywordInput] = useState(searchParams.get('keyword') ?? '');
    const [isComposing, setIsComposing] = useState(false);
    const [suppressPaginationHover, setSuppressPaginationHover] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<GroupDetail | null>(null);
    const [pendingId, setPendingId] = useState<number | null>(null);

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
        queryKey: buildGroupPageQueryKey({ currentPage, pageSize, keyword }),
        queryFn: () => getGroupPage({ page: currentPage, size: pageSize, keyword: keyword || undefined }),
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

    
    const disableMutation = useMutation({
        mutationFn: (id: number) => disableGroup(id),
        onMutate: setPendingId,
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '项目组已禁用', detail: '' });
            void queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
        onError: (e) => {
            showFeedback({ tone: 'error', title: '禁用失败', detail: getErrorMessage(e, '请稍后重试') });
        },
        onSettled: () => setPendingId(null),
    });

    const enableMutation = useMutation({
        mutationFn: (id: number) => enableGroup(id),
        onMutate: setPendingId,
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '项目组已启用', detail: '' });
            void queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
        onError: (e) => {
            showFeedback({ tone: 'error', title: '启用失败', detail: getErrorMessage(e, '请稍后重试') });
        },
        onSettled: () => setPendingId(null),
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

    const handleEdit = (item: GroupDetail) => {
        setEditingGroup(item);
        setIsFormOpen(true);
    };

    const handleDisable = (item: GroupDetail) => {
        disableMutation.mutate(item.id);
    };

    const handleEnable = (item: GroupDetail) => {
        enableMutation.mutate(item.id);
    };

    const queryError = pageQuery.error as { message?: string } | null;
    const errorMessage = queryError?.message ?? '';
    const prevDisabled = currentPage === 1 || pageQuery.isFetching;
    const nextDisabled = currentPage >= totalPages || pageQuery.isFetching;
    const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const pageEnd = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
    const pageCount = total === 0 ? 0 : pageEnd - pageStart + 1;
    const pageSizeOptions = PAGE_SIZE_OPTIONS.map((value) => ({ label: `${value} 条`, value: String(value) }));

    const handleFormSuccess = async (name: string) => {
        setIsFormOpen(false);
        setEditingGroup(null);

        if (editingGroup) {
            showFeedback({
                tone: 'success',
                title: '项目组已更新',
                detail: `${name} 的信息已保存。`,
            });
        } else {
            showFeedback({
                tone: 'success',
                title: '项目组已创建',
                detail: `${name} 已创建，列表正在同步最新记录。`,
            });
            patchSearchParams((params) => {
                params.delete('page');
            });
        }

        void queryClient.invalidateQueries({ queryKey: ['groups'] });

        // 刷新 auth context 以更新顶部项目组下拉列表
        try {
            const ctx = await getAuthContext();
            useAuthStore.getState().setAuthContext(ctx);
        } catch {
            // 刷新失败不影响主流程
        }
    };

    return (
        <div className="group-page">
            <section className="group-toolbar animate-enter">
                <div className="group-search-shell">
                    <Search size={16} />
                    <input
                        aria-label="搜索项目组"
                        placeholder="搜索项目组名称"
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
                <div className="group-toolbar-actions">
                    <Button
                        variant="default"
                        onClick={() => {
                            setIsFormOpen(true);
                        }}
                        type="button"
                    >
                        <FolderPlus size={16} />
                        新建项目组
                    </Button>
                </div>
            </section>

            <section className="group-table-panel animate-enter animate-enter-delay-1">
                <GroupTable
                    data={records}
                    errorMessage={errorMessage}
                    isRefreshing={isRefreshing}
                    onEdit={handleEdit}
                    onDisable={handleDisable}
                    onEnable={handleEnable}
                    pendingId={pendingId}
                />

                {total > 0 ? (
                    <div className={`group-pagination group-pagination-admin ${suppressPaginationHover ? 'hover-locked' : ''}`}>
                        <div className="group-page-info">本页 {pageCount} 条，共 {total} 条</div>

                        <div className="group-pagination-controls" aria-label="项目组分页导航">
                            <div className="group-page-size-group">
                                <span className="group-pagination-label">每页</span>
                                <div className="group-page-size-select">
                                    <SimpleSelect
                                        id="group-page-size"
                                        value={String(pageSize)}
                                        options={pageSizeOptions}
                                        disabled={pageQuery.isFetching}
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

                            <div className="group-page-status">
                                第 {currentPage} / {totalPages} 页
                            </div>

                            <div className="group-page-actions">
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
            </section>

            <GroupForm
                open={isFormOpen}
                onOpenChange={(details) => {
                    setIsFormOpen(details.open);
                    if (!details.open) setEditingGroup(null);
                }}
                onSuccess={handleFormSuccess}
                initialData={editingGroup}
            />
        </div>
    );
}
