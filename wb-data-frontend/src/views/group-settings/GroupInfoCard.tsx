import { useRef, useState } from 'react';
import { AlertCircle, Pencil } from 'lucide-react';
import { useAuthStore } from '../../utils/auth';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import type { GroupSettingsInfo, UpdateGroupSettingsPayload } from '../../api/groupSettings';
import { Button } from '../../components/ui/button';

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const NAME_MIN = 2;
const NAME_MAX = 64;
const DESC_MAX = 255;

interface GroupInfoCardProps {
    data: GroupSettingsInfo | null;
    canEdit: boolean;
    onSave: (payload: UpdateGroupSettingsPayload) => Promise<GroupSettingsInfo>;
    onSaveSuccess: () => void;
}

export default function GroupInfoCard(props: GroupInfoCardProps) {
    const { data, canEdit, onSave, onSaveSuccess } = props;
    const { showFeedback } = useOperationFeedback();

    const [editing, setEditing] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [nameError, setNameError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const nameInputRef = useRef<HTMLInputElement>(null);

    const enterEdit = () => {
        if (!data) return;
        setName(data.name);
        setDescription(data.description ?? '');
        setNameError('');
        setSubmitError('');
        setEditing(true);
        requestAnimationFrame(() => nameInputRef.current?.focus());
    };

    const cancelEdit = () => {
        setEditing(false);
        setSubmitError('');
    };

    const validateName = (value: string): string => {
        const trimmed = value.trim();
        if (!trimmed) return '项目组名称不能为空';
        if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) return `名称长度需在 ${NAME_MIN}-${NAME_MAX} 个字符之间`;
        if (!NAME_PATTERN.test(trimmed)) return '名称仅允许字母、数字、下划线和短横线';
        return '';
    };

    const handleSave = async () => {
        const error = validateName(name);
        if (error) {
            setNameError(error);
            return;
        }

        setSubmitting(true);
        setSubmitError('');

        try {
            const result = await onSave({ name: name.trim(), description: description.trim() || undefined });
            const groupId = result.id;
            useAuthStore.setState((state) => ({
                currentGroup: state.currentGroup ? { ...state.currentGroup, name: result.name } : null,
                accessibleGroups: state.accessibleGroups.map((g) =>
                    g.id === groupId ? { ...g, name: result.name } : g,
                ),
            }));
            setEditing(false);
            showFeedback({ tone: 'success', title: '项目组信息已更新', detail: '项目组名称和描述已保存。' });
            onSaveSuccess();
        } catch (err) {
            const apiError = err as { status?: number; message?: string } | null;
            if (apiError?.status === 409) {
                setSubmitError('该项目组名称已被使用');
            } else {
                setSubmitError(apiError?.message ?? '保存失败，请稍后重试');
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (!data) return null;

    if (editing) {
        return (
            <section className="gs-info-card animate-enter">
                <div className="gs-info-edit-form">
                    <div className={`gs-form-input-group ${nameError ? 'has-error' : ''}`}>
                        <label htmlFor="gs-name">
                            项目组名称<span className="gs-required">*</span>
                        </label>
                        <input
                            ref={nameInputRef}
                            id="gs-name"
                            type="text"
                            value={name}
                            maxLength={NAME_MAX}
                            disabled={submitting}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (nameError) setNameError('');
                            }}
                        />
                        {nameError ? <span className="gs-input-error">{nameError}</span> : null}
                    </div>

                    <div className="gs-form-input-group">
                        <label htmlFor="gs-desc">描述</label>
                        <textarea
                            id="gs-desc"
                            value={description}
                            maxLength={DESC_MAX}
                            rows={3}
                            disabled={submitting}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    {submitError ? (
                        <div className="gs-form-error">
                            <AlertCircle size={14} />
                            {submitError}
                        </div>
                    ) : null}

                    <div className="gs-edit-actions">
                        <Button variant="outline" type="button" disabled={submitting} onClick={cancelEdit}>
                            取消
                        </Button>
                        <Button variant="default" type="button" disabled={submitting} onClick={handleSave}>
                            {submitting ? '保存中...' : '保存'}
                        </Button>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="gs-info-card animate-enter">
            <div className="gs-info-display">
                <div className="gs-info-display-content">
                    <span className="gs-info-label">项目组</span>
                    <span className="gs-info-name">{data.name}</span>
                    <span className={`gs-info-desc ${data.description ? '' : 'is-empty'}`}>
                        {data.description || '暂无描述'}
                    </span>
                </div>
                {canEdit ? (
                    <button className="gs-edit-btn" type="button" onClick={enterEdit}>
                        <Pencil size={14} />
                        编辑
                    </button>
                ) : null}
            </div>
        </section>
    );
}
