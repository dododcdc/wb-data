import { useCallback, useEffect, useState } from 'react';
import './GitSettings.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getGitConfig, saveGitConfig, deleteGitConfig, testGitConnection, type SaveGitConfigPayload } from './gitSettingsApi';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SimpleSelect } from '../../components/SimpleSelect';
import { useOperationFeedback } from '../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../utils/error';
import { LoaderCircle } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';

const PROVIDERS = [
    { value: 'github', label: 'GitHub' },
    { value: 'gitlab', label: 'GitLab' },
    { value: 'gitea', label: 'Gitea' },
];

const DEFAULT_BASE_URL: Record<string, string> = {
    github: 'https://github.com',
    gitlab: 'https://gitlab.com',
    gitea: '',
};

interface GitSettingsTabProps {
    groupId: number;
}

export default function GitSettingsTab({ groupId }: GitSettingsTabProps) {
    const { showFeedback } = useOperationFeedback();
    const [provider, setProvider] = useState('github');
    const [username, setUsername] = useState('');
    const [token, setToken] = useState('');
    const [baseUrl, setBaseUrl] = useState('https://github.com');
    const [testLoading, setTestLoading] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

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
            void queryClient.invalidateQueries({ queryKey: ['git-config', groupId] });
        },
        onError: (e) => {
            showFeedback({ tone: 'error', title: '保存失败', detail: getErrorMessage(e, '保存配置失败，请稍后重试') });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteGitConfig(groupId),
        onSuccess: () => {
            // Close the confirm dialog on successful delete
            setConfirmOpen(false);
            showFeedback({ tone: 'success', title: '删除成功', detail: '' });
            setProvider('github');
            setUsername('');
            setToken('');
            setBaseUrl('https://github.com');
            void queryClient.invalidateQueries({ queryKey: ['git-config', groupId] });
        },
        onError: (e) => {
            showFeedback({ tone: 'error', title: '删除失败', detail: getErrorMessage(e, '删除配置失败，请稍后重试') });
        },
    });

    useEffect(() => {
        if (config) {
            setProvider(config.provider);
            setUsername(config.username);
            setToken('');
            setBaseUrl(config.baseUrl || DEFAULT_BASE_URL[config.provider] || '');
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
            const result = await testGitConnection({ provider, username, token, baseUrl });
            showFeedback({ tone: 'success', title: '连接成功', detail: result });
        } catch (e) {
            showFeedback({ tone: 'error', title: '连接失败', detail: getErrorMessage(e, '连接测试失败，请稍后重试') });
        } finally {
            setTestLoading(false);
        }
    }, [provider, username, token, baseUrl, showFeedback]);

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

    const isGitLabOrGitea = provider === 'gitlab' || provider === 'gitea';

    if (isLoading) {
        return (
            <div className="git-settings-loading">
                <LoaderCircle size={20} className="offline-spin" />
            </div>
        );
    }

    return (
        <div className="git-settings-page">
            <div className="git-settings-header">
                <h2 className="git-settings-title">远程仓库配置</h2>
                {config && (
                    <>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setConfirmOpen(true)}
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                            删除配置
                        </Button>

                        <ConfirmDialog
                            open={confirmOpen}
                            onOpenChange={(open) => {
                                // Prevent closing while delete is pending
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
            </div>

            <div className="git-settings-form">
                <div className="git-settings-row">
                    <label className="git-settings-label">提供商</label>
                    <SimpleSelect
                        value={provider}
                        options={PROVIDERS}
                        onChange={handleProviderChange}
                    />
                </div>

                {isGitLabOrGitea && (
                    <div className="git-settings-row">
                        <label className="git-settings-label">实例地址</label>
                        <Input
                            value={baseUrl}
                            onChange={e => setBaseUrl(e.target.value)}
                            placeholder={provider === 'gitlab' ? 'https://gitlab.example.com' : 'https://gitea.example.com'}
                            className="git-settings-input"
                        />
                    </div>
                )}

                <div className="git-settings-row">
                    <label className="git-settings-label">用户名</label>
                    <Input
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="GitHub / GitLab 用户名"
                        className="git-settings-input"
                    />
                </div>

                <div className="git-settings-row">
                    <label className="git-settings-label">Access Token</label>
                    <Input
                        type="password"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        placeholder={config?.tokenMasked ? `已保存（填新值可更新）` : '填入新的 Token'}
                        className="git-settings-input"
                    />
                </div>

                <div className="git-settings-actions">
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
                </div>
            </div>
        </div>
    );
}
