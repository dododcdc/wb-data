import { useEffect, useMemo, useState } from 'react';
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
import { DataSourceSelect } from '../components/DataSourceSelect';
import './DataSourceForm.css';

interface DataSourceFormProps {
    open: boolean;
    onOpenChange: (details: { open: boolean }) => void;
    dataSourceId: number | null;
    onSuccess: (action: 'create' | 'edit') => void;
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

export default function DataSourceForm({ open, onOpenChange, dataSourceId, onSuccess }: DataSourceFormProps) {
    const isEdit = Boolean(dataSourceId);

    const [formData, setFormData] = useState<FormState>(createEmptyFormState);

    const [testResult, setTestResult] = useState<'none' | 'success' | 'fail'>('none');
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    const pluginQuery = useQuery({
        queryKey: ['dataSourcePlugins'],
        queryFn: getDataSourcePlugins,
        staleTime: 5 * 60 * 1000,
    });

    const pluginDescriptors = pluginQuery.data ?? [];
    const typeOptions = useMemo(
        () => pluginDescriptors.map((plugin) => ({ label: plugin.label, value: plugin.type })),
        [pluginDescriptors],
    );

    const selectedPlugin = useMemo(
        () => pluginDescriptors.find((plugin) => plugin.type === formData.type) ?? pluginDescriptors[0],
        [formData.type, pluginDescriptors],
    );

    const supportsConnectionTest = selectedPlugin?.supportsConnectionTest ?? false;
    const connectionFields = selectedPlugin?.fields.filter((field) => field.section === 'connection') ?? [];
    const authenticationFields = selectedPlugin?.fields.filter((field) => field.section === 'authentication') ?? [];
    const pluginError = pluginQuery.error as Error | null;

    // Reset form when opened with no ID, or fetch data when opened with an ID
    useEffect(() => {
        if (open) {
            setTestResult('none');
            if (isEdit && dataSourceId) {
                getDataSourceById(dataSourceId).then(res => {
                    if (res) {
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
                    }
                });
            } else {
                setFormData(createEmptyFormState());
            }
        }
    }, [open, dataSourceId, isEdit]);

    useEffect(() => {
        if (!open || pluginDescriptors.length === 0) {
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
    }, [isEdit, open, pluginDescriptors]);

    const handleChange = (field: keyof Omit<FormState, 'connectionParams'>, value: string) => {
        setTestResult('none');
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handlePluginFieldChange = (field: PluginEditableField, value: string) => {
        handleChange(field, value);
    };

    const handleTypeChange = (nextType: string) => {
        setTestResult('none');
        setFormData((previousState) => {
            const previousPlugin = pluginDescriptors.find((plugin) => plugin.type === previousState.type);
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

    const onTestConnection = async () => {
        if (!supportsConnectionTest || !selectedPlugin) {
            return;
        }

        setTesting(true);
        setTestResult('none');
        try {
            let isSuccess = false;
            const requestPayload = {
                type: formData.type,
                host: formData.host,
                port: formData.port ? parseInt(formData.port, 10) : undefined,
                databaseName: formData.databaseName,
                username: formData.username,
                password: formData.password,
                connectionParams: normalizeConnectionParams(formData.connectionParams),
            };
            isSuccess = await testNewConnection(requestPayload);
            setTestResult(isSuccess ? 'success' : 'fail');
        } catch (error) {
            setTestResult('fail');
        } finally {
            setTesting(false);
        }
    };

    const onSave = async () => {
        if (!selectedPlugin) {
            return;
        }

        setSaving(true);
        try {
            const payload = {
                ...formData,
                port: formData.port ? parseInt(formData.port, 10) : undefined,
                connectionParams: normalizeConnectionParams(formData.connectionParams),
            };
            if (isEdit && dataSourceId) {
                await updateDataSource(dataSourceId, payload);
                onSuccess('edit');
            } else {
                await createDataSource(payload);
                onSuccess('create');
            }
        } catch (error) {
            console.error(error);
            alert('Save failed');
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
                            <div className="form-main-layout">
                                <div className="form-side-panel">
                                    <div className="side-panel-section">
                                        <h3 className="sub-section-title">标识与类型</h3>
                                        <div className="input-group">
                                            <label htmlFor="ds-name">数据源名称 <span className="required">*</span></label>
                                            <input id="ds-name" type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder="如：生产环境主库" />
                                        </div>
                                        <div className="input-group">
                                            <label htmlFor="datasource-form-type-select">数据库类型 <span className="required">*</span></label>
                                            <DataSourceSelect
                                                value={formData.type}
                                                onChange={handleTypeChange}
                                                options={typeOptions}
                                                disabled={pluginQuery.isLoading || typeOptions.length === 0}
                                                inputId="datasource-form-type-select"
                                            />
                                        </div>
                                        {pluginError ? (
                                            <p className="config-section-tip">
                                                数据源插件加载失败：{pluginError.message}
                                            </p>
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
                                                    <div key={fieldKey} className={getFieldLayoutClass(field)}>
                                                        <label htmlFor={`ds-conn-${fieldKey}`}>
                                                            {field.label}
                                                            {field.required ? <span className="required">*</span> : null}
                                                        </label>
                                                        <input
                                                            id={`ds-conn-${fieldKey}`}
                                                            type={field.inputType === 'password' ? 'password' : 'text'}
                                                            value={formData[fieldKey]}
                                                            onChange={(event) => handlePluginFieldChange(fieldKey, event.target.value)}
                                                            placeholder={field.placeholder}
                                                        />
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
                                                    <div key={fieldKey} className={getFieldLayoutClass(field)}>
                                                        <label htmlFor={`ds-auth-${fieldKey}`}>
                                                            {field.label}
                                                            {field.required ? <span className="required">*</span> : null}
                                                        </label>
                                                        <input
                                                            id={`ds-auth-${fieldKey}`}
                                                            type={field.inputType === 'password' ? 'password' : 'text'}
                                                            value={formData[fieldKey]}
                                                            onChange={(event) => handlePluginFieldChange(fieldKey, event.target.value)}
                                                            placeholder={field.placeholder}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="console-form-footer">
                                <div className="footer-left">
                                    <button
                                        className="test-action-btn"
                                        onClick={onTestConnection}
                                        disabled={testing || !supportsConnectionTest || !selectedPlugin}
                                    >
                                        {testing ? '正在测试...' : supportsConnectionTest ? '测试连接' : '测试连接（待支持）'}
                                    </button>
                                    {testResult === 'success' && <div className="test-badge success"><CheckCircle size={14} /> 校验通过</div>}
                                    {testResult === 'fail' && <div className="test-badge fail"><AlertCircle size={14} /> 校验失败</div>}
                                    {!selectedPlugin ? (
                                        <div className="test-note">
                                            当前没有可用的数据源插件，请先检查后端插件目录。
                                        </div>
                                    ) : !supportsConnectionTest ? (
                                        <div className="test-note">
                                            当前版本暂未接入该类型的测试连接。
                                        </div>
                                    ) : null}
                                </div>
                                <div className="footer-right">
                                    <button className="cancel-btn" onClick={() => onOpenChange({ open: false })}>取消</button>
                                    <button className="submit-btn" onClick={onSave} disabled={saving || !selectedPlugin}>
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
