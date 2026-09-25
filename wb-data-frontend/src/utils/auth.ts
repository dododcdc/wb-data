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
    /** 区分尚未加载与服务端确认的无组状态。 */
    contextLoaded: boolean;
    /** 登录会话或显式切组意图变化时递增，拒绝旧请求回写。 */
    contextVersion: number;
    switchingGroup: boolean;

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
    contextVersion: 0,
    switchingGroup: false,

    setToken: (token: string) => {
        localStorage.setItem(TOKEN_KEY, token);
        set((state) => ({
            token,
            userInfo: null,
            systemAdmin: false,
            currentGroup: null,
            accessibleGroups: [],
            permissions: [],
            contextLoaded: false,
            contextVersion: state.contextVersion + 1,
            switchingGroup: false,
        }));
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
        set((state) => ({
            token: null,
            userInfo: null,
            systemAdmin: false,
            currentGroup: null,
            accessibleGroups: [],
            permissions: [],
            contextLoaded: false,
            contextVersion: state.contextVersion + 1,
            switchingGroup: false,
        }));
    },
}));

export function getToken(): string | null {
    return useAuthStore.getState().token;
}
