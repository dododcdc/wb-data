import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '@/api/auth'
import { useAuthStore } from '@/utils/auth'
import { Layers } from 'lucide-react'
import './Login.css'

export default function Login() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const res = await login({ username, password })
            useAuthStore.getState().setToken(res.accessToken)
            navigate('/', { replace: true })
        } catch (err) {
            const message = err instanceof Error ? err.message : '登录失败，请重试'
            setError(message)
            setPassword('')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-logo">
                    <div className="logo-wrapper">
                        <Layers size={18} className="logo-icon" />
                    </div>
                    <h2 className="login-title">WB Data</h2>
                </div>
                <p className="login-subtitle">登录 WB Data</p>
                
                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="login-field">
                        <span className="login-label">用户名</span>
                        <input
                            className="login-input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="用户名"
                            autoComplete="username"
                            autoFocus
                        />
                    </div>
                    <div className="login-field">
                        <span className="login-label">密码</span>
                        <input
                            type="password"
                            className="login-input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="密码"
                            autoComplete="current-password"
                        />
                    </div>
                    
                    {error && <div className="login-error">{error}</div>}
                    
                    <button
                        type="submit"
                        className="login-button"
                        disabled={loading || !username || !password}
                    >
                        {loading ? '登录中...' : '登录'}
                    </button>
                </form>
            </div>
        </div>
    )
}
