import { useCallback, useEffect, useState } from 'react';
import './GitSettings.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    getGitConfig,
    saveGitConfig,
    deleteGitConfig,
    testGitConnection,
    type SaveGitConfigPayload,
} from './gitSettingsApi';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SimpleSelect } from '../../components/SimpleSelect';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { LoaderCircle } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';

const PROVIDERS = [
    { value: 'github', label: 'GitHub' },
    { value: 'gitlab', label: 'GitLab' },
];

const DEFAULT_BASE_URL: Record<string, string> = {
    github: 'https://github.com',
    gitlab: 'https://gitlab.com',
};

interface GitSettingsTabProps {
    groupId: number;
    canEdit: boolean;
}

export default function GitSettingsTab({ groupId, canEdit }: GitSettingsTabProps) {
    const { showFeedback } = useOperationFeedback();
    const [provider, setProvider] = useState('github');
    const [username, setUsername] = useState('');
    const [token, setToken] = useState('');
    const [baseUrl, setBaseUrl] = useState('https://github.com');
    const [testLoading, setTestLoading] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [configEditing, setConfigEditing] = useState(false);

    const queryClient = useQueryClient();

    const { data: config, isLoading } = useQuery({
        queryKey: ['git-config', groupId],
        queryFn: () => getGitConfig(groupId),
        enabled: groupId != null,
    });

    const saveMutation = useMutation({
        mutationFn: (payload: SaveGitConfigPayload) => saveGitConfig(groupId, payload),
        onSuccess: () => {
            showFeedback({ tone: 'success', title: '保存成功', detail: '' });
            setToken('');
            setConfigEditing(false);
            void queryClient.invalidateQueries({ queryKey: ['git-config', groupId] });
            void queryClient.invalidateQueries({ queryKey: ['git-sync-config', groupId] });
        },
        onError: () => {
            showFeedback({ tone: 'error', title: '保存失败', detail: '' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteGitConfig(groupId),
        onSuccess: () => {
            setConfirmOpen(false);
            showFeedback({ tone: 'success', title: '删除成功', detail: '' });
            setProvider('github');
            setUsername('');
            setToken('');
            setBaseUrl('https://github.com');
            setConfigEditing(false);
            void queryClient.invalidateQueries({ queryKey: ['git-config', groupId] });
            void queryClient.invalidateQueries({ queryKey: ['git-sync-config', groupId] });
        },
        onError: () => {
            showFeedback({ tone: 'error', title: '删除失败', detail: '' });
        },
    });

    useEffect(() => {
        if (config) {
            setProvider(config.provider);
            setUsername(config.username);
            setToken('');
            setBaseUrl(config.baseUrl || DEFAULT_BASE_URL[config.provider] || '');
            setConfigEditing(false);
        }
    }, [config]);

    const handleProviderChange = useCallback((v: string) => {
        setProvider(v);
        setBaseUrl(DEFAULT_BASE_URL[v] || '');
        setToken('');
    }, []);

    const handleTest = useCallback(async () => {
        if (!username || !token) {
            showFeedback({ tone: 'error', title: '请填写用户名和 Token', detail: '' });
            return;
        }
        setTestLoading(true);
        try {
            await testGitConnection(groupId, { provider, username, token, baseUrl });
            showFeedback({ tone: 'success', title: '连接成功', detail: '' });
        } catch {
            showFeedback({ tone: 'error', title: '连接失败', detail: '' });
        } finally {
            setTestLoading(false);
        }
    }, [provider, username, token, baseUrl, showFeedback, groupId]);

    const handleSave = useCallback(async () => {
        if (!username) {
            showFeedback({ tone: 'error', title: '请填写用户名', detail: '' });
            return;
        }
        if (!token && !config?.tokenMasked) {
            showFeedback({ tone: 'error', title: '请填写 Token', detail: '' });
            return;
        }
        const payload: SaveGitConfigPayload = { provider, username, token, baseUrl };
        saveMutation.mutate(payload);
    }, [provider, username, token, baseUrl, config, saveMutation, showFeedback]);

    const isGitLab = provider === 'gitlab';
    const providerLabel = PROVIDERS.find(p => p.value === provider)?.label ?? provider;
    const showConfigForm = canEdit && (!config || configEditing);
    const resetConfigForm = useCallback(() => {
        if (config) {
            setProvider(config.provider);
            setUsername(config.username);
            setToken('');
            setBaseUrl(config.baseUrl || DEFAULT_BASE_URL[config.provider] || '');
        } else {
            setProvider('github');
            setUsername('');
            setToken('');
            setBaseUrl(DEFAULT_BASE_URL.github);
        }
    }, [config]);

    const handleCancelConfigEdit = useCallback(() => {
        resetConfigForm();
        setConfigEditing(false);
    }, [resetConfigForm]);

    if (isLoading) {
        return (
            <div className="git-settings-loading">
                <LoaderCircle size={20} className="offline-spin" />
            </div>
        );
    }

    return (
        <div className="git-settings-page">
            <section className="git-settings-section">
                <div className="git-settings-section-header">
                    <div>
                        <h2 className="git-settings-title">连接配置</h2>
                        <p className="git-settings-description">配置项目组同步离线仓库使用的 Git 凭证。</p>
                    </div>
                </div>

                {!config && !canEdit ? (
                    <p className="git-settings-ro-empty">尚未配置远程仓库</p>
                ) : !showConfigForm ? (
                    <div className="git-settings-config-summary">
                        <div className="git-settings-ro-table">
                            <div className="git-settings-ro-row">
                                <span className="git-settings-ro-label">提供商</span>
                                <span className="git-settings-ro-value">{providerLabel}</span>
                            </div>
                            {baseUrl && baseUrl !== DEFAULT_BASE_URL[provider] && (
                                <div className="git-settings-ro-row">
                                    <span className="git-settings-ro-label">实例地址</span>
                                    <span className="git-settings-ro-value">{baseUrl}</span>
                                </div>
                            )}
                            <div className="git-settings-ro-row">
                                <span className="git-settings-ro-label">用户名</span>
                                <span className="git-settings-ro-value">{username}</span>
                            </div>
                            <div className="git-settings-ro-row">
                                <span className="git-settings-ro-label">Access Token</span>
                                <span className={config?.tokenMasked ? 'git-settings-token-badge' : 'git-settings-token-badge git-settings-token-badge-empty'}>
                                    {config?.tokenMasked ? '已配置' : '未配置'}
                                </span>
                            </div>
                        </div>
                        {canEdit ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setConfigEditing(true)}
                            >
                                编辑配置
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <>
                        <div className="git-settings-form">
                            <div className="git-settings-fields">
                                <div className="git-settings-row">
                                    <label className="git-settings-label">提供商</label>
                                    <SimpleSelect
                                        value={provider}
                                        options={PROVIDERS}
                                        onChange={handleProviderChange}
                                        className="w-full"
                                    />
                                </div>

                                {isGitLab && (
                                    <div className="git-settings-row">
                                        <label className="git-settings-label">实例地址</label>
                                        <Input
                                            value={baseUrl}
                                            onChange={e => setBaseUrl(e.target.value)}
                                            placeholder="https://gitlab.example.com"
                                            className="w-full"
                                        />
                                    </div>
                                )}

                                <div className="git-settings-row">
                                    <label className="git-settings-label">用户名</label>
                                    <Input
                                        value={username}
                                        onChange={e => setUsername(e.target.value)}
                                        placeholder="GitHub / GitLab 用户名"
                                        className="w-full"
                                    />
                                </div>

                                <div className="git-settings-row">
                                    <label className="git-settings-label">Access Token</label>
                                    <Input
                                        type="password"
                                        value={token}
                                        onChange={e => setToken(e.target.value)}
                                        placeholder={config?.tokenMasked ? `已保存（填新值可更新）` : '填入新的 Token'}
                                        className="w-full"
                                    />
                                </div>
                            </div>

                            <div className="git-settings-actions">
                                <div className="git-settings-primary-actions">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleTest}
                                        disabled={testLoading}
                                    >
                                        {testLoading ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        测试连接
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={saveMutation.isPending}
                                    >
                                        {saveMutation.isPending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        保存配置
                                    </Button>
                                    {config ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleCancelConfigEdit}
                                            disabled={saveMutation.isPending}
                                        >
                                            取消
                                        </Button>
                                    ) : null}
                                </div>
                                {config && (
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => setConfirmOpen(true)}
                                        disabled={deleteMutation.isPending}
                                    >
                                        {deleteMutation.isPending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                                        删除配置
                                    </Button>
                                )}
                            </div>
                        </div>

                        <ConfirmDialog
                            open={confirmOpen}
                            onOpenChange={(open) => {
                                if (!open && deleteMutation.isPending) return;
                                setConfirmOpen(open);
                            }}
                            title="删除 Git 配置"
                            description={
                                <>
                                    删除后如需再次使用需重新填写凭证。
                                    {config ? (
                                        <>
                                            <br />
                                            <span>
                                                配置: {config.provider}
                                                {config.username ? `，用户 ${config.username}` : ''}
                                            </span>
                                        </>
                                    ) : null}
                                </>
                            }
                            variant="destructive"
                            onConfirm={() => {
                                deleteMutation.mutate();
                            }}
                            isLoading={deleteMutation.isPending}
                        />
                    </>
                )}
            </section>
        </div>
    );
}
