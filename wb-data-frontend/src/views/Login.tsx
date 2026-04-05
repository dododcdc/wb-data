import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { login, getAuthContext } from '@/api/auth';
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
    const token = useAuthStore((s) => s.token);
    const [showPassword, setShowPassword] = useState(false);
    const [serverError, setServerError] = useState('');

    if (token) {
        navigate('/', { replace: true });
        return null;
    }

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: { username: '', password: '' },
        reValidateMode: 'onChange',
    });

    async function onSubmit(values: LoginFormValues) {
        setServerError('');
        try {
            const res = await login(values);
            useAuthStore.getState().setToken(res.accessToken);
            useAuthStore.getState().setUserInfo(res.user);

            const ctx = await getAuthContext();
            useAuthStore.getState().setAuthContext(ctx);

            navigate('/', { replace: true });
        } catch (error) {
            setServerError(getErrorMessage(error, '登录失败，请稍后重试'));
        }
    }

    return (
        <div className="flex min-h-svh items-start justify-center bg-muted/50 p-4 pt-[15vh] sm:items-center sm:pt-4">
            <Card className="w-full max-w-[380px] shadow-lg">
                <CardHeader className="pb-4 text-center">
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

                        <div className="flex flex-col">
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
                        </div>

                        <div className="flex flex-col">
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
    );
}
