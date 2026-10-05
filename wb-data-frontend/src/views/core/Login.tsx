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
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';

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
        <div
            className="flex min-h-svh items-center justify-center p-4"
            style={{
                background: 'radial-gradient(circle at top left, rgba(217, 119, 87, 0.08), transparent 30%), #f3f1ec',
            }}
        >
            <div className="flex w-full max-w-[860px] items-stretch justify-center">
                {/* 品牌栏：仅桌面端展示，与登录卡片形成对照 */}
                <div className="hidden flex-1 flex-col justify-center gap-8 pr-12 md:flex">
                    <div className="flex items-center gap-3">
                        <img src="/favicon.svg" alt="WB Data" className="size-10" />
                        <div>
                            <div className="text-xl font-bold tracking-tight">WB Data</div>
                            <div className="text-sm text-muted-foreground">一站式数据处理中心</div>
                        </div>
                    </div>
                    <ul className="flex flex-col gap-4">
                        <li className="flex items-start gap-3">
                            <Database className="mt-0.5 size-4 shrink-0 text-[#d97757]" />
                            <div>
                                <div className="text-sm font-medium">自助查询</div>
                                <div className="text-xs text-muted-foreground">多数据源统一查询，SQL 即查即用</div>
                            </div>
                        </li>
                        <li className="flex items-start gap-3">
                            <GitBranch className="mt-0.5 size-4 shrink-0 text-[#d97757]" />
                            <div>
                                <div className="text-sm font-medium">离线开发</div>
                                <div className="text-xs text-muted-foreground">可视化画布编排任务，Git 管理版本</div>
                            </div>
                        </li>
                        <li className="flex items-start gap-3">
                            <TerminalSquare className="mt-0.5 size-4 shrink-0 text-[#d97757]" />
                            <div>
                                <div className="text-sm font-medium">任务运维</div>
                                <div className="text-xs text-muted-foreground">调度依赖与执行监控，一处管理</div>
                            </div>
                        </li>
                    </ul>
                </div>

                <Card className="w-full max-w-[400px] border bg-card shadow-sm">
                    <CardHeader className="pb-4 text-center">
                        <div className="mb-2 flex items-center justify-center gap-2.5 md:hidden">
                            <img src="/favicon.svg" alt="WB Data" className="size-8" />
                        </div>
                        <CardTitle className="text-2xl font-bold tracking-tight">
                            WB Data
                        </CardTitle>
                        <CardDescription>一站式数据处理中心</CardDescription>
                    </CardHeader>

                    <CardContent>
                        <form
                            className="flex flex-col gap-4"
                            noValidate
                            onSubmit={handleSubmit(onSubmit)}
                        >
                            {serverError && (
                                <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    {serverError}
                                </div>
                            )}

                            <div className="flex flex-col gap-1.5">
                                <Input
                                    id="username"
                                    type="text"
                                    placeholder="用户名"
                                    autoComplete="username"
                                    autoFocus
                                    aria-label="用户名"
                                    aria-invalid={!!errors.username}
                                    className="h-11"
                                    {...register('username')}
                                />
                                {errors.username?.message && (
                                    <p className="text-xs text-destructive">{errors.username.message}</p>
                                )}
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="密码"
                                        autoComplete="current-password"
                                        aria-label="密码"
                                        aria-invalid={!!errors.password}
                                        className="h-11 pr-10"
                                        {...register('password')}
                                    />
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
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
                                    <p className="text-xs text-destructive">{errors.password.message}</p>
                                )}
                            </div>

                            <Button
                                type="submit"
                                className="mt-1 h-11 w-full text-base font-semibold"
                                disabled={isSubmitting}
                            >
                                {isSubmitting && (
                                    <Loader2 className="size-4 animate-spin" />
                                )}
                                {isSubmitting ? '登录中...' : '登录'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
