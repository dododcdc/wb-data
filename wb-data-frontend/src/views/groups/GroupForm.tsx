import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';
import { createGroup } from '../../api/group';
import { getErrorMessage } from '../../utils/error';

interface GroupFormProps {
    open: boolean;
    onOpenChange: (details: { open: boolean }) => void;
    onSuccess: (name: string) => void;
}

type FormField = 'name' | 'description';
type FieldErrors = Partial<Record<FormField, string | true>>;

type FormState = {
    name: string;
    description: string;
};

const NAME_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

const EMPTY_FORM_STATE: FormState = {
    name: '',
    description: '',
};

export default function GroupForm(props: GroupFormProps) {
    const { open, onOpenChange, onSuccess } = props;

    const [formData, setFormData] = useState<FormState>(EMPTY_FORM_STATE);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [saveError, setSaveError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setFieldErrors({});
        setSaveError('');
        setFormData(EMPTY_FORM_STATE);
    }, [open]);

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
        const name = formData.name.trim();
        const description = formData.description.trim();

        if (!name) {
            errors.name = true;
        } else if (!NAME_PATTERN.test(name)) {
            errors.name = '项目组名称只能包含字母、数字、下划线和短横线，长度 2-64';
        }

        if (description.length > 255) {
            errors.description = '描述不能超过 255 个字符';
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) {
            return;
        }

        setSaving(true);
        setSaveError('');

        try {
            await createGroup({
                name: formData.name.trim(),
                description: formData.description.trim() || undefined,
            });

            onSuccess(formData.name.trim());
        } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((error as any)?.response?.status === 409) {
                setFieldErrors({ name: '该项目组名称已被使用' });
            } else {
                setSaveError(getErrorMessage(error, '保存失败，请稍后重试'));
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => onOpenChange({ open: nextOpen })}>
            <DialogPortal>
                <DialogOverlay className="dialog-backdrop" />
                <DialogContent className="dialog-positioner">
                    <div className="dialog-content group-form-card">
                        <div className="group-form-header">
                            <DialogTitle className="dialog-title">新建项目组</DialogTitle>
                            <DialogClose className="dialog-close-btn" aria-label="关闭">
                                <X size={20} />
                            </DialogClose>
                        </div>
                        <DialogDescription className="sr-only">项目组创建表单</DialogDescription>

                        <div className="group-form-content">
                            <div className="group-form-section">
                                <div className="group-form-field-grid">
                                    <div className={`group-form-input-group ${fieldErrors.name ? 'has-error' : ''}`}>
                                        <label htmlFor="group-form-name">
                                            项目组名称 <span className="required">*</span>
                                        </label>
                                        <input
                                            id="group-form-name"
                                            type="text"
                                            value={formData.name}
                                            placeholder="请输入项目组名称"
                                            onChange={(event) => handleChange('name', event.target.value)}
                                        />
                                        {typeof fieldErrors.name === 'string' ? <span className="input-error">{fieldErrors.name}</span> : null}
                                    </div>

                                    <div className={`group-form-input-group ${fieldErrors.description ? 'has-error' : ''}`}>
                                        <label htmlFor="group-form-description">
                                            描述
                                        </label>
                                        <textarea
                                            id="group-form-description"
                                            rows={3}
                                            value={formData.description}
                                            placeholder="请输入描述（可选）"
                                            onChange={(event) => handleChange('description', event.target.value)}
                                        />
                                        {typeof fieldErrors.description === 'string' ? <span className="input-error">{fieldErrors.description}</span> : null}
                                    </div>
                                </div>

                                {saveError ? (
                                    <div className="form-feedback form-feedback-error" role="alert">
                                        <AlertCircle size={14} />
                                        <span>{saveError}</span>
                                    </div>
                                ) : null}
                            </div>

                            <div className="group-form-footer">
                                <button
                                    className="group-secondary-btn"
                                    onClick={() => onOpenChange({ open: false })}
                                    type="button"
                                    disabled={saving}
                                >
                                    取消
                                </button>
                                <button
                                    className="group-primary-btn"
                                    onClick={handleSubmit}
                                    type="button"
                                    disabled={saving}
                                >
                                    {saving ? '创建中...' : '确认创建'}
                                </button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
