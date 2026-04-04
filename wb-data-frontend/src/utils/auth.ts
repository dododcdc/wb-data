import { create } from 'zustand';
import type {
    CurrentUser,
    ProjectGroupContextItem,
    AuthContextResponse,
} from '@/types/auth';

const TOKEN_KEY = 'wb_access_token';

interface AuthState {
    token: string | null;
    userInfo: CurrentUser | null;

    systemAdmin: boolean;
    currentGroup: ProjectGroupContextItem | null;
    accessibleGroups: ProjectGroupContextItem[];
    permissions: string[];
    /** 区分"尚未请求"与"请求后确实为空"，AuthGuard 依赖此字段决定是否发起请求 */
    contextLoaded: boolean;

    setToken: (token: string) => void;
    setUserInfo: (user: CurrentUser) => void;
    setAuthContext: (ctx: AuthContextResponse) => void;
    clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    token: localStorage.getItem(TOKEN_KEY),
    userInfo: null,
    systemAdmin: false,
    currentGroup: null,
    accessibleGroups: [],
    permissions: [],
    contextLoaded: false,

    setToken: (token: string) => {
        localStorage.setItem(TOKEN_KEY, token);
        set({ token });
    },

    setUserInfo: (userInfo: CurrentUser) => {
        set({ userInfo });
    },

    setAuthContext: (ctx: AuthContextResponse) => {
        set({
            userInfo: ctx.user,
            systemAdmin: ctx.systemAdmin,
            currentGroup: ctx.currentGroup,
            accessibleGroups: ctx.accessibleGroups,
            permissions: ctx.permissions,
            contextLoaded: true,
        });
    },

    clearAuth: () => {
        localStorage.removeItem(TOKEN_KEY);
        set({
            token: null,
            userInfo: null,
            systemAdmin: false,
            currentGroup: null,
            accessibleGroups: [],
            permissions: [],
            contextLoaded: false,
        });
    },
}));

export function getToken(): string | null {
    return useAuthStore.getState().token;
}
