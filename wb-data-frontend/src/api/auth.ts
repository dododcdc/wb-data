import request from '@/utils/request';
import type { LoginRequest, LoginResponse, AuthContextResponse } from '@/types/auth';

export const login = (data: LoginRequest) => {
    return request.post<unknown, LoginResponse>('/api/v1/auth/login', data);
};

export const getAuthContext = (groupId?: number) => {
    return request.get<unknown, AuthContextResponse>('/api/v1/auth/context', {
        params: groupId != null ? { groupId } : undefined,
    });
};
