import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';

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

interface FormIssue {
    message: string;
    index: number | null;
    field: 'name' | 'key' | 'format' | 'offsetDays' | null;
}

function matchesDefinitionQuery(definition: FormDefinition, query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    const source = definition.valueSource === 'CONSTANT' ? '固定值' : '运行时日期';
    return [
        definition.key,
        definition.description,
        definition.constantValue,
        definition.format,
        source,
        definitionRule(definition),
    ].join('\n').toLowerCase().includes(normalized);
}

function definitionRule(definition: FormDefinition) {
    if (definition.valueSource === 'CONSTANT') {
        return definition.constantValue === '' ? '空字符串' : `"${definition.constantValue}"`;
    }
    const basis = definition.timeBasis === 'EXECUTION_START_TIME' ? '执行开始时间' : '计划时间';
    const format = definition.format.trim();
    const offset = Number(definition.offsetDays);
    const offsetLabel = definition.offsetDays.trim() !== '' && Number.isFinite(offset) && offset !== 0
        ? (offset > 0 ? `+${offset} 天` : `${offset} 天`)
        : '';
    return [basis, format, offsetLabel].filter(Boolean).join(' · ');
}

function validateForm(form: FormState): FormIssue | null {
    if (!form.name.trim()) {
        return { message: '请填写参数组名称', index: null, field: 'name' };
    }

    const keys = new Set<string>();
    for (const [index, definition] of form.definitions.entries()) {
        const key = definition.key.trim();
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
            return { message: `第 ${index + 1} 个参数名格式不正确`, index, field: 'key' };
        }
        if (keys.has(key)) {
            return { message: `参数名 ${key} 重复`, index, field: 'key' };
        }
        keys.add(key);
        if (definition.valueSource === 'SYSTEM_TIME') {
            if (!definition.format.trim()) {
                return { message: `请填写参数 ${key} 的日期格式`, index, field: 'format' };
            }
            if (!Number.isInteger(Number(definition.offsetDays))) {
                return { message: `参数 ${key} 的日期偏移必须是整数`, index, field: 'offsetDays' };
            }
        }
    }
    return null;
}

export default function ParameterGroupDialog({
    open,
    groupId,
    editingId,
    onOpenChange,
    onSuccess,
}: ParameterGroupDialogProps) {
    const [form, setForm] = useState<FormState>(emptyForm);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [issue, setIssue] = useState<FormIssue | null>(null);
    const [keyword, setKeyword] = useState('');
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
    const [originalKeys, setOriginalKeys] = useState<string[]>([]);
    const [removedKeysToConfirm, setRemovedKeysToConfirm] = useState<string[]>([]);
    const keyInputRef = useRef<HTMLInputElement>(null);
    const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const focusKeyRef = useRef(false);
    const isEdit = editingId != null;
    const activeIndex = Math.min(selectedIndex, Math.max(form.definitions.length - 1, 0));
    const selectedDefinition = form.definitions[activeIndex];
    const normalizedQuery = keyword.trim().toLowerCase();
    const visibleIndexes = useMemo(
        () => form.definitions.flatMap((definition, index) => (
            matchesDefinitionQuery(definition, normalizedQuery) ? [index] : []
        )),
        [form.definitions, normalizedQuery],
    );

    useEffect(() => {
        if (!open) return;
        setError('');
        setIssue(null);
        setKeyword('');
        setSelectedIndex(0);
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

    useEffect(() => {
        if (!focusKeyRef.current) return;
        focusKeyRef.current = false;
        keyInputRef.current?.focus();
        rowRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex, form.definitions.length]);

    useEffect(() => {
        if (!normalizedQuery || visibleIndexes.includes(activeIndex) || visibleIndexes.length === 0) return;
        setSelectedIndex(visibleIndexes[0]);
    }, [activeIndex, normalizedQuery, visibleIndexes]);

    const patchDefinition = (index: number, patch: Partial<FormDefinition>) => {
        setIssue((current) => (current?.index === index ? null : current));
        setForm((current) => ({
            ...current,
            definitions: current.definitions.map((definition, definitionIndex) =>
                definitionIndex === index ? { ...definition, ...patch } : definition),
        }));
    };

    const addDefinition = () => {
        focusKeyRef.current = true;
        setIssue(null);
        setKeyword('');
        setForm((current) => ({
            ...current,
            definitions: [...current.definitions, emptyDefinition()],
        }));
        setSelectedIndex(form.definitions.length);
    };

    const removeSelected = () => {
        if (form.definitions.length <= 1) return;
        const removeIndex = activeIndex;
        setIssue((current) => (current?.index === removeIndex ? null : current));
        setForm((current) => ({
            ...current,
            definitions: current.definitions.filter((_, index) => index !== removeIndex),
        }));
        setSelectedIndex(removeIndex >= form.definitions.length - 1 ? removeIndex - 1 : removeIndex);
    };

    const submit = async (removedKeysConfirmed = false) => {
        const validationIssue = validateForm(form);
        if (validationIssue) {
            setIssue(validationIssue);
            setError('');
            if (validationIssue.index != null) {
                setKeyword('');
                setSelectedIndex(validationIssue.index);
                rowRefs.current[validationIssue.index]?.scrollIntoView?.({ block: 'nearest' });
            }
            return;
        }
        setIssue(null);

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
                        MySQL、PostgreSQL、ClickHouse、HiveSQL 和 Shell，以及传输节点的过滤条件、固定值、表达式和前后 SQL，都可以写 <code>{'^[参数名]'}</code>。HiveSQL 里，值的位置会变成字符串，库名和表名的位置会变成标识符。Shell 里会变成带单引号的字符串。
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
                                    aria-invalid={issue?.field === 'name'}
                                    value={form.name}
                                    placeholder="例如 日常公共参数"
                                    onChange={(event) => {
                                        setIssue((current) => (current?.field === 'name' ? null : current));
                                        setForm((current) => ({ ...current, name: event.target.value }));
                                    }}
                                />
                                {issue?.field === 'name' ? <span className="parameter-field-error" role="alert">{issue.message}</span> : null}
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

                        <div className="parameter-editor-pane">
                            <div className="parameter-definitions-heading">
                                <div>
                                    <strong>参数</strong>
                                    <span>
                                        {normalizedQuery
                                            ? `匹配 ${visibleIndexes.length} / ${form.definitions.length}`
                                            : `${form.definitions.length} 个参数`}
                                    </span>
                                </div>
                                <Button type="button" size="sm" variant="outline" onClick={addDefinition}>
                                    <Plus aria-hidden="true" /> 添加参数
                                </Button>
                            </div>

                            <div className="parameter-editor">
                                <div className="parameter-definition-nav">
                                    <label className="parameter-definition-search">
                                        <Search size={14} className="text-muted-foreground" aria-hidden="true" />
                                        <input
                                            aria-label="搜索参数"
                                            placeholder="搜索参数名、说明或规则"
                                            value={keyword}
                                            onChange={(event) => setKeyword(event.target.value)}
                                        />
                                    </label>
                                <div className="parameter-definition-list">
                                    {visibleIndexes.length === 0 ? (
                                        <p className="parameter-definition-empty">没有匹配的参数</p>
                                    ) : visibleIndexes.map((index) => {
                                        const definition = form.definitions[index];
                                        if (!definition) return null;
                                        const key = definition.key.trim();
                                        return (
                                            <button
                                                key={index}
                                                ref={(node) => { rowRefs.current[index] = node; }}
                                                type="button"
                                                className="parameter-definition-row"
                                                aria-pressed={index === activeIndex}
                                                aria-label={key ? `参数 ${key}` : `参数 ${index + 1}`}
                                                onClick={() => setSelectedIndex(index)}
                                            >
                                                <span className="parameter-definition-row-main">
                                                    <code>{key || '未填写'}</code>
                                                    <span className={`parameter-preview-source-badge is-${definition.valueSource.toLowerCase()}`}>
                                                        {definition.valueSource === 'CONSTANT' ? '固定值' : '运行时日期'}
                                                    </span>
                                                </span>
                                                <span className="parameter-definition-row-rule">{definitionRule(definition)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                </div>

                                {selectedDefinition ? (
                                    <div className="parameter-definition-editor">
                                        <div className="parameter-definition-editor-header">
                                            <strong>{selectedDefinition.key.trim() || '新参数'}</strong>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={`删除参数 ${activeIndex + 1}`}
                                                disabled={form.definitions.length === 1}
                                                onClick={removeSelected}
                                            >
                                                <Trash2 aria-hidden="true" />
                                            </Button>
                                        </div>
                                        <div className="parameter-definition-grid">
                                            <label className="parameter-key-field">
                                                <span>参数名</span>
                                                <input
                                                    ref={keyInputRef}
                                                    aria-label={`参数名 ${activeIndex + 1}`}
                                                    aria-invalid={issue?.index === activeIndex && issue.field === 'key'}
                                                    value={selectedDefinition.key}
                                                    placeholder="例如 v_day"
                                                    onChange={(event) => patchDefinition(activeIndex, { key: event.target.value })}
                                                />
                                                {issue?.index === activeIndex && issue.field === 'key'
                                                    ? <span className="parameter-field-error" role="alert">{issue.message}</span>
                                                    : null}
                                            </label>
                                            <label className="parameter-source-field">
                                                <span>取值方式</span>
                                                <SimpleSelect
                                                    ariaLabel={`取值方式 ${activeIndex + 1}`}
                                                    value={selectedDefinition.valueSource}
                                                    className="parameter-select"
                                                    menuContainer={dialogEl}
                                                    options={[
                                                        { value: 'CONSTANT', label: '固定值' },
                                                        { value: 'SYSTEM_TIME', label: '运行时日期' },
                                                    ]}
                                                    onChange={(value) => patchDefinition(activeIndex, { valueSource: value as ParameterValueSource })}
                                                />
                                            </label>

                                            {selectedDefinition.valueSource === 'CONSTANT' ? (
                                                <label className="parameter-value-field">
                                                    <span>固定值</span>
                                                    <input
                                                        aria-label={`固定值 ${activeIndex + 1}`}
                                                        value={selectedDefinition.constantValue}
                                                        placeholder="可留空，表示空字符串"
                                                        onChange={(event) => patchDefinition(activeIndex, { constantValue: event.target.value })}
                                                    />
                                                </label>
                                            ) : (
                                                <>
                                                    <label className="parameter-runtime-basis">
                                                        <span>时间基准</span>
                                                        <SimpleSelect
                                                            ariaLabel={`时间基准 ${activeIndex + 1}`}
                                                            value={selectedDefinition.timeBasis}
                                                            className="parameter-select"
                                                            menuContainer={dialogEl}
                                                            options={[
                                                                { value: 'PLANNED_TIME', label: '计划时间' },
                                                                { value: 'EXECUTION_START_TIME', label: '执行开始时间' },
                                                            ]}
                                                            onChange={(value) => patchDefinition(activeIndex, {
                                                                timeBasis: value as ParameterTimeBasis,
                                                            })}
                                                        />
                                                    </label>
                                                    <label className="parameter-runtime-format">
                                                        <span>日期格式</span>
                                                        <input
                                                            aria-label={`日期格式 ${activeIndex + 1}`}
                                                            aria-invalid={issue?.index === activeIndex && issue.field === 'format'}
                                                            value={selectedDefinition.format}
                                                            placeholder="yyyyMMdd"
                                                            onChange={(event) => patchDefinition(activeIndex, { format: event.target.value })}
                                                        />
                                                        {issue?.index === activeIndex && issue.field === 'format'
                                                            ? <span className="parameter-field-error" role="alert">{issue.message}</span>
                                                            : null}
                                                    </label>
                                                    <label className="parameter-runtime-offset">
                                                        <span>偏移天数</span>
                                                        <input
                                                            aria-label={`偏移天数 ${activeIndex + 1}`}
                                                            aria-invalid={issue?.index === activeIndex && issue.field === 'offsetDays'}
                                                            type="number"
                                                            step="1"
                                                            value={selectedDefinition.offsetDays}
                                                            onChange={(event) => patchDefinition(activeIndex, { offsetDays: event.target.value })}
                                                        />
                                                        {issue?.index === activeIndex && issue.field === 'offsetDays'
                                                            ? <span className="parameter-field-error" role="alert">{issue.message}</span>
                                                            : null}
                                                    </label>
                                                </>
                                            )}

                                            <label className="parameter-description-field">
                                                <span>参数说明 <small>可选</small></span>
                                                <input
                                                    aria-label={`参数说明 ${activeIndex + 1}`}
                                                    value={selectedDefinition.description}
                                                    placeholder="说明参数用途"
                                                    onChange={(event) => patchDefinition(activeIndex, { description: event.target.value })}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
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
                            {removedKeysToConfirm.join('、')}
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
