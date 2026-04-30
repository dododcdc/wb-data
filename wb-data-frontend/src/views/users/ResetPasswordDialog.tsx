import { useEffect, useState } from 'react';
import { AlertCircle, Eye, EyeOff, X } from 'lucide-react';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';
import { resetUserPassword, UserRecord } from '../../api/user';
import { getErrorMessage } from '../../utils/error';
import { Button } from 'components/ui/button';

interface ResetPasswordDialogProps {
    open: boolean;
    user: UserRecord | null;
    onOpenChange: (details: { open: boolean }) => void;
    onSuccess: (details: { username: string }) => void;
}

type FormField = 'newPassword' | 'confirmPassword';

const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*\d).{8,64}$/;

export default function ResetPasswordDialog(props: ResetPasswordDialogProps) {
    const { open, user, onOpenChange, onSuccess } = props;

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FormField, string>>>({});
    const [saveError, setSaveError] = useState('');
    const [saving, setSaving] = useState(false);
    const [newPasswordVisible, setNewPasswordVisible] = useState(false);
    const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

    useEffect(() => {
        if (!open) return;
        setNewPassword('');
        setConfirmPassword('');
        setFieldErrors({});
        setSaveError('');
        setSaving(false);
        setNewPasswordVisible(false);
        setConfirmPasswordVisible(false);
    }, [open]);

    const handleFieldChange = (field: FormField, value: string) => {
        setSaveError('');
        setFieldErrors((previousErrors) => {
            if (!previousErrors[field]) {
                return previousErrors;
            }
            const nextErrors = { ...previousErrors };
            delete nextErrors[field];
            return nextErrors;
        });

        if (field === 'newPassword') {
            setNewPassword(value);
            return;
        }
        setConfirmPassword(value);
    };

    const validate = () => {
        const errors: Partial<Record<FormField, string>> = {};

        if (!newPassword) {
            errors.newPassword = '请输入密码';
        } else if (!PASSWORD_PATTERN.test(newPassword)) {
            errors.newPassword = '密码需 8-64 位，至少包含字母和数字';
        }

        if (!confirmPassword) {
            errors.confirmPassword = '请输入密码';
        } else if (confirmPassword !== newPassword) {
            errors.confirmPassword = '两次输入的密码不一致';
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async () => {
        if (!user || !validate()) {
            return;
        }

        setSaving(true);
        setSaveError('');

        try {
            await resetUserPassword(user.id, { newPassword });
            onSuccess({ username: user.username });
        } catch (error) {
            setSaveError(getErrorMessage(error, '重置密码失败，请稍后重试'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => onOpenChange({ open: nextOpen })}>
            <DialogPortal>
                <DialogOverlay className="dialog-backdrop" />
                <DialogContent className="dialog-positioner">
                    <div className="dialog-content user-form-card user-reset-dialog-card">
                        <div className="user-form-header">
                            <DialogTitle className="dialog-title">重置密码</DialogTitle>
                            <DialogClose className="dialog-close-btn" aria-label="关闭">
                                <X size={20} />
                            </DialogClose>
                        </div>

                        <div className="user-form-content">
                            <DialogDescription className="user-reset-description">
                                为用户 <strong>{user?.username ?? '--'}</strong> 设置新密码
                            </DialogDescription>

                            <div className="user-form-section">
                                <div className={`user-form-input-group ${fieldErrors.newPassword ? 'has-error' : ''}`}>
                                    <label htmlFor="reset-user-new-password">
                                        新密码 <span className="required">*</span>
                                    </label>
                                    <div className="user-form-password-field">
                                        <input
                                            id="reset-user-new-password"
                                            type={newPasswordVisible ? 'text' : 'password'}
                                            value={newPassword}
                                            placeholder="请输入新密码"
                                            onChange={(event) => handleFieldChange('newPassword', event.target.value)}
                                        />
                                        <button
                                            className="user-form-password-toggle"
                                            type="button"
                                            aria-label={newPasswordVisible ? '隐藏密码' : '显示密码'}
                                            onClick={() => setNewPasswordVisible((current) => !current)}
                                        >
                                            {newPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    {fieldErrors.newPassword ? <span className="input-error">{fieldErrors.newPassword}</span> : null}
                                </div>

                                <div className={`user-form-input-group ${fieldErrors.confirmPassword ? 'has-error' : ''}`}>
                                    <label htmlFor="reset-user-confirm-password">
                                        确认密码 <span className="required">*</span>
                                    </label>
                                    <div className="user-form-password-field">
                                        <input
                                            id="reset-user-confirm-password"
                                            type={confirmPasswordVisible ? 'text' : 'password'}
                                            value={confirmPassword}
                                            placeholder="请再次输入新密码"
                                            onChange={(event) => handleFieldChange('confirmPassword', event.target.value)}
                                        />
                                        <button
                                            className="user-form-password-toggle"
                                            type="button"
                                            aria-label={confirmPasswordVisible ? '隐藏密码' : '显示密码'}
                                            onClick={() => setConfirmPasswordVisible((current) => !current)}
                                        >
                                            {confirmPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    {fieldErrors.confirmPassword ? <span className="input-error">{fieldErrors.confirmPassword}</span> : null}
                                </div>

                                {saveError ? (
                                    <div className="form-feedback form-feedback-error" role="alert">
                                        <AlertCircle size={14} />
                                        <span>{saveError}</span>
                                    </div>
                                ) : null}
                            </div>

                            <div className="user-form-footer">
                                <Button
                                    variant="outline"
                                    onClick={() => onOpenChange({ open: false })}
                                    type="button"
                                    disabled={saving}
                                >
                                    取消
                                </Button>
                                <Button
                                    variant="default"
                                    onClick={handleSubmit}
                                    type="button"
                                    disabled={saving || !user}
                                >
                                    {saving ? '重置中...' : '确认重置'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
