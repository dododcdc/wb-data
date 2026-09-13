import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../components/ui/dialog';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import {
    DataSourcePluginDescriptor,
    PluginFieldDescriptor,
    createDataSource,
    getDataSourceById,
    getDataSourcePlugins,
    testExistingConnection,
    testNewConnection,
    updateDataSource,
} from '../../api/datasource';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import '../../components/ui/form-input-group.css';
import { SimpleSelect } from '../../components/SimpleSelect';
import { getErrorMessage } from '../../utils/error';
import './DataSourceForm.css';

interface DataSourceFormProps {
    open: boolean;
    onOpenChange: (details: { open: boolean }) => void;
    dataSourceId: number | null;
    groupId?: number;
    readOnly?: boolean;
    onSuccess: (details: DataSourceFormSuccessDetails) => void;
}

export interface DataSourceFormSuccessDetails {
    action: 'create' | 'edit';
    dataSourceId: number | null;
    payload: {
        name: string;
        type: string;
        description: string;
        owner: string;
        host: string;
        port?: number;
        databaseName: string;
    };
}

type FormState = {
    name: string;
    type: string;
    description: string;
    owner: string;
    host: string;
    port: string;
    databaseName: string;
    username: string;
    password: string;
    connectionParams: Record<string, unknown>;
};

type ConnectionParamField = `connectionParams.${string}`;
type FormField = 'name' | 'type' | PluginEditableField | ConnectionParamField;

const PLUGIN_EDITABLE_FIELDS = ['host', 'port', 'databaseName', 'username', 'password'] as const;
type PluginEditableField = (typeof PLUGIN_EDITABLE_FIELDS)[number];

const EMPTY_FORM_STATE: FormState = {
    name: '',
    type: '',
    description: '',
    owner: 'admin',
    host: '',
    port: '',
    databaseName: '',
    username: '',
    password: '',
    connectionParams: {},
};

function createEmptyFormState(): FormState {
    return {
        ...EMPTY_FORM_STATE,
        connectionParams: {},
    };
}

function isPluginEditableField(key: string): key is PluginEditableField {
    return PLUGIN_EDITABLE_FIELDS.includes(key as PluginEditableField);
}

function normalizeConnectionParams(params: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined),
    );
}

function connectionParamFieldKey(key: string): ConnectionParamField {
    return `connectionParams.${key}`;
}

function getPluginField(
    descriptor: DataSourcePluginDescriptor | undefined,
    key: PluginEditableField,
) {
    return descriptor?.fields.find((field) => field.key === key);
}

function getPluginFieldDefaultValue(
    descriptor: DataSourcePluginDescriptor | undefined,
    key: PluginEditableField,
) {
    return getPluginField(descriptor, key)?.defaultValue ?? '';
}

function applyPluginDefaults(
    previousState: FormState,
    nextDescriptor: DataSourcePluginDescriptor | undefined,
    previousDescriptor?: DataSourcePluginDescriptor,
) {
    if (!nextDescriptor) {
        return previousState;
    }

    let changed = false;
    const nextState: FormState = {
        ...previousState,
        connectionParams: normalizeConnectionParams(previousState.connectionParams),
    };

    for (const field of PLUGIN_EDITABLE_FIELDS) {
        // Never invent a password default — edit forms keep password empty until the user types one.
        if (field === 'password') {
            continue;
        }

        const currentValue = previousState[field];
        const previousDefault = getPluginFieldDefaultValue(previousDescriptor, field);
        const nextDefault = getPluginFieldDefaultValue(nextDescriptor, field);

        if (!currentValue || currentValue === previousDefault) {
            const normalizedNextValue = nextDefault ?? '';
            if (normalizedNextValue !== currentValue) {
                nextState[field] = normalizedNextValue;
                changed = true;
            }
        }
    }

    const nextConnectionParamFields = nextDescriptor.fields.filter((field) => field.section === 'connectionParams');
    const previousConnectionParamFields = previousDescriptor?.fields.filter((field) => field.section === 'connectionParams') ?? [];
    const nextConnectionParams: Record<string, unknown> = {};

    for (const field of nextConnectionParamFields) {
        const currentValue = nextState.connectionParams[field.key];
        const previousDefault = previousConnectionParamFields.find((previousField) => previousField.key === field.key)?.defaultValue ?? '';
        const nextDefault = field.defaultValue ?? '';
        if (currentValue === undefined || currentValue === previousDefault) {
            if (nextDefault !== '') {
                nextConnectionParams[field.key] = nextDefault;
            }
            continue;
        }

        nextConnectionParams[field.key] = currentValue;
    }

    if (JSON.stringify(nextConnectionParams) !== JSON.stringify(nextState.connectionParams)) {
        nextState.connectionParams = nextConnectionParams;
        changed = true;
    }

    return changed ? nextState : previousState;
}

function getFieldLayoutClass(field: PluginFieldDescriptor) {
    if (field.key === 'host') {
        return 'form-input-group span-2';
    }

    if (field.key === 'databaseName') {
        return 'form-input-group span-2';
    }

    return 'form-input-group';
}

function getFieldPlaceholder(field: PluginFieldDescriptor, isEdit: boolean, readOnly: boolean) {
    if (field.key === 'password') {
        if (readOnly) {
            return '********';
        }
        if (isEdit) {
            return '留空则保持当前密码';
        }
    }

    return field.placeholder;
}

const SECRET_PARAM_KEY = /password|secret|token|credential|passwd|private[_-]?key/i;
const MASKED_PASSWORD = '••••••••';

function formatPlainValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

function isSecretConnectionParam(key: string, field?: PluginFieldDescriptor) {
    return field?.inputType === 'password' || SECRET_PARAM_KEY.test(key);
}

function DetailValue({
    value,
    multiline = false,
    masked = false,
}: {
    value?: unknown;
    multiline?: boolean;
    masked?: boolean;
}) {
    if (masked) {
        return (
            <div className="datasource-detail-value datasource-detail-password">
                {MASKED_PASSWORD}
            </div>
        );
    }

    const text = formatPlainValue(value);
    if (!text) {
        return <div className="datasource-detail-value datasource-detail-empty">—</div>;
    }

    return (
        <div className={`datasource-detail-value${multiline ? ' is-multiline' : ''}`}>
            {text}
        </div>
    );
}

function DataSourceDetailSheet({
    formData,
    selectedPlugin,
    loadError,
    pluginError,
}: {
    formData: FormState;
    selectedPlugin?: DataSourcePluginDescriptor;
    loadError: string;
    pluginError: Error | null;
}) {
    const connectionFields = selectedPlugin?.fields.filter((field) => field.section === 'connection') ?? [];
    const connectionParamFields = selectedPlugin?.fields.filter((field) => field.section === 'connectionParams') ?? [];
    const authenticationFields = selectedPlugin?.fields.filter((field) => field.section === 'authentication') ?? [];

    return (
        <div className="form-main-layout">
            <div className="form-side-panel">
                <div className="side-panel-section">
                    <h3 className="sub-section-title">标识与类型</h3>
                    <div className="form-input-group">
                        <label>数据源名称</label>
                        <DetailValue value={formData.name} />
                    </div>
                    <div className="form-input-group">
                        <label>数据库类型</label>
                        <div className="datasource-detail-value">
                            {formData.type ? (
                                <span className={`type-badge ${formData.type.toLowerCase()}`}>{formData.type}</span>
                            ) : (
                                <span className="datasource-detail-empty">—</span>
                            )}
                        </div>
                    </div>
                    {pluginError ? (
                        <p className="config-section-tip">
                            数据源插件加载失败：{pluginError.message}
                        </p>
                    ) : null}
                    {loadError ? (
                        <div className="form-feedback form-feedback-error">
                            <AlertCircle size={14} />
                            <span>{loadError}</span>
                        </div>
                    ) : null}
                    <div className="form-input-group">
                        <label>负责人</label>
                        <DetailValue value={formData.owner} />
                    </div>
                    <div className="form-input-group">
                        <label>备注描述</label>
                        <DetailValue value={formData.description} multiline />
                    </div>
                </div>
            </div>

            <div className="form-main-panel">
                <div className="config-section">
                    <h3 className="sub-section-title">连接配置</h3>
                    {selectedPlugin?.helperText ? (
                        <p className="config-section-tip">{selectedPlugin.helperText}</p>
                    ) : null}
                    <div className="field-grid">
                        {connectionFields.map((field) => {
                            if (!isPluginEditableField(field.key)) {
                                return null;
                            }

                            const fieldKey = field.key;

                            return (
                                <div key={fieldKey} className={getFieldLayoutClass(field)}>
                                    <label>{field.label}</label>
                                    <DetailValue
                                        value={formData[fieldKey]}
                                        masked={field.inputType === 'password' || fieldKey === 'password'}
                                    />
                                </div>
                            );
                        })}
                        {connectionParamFields.map((field) => (
                            <div key={field.key} className={getFieldLayoutClass(field)}>
                                <label>{field.label}</label>
                                <DetailValue
                                    value={formData.connectionParams[field.key]}
                                    masked={isSecretConnectionParam(field.key, field)}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="panel-divider" />

                <div className="config-section">
                    <h3 className="sub-section-title">身份核验</h3>
                    <div className="field-grid">
                        {authenticationFields.map((field) => {
                            if (!isPluginEditableField(field.key)) {
                                return null;
                            }

                            const fieldKey = field.key;

                            return (
                                <div key={fieldKey} className={getFieldLayoutClass(field)}>
                                    <label>{field.label}</label>
                                    <DetailValue
                                        value={formData[fieldKey]}
                                        masked={field.inputType === 'password' || fieldKey === 'password'}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function DataSourceForm({ open, onOpenChange, dataSourceId, groupId, readOnly = false, onSuccess }: DataSourceFormProps) {
    const isEdit = Boolean(dataSourceId);
    const isView = readOnly && isEdit;
    const detailRequestIdRef = useRef(0);
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);

    const [formData, setFormData] = useState<FormState>(createEmptyFormState);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FormField, string | true>>>({});
    const [passwordDirty, setPasswordDirty] = useState(false);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [loadError, setLoadError] = useState('');

    const [testResult, setTestResult] = useState<'none' | 'success' | 'fail'>('none');
    const [testMessage, setTestMessage] = useState('');
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const pluginQuery = useQuery({
        queryKey: ['dataSourcePlugins'],
        queryFn: getDataSourcePlugins,
        staleTime: 5 * 60 * 1000,
    });
    const { refetch: refetchPlugins } = pluginQuery;

    const pluginDescriptors = useMemo(() => pluginQuery.data ?? [], [pluginQuery.data]);
    const typeOptions = useMemo(
        () => pluginDescriptors.map((plugin) => ({ label: plugin.label, value: plugin.type })),
        [pluginDescriptors],
    );

    const effectiveType = formData.type || pluginDescriptors[0]?.type || '';

    const selectedPlugin = useMemo(
        () => pluginDescriptors.find((plugin) => plugin.type === effectiveType) ?? pluginDescriptors[0],
        [effectiveType, pluginDescriptors],
    );

    const supportsConnectionTest = selectedPlugin?.supportsConnectionTest ?? false;
    const connectionFields = selectedPlugin?.fields.filter((field) => field.section === 'connection') ?? [];
    const connectionParamFields = selectedPlugin?.fields.filter((field) => field.section === 'connectionParams') ?? [];
    const authenticationFields = selectedPlugin?.fields.filter((field) => field.section === 'authentication') ?? [];
    const pluginError = pluginQuery.error as Error | null;
    const testingIndicatorVisible = useDelayedBusy(testing, { delayMs: 0, minVisibleMs: 420 });

    // Reset form when opened with no ID, or fetch data when opened with an ID
    useEffect(() => {
        if (open) {
            const requestId = ++detailRequestIdRef.current;
            refetchPlugins();
            setFieldErrors({});
            setTestResult('none');
            setTestMessage('');
            setSaveError('');
            setLoadError('');
            setPasswordDirty(false);
            if (isEdit && dataSourceId) {
                setIsLoadingDetails(true);
                setFormData(createEmptyFormState());

                getDataSourceById(dataSourceId, groupId)
                    .then(res => {
                        if (detailRequestIdRef.current !== requestId || !res) {
                            return;
                        }

                        setFormData({
                            name: res.name || '',
                            type: res.type || '',
                            description: res.description || '',
                            owner: res.owner || 'admin',
                            host: res.host || '',
                            port: res.port ? String(res.port) : '',
                            databaseName: res.databaseName || '',
                            username: res.username || '',
                            password: readOnly ? '********' : '',
                            connectionParams: normalizeConnectionParams((res.connectionParams || {}) as Record<string, unknown>),
                        });
                    })
                    .catch((error) => {
                        if (detailRequestIdRef.current !== requestId) {
                            return;
                        }

                        setLoadError(getErrorMessage(error, '加载数据源详情失败，请稍后重试'));
                    })
                    .finally(() => {
                        if (detailRequestIdRef.current === requestId) {
                            setIsLoadingDetails(false);
                        }
                    });
            } else {
                setIsLoadingDetails(false);
                setFormData(createEmptyFormState());
            }
        }
    }, [dataSourceId, groupId, isEdit, open, readOnly, refetchPlugins]);

    useEffect(() => {
        if (!open || pluginDescriptors.length === 0 || (isEdit && isLoadingDetails)) {
            return;
        }

        setFormData((previousState) => {
            const activePlugin = pluginDescriptors.find((plugin) => plugin.type === previousState.type);
            if (activePlugin) {
                return applyPluginDefaults(previousState, activePlugin);
            }

            if (isEdit && previousState.type) {
                return previousState;
            }

            const defaultPlugin = pluginDescriptors[0];
            return applyPluginDefaults(
                {
                    ...previousState,
                    type: defaultPlugin.type,
                },
                defaultPlugin,
            );
        });
    }, [isEdit, isLoadingDetails, open, pluginDescriptors]);

    useEffect(() => {
        if (!open || !effectiveType || formData.type === effectiveType) {
            return;
        }

        setFormData((previousState) => ({
            ...previousState,
            type: effectiveType,
        }));
    }, [effectiveType, formData.type, open]);

    const handleChange = (field: keyof Omit<FormState, 'connectionParams'>, value: string) => {
        setTestResult('none');
        setTestMessage('');
        setSaveError('');
        setFieldErrors((previousErrors) => {
            if (!previousErrors[field as FormField]) {
                return previousErrors;
            }

            const nextErrors = { ...previousErrors };
            delete nextErrors[field as FormField];
            return nextErrors;
        });
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handlePluginFieldChange = (field: PluginEditableField, value: string) => {
        if (field === 'password') {
            setPasswordDirty(true);
        }
        handleChange(field, value);
    };

    const handleConnectionParamFieldChange = (field: PluginFieldDescriptor, value: string) => {
        const errorKey = connectionParamFieldKey(field.key);
        setTestResult('none');
        setTestMessage('');
        setSaveError('');
        setFieldErrors((previousErrors) => {
            if (!previousErrors[errorKey]) {
                return previousErrors;
            }

            const nextErrors = { ...previousErrors };
            delete nextErrors[errorKey];
            return nextErrors;
        });
        setFormData((previousState) => ({
            ...previousState,
            connectionParams: {
                ...previousState.connectionParams,
                [field.key]: value,
            },
        }));
    };

    const handleTypeChange = (nextType: string) => {
        setTestResult('none');
        setTestMessage('');
        setSaveError('');
        setFieldErrors({});
        setFormData((previousState) => {
            const previousType = previousState.type || effectiveType;
            const previousPlugin = pluginDescriptors.find((plugin) => plugin.type === previousType);
            const nextPlugin = pluginDescriptors.find((plugin) => plugin.type === nextType);

            return applyPluginDefaults(
                {
                    ...previousState,
                    type: nextType,
                },
                nextPlugin,
                previousPlugin,
            );
        });
    };

    const validateForm = (mode: 'test' | 'save') => {
        const nextErrors: Partial<Record<FormField, string | true>> = {};

        if (mode === 'save' && !formData.name.trim()) {
            nextErrors.name = true;
        }

        if (!effectiveType) {
            nextErrors.type = true;
        }

        if (!selectedPlugin) {
            setFieldErrors(nextErrors);
            return false;
        }

        for (const field of selectedPlugin.fields) {
            if (!field.required) {
                continue;
            }

            if (field.section === 'connectionParams') {
                const value = String(formData.connectionParams[field.key] ?? '').trim();
                if (!value) {
                    nextErrors[connectionParamFieldKey(field.key)] = true;
                }
                continue;
            }

            if (!isPluginEditableField(field.key)) {
                continue;
            }

            const fieldKey = field.key;
            const rawValue = formData[fieldKey];
            const value = rawValue.trim();

            if (fieldKey === 'port') {
                if (!value) {
                    nextErrors.port = true;
                    continue;
                }

                if (!/^\d+$/.test(value)) {
                    nextErrors.port = '端口必须为数字';
                    continue;
                }

                const port = Number.parseInt(value, 10);
                if (port < 1 || port > 65535) {
                    nextErrors.port = '端口必须在 1-65535 之间';
                }
                continue;
            }

            if (!value) {
                nextErrors[fieldKey] = true;
            }
        }

        setFieldErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    };

    const runExistingConnectionTest = async () => {
        if (!dataSourceId || groupId == null) {
            return;
        }

        setTesting(true);
        setTestResult('none');
        setTestMessage('正在验证连接配置，请稍等...');
        setSaveError('');
        try {
            const result = await testExistingConnection(dataSourceId, groupId);
            setTestResult(result.success ? 'success' : 'fail');
            setTestMessage(result.message || (result.success ? '连接成功' : '连接失败'));
        } catch (error) {
            setTestResult('fail');
            setTestMessage(getErrorMessage(error, '连接失败'));
        } finally {
            setTesting(false);
        }
    };

    const onTestConnection = async () => {
        if (!supportsConnectionTest || !selectedPlugin || isLoadingDetails) {
            return;
        }

        if (isView) {
            await runExistingConnectionTest();
            return;
        }

        // Edit keeps stored secrets unless the user explicitly changed the password field
        // (empty string OR browser autofill without a user edit should not hit test-new).
        if (isEdit && dataSourceId && !passwordDirty) {
            await runExistingConnectionTest();
            return;
        }

        if (!validateForm('test')) {
            return;
        }

        setTesting(true);
        setTestResult('none');
        setTestMessage('正在验证连接配置，请稍等...');
        setSaveError('');
        try {
            const requestPayload = {
                type: effectiveType,
                host: formData.host,
                port: formData.port ? parseInt(formData.port, 10) : undefined,
                databaseName: formData.databaseName,
                username: formData.username,
                password: formData.password,
                connectionParams: normalizeConnectionParams(formData.connectionParams),
            };
            const result = await testNewConnection(requestPayload, groupId!);
            setTestResult(result.success ? 'success' : 'fail');
            setTestMessage(result.message || (result.success ? '连接成功' : '连接失败'));
        } catch (error) {
            setTestResult('fail');
            setTestMessage(getErrorMessage(error, '连接失败'));
        } finally {
            setTesting(false);
        }
    };

    const onSave = async () => {
        if (isView || !selectedPlugin || isLoadingDetails) {
            return;
        }

        if (!validateForm('save')) {
            return;
        }

        setSaving(true);
        setSaveError('');
        try {
            const payload = {
                ...formData,
                type: effectiveType,
                port: formData.port ? parseInt(formData.port, 10) : undefined,
                connectionParams: normalizeConnectionParams(formData.connectionParams),
            };
            if (isEdit && dataSourceId) {
                await updateDataSource(dataSourceId, payload, groupId!);
                onSuccess({
                    action: 'edit',
                    dataSourceId,
                    payload: {
                        name: payload.name,
                        type: payload.type,
                        description: payload.description,
                        owner: payload.owner,
                        host: payload.host ?? '',
                        port: payload.port,
                        databaseName: payload.databaseName ?? '',
                    },
                });
            } else {
                await createDataSource(payload, groupId!);
                onSuccess({
                    action: 'create',
                    dataSourceId: null,
                    payload: {
                        name: payload.name,
                        type: payload.type,
                        description: payload.description,
                        owner: payload.owner,
                        host: payload.host ?? '',
                        port: payload.port,
                        databaseName: payload.databaseName ?? '',
                    },
                });
            }
        } catch (error) {
            console.error(error);
            setSaveError(getErrorMessage(error, '保存失败'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => onOpenChange({ open: nextOpen })}>
            <DialogContent ref={(el) => { setDialogEl(el); }} style={{ maxWidth: '960px' }}>
                <DialogHeader>
                    <DialogTitle>
                        {isView ? '数据源详情' : isEdit ? '编辑数据源' : '新建数据源'}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {isView
                            ? 'View read-only data source connection details.'
                            : 'Form to configure settings for a data source connection.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="dialog-body form-content">
                    {isLoadingDetails ? (
                        <div className="form-loading-state" role="status">
                            <span className="sr-only">正在加载数据源信息</span>
                            <div className="form-loading-skeleton" aria-hidden="true">
                                {Array.from({ length: 4 }).map((_, index) => (
                                    <div className="form-loading-skeleton-field" key={index}>
                                        <span className="skeleton-line form-loading-skeleton-label" />
                                        <span className="skeleton-line form-loading-skeleton-input" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : isView ? (
                        <DataSourceDetailSheet
                            formData={formData}
                            selectedPlugin={selectedPlugin}
                            loadError={loadError}
                            pluginError={pluginError}
                        />
                    ) : (
                        <div className="form-main-layout">
                            <div className="form-side-panel">
                                <div className="side-panel-section">
                                    <h3 className="sub-section-title">标识与类型</h3>
                                    <div className={`form-input-group ${fieldErrors.name ? 'has-error' : ''}`}>
                                        <label htmlFor="ds-name">数据源名称 <span className="required">*</span></label>
                                        <input id="ds-name" type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder="如：生产环境主库" disabled={isView} readOnly={isView} />
                                        {typeof fieldErrors.name === 'string' ? <span className="form-input-error">{fieldErrors.name}</span> : null}
                                    </div>
                                    <div className={`form-input-group ${fieldErrors.type ? 'has-error' : ''}`}>
                                        <label htmlFor="datasource-form-type-select">数据库类型 <span className="required">*</span></label>
                                        <SimpleSelect
                                            id="datasource-form-type-select"
                                            value={effectiveType}
                                            onChange={handleTypeChange}
                                            disabled={isView || pluginQuery.isLoading || typeOptions.length === 0}
                                            options={typeOptions}
                                            placeholder="选择数据库类型"
                                            menuContainer={dialogEl}
                                        />
                                        {typeof fieldErrors.type === 'string' ? <span className="form-input-error">{fieldErrors.type}</span> : null}
                                    </div>
                                    {pluginError ? (
                                        <p className="config-section-tip">
                                            数据源插件加载失败：{pluginError.message}
                                        </p>
                                    ) : null}
                                    {loadError ? (
                                        <div className="form-feedback form-feedback-error">
                                            <AlertCircle size={14} />
                                            <span>{loadError}</span>
                                        </div>
                                    ) : null}
                                    <div className="form-input-group">
                                        <label htmlFor="ds-owner">负责人</label>
                                        <input id="ds-owner" type="text" value={formData.owner} onChange={e => handleChange('owner', e.target.value)} placeholder="项目负责人姓名" disabled={isView} readOnly={isView} />
                                    </div>
                                    <div className="form-input-group">
                                        <label htmlFor="ds-description">备注描述</label>
                                        <textarea
                                            id="ds-description"
                                            value={formData.description}
                                            onChange={e => handleChange('description', e.target.value)}
                                            placeholder="简要描述业务用途..."
                                            rows={3}
                                            disabled={isView}
                                            readOnly={isView}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="form-main-panel">
                                <div className="config-section">
                                    <h3 className="sub-section-title">连接配置</h3>
                                    {selectedPlugin?.helperText ? (
                                        <p className="config-section-tip">{selectedPlugin.helperText}</p>
                                    ) : null}
                                    <div className="field-grid">
                                        {connectionFields.map((field) => {
                                            if (!isPluginEditableField(field.key)) {
                                                return null;
                                            }

                                            const fieldKey = field.key;

                                            return (
                                                <div key={fieldKey} className={`${getFieldLayoutClass(field)} ${fieldErrors[fieldKey] ? 'has-error' : ''}`}>
                                                    <label htmlFor={`ds-conn-${fieldKey}`}>
                                                        {field.label}
                                                        {field.required ? <span className="required">*</span> : null}
                                                    </label>
                                                    <input
                                                        id={`ds-conn-${fieldKey}`}
                                                        type={field.inputType === 'password' ? 'password' : 'text'}
                                                        autoComplete={field.inputType === 'password' || field.key === 'password' ? 'new-password' : 'off'}
                                                        value={formData[fieldKey]}
                                                        onChange={(event) => handlePluginFieldChange(fieldKey, event.target.value)}
                                                        placeholder={getFieldPlaceholder(field, isEdit, isView)}
                                                        disabled={isView}
                                                        readOnly={isView}
                                                    />
                                                    {typeof fieldErrors[fieldKey] === 'string' ? <span className="form-input-error">{fieldErrors[fieldKey]}</span> : null}
                                                </div>
                                            );
                                        })}
                                        {connectionParamFields.map((field) => {
                                            const fieldKey = connectionParamFieldKey(field.key);

                                            return (
                                                <div key={field.key} className={`${getFieldLayoutClass(field)} ${fieldErrors[fieldKey] ? 'has-error' : ''}`}>
                                                    <label htmlFor={`ds-conn-param-${field.key}`}>
                                                        {field.label}
                                                        {field.required ? <span className="required">*</span> : null}
                                                    </label>
                                                    <input
                                                        id={`ds-conn-param-${field.key}`}
                                                        type={field.inputType === 'password' ? 'password' : 'text'}
                                                        autoComplete={field.inputType === 'password' || field.key === 'password' ? 'new-password' : 'off'}
                                                        value={String(formData.connectionParams[field.key] ?? '')}
                                                        onChange={(event) => handleConnectionParamFieldChange(field, event.target.value)}
                                                        placeholder={field.placeholder}
                                                        disabled={isView}
                                                        readOnly={isView}
                                                    />
                                                    {typeof fieldErrors[fieldKey] === 'string' ? <span className="form-input-error">{fieldErrors[fieldKey]}</span> : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="panel-divider" />

                                <div className="config-section">
                                    <h3 className="sub-section-title">身份核验</h3>
                                    <div className="field-grid">
                                        {authenticationFields.map((field) => {
                                            if (!isPluginEditableField(field.key)) {
                                                return null;
                                            }

                                            const fieldKey = field.key;

                                            if (fieldKey === 'password' && isEdit && !isView) {
                                                return (
                                                    <div key={fieldKey} className={`${getFieldLayoutClass(field)} ${fieldErrors[fieldKey] ? 'has-error' : ''}`}>
                                                        <label htmlFor="ds-auth-password">{field.label}</label>
                                                        {passwordDirty ? (
                                                            <input
                                                                id="ds-auth-password"
                                                                type="password"
                                                                name="wb-data-ds-new-password"
                                                                autoComplete="new-password"
                                                                value={formData.password}
                                                                onChange={(event) => handlePluginFieldChange('password', event.target.value)}
                                                                onBlur={() => {
                                                                    if (!formData.password.trim()) {
                                                                        setPasswordDirty(false);
                                                                    }
                                                                }}
                                                                placeholder="请输入新密码"
                                                                autoFocus
                                                            />
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                id="ds-auth-password"
                                                                className="datasource-password-mask"
                                                                aria-label="当前密码已保存，点击后可输入新密码"
                                                                onClick={() => {
                                                                    setPasswordDirty(true);
                                                                    handleChange('password', '');
                                                                }}
                                                            >
                                                                <span aria-hidden="true">{MASKED_PASSWORD}</span>
                                                            </button>
                                                        )}
                                                        {typeof fieldErrors[fieldKey] === 'string' ? <span className="form-input-error">{fieldErrors[fieldKey]}</span> : null}
                                                    </div>
                                                );
                                            }

                                            return (
                                                <div key={fieldKey} className={`${getFieldLayoutClass(field)} ${fieldErrors[fieldKey] ? 'has-error' : ''}`}>
                                                    <label htmlFor={`ds-auth-${fieldKey}`}>
                                                        {field.label}
                                                        {field.required ? <span className="required">*</span> : null}
                                                    </label>
                                                    <input
                                                        id={`ds-auth-${fieldKey}`}
                                                        type={field.inputType === 'password' ? 'password' : 'text'}
                                                        name={fieldKey === 'password' ? 'wb-data-ds-password' : undefined}
                                                        autoComplete={field.inputType === 'password' || field.key === 'password' ? 'new-password' : 'off'}
                                                        value={formData[fieldKey]}
                                                        onChange={(event) => handlePluginFieldChange(fieldKey, event.target.value)}
                                                        placeholder={getFieldPlaceholder(field, isEdit, isView)}
                                                        disabled={isView}
                                                        readOnly={isView}
                                                    />
                                                    {typeof fieldErrors[fieldKey] === 'string' ? <span className="form-input-error">{fieldErrors[fieldKey]}</span> : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="console-form-footer" style={{ padding: '16px 24px' }}>
                    <div className="footer-left" style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                        <button
                            className="test-action-btn"
                            onClick={onTestConnection}
                            disabled={testing || isLoadingDetails || !supportsConnectionTest || !selectedPlugin}
                            type="button"
                        >
                            {testing || testingIndicatorVisible ? '正在测试...' : supportsConnectionTest ? '测试连接' : '测试连接（待支持）'}
                        </button>
                        {(testing || testingIndicatorVisible || testResult === 'success' || (testResult === 'fail' && testMessage)) ? (
                            <div
                                className={`form-feedback ${
                                    testing || testingIndicatorVisible ? 'form-feedback-info' : testResult === 'success' ? 'form-feedback-success' : 'form-feedback-error'
                                }`}
                                role="status"
                                aria-live="polite"
                                style={{ margin: 0 }}
                            >
                                {testing || testingIndicatorVisible ? <div className="form-feedback-spinner" aria-hidden="true" /> : testResult === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                <span>{testing || testingIndicatorVisible ? '正在验证连接配置，请稍等...' : testMessage}</span>
                            </div>
                        ) : null}
                        {saveError ? (
                            <div className="form-feedback form-feedback-error" style={{ margin: 0 }}>
                                <AlertCircle size={14} />
                                <span>{saveError}</span>
                            </div>
                        ) : null}
                    </div>
                    <div className="footer-right" style={{ display: 'flex', gap: 12 }}>
                        <Button variant="outline" onClick={() => onOpenChange({ open: false })} disabled={saving}>
                            {isView ? '关闭' : '取消'}
                        </Button>
                        {!isView ? (
                            <Button variant="default" onClick={onSave} disabled={saving || isLoadingDetails || !selectedPlugin}>
                                {saving ? '保存中...' : '确认保存'}
                            </Button>
                        ) : null}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
