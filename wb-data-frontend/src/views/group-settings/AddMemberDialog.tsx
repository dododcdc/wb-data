import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../components/ui/dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
import { SearchSelect, type SearchSelectOption } from '../../components/ui/search-select';
import type { AddMemberPayload, AvailableUser } from '../../api/groupSettings';
import { getAvailableUsers } from '../../api/groupSettings';
import { Button } from '../../components/ui/button';

interface AddMemberDialogProps {
    open: boolean;
    groupId: number;
    onOpenChange: (details: { open: boolean }) => void;
    onSuccess: (payload: AddMemberPayload, displayName: string) => void;
}

const ROLE_OPTIONS = [
    { label: '开发者', value: 'DEVELOPER' },
    { label: '项目组管理员', value: 'GROUP_ADMIN' },
];

export default function AddMemberDialog(props: AddMemberDialogProps) {
    const { open, groupId, onOpenChange, onSuccess } = props;

    const [searchKeyword, setSearchKeyword] = useState('');
    const [users, setUsers] = useState<AvailableUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedUser, setSelectedUser] = useState<AvailableUser | null>(null);
    const [role, setRole] = useState('DEVELOPER');
    const [submitting, setSubmitting] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setSearchKeyword('');
            setUsers([]);
            setLoading(false);
            setSelectedUser(null);
            setRole('DEVELOPER');
            setSubmitting(false);
            setSearchError(null);
        }
    }, [open]);

    useEffect(() => {
        // Fix: Removed 'selectedUser' from the bypass condition to prevent 
        // clearing results while the selection event is still processing.
        if (!open || !searchKeyword.trim()) {
            setUsers([]);
            setLoading(false);
            return;
        }

        // If we already have a selection, don't trigger NEW searches
        if (selectedUser) return;

        const timer = window.setTimeout(() => {
            setLoading(true);
            setSearchError(null);
            getAvailableUsers(groupId, searchKeyword.trim())
                .then((result) => {
                    setUsers(result);
                    if (result.length === 0) {
                        setSearchError('未找到匹配的用户');
                    }
                })
                .catch(() => {
                    setSearchError('搜索失败，请稍后重试');
                })
                .finally(() => {
                    setLoading(false);
                });
        }, 300);

        return () => window.clearTimeout(timer);
    }, [open, groupId, searchKeyword, selectedUser]);

    const handleSubmit = () => {
        if (!selectedUser || submitting) return;
        setSubmitting(true);
        onSuccess({ userId: selectedUser.id, role }, selectedUser.displayName);
    };

    const handleClearUser = () => {
        setSelectedUser(null);
        setSearchKeyword('');
        setUsers([]);
        setSearchError(null);
    };

    const userOptions: SearchSelectOption[] = users.map(u => ({
        label: u.username,
        value: String(u.id),
        secondaryLabel: u.displayName,
        raw: u
    }));

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting) onOpenChange({ open: nextOpen }); }}>
            <DialogContent style={{ maxWidth: '520px' }}>
                <DialogHeader>
                    <DialogTitle>添加成员</DialogTitle>
                    <DialogDescription>向项目组添加新成员</DialogDescription>
                </DialogHeader>

                <div className="dialog-body gs-dialog-content">
                    <div className="gs-dialog-section">
                        <div className="gs-dialog-field-grid">
                            <div className="gs-dialog-input-group">
                                <label>用户<span className="gs-required">*</span></label>
                                {/* Fix: Use a container that keeps SearchSelect mounted but visually hidden 
                                    when selectedUser is present, or just use simpler logic that avoids unmounting 
                                    during the critical selection frame. */}
                                <div className="relative min-h-[38px]">
                                    {selectedUser ? (
                                        <div className="gs-selected-user animate-in fade-in zoom-in-95 duration-200">
                                            <span>{selectedUser.username} — {selectedUser.displayName}</span>
                                            <button
                                                className="gs-selected-user-clear"
                                                type="button"
                                                aria-label="清除选择"
                                                disabled={submitting}
                                                onClick={handleClearUser}
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ) : (
                                        <SearchSelect
                                            options={userOptions}
                                            placeholder="搜索用户名或展示名"
                                            disabled={submitting}
                                            loading={loading}
                                            emptyText={searchError || '请输入关键词搜索'}
                                            onInputChange={setSearchKeyword}
                                            onChange={(_, opt) => {
                                                if (opt) setSelectedUser(opt.raw as AvailableUser);
                                            }}
                                        />
                                    )}
                                </div>
                            </div>

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
                        disabled={!selectedUser || submitting}
                        onClick={handleSubmit}
                    >
                        {submitting ? '添加中...' : '添加'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
