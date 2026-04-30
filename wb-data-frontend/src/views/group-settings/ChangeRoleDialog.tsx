import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogDescription,
} from '../../components/ui/dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
import type { MemberRecord } from '../../api/groupSettings';
import { Button } from 'components/ui/button';

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

    useEffect(() => {
        if (open && member) {
            setRole(member.role);
        }
    }, [open, member]);

    const canSubmit = member !== null && role !== '' && role !== member?.role && !submitting;

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting) onOpenChange({ open: nextOpen }); }}>
            <DialogPortal>
                <DialogOverlay className="dialog-backdrop" />
                <DialogContent className="dialog-positioner">
                    <div className="gs-dialog-card">
                        <div className="gs-dialog-header">
                            <DialogTitle className="gs-confirm-title">修改角色</DialogTitle>
                            <Button
                                variant="outline" size="icon"
                                type="button"
                                aria-label="关闭"
                                disabled={submitting}
                                onClick={() => onOpenChange({ open: false })}
                            >
                                <X size={16} />
                            </Button>
                        </div>
                        <DialogDescription className="sr-only">
                            修改成员 {member?.displayName} 的项目组角色
                        </DialogDescription>
                        <div className="gs-dialog-content">
                            <div className="gs-dialog-section">
                                {member ? (
                                    <p className="gs-dialog-subtitle">
                                        修改 <strong>{member.displayName}</strong> 的角色
                                    </p>
                                ) : null}
                                <div className="gs-dialog-field-grid">
                                    <div className="gs-dialog-input-group">
                                        <label>角色</label>
                                        <SimpleSelect
                                            value={role}
                                            options={ROLE_OPTIONS}
                                            disabled={submitting}
                                            onChange={setRole}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="gs-dialog-footer">
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
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
