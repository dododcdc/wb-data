import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Eye, EyeOff, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';
import { SimpleSelect } from '../../components/SimpleSelect';
import { getUserGroups, createUser, getAllGroups, GroupSimple, updateUser, UserRecord } from '../../api/user';
import { useAuthStore } from '../../utils/auth';

interface UserFormProps {
    open: boolean;
    onOpenChange: (details: { open: boolean }) => void;
    editingUser: UserRecord | null;
    onSuccess: (details: UserFormSuccessDetails) => void;
}

export interface UserFormSuccessDetails {
    action: 'create' | 'edit';
    userId: number | null;
    payload: {
        username: string;
        displayName: string;
        systemRole: string;
    };
}

type FormField = 'username' | 'displayName' | 'password' | 'systemRole';

type FieldErrors = Partial<Record<FormField, string | true>>;

type FormState = {
    username: string;
    displayName: string;
    password: string;
    systemRole: string;
};

interface GroupRow {
    key: string;
    groupId: string;
    groupRole: string;
}

const SYSTEM_ROLE_OPTIONS = [
    { label: '普通用户', value: 'USER' },
    { label: '系统管理员', value: 'SYSTEM_ADMIN' },
];

const GROUP_ROLE_OPTIONS = [
    { label: '开发者', value: 'DEVELOPER' },
    { label: '项目组管理员', value: 'GROUP_ADMIN' },
];

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;
const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*\d).{8,64}$/;

const EMPTY_FORM_STATE: FormState = {
    username: '',
    displayName: '',
    password: '',
    systemRole: 'USER',
};

function getErrorMessage(error: unknown, fallback: string) {
    if (typeof error === 'object' && error !== null) {
        const axiosMessage = (error as {
            response?: { data?: { message?: string } };
            message?: string;
        }).response?.data?.message;

        if (axiosMessage) {
            return axiosMessage;
        }

        const message = (error as { message?: string }).message;
        if (message) {
            return message;
        }
    }

    return fallback;
}

export default function UserForm(props: UserFormProps) {
    const { open, onOpenChange, editingUser, onSuccess } = props;
    const isEdit = Boolean(editingUser);
    const currentUser = useAuthStore((s) => s.userInfo);
    const editingSelf = Boolean(isEdit && currentUser && editingUser?.id === currentUser.id);

    const [formData, setFormData] = useState<FormState>(EMPTY_FORM_STATE);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [groupRows, setGroupRows] = useState<GroupRow[]>([]);
    const [groupRowErrors, setGroupRowErrors] = useState<Record<string, { groupId?: true; groupRole?: true }>>({});
    const [saveError, setSaveError] = useState('');
    const [saving, setSaving] = useState(false);
    const [passwordVisible, setPasswordVisible] = useState(false);

    const groupQuery = useQuery({
        queryKey: ['groups', 'simple'],
        queryFn: getAllGroups,
        staleTime: 5 * 60 * 1000,
        enabled: open,
    });

    const userGroupsQuery = useQuery({
        queryKey: ['userGroups', editingUser?.id],
        queryFn: () => getUserGroups(editingUser!.id),
        enabled: open && isEdit && !!editingUser,
    });

    const groupOptions = useMemo(
        () => (groupQuery.data ?? []).map((group: GroupSimple) => ({
            label: group.name,
            value: String(group.id),
        })),
        [groupQuery.data],
    );

    useEffect(() => {
        if (!open) return;

        setFieldErrors({});
        setGroupRowErrors({});
        setSaveError('');
        setPasswordVisible(false);

        if (editingUser) {
            setFormData({
                username: editingUser.username,
                displayName: editingUser.displayName ?? '',
                password: '',
                systemRole: editingUser.systemRole || 'USER',
            });
            return;
        }

        setFormData(EMPTY_FORM_STATE);
        setGroupRows([]);
    }, [editingUser, open]);

    useEffect(() => {
        if (!open || !isEdit || !userGroupsQuery.data) return;
        setGroupRows(userGroupsQuery.data.map(g => ({
            key: crypto.randomUUID(),
            groupId: String(g.groupId),
            groupRole: g.groupRole,
        })));
    }, [open, isEdit, userGroupsQuery.data]);

    const addGroupRow = () => {
        setGroupRows(prev => [...prev, { key: crypto.randomUUID(), groupId: '', groupRole: 'DEVELOPER' }]);
    };

    const removeGroupRow = (key: string) => {
        setGroupRows(prev => prev.filter(row => row.key !== key));
    };

    const updateGroupRow = (key: string, field: 'groupId' | 'groupRole', value: string) => {
        setSaveError('');
        setGroupRowErrors(prev => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            const rowErrs = { ...next[key] };
            delete rowErrs[field];
            next[key] = rowErrs;
            return next;
        });
        setGroupRows(prev => prev.map(row => row.key === key ? { ...row, [field]: value } : row));
    };

    const getAvailableGroupOptions = (currentRowKey: string) => {
        const selectedGroupIds = new Set(
            groupRows.filter(row => row.key !== currentRowKey && row.groupId).map(row => row.groupId)
        );
        return groupOptions.filter(opt => !selectedGroupIds.has(opt.value));
    };

    const handleChange = (field: FormField, value: string) => {
        setSaveError('');
        setFieldErrors((previousErrors) => {
            if (!previousErrors[field]) {
                return previousErrors;
            }
            const nextErrors = { ...previousErrors };
            delete nextErrors[field];
            return nextErrors;
        });

        setFormData((previousState) => ({
            ...previousState,
            [field]: value,
        }));
    };

    const validate = () => {
        const errors: FieldErrors = {};
        const gErrors: Record<string, { groupId?: true; groupRole?: true }> = {};
        const username = formData.username.trim();
        const displayName = formData.displayName.trim();

        if (!isEdit) {
            if (!username) {
                errors.username = true;
            } else if (!USERNAME_PATTERN.test(username)) {
                errors.username = '用户名只能包含字母、数字、下划线和短横线，长度 2-64';
            }
        }

        if (!displayName) {
            errors.displayName = true;
        } else if (displayName.length > 64) {
            errors.displayName = '展示名不能超过 64 个字符';
        }

        if (!isEdit) {
            if (!formData.password) {
                errors.password = true;
            } else if (!PASSWORD_PATTERN.test(formData.password)) {
                errors.password = '密码需 8-64 位，至少包含字母和数字';
            }
        }

        let hasGroupErrors = false;
        for (const row of groupRows) {
            const rowErr: { groupId?: true; groupRole?: true } = {};
            if (!row.groupId) {
                rowErr.groupId = true;
                hasGroupErrors = true;
            }
            if (!row.groupRole) {
                rowErr.groupRole = true;
                hasGroupErrors = true;
            }
            if (Object.keys(rowErr).length > 0) {
                gErrors[row.key] = rowErr;
            }
        }

        setFieldErrors(errors);
        setGroupRowErrors(gErrors);
        return Object.keys(errors).length === 0 && !hasGroupErrors;
    };

    const handleSubmit = async () => {
        if (!validate()) {
            return;
        }

        setSaving(true);
        setSaveError('');

        const validGroupAssignments = groupRows
            .filter(r => r.groupId && r.groupRole)
            .map(r => ({ groupId: Number(r.groupId), groupRole: r.groupRole }));

        try {
            if (isEdit && editingUser) {
                await updateUser(editingUser.id, {
                    displayName: formData.displayName.trim(),
                    systemRole: formData.systemRole,
                    groupAssignments: validGroupAssignments,
                });

                onSuccess({
                    action: 'edit',
                    userId: editingUser.id,
                    payload: {
                        username: editingUser.username,
                        displayName: formData.displayName.trim(),
                        systemRole: formData.systemRole,
                    },
                });
                return;
            }

            await createUser({
                username: formData.username.trim(),
                displayName: formData.displayName.trim(),
                password: formData.password,
                systemRole: formData.systemRole,
                groupAssignments: validGroupAssignments,
            });

            onSuccess({
                action: 'create',
                userId: null,
                payload: {
                    username: formData.username.trim(),
                    displayName: formData.displayName.trim(),
                    systemRole: formData.systemRole,
                },
            });
        } catch (error) {
            setSaveError(getErrorMessage(error, '保存失败，请稍后重试'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => onOpenChange({ open: nextOpen })}>
            <DialogPortal>
                <DialogOverlay className="dialog-backdrop" />
                <DialogContent className="dialog-positioner">
                    <div className="dialog-content user-form-card">
                        <div className="user-form-header">
                            <DialogTitle className="dialog-title">{isEdit ? '编辑用户' : '新建用户'}</DialogTitle>
                            <DialogClose className="dialog-close-btn" aria-label="关闭">
                                <X size={20} />
                            </DialogClose>
                        </div>
                        <DialogDescription className="sr-only">用户创建或编辑表单</DialogDescription>

                        <div className="user-form-content">
                            <div className="user-form-section">
                                <div className="user-form-field-grid">
                                    <div className={`user-form-input-group ${fieldErrors.username ? 'has-error' : ''}`}>
                                        <label htmlFor="user-form-username">
                                            用户名 {!isEdit ? <span className="required">*</span> : null}
                                        </label>
                                        <input
                                            id="user-form-username"
                                            type="text"
                                            value={formData.username}
                                            placeholder="请输入用户名"
                                            readOnly={isEdit}
                                            className={isEdit ? 'user-form-readonly' : ''}
                                            onChange={(event) => handleChange('username', event.target.value)}
                                        />
                                        {typeof fieldErrors.username === 'string' ? <span className="input-error">{fieldErrors.username}</span> : null}

                                    </div>

                                    <div className={`user-form-input-group ${fieldErrors.displayName ? 'has-error' : ''}`}>
                                        <label htmlFor="user-form-display-name">
                                            展示名 <span className="required">*</span>
                                        </label>
                                        <input
                                            id="user-form-display-name"
                                            type="text"
                                            value={formData.displayName}
                                            placeholder="请输入展示名"
                                            onChange={(event) => handleChange('displayName', event.target.value)}
                                        />
                                        {typeof fieldErrors.displayName === 'string' ? <span className="input-error">{fieldErrors.displayName}</span> : null}
                                    </div>

                                    {!isEdit ? (
                                        <div className={`user-form-input-group ${fieldErrors.password ? 'has-error' : ''}`}>
                                            <label htmlFor="user-form-password">
                                                初始密码 <span className="required">*</span>
                                            </label>
                                            <div className="user-form-password-field">
                                                <input
                                                    id="user-form-password"
                                                    type={passwordVisible ? 'text' : 'password'}
                                                    value={formData.password}
                                                    placeholder="请输入初始密码"
                                                    onChange={(event) => handleChange('password', event.target.value)}
                                                />
                                                <button
                                                    className="user-form-password-toggle"
                                                    type="button"
                                                    aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                                                    onClick={() => setPasswordVisible((current) => !current)}
                                                >
                                                    {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                            </div>
                                            {typeof fieldErrors.password === 'string' ? <span className="input-error">{fieldErrors.password}</span> : null}
                                        </div>
                                    ) : null}

                                    <div className={`user-form-input-group ${fieldErrors.systemRole ? 'has-error' : ''}`}>
                                        <label htmlFor="user-form-system-role">系统角色</label>
                                        <SimpleSelect
                                            id="user-form-system-role"
                                            value={formData.systemRole}
                                            options={SYSTEM_ROLE_OPTIONS}
                                            disabled={editingSelf}
                                            onChange={(value) => handleChange('systemRole', value)}
                                        />
                                        {editingSelf ? <span className="input-help">不可修改自己的角色</span> : null}
                                    </div>
                                </div>

                                <div className="user-form-divider">
                                    <span>{isEdit ? '项目组管理' : '加入项目组（可选）'}</span>
                                </div>

                                {groupRows.map((row) => {
                                    const rowErrors = groupRowErrors[row.key];
                                    const availableOptions = getAvailableGroupOptions(row.key);
                                    return (
                                        <div key={row.key} className="user-form-group-row">
                                            <div className={`user-form-group-row-field ${rowErrors?.groupId ? 'has-error' : ''}`}>
                                                <SimpleSelect
                                                    value={row.groupId}
                                                    options={row.groupId ? [...availableOptions, ...groupOptions.filter(o => o.value === row.groupId)] : availableOptions}
                                                    placeholder="请选择项目组"
                                                    onChange={(value) => updateGroupRow(row.key, 'groupId', value)}
                                                />
                                            </div>
                                            <div className={`user-form-group-row-field ${rowErrors?.groupRole ? 'has-error' : ''}`}>
                                                <SimpleSelect
                                                    value={row.groupRole}
                                                    options={GROUP_ROLE_OPTIONS}
                                                    onChange={(value) => updateGroupRow(row.key, 'groupRole', value)}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                className="user-form-group-row-remove"
                                                aria-label="移除此项目组"
                                                onClick={() => removeGroupRow(row.key)}
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    );
                                })}

                                <button
                                    type="button"
                                    className="user-form-add-group-btn"
                                    disabled={groupRows.length >= groupOptions.length}
                                    onClick={addGroupRow}
                                >
                                    + 添加项目组
                                </button>

                                {saveError ? (
                                    <div className="form-feedback form-feedback-error" role="alert">
                                        <AlertCircle size={14} />
                                        <span>{saveError}</span>
                                    </div>
                                ) : null}
                            </div>

                            <div className="user-form-footer">
                                <button
                                    className="user-secondary-btn"
                                    onClick={() => onOpenChange({ open: false })}
                                    type="button"
                                    disabled={saving}
                                >
                                    取消
                                </button>
                                <button
                                    className="user-primary-btn"
                                    onClick={handleSubmit}
                                    type="button"
                                    disabled={saving}
                                >
                                    {saving ? '保存中...' : isEdit ? '保存修改' : '确认创建'}
                                </button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
