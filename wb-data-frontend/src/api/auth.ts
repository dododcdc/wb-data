import request from '@/utils/request';
import type { LoginRequest, LoginResponse, AuthContextResponse } from '@/types/auth';

export const login = (data: LoginRequest) => {
    return request.post<unknown, LoginResponse>('/api/v1/auth/login', data);
};

export const logout = () => {
    return request.post<unknown, void>('/api/v1/auth/logout');
};

export const getAuthContext = (groupId?: number, signal?: AbortSignal) => {
    return request.get<unknown, AuthContextResponse>('/api/v1/auth/context', {
        params: groupId != null ? { groupId } : undefined,
        signal,
    });
};

export const selectGroupContext = (groupId: number) => {
    return request.post<unknown, AuthContextResponse>('/api/v1/auth/context', undefined, {
        params: { groupId },
    });
};
