import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';

import { login } from '@/api/auth';
import { useAuthStore } from '@/utils/auth';
import { getErrorMessage } from '@/utils/error';
import './Login.css';

const loginSchema = z.object({
    username: z
        .string({ error: '请输入用户名' })
        .min(1, '请输入用户名')
        .max(64, '用户名不能超过 64 个字符'),
    password: z
        .string({ error: '请输入密码' })
        .min(1, '请输入密码'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
    const navigate = useNavigate();
    const location = useLocation();
    const token = useAuthStore((s) => s.token);
    const [showPassword, setShowPassword] = useState(false);
    const [serverError, setServerError] = useState('');

    const redirectPath = useMemo(() => {
        const from = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
        if (!from) return '/';
        const target = `${from.pathname || ''}${from.search || ''}${from.hash || ''}`;
        return target.startsWith('/login') || !target.startsWith('/') ? '/' : target;
    }, [location.state]);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: { username: '', password: '' },
        reValidateMode: 'onChange',
    });

    useEffect(() => {
        if (token) {
            navigate(redirectPath, { replace: true });
        }
    }, [token, navigate, redirectPath]);

    if (token) return null;

    async function onSubmit(values: LoginFormValues) {
        setServerError('');
        try {
            const res = await login(values);
            useAuthStore.getState().setToken(res.accessToken);
            useAuthStore.getState().setUserInfo(res.user);

            // AuthGuard owns the initial context load as well as later refreshes.
            navigate(redirectPath, { replace: true });
        } catch (error) {
            setServerError(getErrorMessage(error, '登录失败，请稍后重试'));
        }
    }

    return (
        <main className="login-viewport">
            <section className="login-card" aria-labelledby="login-heading">
                <header className="login-header">
                    <h1 id="login-heading" className="login-title">
                        登录 WB Data
                    </h1>
                    <p className="login-subtitle">
                        一站式数据研发、自助查询与离线调度中心
                    </p>
                </header>

                <form onSubmit={handleSubmit(onSubmit)} className="login-form" noValidate>
                    {serverError && (
                        <div className="login-alert" role="alert">
                            <AlertCircle size={16} className="login-alert__icon" aria-hidden="true" />
                            <span>{serverError}</span>
                        </div>
                    )}

                    <div className="login-field-group">
                        <label htmlFor="username" className="login-label">
                            用户名
                        </label>
                        <div className={`login-input-wrap ${errors.username ? 'is-error' : ''}`}>
                            <input
                                id="username"
                                type="text"
                                aria-label="用户名"
                                aria-invalid={!!errors.username}
                                aria-describedby={errors.username ? 'username-error' : undefined}
                                autoComplete="username"
                                autoFocus
                                disabled={isSubmitting}
                                className="login-input"
                                {...register('username')}
                            />
                        </div>
                        {errors.username?.message && (
                            <p id="username-error" className="login-error-text" role="alert">
                                {errors.username.message}
                            </p>
                        )}
                    </div>

                    <div className="login-field-group">
                        <label htmlFor="password" className="login-label">
                            密码
                        </label>
                        <div className={`login-input-wrap ${errors.password ? 'is-error' : ''}`}>
                            <input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                aria-label="密码"
                                aria-invalid={!!errors.password}
                                aria-describedby={errors.password ? 'password-error' : undefined}
                                autoComplete="current-password"
                                disabled={isSubmitting}
                                className="login-input login-input--password"
                                {...register('password')}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((prev) => !prev)}
                                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                                aria-pressed={showPassword}
                                className="login-eye-btn"
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        {errors.password?.message && (
                            <p id="password-error" className="login-error-text" role="alert">
                                {errors.password.message}
                            </p>
                        )}
                    </div>

                    <button type="submit" disabled={isSubmitting} className="login-submit-btn">
                        {isSubmitting ? (
                            <>
                                <Loader2 size={16} className="login-spinner" aria-hidden="true" />
                                <span>登录中...</span>
                            </>
                        ) : (
                            <>
                                <span>登录</span>
                                <ArrowRight size={16} className="login-submit-arrow" aria-hidden="true" />
                            </>
                        )}
                    </button>
                </form>

                <footer className="login-footer">
                    <span>如需开通账号或重置密码，请联系项目组或系统管理员</span>
                </footer>
            </section>
        </main>
    );
}
