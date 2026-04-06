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
import {
    deleteGroup,
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
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [pendingDeleteTarget, setPendingDeleteTarget] = useState<GroupDetail | null>(null);

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

    const deleteMutation = useMutation({
        mutationFn: (id: number) => deleteGroup(id),
        onMutate: (id) => {
            setPendingDeleteId(id);
        },
        onSuccess: () => {
            showFeedback({
                tone: 'success',
                title: '项目组已删除',
                detail: `项目组 ${pendingDeleteTarget?.name} 及其关联数据已被成功删除。`,
            });
            void queryClient.invalidateQueries({ queryKey: ['groups'] });
            setPendingDeleteTarget(null);
        },
        onError: (error) => {
            showFeedback(
                {
                    tone: 'error',
                    title: '项目组删除失败',
                    detail: (error as { message?: string } | null)?.message ?? '无法删除该项目组，请稍后重试。',
                },
                5000,
            );
        },
        onSettled: () => {
            setPendingDeleteId(null);
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

    const handleDelete = (item: GroupDetail) => {
        setPendingDeleteTarget(item);
    };

    const queryError = pageQuery.error as { message?: string } | null;
    const errorMessage = queryError?.message ?? '';
    const prevDisabled = currentPage === 1 || pageQuery.isFetching;
    const nextDisabled = currentPage >= totalPages || pageQuery.isFetching;
    const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const pageEnd = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
    const pageCount = total === 0 ? 0 : pageEnd - pageStart + 1;
    const pageSizeOptions = PAGE_SIZE_OPTIONS.map((value) => ({ label: `${value} 条`, value: String(value) }));

    const handleFormSuccess = (name: string) => {
        setIsFormOpen(false);

        showFeedback({
            tone: 'success',
            title: '项目组已创建',
            detail: `${name} 已创建，列表正在同步最新记录。`,
        });

        void queryClient.invalidateQueries({ queryKey: ['groups'] });
        patchSearchParams((params) => {
            params.delete('page');
        });
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
                    <button
                        className="group-primary-btn"
                        onClick={() => {
                            setIsFormOpen(true);
                        }}
                        type="button"
                    >
                        <FolderPlus size={16} />
                        新建项目组
                    </button>
                </div>
            </section>

            <section className="group-table-panel animate-enter animate-enter-delay-1">
                <GroupTable
                    data={records}
                    errorMessage={errorMessage}
                    isRefreshing={isRefreshing}
                    onDelete={handleDelete}
                    deletePendingId={pendingDeleteId}
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
                                <button
                                    className="group-page-icon-btn"
                                    type="button"
                                    aria-label="第一页"
                                    aria-disabled={prevDisabled}
                                    disabled={prevDisabled}
                                    onClick={() => handlePageChange(1)}
                                >
                                    <ChevronsLeft size={16} />
                                </button>
                                <button
                                    className="group-page-icon-btn"
                                    type="button"
                                    aria-label="上一页"
                                    aria-disabled={prevDisabled}
                                    disabled={prevDisabled}
                                    onClick={() => handlePageChange(currentPage - 1)}
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <button
                                    className="group-page-icon-btn"
                                    type="button"
                                    aria-label="下一页"
                                    aria-disabled={nextDisabled}
                                    disabled={nextDisabled}
                                    onClick={() => handlePageChange(currentPage + 1)}
                                >
                                    <ChevronRight size={16} />
                                </button>
                                <button
                                    className="group-page-icon-btn"
                                    type="button"
                                    aria-label="最后一页"
                                    aria-disabled={nextDisabled}
                                    disabled={nextDisabled}
                                    onClick={() => handlePageChange(totalPages)}
                                >
                                    <ChevronsRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </section>

            <GroupForm
                open={isFormOpen}
                onOpenChange={(details) => setIsFormOpen(details.open)}
                onSuccess={handleFormSuccess}
            />

            <Dialog
                open={Boolean(pendingDeleteTarget)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && pendingDeleteId == null) {
                        setPendingDeleteTarget(null);
                    }
                }}
            >
                <DialogPortal>
                    <DialogOverlay className="dialog-backdrop" />
                    <DialogContent className="dialog-positioner">
                        <div className="group-confirm-dialog">
                            <DialogTitle className="group-confirm-title">删除项目组</DialogTitle>
                            <DialogDescription className="group-confirm-description">
                                {pendingDeleteTarget ? (
                                    <>
                                        确定要删除项目组 <strong>{pendingDeleteTarget.name}</strong> 吗？
                                        <br />
                                        删除后不可恢复。
                                    </>
                                ) : (
                                    ''
                                )}
                            </DialogDescription>
                            <div className="group-confirm-actions">
                                <button
                                    className="group-secondary-btn"
                                    disabled={pendingDeleteId != null}
                                    onClick={() => setPendingDeleteTarget(null)}
                                    type="button"
                                >
                                    取消
                                </button>
                                <button
                                    className="group-danger-btn"
                                    disabled={!pendingDeleteTarget || pendingDeleteId != null}
                                    onClick={() => {
                                        if (!pendingDeleteTarget) return;
                                        deleteMutation.mutate(pendingDeleteTarget.id);
                                    }}
                                    type="button"
                                >
                                    {pendingDeleteId != null ? '删除中...' : '确认删除'}
                                </button>
                            </div>
                        </div>
                    </DialogContent>
                </DialogPortal>
            </Dialog>
        </div>
    );
}
