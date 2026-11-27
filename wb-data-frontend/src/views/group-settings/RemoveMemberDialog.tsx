import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import type { MemberRecord } from '../../api/groupSettings';
import { getGroupMemberAssetSummary, type GroupMemberAssetSummary } from '../../api/ownership';
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

interface RemoveMemberDialogProps {
    groupId: number;
    member: MemberRecord | null;
    removing?: boolean;
    onClose: () => void;
    onConfirmRemoveOnly: (member: MemberRecord) => Promise<void> | void;
    onConfirmHandoverAndRemove: (member: MemberRecord, targetOwnerUserId: number) => Promise<void> | void;
}

function emptyAssetSummary(groupId: number, userId: number): GroupMemberAssetSummary {
    return {
        groupId,
        groupName: '',
        userId,
        dataSourceCount: 0,
        parameterGroupCount: 0,
        offlineFlowCount: 0,
        totalCount: 0,
    };
}

function formatAssetParts(summary: GroupMemberAssetSummary): string[] {
    const parts: string[] = [];
    if (summary.dataSourceCount > 0) parts.push(`${summary.dataSourceCount} 个数据源`);
    if (summary.parameterGroupCount > 0) parts.push(`${summary.parameterGroupCount} 个参数组`);
    if (summary.offlineFlowCount > 0) parts.push(`${summary.offlineFlowCount} 个离线任务`);
    return parts;
}

export function RemoveMemberDialog({
    groupId,
    member,
    removing = false,
    onClose,
    onConfirmRemoveOnly,
    onConfirmHandoverAndRemove,
}: RemoveMemberDialogProps) {
    const [targetOwnerUserId, setTargetOwnerUserId] = useState<number | null>(null);
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        setTargetOwnerUserId(null);
    }, [member?.userId]);

    const summaryQuery = useQuery({
        queryKey: ['groupMemberAssetSummary', groupId, member?.userId ?? null],
        enabled: member !== null && Number.isFinite(groupId),
        queryFn: async () => {
            if (!member) return emptyAssetSummary(groupId, 0);
            if (typeof getGroupMemberAssetSummary !== 'function') {
                return emptyAssetSummary(groupId, member.userId);
            }
            const res = await getGroupMemberAssetSummary(groupId, member.userId);
            return res ?? emptyAssetSummary(groupId, member.userId);
        },
        staleTime: 0,
    });

    const summary = summaryQuery.data;
    const totalCount = summary?.totalCount ?? 0;
    const hasAssets = totalCount > 0;
    const assetParts = summary ? formatAssetParts(summary) : [];
    const memberLabel = member
        ? formatOwnerDisplay(member.displayName, member.username)
        : '';

    return (
        <Dialog
            open={member !== null}
            onOpenChange={(open) => {
                if (!open && !removing) {
                    onClose();
                }
            }}
        >
            <DialogContent ref={setDialogEl} className="sm:max-w-[460px]">
                <DialogHeader>
                    <DialogTitle>移除成员</DialogTitle>
                    <DialogDescription>
                        {member ? `确认处理成员「${memberLabel}」的移出操作。` : ''}
                    </DialogDescription>
                </DialogHeader>

                {summaryQuery.isLoading ? (
                    <div className="py-3 text-sm text-[var(--color-text-secondary)]">
                        正在检查该成员在项目组下负责的资产…
                    </div>
                ) : summaryQuery.isError ? (
                    <div className="space-y-2 py-2 text-sm text-[var(--color-text-secondary)]">
                        <p>暂时无法获取该成员的资产统计。确定仍要将「{memberLabel}」从当前项目组移除吗？</p>
                    </div>
                ) : hasAssets ? (
                    <div className="space-y-3 py-1">
                        <div className="flex items-start gap-2.5 rounded-md border border-amber-300/70 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div className="space-y-1">
                                <div className="font-medium">
                                    该成员当前仍负责 {totalCount} 项项目组资产
                                </div>
                                <div className="text-xs opacity-90">
                                    包含：{assetParts.join('、')}。建议先将负责人交接给其他成员，再移出项目组。
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label
                                htmlFor="remove-member-handover-select"
                                className="block text-xs font-medium text-[var(--color-text-secondary)]"
                            >
                                交接给项目组内其他负责人
                            </label>
                            <OwnerSelect
                                id="remove-member-handover-select"
                                groupId={groupId}
                                value={targetOwnerUserId}
                                onChange={setTargetOwnerUserId}
                                excludeUserIds={member ? [member.userId] : []}
                                menuContainer={dialogEl}
                                placeholder="请选择接手人"
                                disabled={removing}
                                ariaLabel="选择接手人"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="py-2 text-sm text-[var(--color-text-secondary)]">
                        确定要将「{memberLabel}」从当前项目组移除吗？该成员当前名下无项目组资产，移除后将立即失去当前项目组的访问权限。
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={removing}>
                        取消
                    </Button>
                    {!summaryQuery.isLoading && hasAssets && member ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={removing}
                                onClick={() => void onConfirmRemoveOnly(member)}
                            >
                                暂不交接，直接移除
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={removing || targetOwnerUserId == null}
                                onClick={() => {
                                    if (targetOwnerUserId != null) {
                                        void onConfirmHandoverAndRemove(member, targetOwnerUserId);
                                    }
                                }}
                            >
                                {removing ? '处理中…' : '交接并移除'}
                            </Button>
                        </>
                    ) : !summaryQuery.isLoading && member ? (
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={removing}
                            onClick={() => void onConfirmRemoveOnly(member)}
                        >
                            {removing ? '移除中…' : '确认移除'}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
