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
import { MultiSearchAutocomplete } from '../../components/ui/multi-search-autocomplete';
import type { SearchAutocompleteOption } from '../../components/ui/search-autocomplete';
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
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const searchRequestIdRef = useRef(0);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) {
            setSearchKeyword('');
            setUsers([]);
            setLoading(false);
            setSelectedUsers([]);
            setRole('DEVELOPER');
            setSubmitting(false);
            setSearchError(null);
            setPage(1);
            setHasMore(false);
            setLoadingMore(false);
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
            getAvailableUsers(groupId, trimmedKeyword, 1, 50)
                .then((result) => {
                    if (searchRequestIdRef.current !== requestId) {
                        return;
                    }
                    setUsers(result.records);
                    setHasMore(result.current < result.pages);
                    setPage(1);
                    setSearchError(result.records.length === 0 ? '未找到匹配的用户' : null);
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

    const handleLoadMore = () => {
        if (!hasMore || loading || loadingMore) return;
        const trimmedKeyword = searchKeyword.trim();
        const requestId = searchRequestIdRef.current;
        const nextPage = page + 1;
        
        setLoadingMore(true);
        getAvailableUsers(groupId, trimmedKeyword, nextPage, 50)
            .then((result) => {
                if (searchRequestIdRef.current !== requestId) return;
                setUsers(prev => [...prev, ...result.records]);
                setHasMore(nextPage < result.pages);
                setPage(nextPage);
            })
            .finally(() => {
                if (searchRequestIdRef.current === requestId) {
                    setLoadingMore(false);
                }
            });
    };

    const handleSubmit = () => {
        if (selectedUsers.length === 0 || submitting) return;
        setSubmitting(true);
        onSuccess(
            { userIds: selectedUsers.map((user) => user.id), role },
            selectedUsers.map((user) => user.username),
        );
    };

    const userOptions: SearchAutocompleteOption[] = users.map((user) => ({
        label: user.username,
        value: String(user.id),
        raw: user,
    }));

    const selectedUserOptions: SearchAutocompleteOption[] = selectedUsers.map((user) => ({
        label: user.username,
        value: String(user.id),
        raw: user,
    }));

    return (
        <Dialog modal={false} open={open} onOpenChange={(nextOpen) => { if (!submitting) onOpenChange({ open: nextOpen }); }}>
            <DialogContent ref={(el) => { dialogRef.current = el; setDialogEl(el); }} style={{ maxWidth: '520px' }}>
                <DialogHeader>
                    <DialogTitle>添加成员</DialogTitle>
                    <DialogDescription>向项目组添加新成员</DialogDescription>
                </DialogHeader>

                <div className="dialog-body gs-dialog-content">
                    <div className="gs-dialog-section">
                        <div className="gs-dialog-field-grid">
                            <div className="form-input-group">
                                <label>用户<span className="gs-required">*</span></label>
                                <MultiSearchAutocomplete
                                    options={userOptions}
                                    values={selectedUsers.map((user) => String(user.id))}
                                    selectedOptions={selectedUserOptions}
                                    placeholder="搜索用户名"
                                    disabled={submitting}
                                    menuContainer={dialogEl}
                                    loading={loading}
                                    emptyText={searchKeyword.trim() ? (searchError || undefined) : undefined}
                                    onInputChange={setSearchKeyword}
                                    onChange={(_, options) => {
                                        setSelectedUsers(options.map((option) => option.raw as AvailableUser));
                                    }}
                                    virtualize={true}
                                    hasMore={hasMore}
                                    loadingMore={loadingMore}
                                    onLoadMore={handleLoadMore}
                                />
                            </div>

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
