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
import { MultiSearchSelect } from '../../components/ui/multi-search-select';
import type { SearchSelectOption } from '../../components/ui/search-select';
import type { AddMembersPayload, AvailableUser } from '../../api/groupSettings';
import { getAvailableUsers } from '../../api/groupSettings';
import { Button } from '../../components/ui/button';

interface AddMemberDialogProps {
    open: boolean;
    groupId: number;
    onOpenChange: (details: { open: boolean }) => void;
    onSuccess: (payload: AddMembersPayload, usernames: string[]) => void;
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
    const [selectedUsers, setSelectedUsers] = useState<AvailableUser[]>([]);
    const [role, setRole] = useState('DEVELOPER');
    const [submitting, setSubmitting] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const searchRequestIdRef = useRef(0);

    useEffect(() => {
        if (!open) {
            setSearchKeyword('');
            setUsers([]);
            setLoading(false);
            setSelectedUsers([]);
            setRole('DEVELOPER');
            setSubmitting(false);
            setSearchError(null);
            searchRequestIdRef.current = 0;
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const trimmedKeyword = searchKeyword.trim();
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;

        if (!trimmedKeyword) {
            setUsers([]);
            setLoading(false);
            setSearchError(null);
            return;
        }

        const timer = window.setTimeout(() => {
            setLoading(true);
            setSearchError(null);
            getAvailableUsers(groupId, trimmedKeyword)
                .then((result) => {
                    if (searchRequestIdRef.current !== requestId) {
                        return;
                    }
                    setUsers(result);
                    setSearchError(result.length === 0 ? '未找到匹配的用户' : null);
                })
                .catch(() => {
                    if (searchRequestIdRef.current !== requestId) {
                        return;
                    }
                    setUsers([]);
                    setSearchError('搜索失败，请稍后重试');
                })
                .finally(() => {
                    if (searchRequestIdRef.current === requestId) {
                        setLoading(false);
                    }
                });
        }, 300);

        return () => window.clearTimeout(timer);
    }, [open, groupId, searchKeyword]);

    const handleSubmit = () => {
        if (selectedUsers.length === 0 || submitting) return;
        setSubmitting(true);
        onSuccess(
            { userIds: selectedUsers.map((user) => user.id), role },
            selectedUsers.map((user) => user.username),
        );
    };

    const userOptions: SearchSelectOption[] = users.map((user) => ({
        label: user.username,
        value: String(user.id),
        raw: user,
    }));

    const selectedUserOptions: SearchSelectOption[] = selectedUsers.map((user) => ({
        label: user.username,
        value: String(user.id),
        raw: user,
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
                                <MultiSearchSelect
                                    options={userOptions}
                                    values={selectedUsers.map((user) => String(user.id))}
                                    selectedOptions={selectedUserOptions}
                                    placeholder="搜索用户名"
                                    disabled={submitting}
                                    loading={loading}
                                    emptyText={searchError || '请输入关键词搜索'}
                                    onInputChange={setSearchKeyword}
                                    onChange={(_, options) => {
                                        setSelectedUsers(options.map((option) => option.raw as AvailableUser));
                                    }}
                                />
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
                        disabled={selectedUsers.length === 0 || submitting}
                        onClick={handleSubmit}
                    >
                        {submitting ? '添加中...' : `添加 ${selectedUsers.length} 名成员`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
