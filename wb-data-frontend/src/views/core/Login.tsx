import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Database, Eye, EyeOff, GitBranch, Loader2, TerminalSquare } from 'lucide-react';

import { login } from '@/api/auth';
import { useAuthStore } from '@/utils/auth';
import { getErrorMessage } from '@/utils/error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
        <div className="login-shell">
            <div className="login-stage">
                {/* 品牌栏：仅桌面端展示，与登录卡片形成对照 */}
                <div className="login-brand">
                    <div className="login-brand-mark">
                        <img src="/favicon.svg" alt="WB Data" />
                        <div>
                            <div className="login-brand-name">WB Data</div>
                            <div className="login-brand-tagline">一站式数据处理中心</div>
                        </div>
                    </div>
                    <div className="login-brand-divider" />
                    <ul className="login-features">
                        <li className="login-feature">
                            <div className="login-feature-icon"><Database /></div>
                            <div>
                                <div className="login-feature-title">自助查询</div>
                                <div className="login-feature-desc">多数据源统一查询，SQL 即查即用</div>
                            </div>
                        </li>
                        <li className="login-feature">
                            <div className="login-feature-icon"><GitBranch /></div>
                            <div>
                                <div className="login-feature-title">离线开发</div>
                                <div className="login-feature-desc">可视化画布编排任务，Git 管理版本</div>
                            </div>
                        </li>
                        <li className="login-feature">
                            <div className="login-feature-icon"><TerminalSquare /></div>
                            <div>
                                <div className="login-feature-title">任务运维</div>
                                <div className="login-feature-desc">调度依赖与执行监控，一处管理</div>
                            </div>
                        </li>
                    </ul>
                </div>

                <div className="login-card">
                    <div className="login-card-header">
                        <div className="login-card-mobile-logo">
                            <img src="/favicon.svg" alt="WB Data" />
                        </div>
                        <div className="login-card-title">WB Data</div>
                        <div className="login-card-desc">一站式数据处理中心</div>
                    </div>

                    <div className="login-card-body">
                        <form
                            className="login-form"
                            noValidate
                            onSubmit={handleSubmit(onSubmit)}
                        >
                            {serverError && (
                                <div className="login-server-error">
                                    {serverError}
                                </div>
                            )}

                            <div className="login-field">
                                <Input
                                    id="username"
                                    type="text"
                                    placeholder="用户名"
                                    autoComplete="username"
                                    autoFocus
                                    aria-label="用户名"
                                    aria-invalid={!!errors.username}
                                    {...register('username')}
                                />
                                {errors.username?.message && (
                                    <p className="login-field-error">{errors.username.message}</p>
                                )}
                            </div>

                            <div className="login-field">
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="密码"
                                        autoComplete="current-password"
                                        aria-label="密码"
                                        aria-invalid={!!errors.password}
                                        className="pr-10"
                                        {...register('password')}
                                    />
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        className="login-password-toggle"
                                        onClick={() => setShowPassword((v) => !v)}
                                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                                    >
                                        {showPassword ? (
                                            <EyeOff className="size-4" />
                                        ) : (
                                            <Eye className="size-4" />
                                        )}
                                    </button>
                                </div>
                                {errors.password?.message && (
                                    <p className="login-field-error">{errors.password.message}</p>
                                )}
                            </div>

                            <Button
                                type="submit"
                                className="login-submit"
                                disabled={isSubmitting}
                            >
                                {isSubmitting && (
                                    <Loader2 className="size-4 animate-spin" />
                                )}
                                {isSubmitting ? '登录中...' : '登录'}
                            </Button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
