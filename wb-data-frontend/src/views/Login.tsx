import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { login } from '@/api/auth';
import { useAuthStore } from '@/utils/auth';
import './Login.css';

export default function Login() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await login({ username, password });
            useAuthStore.getState().setToken(res.accessToken);
            useAuthStore.getState().setUserInfo(res.user);
            navigate('/', { replace: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : '登录失败，请重试';
            setError(message);
            setPassword('');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">
                        <Layers size={20} />
                    </div>
                    <h1 className="login-title">WB Data</h1>
                </div>
                <p className="login-subtitle">登录 WB Data</p>
                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="login-field">
                        <span className="login-label">用户名</span>
                        <input
                            className="login-input"
                            type="text"
                            placeholder="请输入用户名"
                            autoComplete="username"
                            autoFocus
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>
                    <div className="login-field">
                        <span className="login-label">密码</span>
                        <input
                            className="login-input"
                            type="password"
                            placeholder="请输入密码"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    {error && <div className="login-error">{error}</div>}
                    <button
                        className="login-button"
                        type="submit"
                        disabled={loading || !username || !password}
                    >
                        {loading ? '登录中...' : '登录'}
                    </button>
                </form>
            </div>
        </div>
    );
}
