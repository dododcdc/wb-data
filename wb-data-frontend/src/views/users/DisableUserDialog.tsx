import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { getUserAssetSummary, type UserAssetSummary } from '../../api/ownership';
import type { UserRecord } from '../../api/user';
import { OwnerSelect } from '../../components/owner/OwnerSelect';
import { formatOwnerDisplay } from '../../components/owner/ownerUtils';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';

interface DisableUserDialogProps {
    user: UserRecord | null;
    submitting?: boolean;
    onClose: () => void;
    onConfirmDisableOnly: (user: UserRecord) => Promise<void> | void;
    onConfirmHandoverAndDisable: (
        user: UserRecord,
        transfers: Array<{ groupId: number; targetOwnerUserId: number }>,
    ) => Promise<void> | void;
}

function emptyUserAssetSummary(userId: number): UserAssetSummary {
    return {
        userId,
        totalDataSources: 0,
        totalParameterGroups: 0,
        totalOfflineFlows: 0,
        totalCount: 0,
        groups: [],
    };
}

function formatGroupBreakdown(group: UserAssetSummary['groups'][number]): string {
    const parts: string[] = [];
    if (group.dataSourceCount > 0) parts.push(`${group.dataSourceCount} 数据源`);
    if (group.parameterGroupCount > 0) parts.push(`${group.parameterGroupCount} 参数组`);
    if (group.offlineFlowCount > 0) parts.push(`${group.offlineFlowCount} 离线任务`);
    return parts.join(' · ');
}

export function DisableUserDialog({
    user,
    submitting = false,
    onClose,
    onConfirmDisableOnly,
    onConfirmHandoverAndDisable,
}: DisableUserDialogProps) {
    const [targetsByGroup, setTargetsByGroup] = useState<Record<number, number | null>>({});
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        setTargetsByGroup({});
    }, [user?.id]);

    const summaryQuery = useQuery({
        queryKey: ['userAssetSummary', user?.id ?? null],
        enabled: user !== null,
        queryFn: async () => {
            if (!user) return emptyUserAssetSummary(0);
            if (typeof getUserAssetSummary !== 'function') {
                return emptyUserAssetSummary(user.id);
            }
            const res = await getUserAssetSummary(user.id);
            return res ?? emptyUserAssetSummary(user.id);
        },
        staleTime: 0,
    });

    const summary = summaryQuery.data;
    const totalCount = summary?.totalCount ?? 0;
    const groups = summary?.groups ?? [];
    const hasAssets = totalCount > 0 && groups.length > 0;
    const allGroupsAssigned = hasAssets && groups.every((g) => targetsByGroup[g.groupId] != null);

    const userLabel = user
        ? formatOwnerDisplay(user.displayName, user.username)
        : '';

    return (
        <Dialog
            open={user !== null}
            onOpenChange={(open) => {
                if (!open && !submitting) {
                    onClose();
                }
            }}
        >
            <DialogContent ref={setDialogEl} className="sm:max-w-[540px]">
                <DialogHeader>
                    <DialogTitle>禁用用户</DialogTitle>
                    <DialogDescription>
                        {user ? `确认处理用户「${userLabel}」的禁用操作。` : ''}
                    </DialogDescription>
                </DialogHeader>

                {summaryQuery.isLoading ? (
                    <div className="py-3 text-sm text-[var(--color-text-secondary)]">
                        正在汇总该用户在各项目组下负责的资产…
                    </div>
                ) : summaryQuery.isError ? (
                    <div className="py-2 text-sm text-[var(--color-text-secondary)]">
                        暂时无法获取该用户的资产汇总。确定要禁用「{userLabel}」吗？禁用后该用户将无法登录系统。
                    </div>
                ) : hasAssets ? (
                    <div className="space-y-3 py-1">
                        <div className="flex items-start gap-2.5 rounded-md border border-amber-300/70 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div className="space-y-1">
                                <div className="font-medium">
                                    该用户在 {groups.length} 个项目组中仍负责共 {totalCount} 项资产
                                </div>
                                <div className="text-xs opacity-90">
                                    请为各受影响项目组指定新的负责人后再禁用；也可跳过交接直接禁用。
                                </div>
                            </div>
                        </div>

                        <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
                            {groups.map((group) => (
                                <div
                                    key={group.groupId}
                                    className="space-y-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] p-2.5"
                                >
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="font-medium text-[var(--color-text-primary)]">
                                            {group.groupName}
                                        </span>
                                        <span className="text-[var(--color-text-secondary)]">
                                            {formatGroupBreakdown(group)}
                                        </span>
                                    </div>
                                    <OwnerSelect
                                        id={`disable-user-handover-${group.groupId}`}
                                        groupId={group.groupId}
                                        value={targetsByGroup[group.groupId] ?? null}
                                        onChange={(nextTarget) => {
                                            setTargetsByGroup((prev) => ({
                                                ...prev,
                                                [group.groupId]: nextTarget,
                                            }));
                                        }}
                                        excludeUserIds={user ? [user.id] : []}
                                        menuContainer={dialogEl}
                                        placeholder={`为「${group.groupName}」选择接手人`}
                                        disabled={submitting}
                                        ariaLabel={`为 ${group.groupName} 选择接手人`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="py-2 text-sm text-[var(--color-text-secondary)]">
                        确定要禁用「{userLabel}」吗？该用户当前名下无负责的资产，禁用后将无法登录系统。
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                        取消
                    </Button>
                    {!summaryQuery.isLoading && hasAssets && user ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={submitting}
                                onClick={() => void onConfirmDisableOnly(user)}
                            >
                                暂不交接，直接禁用
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={submitting || !allGroupsAssigned}
                                onClick={() => {
                                    if (!allGroupsAssigned) return;
                                    const transfers = groups.map((group) => ({
                                        groupId: group.groupId,
                                        targetOwnerUserId: targetsByGroup[group.groupId] as number,
                                    }));
                                    void onConfirmHandoverAndDisable(user, transfers);
                                }}
                            >
                                {submitting ? '处理中…' : '交接并禁用'}
                            </Button>
                        </>
                    ) : !summaryQuery.isLoading && user ? (
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={submitting}
                            onClick={() => void onConfirmDisableOnly(user)}
                        >
                            {submitting ? '禁用中…' : '确认禁用'}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
