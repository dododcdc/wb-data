import { useEffect, useRef, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../components/ui/dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
import type { MemberRecord } from '../../api/groupSettings';
import { Button } from '../../components/ui/button';

interface ChangeRoleDialogProps {
    open: boolean;
    member: MemberRecord | null;
    onOpenChange: (details: { open: boolean }) => void;
    onConfirm: (memberId: number, role: string) => void;
    submitting: boolean;
}

const ROLE_OPTIONS = [
    { label: '开发者', value: 'DEVELOPER' },
    { label: '项目组管理员', value: 'GROUP_ADMIN' },
];

export default function ChangeRoleDialog(props: ChangeRoleDialogProps) {
    const { open, member, onOpenChange, onConfirm, submitting } = props;

    const [role, setRole] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (open && member) {
            setRole(member.role);
        }
    }, [open, member]);

    const canSubmit = member !== null && role !== '' && role !== member?.role && !submitting;

    return (
        <Dialog modal={false} open={open} onOpenChange={(nextOpen) => { if (!submitting) onOpenChange({ open: nextOpen }); }}>
            <DialogContent ref={(el) => { dialogRef.current = el; setDialogEl(el); }} style={{ maxWidth: '440px' }}>
                <DialogHeader>
                    <DialogTitle>修改角色</DialogTitle>
                    <DialogDescription>
                        修改成员 {member?.displayName} 的项目组角色
                    </DialogDescription>
                </DialogHeader>

                <div className="dialog-body gs-dialog-content">
                    <div className="gs-dialog-section">
                        <div className="gs-dialog-field-grid">
                            <div className="form-input-group">
                                <label>角色</label>
                                <SimpleSelect
                                    value={role}
                                    options={ROLE_OPTIONS}
                                    disabled={submitting}
                                    menuContainer={dialogEl}
                                    onChange={setRole}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        type="button"
                        disabled={submitting}
                        onClick={() => onOpenChange({ open: false })}
                    >
                        取消
                    </Button>
                    <Button
                        variant="default"
                        type="button"
                        disabled={!canSubmit}
                        onClick={() => {
                            if (member) onConfirm(member.id, role);
                        }}
                    >
                        {submitting ? '保存中...' : '确认'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
