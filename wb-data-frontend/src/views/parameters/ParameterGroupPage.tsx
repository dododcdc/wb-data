import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { archiveParameterGroup, getParameterGroupPage, getParameterGroupReferences, restoreParameterGroup } from '../../api/parameterGroups';
import type { ParameterGroupSummary } from '../../api/parameterGroups';
import { SimpleSelect } from '../../components/SimpleSelect';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ListPagination } from '../../components/ui/list/ListPagination';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { useAuthStore } from '../../utils/auth';
import ParameterGroupDialog from './ParameterGroupDialog';
import ParameterPreviewDialog from './ParameterPreviewDialog';
import { ParameterGroupTable } from './ParameterGroupTable';
import './ParameterGroupPage.css';

const DEFAULT_PAGE_SIZE = 20;

function parsePositiveInteger(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default function ParameterGroupPage() {
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [previewTarget, setPreviewTarget] = useState<ParameterGroupSummary | null>(null);
    const [actionTarget, setActionTarget] = useState<ParameterGroupSummary | null>(null);
    const [keywordInput, setKeywordInput] = useState(searchParams.get('keyword') ?? '');
    const [actionError, setActionError] = useState('');
    const currentGroup = useAuthStore((state) => state.currentGroup);
    const permissions = useAuthStore((state) => state.permissions);
    const systemAdmin = useAuthStore((state) => state.systemAdmin);
    const groupId = currentGroup?.id;
    const keyword = searchParams.get('keyword')?.trim() || undefined;
    const currentPage = parsePositiveInteger(searchParams.get('page'), 1);
    const pageSize = parsePositiveInteger(searchParams.get('size'), DEFAULT_PAGE_SIZE);
    const statusValue = searchParams.get('status');
    const status = statusValue === 'ACTIVE' || statusValue === 'ARCHIVED' ? statusValue : undefined;
    const canWrite = groupId != null && (systemAdmin || permissions.includes('parameter.write'));

    useEffect(() => {
        setKeywordInput(keyword ?? '');
    }, [keyword]);

    useEffect(() => {
        const normalized = keywordInput.trim();
        if (normalized === (keyword ?? '')) return;
        const timer = window.setTimeout(() => {
            const next = new URLSearchParams(searchParams);
            if (normalized) next.set('keyword', normalized);
            else next.delete('keyword');
            next.delete('page');
            setSearchParams(next, { replace: true });
        }, 350);
        return () => window.clearTimeout(timer);
    }, [keyword, keywordInput, searchParams, setSearchParams]);

    const pageQuery = useQuery({
        queryKey: ['parameter-groups', groupId, currentPage, pageSize, keyword, status],
        queryFn: () => getParameterGroupPage({
            groupId: groupId!,
            page: currentPage,
            size: pageSize,
            keyword,
            status,
        }),
        enabled: groupId != null,
    });

    const records = pageQuery.data?.records ?? [];
    const total = pageQuery.data?.total ?? 0;
    const isRefreshing = useDelayedBusy(pageQuery.isFetching && Boolean(pageQuery.data), { delayMs: 140, minVisibleMs: 320 });

    const archivingTarget = actionTarget?.status === 'ACTIVE' ? actionTarget : null;
    const referencesQuery = useQuery({
        queryKey: ['parameter-group-references', groupId, archivingTarget?.id],
        queryFn: () => getParameterGroupReferences(groupId!, archivingTarget!.id),
        enabled: groupId != null && archivingTarget != null,
        staleTime: 30_000,
    });

    const openCreateDialog = () => {
        setEditingId(null);
        setDialogOpen(true);
    };

    const actionMutation = useMutation({
        mutationFn: (target: ParameterGroupSummary) => target.status === 'ACTIVE'
            ? archiveParameterGroup(groupId!, target.id)
            : restoreParameterGroup(groupId!, target.id),
        onSuccess: () => {
            setActionTarget(null);
            setActionError('');
            void queryClient.invalidateQueries({ queryKey: ['parameter-groups', groupId] });
        },
        onError: (cause) => {
            setActionError(cause instanceof Error ? cause.message : '参数组状态更新失败');
        },
    });

    const patchSearchParams = (mutate: (next: URLSearchParams) => void) => {
        const next = new URLSearchParams(searchParams);
        mutate(next);
        if (next.get('page') === '1') next.delete('page');
        if (next.get('size') === String(DEFAULT_PAGE_SIZE)) next.delete('size');
        if (!next.get('status')) next.delete('status');
        setSearchParams(next);
    };

    return (
        <section className="parameter-page">
            <div className="parameter-toolbar">
                <div className="parameter-toolbar-filters">
                    <label className="parameter-search">
                        <Search aria-hidden="true" />
                        <input
                            aria-label="搜索参数组"
                            placeholder="搜索参数组名称"
                            value={keywordInput}
                            onChange={(event) => setKeywordInput(event.target.value)}
                        />
                    </label>
                    <div className="parameter-status-filter">
                        <SimpleSelect
                            ariaLabel="状态筛选"
                            value={status ?? 'ALL'}
                            className="parameter-status-select"
                            options={[
                                { value: 'ALL', label: '全部状态' },
                                { value: 'ACTIVE', label: '使用中' },
                                { value: 'ARCHIVED', label: '已归档' },
                            ]}
                            onChange={(value) => patchSearchParams((next) => {
                                if (value === 'ALL') next.delete('status');
                                else next.set('status', value);
                                next.delete('page');
                            })}
                        />
                    </div>
                </div>
                {canWrite ? (
                    <div className="parameter-toolbar-actions">
                        <Button type="button" onClick={openCreateDialog}>
                            <Plus aria-hidden="true" />
                            新建参数组
                        </Button>
                    </div>
                ) : null}
            </div>

            {actionError ? <p className="parameter-page-error" role="alert">{actionError}</p> : null}

            <ParameterGroupTable
                data={records}
                canWrite={canWrite}
                errorMessage={pageQuery.error instanceof Error ? pageQuery.error.message : ''}
                hasActiveFilter={Boolean(keyword || status)}
                hasFooter={total > 0}
                isLoading={pageQuery.isLoading && !pageQuery.data}
                isRefreshing={isRefreshing}
                onPreview={setPreviewTarget}
                onEdit={(record) => {
                    setEditingId(record.id);
                    setDialogOpen(true);
                }}
                onAction={setActionTarget}
                onCreate={openCreateDialog}
                onClearFilters={() => patchSearchParams((next) => {
                    next.delete('keyword');
                    next.delete('status');
                    next.delete('page');
                })}
                onRetry={() => void pageQuery.refetch()}
            />
            <ListPagination
                currentPage={currentPage}
                isFetching={pageQuery.isFetching}
                onPageChange={(page) => patchSearchParams((next) => next.set('page', String(page)))}
                onPageSizeChange={(nextPageSize) => patchSearchParams((next) => {
                    next.set('size', String(nextPageSize));
                    next.delete('page');
                })}
                pageSize={pageSize}
                total={total}
                ariaLabel="参数组分页导航"
            />
            {groupId != null ? (
                <>
                    <ParameterGroupDialog
                        open={dialogOpen}
                        groupId={groupId}
                        editingId={editingId}
                        onOpenChange={setDialogOpen}
                        onSuccess={() => {
                            void queryClient.invalidateQueries({ queryKey: ['parameter-groups', groupId] });
                        }}
                    />
                    <ParameterPreviewDialog
                        open={previewTarget != null}
                        groupId={groupId}
                        parameterGroup={previewTarget}
                        onOpenChange={(open) => {
                            if (!open) setPreviewTarget(null);
                        }}
                    />
                </>
            ) : null}
            <ConfirmDialog
                open={actionTarget != null}
                onOpenChange={(open) => {
                    if (!open) setActionTarget(null);
                }}
                title={actionTarget?.status === 'ACTIVE' ? '归档参数组' : '恢复参数组'}
                description={actionTarget?.status === 'ACTIVE' ? (
                    <>
                        <span>归档后，新任务不能再引用“{actionTarget.name}”；已有任务仍保留当前版本。</span>
                        {referencesQuery.data ? (
                            referencesQuery.data.totalCount > 0 ? (
                                <span className="parameter-archive-references">
                                    当前有 <strong>{referencesQuery.data.totalCount}</strong> 个任务绑定该参数组
                                    （{referencesQuery.data.sampleFlows.join('、')}
                                    {referencesQuery.data.totalCount > referencesQuery.data.sampleFlows.length
                                        ? ` 等 ${referencesQuery.data.totalCount} 个`
                                        : ''}）。
                                    归档后这些任务将显示「已归档」，且无法升级绑定版本。
                                </span>
                            ) : (
                                <span className="parameter-archive-references">当前没有任务绑定该参数组。</span>
                            )
                        ) : null}
                        {referencesQuery.isError ? (
                            <span className="parameter-archive-references">绑定引用情况读取失败，归档不受影响。</span>
                        ) : null}
                    </>
                ) : `恢复后，“${actionTarget?.name ?? ''}”可以再次被任务引用。`}
                confirmText={actionTarget?.status === 'ACTIVE' ? '确认归档' : '确认恢复'}
                variant={actionTarget?.status === 'ACTIVE' ? 'warning' : 'default'}
                icon="warning"
                isLoading={actionMutation.isPending}
                onConfirm={async () => {
                    if (actionTarget) await actionMutation.mutateAsync(actionTarget);
                }}
            />
        </section>
    );
}
