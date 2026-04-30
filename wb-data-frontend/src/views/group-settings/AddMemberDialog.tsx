import { useEffect, useRef, useState } from 'react';
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
import type { AvailableUser, AddMemberPayload } from '../../api/groupSettings';
import { getAvailableUsers } from '../../api/groupSettings';
import { Button } from 'components/ui/button';

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
    const [showDropdown, setShowDropdown] = useState(false);
    const searchTimerRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            setSearchKeyword('');
            setUsers([]);
            setSelectedUser(null);
            setRole('DEVELOPER');
            setSubmitting(false);
            setShowDropdown(false);
        }
    }, [open]);

    useEffect(() => {
        if (!open || selectedUser) return;

        if (searchTimerRef.current !== null) {
            window.clearTimeout(searchTimerRef.current);
        }

        searchTimerRef.current = window.setTimeout(() => {
            searchTimerRef.current = null;
            if (!searchKeyword.trim() && searchKeyword.length === 0) {
                setUsers([]);
                setShowDropdown(false);
                return;
            }
            setLoading(true);
            getAvailableUsers(groupId, searchKeyword.trim() || undefined)
                .then((result) => {
                    setUsers(result);
                    setShowDropdown(true);
                })
                .catch(() => {
                    setUsers([]);
                })
                .finally(() => setLoading(false));
        }, 300);

        return () => {
            if (searchTimerRef.current !== null) {
                window.clearTimeout(searchTimerRef.current);
            }
        };
    }, [open, groupId, searchKeyword, selectedUser]);

    useEffect(() => {
        if (!showDropdown) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showDropdown]);

    const handleSelectUser = (user: AvailableUser) => {
        setSelectedUser(user);
        setShowDropdown(false);
        setSearchKeyword('');
    };

    const handleClearUser = () => {
        setSelectedUser(null);
        setSearchKeyword('');
        setUsers([]);
    };

    const handleSubmit = () => {
        if (!selectedUser || submitting) return;
        setSubmitting(true);
        onSuccess({ userId: selectedUser.id, role }, selectedUser.displayName);
    };

    const canSubmit = selectedUser !== null && !submitting;

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting) onOpenChange({ open: nextOpen }); }}>
            <DialogPortal>
                <DialogOverlay className="dialog-backdrop" />
                <DialogContent className="dialog-positioner">
                    <div className="gs-dialog-card">
                        <div className="gs-dialog-header">
                            <DialogTitle className="gs-confirm-title">添加成员</DialogTitle>
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
                        <DialogDescription className="sr-only">向项目组添加新成员</DialogDescription>
                        <div className="gs-dialog-content">
                            <div className="gs-dialog-section">
                                <div className="gs-dialog-field-grid">
                                    <div className="gs-dialog-input-group">
                                        <label>用户<span className="gs-required">*</span></label>
                                        {selectedUser ? (
                                            <div className="gs-selected-user">
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
                                            <div className="gs-user-search-container" ref={containerRef}>
                                                <input
                                                    className="gs-user-search-input"
                                                    type="text"
                                                    placeholder="搜索用户名或展示名"
                                                    value={searchKeyword}
                                                    disabled={submitting}
                                                    onChange={(e) => setSearchKeyword(e.target.value)}
                                                    onFocus={() => {
                                                        if (users.length > 0) setShowDropdown(true);
                                                    }}
                                                />
                                                {showDropdown ? (
                                                    <div className="gs-user-dropdown">
                                                        {loading ? (
                                                            <div className="gs-user-dropdown-loading">搜索中...</div>
                                                        ) : users.length === 0 ? (
                                                            <div className="gs-user-dropdown-empty">未找到匹配的用户</div>
                                                        ) : (
                                                            users.map((user) => (
                                                                <button
                                                                    key={user.id}
                                                                    className="gs-user-option"
                                                                    type="button"
                                                                    onClick={() => handleSelectUser(user)}
                                                                >
                                                                    {user.username}
                                                                    <span className="gs-user-option-secondary">— {user.displayName}</span>
                                                                </button>
                                                            ))
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        )}
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
                                onClick={handleSubmit}
                            >
                                {submitting ? '添加中...' : '添加'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
