import { create } from 'zustand';

const TOKEN_KEY = 'wb_access_token';

interface AuthState {
    token: string | null;
    setToken: (token: string) => void;
    clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    token: localStorage.getItem(TOKEN_KEY),

    setToken: (token: string) => {
        localStorage.setItem(TOKEN_KEY, token);
        set({ token });
    },

    clearAuth: () => {
        localStorage.removeItem(TOKEN_KEY);
        set({ token: null });
    },
}));

export function getToken(): string | null {
    return useAuthStore.getState().token;
}
