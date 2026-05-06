import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../components/ui/dialog';
import { createGroup, updateGroup } from '../../api/group';
import { getErrorMessage } from '../../utils/error';
import type { CreateGroupPayload, GroupDetail, UpdateGroupPayload } from '../../api/group';
import { Button } from '../../components/ui/button';

interface GroupFormProps {
    open: boolean;
    onOpenChange: (details: { open: boolean }) => void;
    onSuccess: (name: string) => void;
    initialData?: GroupDetail | null;
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
    const { open, onOpenChange, onSuccess, initialData } = props;

    const isEditMode = Boolean(initialData);
    const editId = initialData?.id;

    const [formData, setFormData] = useState<FormState>(EMPTY_FORM_STATE);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [saveError, setSaveError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) {
            setFieldErrors({});
            setSaveError('');
            setFormData(EMPTY_FORM_STATE);
        } else if (initialData) {
            setFormData({ name: initialData.name, description: initialData.description || '' });
        }
    }, [open, initialData]);

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
            if (isEditMode && editId != null) {
                const payload: UpdateGroupPayload = {
                    name: formData.name.trim(),
                    description: formData.description.trim() || undefined,
                };
                await updateGroup(editId, payload);
                onSuccess(formData.name.trim());
            } else {
                await createGroup({
                    name: formData.name.trim(),
                    description: formData.description.trim() || undefined,
                });
                onSuccess(formData.name.trim());
            }
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
            <DialogContent style={{ maxWidth: '620px' }}>
                <DialogHeader>
                    <DialogTitle>{isEditMode ? '编辑项目组' : '新建项目组'}</DialogTitle>
                    <DialogDescription className="sr-only">项目组创建表单</DialogDescription>
                </DialogHeader>

                <div className="dialog-body group-form-content">
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
                </div>

                <DialogFooter>
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
                        disabled={saving}
                    >
                        {saving ? (isEditMode ? '保存中...' : '创建中...') : (isEditMode ? '保存修改' : '确认创建')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
