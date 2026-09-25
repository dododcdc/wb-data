import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Search,
    FolderPlus,
} from 'lucide-react';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { SimpleSelect } from '../../components/SimpleSelect';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { refreshAuthContext } from '../../hooks/useAuthContext';
import {
    disableGroup,
    enableGroup,
    getGroupPage,
    GroupDetail,
} from '../../api/group';
import GroupForm from './GroupForm';
import { GroupTable } from './GroupTable';
import {
    DEFAULT_PAGE_SIZE,
    PAGE_SIZE_OPTIONS,
} from './config';
import './GroupList.css';
import { Button } from '../../components/ui/button';
import { useDataTable } from '../../hooks/useDataTable';

export default function GroupList() {
    const queryClient = useQueryClient();
    const { showSuccess, showError } = useOperationFeedback();
    const [keywordInput, setKeywordInput] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<GroupDetail | null>(null);
    const [pendingId, setPendingId] = useState<number | null>(null);

    const {
        data: records,
        total,
        isFetching,
        error,
        pagination,
        search,
    } = useDataTable<GroupDetail>({
        queryKey: ['groups'],
        fetchFn: getGroupPage,
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

    const isRefreshing = useDelayedBusy(isFetching && records.length > 0, { delayMs: 140, minVisibleMs: 320 });


    const handleEdit = (item: GroupDetail) => {
        setEditingGroup(item);
        setIsFormOpen(true);
    };

    const disableMutation = useMutation({
        mutationFn: (id: number) => disableGroup(id),
        onMutate: setPendingId,
        onSuccess: () => {
            showSuccess('项目组已禁用');
            void queryClient.invalidateQueries({ queryKey: ['groups'] });
            void refreshAuthContext(queryClient);
        },
        onError: (error) => {
            showError(error, '禁用失败');
        },
        onSettled: () => setPendingId(null),
    });

    const enableMutation = useMutation({
        mutationFn: (id: number) => enableGroup(id),
        onMutate: setPendingId,
        onSuccess: () => {
            showSuccess('项目组已启用');
            void queryClient.invalidateQueries({ queryKey: ['groups'] });
            void refreshAuthContext(queryClient);
        },
        onError: (error) => {
            showError(error, '启用失败');
        },
        onSettled: () => setPendingId(null),
    });

    const handleDisable = (item: GroupDetail) => {
        disableMutation.mutate(item.id);
    };

    const handleEnable = (item: GroupDetail) => {
        enableMutation.mutate(item.id);
    };

    const errorMessage = error instanceof Error ? error.message : String(error || '');
    const { page, pageSize, setPage, setPageSize, totalPages } = pagination;

    const prevDisabled = page === 1 || isFetching;
    const nextDisabled = page >= totalPages || isFetching;
    const pageCount = records.length;
    const pageSizeOptions = PAGE_SIZE_OPTIONS.map((value) => ({ label: `${value} 条`, value: String(value) }));

    const handleFormSuccess = async () => {
        setIsFormOpen(false);
        setEditingGroup(null);

        if (editingGroup) {
            showSuccess('项目组已更新');
        } else {
            showSuccess('项目组已创建');
            setPage(1);
        }

        void queryClient.invalidateQueries({ queryKey: ['groups'] });

        // 与自动刷新共用同一查询，避免覆盖更新的切组或登录会话。
        void refreshAuthContext(queryClient);
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
                    <div className="group-pagination group-pagination-admin">
                        <div className="group-page-info">本页 {pageCount} 条，共 {total} 条</div>

                        <div className="group-pagination-controls" aria-label="项目组分页导航">
                            <div className="group-page-size-group">
                                <span className="group-pagination-label">每页</span>
                                <div className="group-page-size-select">
                                    <SimpleSelect
                                        id="group-page-size"
                                        value={String(pageSize)}
                                        options={pageSizeOptions}
                                        disabled={isFetching}
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

                            <div className="group-page-status">
                                第 {page} / {totalPages} 页
                            </div>

                            <div className="group-page-actions">
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
