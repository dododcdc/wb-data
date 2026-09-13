import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
    createParameterGroup,
    getParameterGroup,
    type ParameterDefinition,
    type ParameterGroup,
    type ParameterTimeBasis,
    type ParameterValueSource,
    updateParameterGroup,
} from '../../api/parameterGroups';
import { SimpleSelect } from '../../components/SimpleSelect';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import { getErrorMessage } from '../../utils/error';

interface ParameterGroupDialogProps {
    open: boolean;
    groupId: number;
    editingId: number | null;
    onOpenChange: (open: boolean) => void;
    onSuccess: (group: ParameterGroup) => void;
}

interface FormDefinition {
    key: string;
    valueSource: ParameterValueSource;
    constantValue: string;
    timeBasis: ParameterTimeBasis;
    format: string;
    offsetDays: string;
    description: string;
}

interface FormState {
    code: string;
    name: string;
    description: string;
    revision: number;
    definitions: FormDefinition[];
}

function emptyDefinition(): FormDefinition {
    return {
        key: '',
        valueSource: 'CONSTANT',
        constantValue: '',
        timeBasis: 'PLANNED_TIME',
        format: 'yyyyMMdd',
        offsetDays: '0',
        description: '',
    };
}

function emptyForm(): FormState {
    const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 20)
        ?? `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
    return { code: `pg_${suffix}`, name: '', description: '', revision: 0, definitions: [emptyDefinition()] };
}

function formFromGroup(group: ParameterGroup): FormState {
    return {
        code: group.code,
        name: group.name,
        description: group.description ?? '',
        revision: group.revision,
        definitions: group.definitions.map((definition) => ({
            key: definition.key,
            valueSource: definition.valueSource,
            constantValue: definition.constantValue ?? '',
            timeBasis: definition.timeBasis ?? 'PLANNED_TIME',
            format: definition.format ?? 'yyyyMMdd',
            offsetDays: String(definition.offsetDays ?? 0),
            description: definition.description ?? '',
        })),
    };
}

function toRequestDefinition(definition: FormDefinition, sortOrder: number): ParameterDefinition {
    if (definition.valueSource === 'SYSTEM_TIME') {
        return {
            key: definition.key.trim(),
            valueSource: 'SYSTEM_TIME',
            constantValue: null,
            timeBasis: definition.timeBasis,
            format: definition.format.trim(),
            offsetDays: Number(definition.offsetDays || 0),
            description: definition.description.trim() || null,
            sortOrder,
        };
    }

    return {
        key: definition.key.trim(),
        valueSource: 'CONSTANT',
        constantValue: definition.constantValue,
        timeBasis: null,
        format: null,
        offsetDays: 0,
        description: definition.description.trim() || null,
        sortOrder,
    };
}

function validateForm(form: FormState) {
    if (!form.name.trim()) return '请填写参数组名称';

    const keys = new Set<string>();
    for (const [index, definition] of form.definitions.entries()) {
        const key = definition.key.trim();
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) return `第 ${index + 1} 个参数名格式不正确`;
        if (keys.has(key)) return `参数名 ${key} 重复`;
        keys.add(key);
        if (definition.valueSource === 'SYSTEM_TIME') {
            if (!definition.format.trim()) return `请填写参数 ${key} 的日期格式`;
            if (!Number.isInteger(Number(definition.offsetDays))) return `参数 ${key} 的日期偏移必须是整数`;
        }
    }
    return '';
}

export default function ParameterGroupDialog({
    open,
    groupId,
    editingId,
    onOpenChange,
    onSuccess,
}: ParameterGroupDialogProps) {
    const [form, setForm] = useState<FormState>(emptyForm);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
    const [originalKeys, setOriginalKeys] = useState<string[]>([]);
    const [removedKeysToConfirm, setRemovedKeysToConfirm] = useState<string[]>([]);
    const isEdit = editingId != null;

    useEffect(() => {
        if (!open) return;
        setError('');
        setRemovedKeysToConfirm([]);
        setOriginalKeys([]);
        if (editingId == null) {
            setForm(emptyForm());
            setLoading(false);
            return;
        }

        let active = true;
        setLoading(true);
        void getParameterGroup(groupId, editingId)
            .then((group) => {
                if (active) {
                    setForm(formFromGroup(group));
                    setOriginalKeys(group.definitions.map((definition) => definition.key));
                }
            })
            .catch((cause) => {
                if (active) setError(getErrorMessage(cause, '参数组详情加载失败'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [editingId, groupId, open]);

    const patchDefinition = (index: number, patch: Partial<FormDefinition>) => {
        setForm((current) => ({
            ...current,
            definitions: current.definitions.map((definition, definitionIndex) =>
                definitionIndex === index ? { ...definition, ...patch } : definition),
        }));
    };

    const submit = async (removedKeysConfirmed = false) => {
        const validationError = validateForm(form);
        if (validationError) {
            setError(validationError);
            return;
        }

        const currentKeys = new Set(form.definitions.map((definition) => definition.key.trim()));
        const removedKeys = originalKeys.filter((key) => !currentKeys.has(key));
        if (isEdit && removedKeys.length > 0 && !removedKeysConfirmed) {
            setRemovedKeysToConfirm(removedKeys);
            return;
        }

        setSaving(true);
        setError('');
        const definitions = form.definitions.map(toRequestDefinition);
        try {
            const group = editingId == null
                ? await createParameterGroup(groupId, {
                    code: form.code.trim(),
                    name: form.name.trim(),
                    description: form.description.trim() || null,
                    definitions,
                })
                : await updateParameterGroup(groupId, editingId, {
                    expectedRevision: form.revision,
                    name: form.name.trim(),
                    description: form.description.trim() || null,
                    definitions,
                });
            onSuccess(group);
            setRemovedKeysToConfirm([]);
            onOpenChange(false);
        } catch (cause) {
            setRemovedKeysToConfirm([]);
            setError(getErrorMessage(cause, isEdit ? '参数组更新失败' : '参数组创建失败'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent ref={setDialogEl} className="parameter-dialog">
                <DialogHeader>
                    <DialogTitle>{isEdit ? '编辑参数组' : '创建参数组'}</DialogTitle>
                    <DialogDescription>
                        SQL 中使用 <code>{'${参数名}'}</code>，例如 <code>{'where name = ${name}'}</code>。
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="parameter-dialog-skeleton" role="status">
                        <span className="sr-only">正在加载参数组</span>
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div className="parameter-dialog-skeleton-field" key={index} aria-hidden="true">
                                <span className="skeleton-line parameter-dialog-skeleton-label" />
                                <span className="skeleton-line parameter-dialog-skeleton-input" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="parameter-dialog-body">
                        <div className="parameter-meta-grid">
                            <label>
                                <span>名称</span>
                                <input
                                    aria-label="参数组名称"
                                    value={form.name}
                                    placeholder="例如 日常公共参数"
                                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                                />
                            </label>
                            <label>
                                <span>说明 <small>可选</small></span>
                                <textarea
                                    aria-label="参数组说明"
                                    value={form.description}
                                    rows={1}
                                    placeholder="说明哪些任务适合引用这组参数"
                                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                                />
                            </label>
                        </div>

                        <div className="parameter-definitions-heading">
                            <div>
                                <strong>参数</strong>
                                <span>{form.definitions.length} 个参数</span>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setForm((current) => ({
                                    ...current,
                                    definitions: [...current.definitions, emptyDefinition()],
                                }))}
                            >
                                <Plus aria-hidden="true" /> 添加参数
                            </Button>
                        </div>

                        <div className="parameter-definition-list">
                            {form.definitions.map((definition, index) => (
                                <article className="parameter-definition-card" key={index}>
                                    <div className="parameter-definition-index">{index + 1}</div>
                                    <div className="parameter-definition-grid">
                                        <label className="parameter-key-field">
                                            <span>参数名</span>
                                            <input
                                                aria-label={`参数名 ${index + 1}`}
                                                value={definition.key}
                                                placeholder="例如 v_day"
                                                onChange={(event) => patchDefinition(index, { key: event.target.value })}
                                            />
                                        </label>
                                        <label className="parameter-source-field">
                                            <span>取值方式</span>
                                            <SimpleSelect
                                                ariaLabel={`取值方式 ${index + 1}`}
                                                value={definition.valueSource}
                                                className="parameter-select"
                                                menuContainer={dialogEl}
                                                options={[
                                                    { value: 'CONSTANT', label: '固定值' },
                                                    { value: 'SYSTEM_TIME', label: '运行时日期' },
                                                ]}
                                                onChange={(value) => patchDefinition(index, { valueSource: value as ParameterValueSource })}
                                            />
                                        </label>

                                        {definition.valueSource === 'CONSTANT' ? (
                                            <label className="parameter-value-field">
                                                <span>固定值</span>
                                                <input
                                                    aria-label={`固定值 ${index + 1}`}
                                                    value={definition.constantValue}
                                                    placeholder="可留空，表示空字符串"
                                                    onChange={(event) => patchDefinition(index, { constantValue: event.target.value })}
                                                />
                                            </label>
                                        ) : (
                                            <>
                                                <label className="parameter-runtime-basis">
                                                    <span>时间基准</span>
                                                    <SimpleSelect
                                                        ariaLabel={`时间基准 ${index + 1}`}
                                                        value={definition.timeBasis}
                                                        className="parameter-select"
                                                        menuContainer={dialogEl}
                                                        options={[
                                                            { value: 'PLANNED_TIME', label: '计划时间' },
                                                            { value: 'EXECUTION_START_TIME', label: '执行开始时间' },
                                                        ]}
                                                        onChange={(value) => patchDefinition(index, {
                                                            timeBasis: value as ParameterTimeBasis,
                                                        })}
                                                    />
                                                </label>
                                                <label className="parameter-runtime-format">
                                                    <span>日期格式</span>
                                                    <input
                                                        aria-label={`日期格式 ${index + 1}`}
                                                        value={definition.format}
                                                        placeholder="yyyyMMdd"
                                                        onChange={(event) => patchDefinition(index, { format: event.target.value })}
                                                    />
                                                </label>
                                                <label className="parameter-runtime-offset">
                                                    <span>偏移天数</span>
                                                    <input
                                                        aria-label={`偏移天数 ${index + 1}`}
                                                        type="number"
                                                        step="1"
                                                        value={definition.offsetDays}
                                                        onChange={(event) => patchDefinition(index, { offsetDays: event.target.value })}
                                                    />
                                                </label>
                                            </>
                                        )}

                                        <label className="parameter-description-field">
                                            <span>参数说明 <small>可选</small></span>
                                            <input
                                                aria-label={`参数说明 ${index + 1}`}
                                                value={definition.description}
                                                placeholder="说明参数用途"
                                                onChange={(event) => patchDefinition(index, { description: event.target.value })}
                                            />
                                        </label>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`删除参数 ${index + 1}`}
                                        disabled={form.definitions.length === 1}
                                        onClick={() => setForm((current) => ({
                                            ...current,
                                            definitions: current.definitions.filter((_, definitionIndex) => definitionIndex !== index),
                                        }))}
                                    >
                                        <Trash2 aria-hidden="true" />
                                    </Button>
                                </article>
                            ))}
                        </div>
                    </div>
                )}

                {error ? <p className="parameter-form-error" role="alert">{error}</p> : null}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button type="button" disabled={loading || saving} onClick={() => void submit()}>
                        {saving ? '正在保存…' : isEdit ? '保存修改' : '创建参数组'}
                    </Button>
                </DialogFooter>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={removedKeysToConfirm.length > 0}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && !saving) setRemovedKeysToConfirm([]);
                }}
                title="确认移除参数？"
                description={(
                    <span className="parameter-breaking-change-description">
                        <span>新版本将不再包含以下参数：</span>
                        <code className="parameter-breaking-change-keys">
                            {removedKeysToConfirm.map((key) => `\${${key}}`).join('、')}
                        </code>
                        <span>已有任务的当前快照不会变化；任务更新到这个版本前，需要先修改对应引用。</span>
                    </span>
                )}
                confirmText="仍然保存"
                cancelText="返回修改"
                variant="warning"
                icon="warning"
                isLoading={saving}
                onConfirm={() => submit(true)}
            />
        </>
    );
}
