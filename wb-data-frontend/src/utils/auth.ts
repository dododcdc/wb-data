import { create } from 'zustand';
import type { CurrentUser } from '@/types/auth';

const TOKEN_KEY = 'wb_access_token';

interface AuthState {
    token: string | null;
    userInfo: CurrentUser | null;
    setToken: (token: string) => void;
    setUserInfo: (user: CurrentUser) => void;
    clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    token: localStorage.getItem(TOKEN_KEY),
    userInfo: null,

    setToken: (token: string) => {
        localStorage.setItem(TOKEN_KEY, token);
        set({ token });
    },

    setUserInfo: (userInfo: CurrentUser) => {
        set({ userInfo });
    },

    clearAuth: () => {
        localStorage.removeItem(TOKEN_KEY);
        set({ token: null, userInfo: null });
    },
}));

export function getToken(): string | null {
    return useAuthStore.getState().token;
}
