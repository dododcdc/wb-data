import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Braces, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { archiveParameterGroup, getParameterGroupPage, restoreParameterGroup } from '../../api/parameterGroups';
import type { ParameterGroupSummary } from '../../api/parameterGroups';
import { SimpleSelect } from '../../components/SimpleSelect';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataTableShell } from '../../components/ui/data-table-shell';
import { useAuthStore } from '../../utils/auth';
import ParameterGroupDialog from './ParameterGroupDialog';
import ParameterPreviewDialog from './ParameterPreviewDialog';
import './ParameterGroupPage.css';

const DEFAULT_PAGE_SIZE = 20;

function parsePositiveInteger(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatUpdatedAt(value: string) {
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(value));
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
    const totalPages = Math.max(1, pageQuery.data?.pages ?? 1);
    const isInitialEmpty = !pageQuery.isLoading && !pageQuery.error && total === 0 && !keyword && !status;

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
            {!isInitialEmpty ? (
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
            ) : null}

            {actionError ? <p className="parameter-page-error" role="alert">{actionError}</p> : null}

            {isInitialEmpty ? (
                <div className="parameter-first-empty">
                    <Braces aria-hidden="true" />
                    <h2>还没有参数组</h2>
                    <p>创建一组可复用的参数，在多个任务中保持一致。</p>
                    {canWrite ? (
                        <Button type="button" onClick={openCreateDialog}>
                            <Plus aria-hidden="true" />
                            创建第一个参数组
                        </Button>
                    ) : null}
                </div>
            ) : <DataTableShell
                className="parameter-table-shell"
                dataLength={records.length}
                isRefreshing={pageQuery.isFetching && Boolean(pageQuery.data)}
                errorMessage={pageQuery.error instanceof Error ? pageQuery.error.message : undefined}
                emptyIcon={<Braces aria-hidden="true" />}
                emptyTitle="还没有参数组"
                emptyDescription="创建一个参数组，让多个任务共享同一套运行参数。"
            >
                <table className="parameter-table">
                    <thead>
                        <tr>
                            <th>参数组</th>
                            <th>参数</th>
                            <th>版本</th>
                            <th>状态</th>
                            <th>最近更新</th>
                            <th><span className="sr-only">操作</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {records.map((record) => (
                            <tr key={record.id}>
                                <td>
                                    <div className="parameter-name-cell">
                                        <strong>{record.name}</strong>
                                        {record.description ? <span>{record.description}</span> : null}
                                    </div>
                                </td>
                                <td>{record.parameterCount} 个参数</td>
                                <td><span className="parameter-version">v{record.version}</span></td>
                                <td>
                                    <span className={`parameter-status is-${record.status.toLowerCase()}`}>
                                        {record.status === 'ACTIVE' ? '使用中' : '已归档'}
                                    </span>
                                </td>
                                <td>{formatUpdatedAt(record.updatedAt)}</td>
                                <td className="parameter-actions">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        aria-label={`预览${record.name}`}
                                        onClick={() => setPreviewTarget(record)}
                                    >预览</Button>
                                    {canWrite && record.status === 'ACTIVE' ? (
                                        <>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                aria-label={`编辑${record.name}`}
                                                onClick={() => {
                                                    setEditingId(record.id);
                                                    setDialogOpen(true);
                                                }}
                                            >编辑</Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                aria-label={`归档${record.name}`}
                                                onClick={() => setActionTarget(record)}
                                            >归档</Button>
                                        </>
                                    ) : null}
                                    {canWrite && record.status === 'ARCHIVED' ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            aria-label={`恢复${record.name}`}
                                            onClick={() => setActionTarget(record)}
                                        >恢复</Button>
                                    ) : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DataTableShell>}
            {total > 0 ? (
                <footer className="parameter-pagination" aria-label="参数组分页导航">
                    <span>共 {total} 个参数组</span>
                    <label>
                        每页
                        <select
                            aria-label="每页数量"
                            value={pageSize}
                            onChange={(event) => patchSearchParams((next) => {
                                next.set('size', event.target.value);
                                next.delete('page');
                            })}
                        >
                            <option value="10">10</option>
                            <option value="20">20</option>
                            <option value="50">50</option>
                        </select>
                    </label>
                    <span>第 {currentPage} / {totalPages} 页</span>
                    <div>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label="上一页"
                            disabled={currentPage <= 1 || pageQuery.isFetching}
                            onClick={() => patchSearchParams((next) => next.set('page', String(currentPage - 1)))}
                        ><ChevronLeft aria-hidden="true" /></Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label="下一页"
                            disabled={currentPage >= totalPages || pageQuery.isFetching}
                            onClick={() => patchSearchParams((next) => next.set('page', String(currentPage + 1)))}
                        ><ChevronRight aria-hidden="true" /></Button>
                    </div>
                </footer>
            ) : null}
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
                description={actionTarget?.status === 'ACTIVE'
                    ? `归档后，新任务不能再引用“${actionTarget?.name ?? ''}”；已有任务仍保留当前版本。`
                    : `恢复后，“${actionTarget?.name ?? ''}”可以再次被任务引用。`}
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
