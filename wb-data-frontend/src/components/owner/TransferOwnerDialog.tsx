import { useEffect, useMemo, useState } from 'react';
import type { AssetOwnerSummary, TransferOwnerPayload } from '../../api/groupSettings';
import { Button } from '../ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../ui/dialog';
import { SimpleSelect } from '../SimpleSelect';
import { OwnerSelect } from './OwnerSelect';
import { formatCandidateLabel } from './ownerUtils';
import './owner.css';

interface TransferOwnerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    groupId: number;
    assetLabel: string;
    mode: 'selected' | 'by-owner';
    selectedIds?: number[];
    selectedNames?: string[];
    owners?: AssetOwnerSummary[];
    initialFromOwnerUserId?: number | null;
    restrictFromOwnerUserId?: number | null;
    pending?: boolean;
    errorMessage?: string;
    onConfirm: (payload: TransferOwnerPayload) => void;
}

export function TransferOwnerDialog({
    open,
    onOpenChange,
    groupId,
    assetLabel,
    mode,
    selectedIds = [],
    selectedNames = [],
    owners = [],
    initialFromOwnerUserId = null,
    restrictFromOwnerUserId = null,
    pending = false,
    errorMessage = '',
    onConfirm,
}: TransferOwnerDialogProps) {
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
    const [fromOwnerUserId, setFromOwnerUserId] = useState<number | null>(null);
    const [targetOwnerUserId, setTargetOwnerUserId] = useState<number | null>(null);

    const selectableOwners = useMemo(
        () => (restrictFromOwnerUserId != null
            ? owners.filter((owner) => owner.userId === restrictFromOwnerUserId)
            : owners),
        [owners, restrictFromOwnerUserId],
    );

    useEffect(() => {
        if (!open) return;
        setTargetOwnerUserId(null);
        if (mode === 'by-owner') {
            const preferred = initialFromOwnerUserId != null
                && selectableOwners.some((o) => o.userId === initialFromOwnerUserId)
                ? initialFromOwnerUserId
                : (selectableOwners[0]?.userId ?? null);
            setFromOwnerUserId(preferred);
        } else {
            setFromOwnerUserId(null);
        }
    }, [initialFromOwnerUserId, mode, open, selectableOwners]);

    const fromOwnerOptions = useMemo(
        () => selectableOwners.map((owner) => {
            const statusHint = owner.status === 'DISABLED'
                ? ' [已停用]'
                : owner.status === 'LEFT_GROUP'
                    ? ' [已离组]'
                    : '';
            return {
                value: String(owner.userId),
                label: `${formatCandidateLabel(owner.displayName, owner.username)}${statusHint} · ${owner.count} 项`,
            };
        }),
        [selectableOwners],
    );

    const selectedFromOwner = selectableOwners.find((o) => o.userId === fromOwnerUserId) ?? null;
    const sameOwnerError = mode === 'by-owner'
        && fromOwnerUserId != null
        && targetOwnerUserId != null
        && fromOwnerUserId === targetOwnerUserId
        ? '目标负责人不能与原负责人相同'
        : '';

    const canSubmit = !pending
        && targetOwnerUserId != null
        && !sameOwnerError
        && (mode === 'selected' ? selectedIds.length > 0 : fromOwnerUserId != null);

    const handleSubmit = () => {
        if (!canSubmit || targetOwnerUserId == null) return;
        if (mode === 'selected') {
            onConfirm({ ids: selectedIds, targetOwnerUserId });
        } else if (fromOwnerUserId != null) {
            onConfirm({ fromOwnerUserId, targetOwnerUserId });
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
            <DialogContent ref={setDialogEl} className="wb-transfer-dialog">
                <DialogHeader>
                    <DialogTitle>
                        {mode === 'selected' ? `转移${assetLabel}负责人` : `批量移交${assetLabel}负责人`}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'selected'
                            ? `将已选中的 ${selectedIds.length} 个${assetLabel}移交给新的项目组成员负责。`
                            : `将指定原负责人名下的全部${assetLabel}一次性移交给新成员。`}
                    </DialogDescription>
                </DialogHeader>

                <div className="wb-transfer-dialog-body">
                    {mode === 'selected' ? (
                        <div className="wb-transfer-summary">
                            已选择 <strong>{selectedIds.length}</strong> 个{assetLabel}
                            {selectedNames.length > 0 ? (
                                <>：{selectedNames.slice(0, 3).join('、')}{selectedNames.length > 3 ? ` 等 ${selectedNames.length} 个` : ''}</>
                            ) : null}
                        </div>
                    ) : (
                        <div className="wb-transfer-field">
                            <label className="wb-transfer-field-label" htmlFor="transfer-from-owner">
                                原负责人
                            </label>
                            <SimpleSelect
                                id="transfer-from-owner"
                                ariaLabel="原负责人"
                                className="wb-transfer-select"
                                menuContainer={dialogEl}
                                value={fromOwnerUserId != null ? String(fromOwnerUserId) : ''}
                                placeholder={fromOwnerOptions.length === 0 ? `暂无可移交的${assetLabel}` : '请选择原负责人'}
                                disabled={pending || fromOwnerOptions.length === 0}
                                options={fromOwnerOptions}
                                onChange={(val) => {
                                    const parsed = Number(val);
                                    setFromOwnerUserId(Number.isFinite(parsed) ? parsed : null);
                                }}
                            />
                            {selectedFromOwner ? (
                                <div className="wb-transfer-summary">
                                    将移交该负责人名下共 <strong>{selectedFromOwner.count}</strong> 个{assetLabel}。
                                </div>
                            ) : null}
                        </div>
                    )}

                    <div className="wb-transfer-field">
                        <label className="wb-transfer-field-label" htmlFor="transfer-target-owner">
                            新负责人
                        </label>
                        <OwnerSelect
                            id="transfer-target-owner"
                            ariaLabel="新负责人"
                            className="wb-transfer-select"
                            groupId={groupId}
                            value={targetOwnerUserId}
                            onChange={setTargetOwnerUserId}
                            disabled={pending}
                            menuContainer={dialogEl}
                            placeholder="请选择接手人"
                        />
                    </div>

                    {sameOwnerError || errorMessage ? (
                        <div className="wb-transfer-error" role="alert">
                            {sameOwnerError || errorMessage}
                        </div>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
                        {pending ? '转移中...' : '确认转移'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
