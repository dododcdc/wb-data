import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../components/ui/dialog';
import { useDelayedBusy } from '../hooks/useDelayedBusy';
import {
    DataSourcePluginDescriptor,
    PluginFieldDescriptor,
    createDataSource,
    getDataSourceById,
    getDataSourcePlugins,
    testNewConnection,
    updateDataSource,
} from '../api/datasource';
import { CheckCircle, AlertCircle, X } from 'lucide-react';
import { SimpleSelect } from '../components/SimpleSelect';
import './DataSourceForm.css';

interface DataSourceFormProps {
    open: boolean;
    onOpenChange: (details: { open: boolean }) => void;
    dataSourceId: number | null;
    groupId?: number;
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

type FormField = 'name' | 'type' | PluginEditableField;

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

    return changed ? nextState : previousState;
}

function getFieldLayoutClass(field: PluginFieldDescriptor) {
    if (field.key === 'host') {
        return 'input-group span-2';
    }

    if (field.key === 'databaseName') {
        return 'input-group span-2';
    }

    return 'input-group';
}

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

function getFieldPlaceholder(field: PluginFieldDescriptor, isEdit: boolean) {
    if (isEdit && field.key === 'password') {
        return '留空则保持当前密码';
    }

    return field.placeholder;
}

export default function DataSourceForm({ open, onOpenChange, dataSourceId, groupId, onSuccess }: DataSourceFormProps) {
    const isEdit = Boolean(dataSourceId);
    const detailRequestIdRef = useRef(0);

    const [formData, setFormData] = useState<FormState>(createEmptyFormState);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FormField, string>>>({});
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
            if (isEdit && dataSourceId) {
                setIsLoadingDetails(true);
                setFormData(createEmptyFormState());

                getDataSourceById(dataSourceId)
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
                            password: res.password || '',
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
    }, [dataSourceId, isEdit, open, refetchPlugins]);

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
        handleChange(field, value);
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
        const nextErrors: Partial<Record<FormField, string>> = {};

        if (mode === 'save' && !formData.name.trim()) {
            nextErrors.name = '数据源名称不能为空';
        }

        if (!effectiveType) {
            nextErrors.type = '请选择数据库类型';
        }

        if (!selectedPlugin) {
            setFieldErrors(nextErrors);
            return false;
        }

        for (const field of selectedPlugin.fields) {
            if (!isPluginEditableField(field.key) || !field.required) {
                continue;
            }

            const fieldKey = field.key;
            const rawValue = formData[fieldKey];
            const value = rawValue.trim();

            if (fieldKey === 'port') {
                if (!value) {
                    nextErrors.port = `${field.label}不能为空`;
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
                nextErrors[fieldKey] = `${field.label}不能为空`;
            }
        }

        setFieldErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    };

    const onTestConnection = async () => {
        if (!supportsConnectionTest || !selectedPlugin || isLoadingDetails) {
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
            setTestMessage(result.message || (result.success ? '连接测试通过，可以继续保存。' : '连接测试失败，请检查连接配置。'));
        } catch (error) {
            setTestResult('fail');
            setTestMessage(getErrorMessage(error, '连接校验失败，请稍后重试'));
        } finally {
            setTesting(false);
        }
    };

    const onSave = async () => {
        if (!selectedPlugin || isLoadingDetails) {
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
                await updateDataSource(dataSourceId, payload);
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
            setSaveError(getErrorMessage(error, '保存失败，请检查表单后重试'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => onOpenChange({ open: nextOpen })}>
            <DialogPortal>
                <DialogOverlay className="dialog-backdrop" />
                <DialogContent className="dialog-positioner">
                    <div className="dialog-content console-form-card">
                        <div className="form-header">
                            <DialogTitle className="dialog-title">
                                {isEdit ? '编辑数据源' : '新建数据源'}
                            </DialogTitle>
                            <DialogClose className="dialog-close-btn" aria-label="关闭">
                                <X size={20} />
                            </DialogClose>
                        </div>
                        <DialogDescription className="sr-only">
                            Form to configure settings for a data source connection.
                        </DialogDescription>

                        <div className="form-content">
                            {isLoadingDetails ? (
                                <div className="form-loading-state" role="status" aria-live="polite">
                                    <div className="form-loading-spinner" aria-hidden="true" />
                                    <strong>正在加载数据源信息</strong>
                                    <p>稍等一下，正在同步当前配置。</p>
                                </div>
                            ) : (
                                <div className="form-main-layout">
                                <div className="form-side-panel">
                                    <div className="side-panel-section">
                                        <h3 className="sub-section-title">标识与类型</h3>
                                        <div className={`input-group ${fieldErrors.name ? 'has-error' : ''}`}>
                                            <label htmlFor="ds-name">数据源名称 <span className="required">*</span></label>
                                            <input id="ds-name" type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder="如：生产环境主库" />
                                            {fieldErrors.name ? <span className="input-error">{fieldErrors.name}</span> : null}
                                        </div>
                                        <div className={`input-group ${fieldErrors.type ? 'has-error' : ''}`}>
                                            <label htmlFor="datasource-form-type-select">数据库类型 <span className="required">*</span></label>
                                            <SimpleSelect
                                                id="datasource-form-type-select"
                                                value={effectiveType}
                                                onChange={handleTypeChange}
                                                disabled={pluginQuery.isLoading || typeOptions.length === 0}
                                                options={typeOptions}
                                                placeholder="选择数据库类型"
                                            />
                                            {fieldErrors.type ? <span className="input-error">{fieldErrors.type}</span> : null}
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
                                        <div className="input-group">
                                            <label htmlFor="ds-owner">负责人</label>
                                            <input id="ds-owner" type="text" value={formData.owner} onChange={e => handleChange('owner', e.target.value)} placeholder="项目负责人姓名" />
                                        </div>
                                        <div className="input-group">
                                            <label htmlFor="ds-description">备注描述</label>
                                            <textarea
                                                id="ds-description"
                                                value={formData.description}
                                                onChange={e => handleChange('description', e.target.value)}
                                                placeholder="简要描述业务用途..."
                                                rows={3}
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
                                                            value={formData[fieldKey]}
                                                            onChange={(event) => handlePluginFieldChange(fieldKey, event.target.value)}
                                                            placeholder={getFieldPlaceholder(field, isEdit)}
                                                        />
                                                        {fieldErrors[fieldKey] ? <span className="input-error">{fieldErrors[fieldKey]}</span> : null}
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

                                                return (
                                                    <div key={fieldKey} className={`${getFieldLayoutClass(field)} ${fieldErrors[fieldKey] ? 'has-error' : ''}`}>
                                                        <label htmlFor={`ds-auth-${fieldKey}`}>
                                                            {field.label}
                                                            {field.required ? <span className="required">*</span> : null}
                                                        </label>
                                                        <input
                                                            id={`ds-auth-${fieldKey}`}
                                                            type={field.inputType === 'password' ? 'password' : 'text'}
                                                            value={formData[fieldKey]}
                                                            onChange={(event) => handlePluginFieldChange(fieldKey, event.target.value)}
                                                            placeholder={getFieldPlaceholder(field, isEdit)}
                                                        />
                                                        {fieldErrors[fieldKey] ? <span className="input-error">{fieldErrors[fieldKey]}</span> : null}
                                                        {isEdit && fieldKey === 'password' ? (
                                                            <span className="input-help">留空则保持当前密码不变</span>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                                </div>
                            )}

                            <div className="console-form-footer">
                                <div className="footer-left">
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
                                        >
                                            {testing || testingIndicatorVisible ? <div className="form-feedback-spinner" aria-hidden="true" /> : testResult === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                            <span>{testing || testingIndicatorVisible ? '正在验证连接配置，请稍等...' : testMessage}</span>
                                        </div>
                                    ) : null}
                                    {!selectedPlugin ? (
                                        <div className="test-note">
                                            当前没有可用的数据源插件，请先检查后端插件目录。
                                        </div>
                                    ) : !supportsConnectionTest ? (
                                        <div className="test-note">
                                            当前版本暂未接入该类型的测试连接。
                                        </div>
                                    ) : null}
                                    {saveError ? (
                                        <div className="form-feedback form-feedback-error">
                                            <AlertCircle size={14} />
                                            <span>{saveError}</span>
                                        </div>
                                    ) : null}
                                </div>
                                <div className="footer-right">
                                    <button className="cancel-btn" onClick={() => onOpenChange({ open: false })} type="button">取消</button>
                                    <button className="submit-btn" onClick={onSave} disabled={saving || isLoadingDetails || !selectedPlugin} type="button">
                                        {saving ? '保存中...' : '确认保存'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
