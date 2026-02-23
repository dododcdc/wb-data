import { useState, useEffect } from 'react';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { getDataSourceById, createDataSource, updateDataSource, testNewConnection } from '../api/datasource';
import { CheckCircle, AlertCircle, X } from 'lucide-react';
import { DataSourceSelect } from '../components/DataSourceSelect';
import './DataSourceForm.css';

interface DataSourceFormProps {
    open: boolean;
    onOpenChange: (details: { open: boolean }) => void;
    dataSourceId: number | null;
    onSuccess: (action: 'create' | 'edit') => void;
}

export default function DataSourceForm({ open, onOpenChange, dataSourceId, onSuccess }: DataSourceFormProps) {
    const isEdit = Boolean(dataSourceId);

    const [formData, setFormData] = useState({
        name: '',
        type: 'MYSQL',
        description: '',
        owner: 'admin',
        host: '',
        port: '',
        databaseName: '',
        username: '',
        password: '',
        connectionParams: {},
    });

    const [testResult, setTestResult] = useState<'none' | 'success' | 'fail'>('none');
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    // Reset form when opened with no ID, or fetch data when opened with an ID
    useEffect(() => {
        if (open) {
            setTestResult('none');
            if (isEdit && dataSourceId) {
                getDataSourceById(dataSourceId).then(res => {
                    if (res) {
                        setFormData({
                            name: res.name || '',
                            type: res.type || 'MYSQL',
                            description: res.description || '',
                            owner: res.owner || 'admin',
                            host: res.host || '',
                            port: res.port ? String(res.port) : '',
                            databaseName: res.databaseName || '',
                            username: res.username || '',
                            password: res.password || '',
                            connectionParams: (res.connectionParams || {}) as any,
                        });
                    }
                });
            } else {
                setFormData({
                    name: '',
                    type: 'MYSQL',
                    description: '',
                    owner: 'admin',
                    host: '',
                    port: '',
                    databaseName: '',
                    username: '',
                    password: '',
                    connectionParams: {},
                });
            }
        }
    }, [open, dataSourceId, isEdit]);

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const onTestConnection = async () => {
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
                connectionParams: formData.connectionParams
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
        setSaving(true);
        try {
            const payload = {
                ...formData,
                port: formData.port ? parseInt(formData.port, 10) : undefined
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
        <Dialog.Root open={open} onOpenChange={onOpenChange} trapFocus modal lazyMount unmountOnExit>
            <Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Positioner className="dialog-positioner">
                    <Dialog.Content className="dialog-content console-form-card">
                        <div className="form-header">
                            <Dialog.Title className="dialog-title">
                                {isEdit ? '编辑数据源' : '新建数据源'}
                            </Dialog.Title>
                            <Dialog.CloseTrigger className="dialog-close-btn">
                                <X size={20} />
                            </Dialog.CloseTrigger>
                        </div>
                        <Dialog.Description className="sr-only">
                            Form to configure settings for a data source connection.
                        </Dialog.Description>

                        <div className="form-content">
                            <div className="form-main-layout">
                                {/* Side Panel: Identity & Type */}
                                <div className="form-side-panel">
                                    <div className="side-panel-section">
                                        <h3 className="sub-section-title">标识与类型</h3>
                                        <div className="input-group">
                                            <label>数据源名称 <span className="required">*</span></label>
                                            <input type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder="如：生产环境主库" />
                                        </div>
                                        <div className="input-group">
                                            <label>数据库类型 <span className="required">*</span></label>
                                            <DataSourceSelect
                                                value={formData.type}
                                                onChange={(value) => handleChange('type', value)}
                                                options={[
                                                    { label: 'MySQL', value: 'MYSQL' },
                                                    { label: 'Hive', value: 'HIVE' },
                                                    { label: 'PostgreSQL', value: 'POSTGRESQL' },
                                                    { label: 'StarRocks', value: 'STARROCKS' }
                                                ]}
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label>负责人</label>
                                            <input type="text" value={formData.owner} onChange={e => handleChange('owner', e.target.value)} placeholder="项目负责人姓名" />
                                        </div>
                                        <div className="input-group">
                                            <label>备注描述</label>
                                            <textarea
                                                value={formData.description}
                                                onChange={e => handleChange('description', e.target.value)}
                                                placeholder="简要描述业务用途..."
                                                rows={3}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Main Panel: Connection Details */}
                                <div className="form-main-panel">
                                    <div className="config-section">
                                        <h3 className="sub-section-title">连接配置</h3>
                                        <div className="field-grid">
                                            <div className="input-group span-2">
                                                <label>主机名/IP地址 <span className="required">*</span></label>
                                                <input type="text" value={formData.host || ''} onChange={e => handleChange('host', e.target.value)} placeholder="127.0.0.1" />
                                            </div>
                                            <div className="input-group">
                                                <label>端口 <span className="required">*</span></label>
                                                <input type="text" value={formData.port || ''} onChange={e => handleChange('port', e.target.value)} placeholder="3306" />
                                            </div>
                                            <div className="input-group flex-1">
                                                <label>默认数据库 <span className="required">*</span></label>
                                                <input type="text" value={formData.databaseName || ''} onChange={e => handleChange('databaseName', e.target.value)} placeholder="数据库名" />
                                            </div>
                                            <div className="spacer-2" />
                                        </div>
                                    </div>

                                    <div className="panel-divider" />

                                    <div className="config-section">
                                        <h3 className="sub-section-title">身份核验</h3>
                                        <div className="field-grid">
                                            <div className="input-group">
                                                <label>用户名</label>
                                                <input type="text" value={formData.username || ''} onChange={e => handleChange('username', e.target.value)} placeholder="Username" />
                                            </div>
                                            <div className="input-group">
                                                <label>密码</label>
                                                <input type="password" value={formData.password || ''} onChange={e => handleChange('password', e.target.value)} placeholder="••••••••" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="console-form-footer">
                                <div className="footer-left">
                                    <button className="test-action-btn" onClick={onTestConnection} disabled={testing}>
                                        {testing ? '正在测试...' : '测试连接'}
                                    </button>
                                    {testResult === 'success' && <div className="test-badge success"><CheckCircle size={14} /> 校验通过</div>}
                                    {testResult === 'fail' && <div className="test-badge fail"><AlertCircle size={14} /> 校验失败</div>}
                                </div>
                                <div className="footer-right">
                                    <button className="cancel-btn" onClick={() => onOpenChange({ open: false })}>取消</button>
                                    <button className="submit-btn" onClick={onSave} disabled={saving}>
                                        {saving ? '保存中...' : '确认保存'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    );
}
