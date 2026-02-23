import { create } from 'zustand';

interface UserState {
    userInfo: {
        username: string;
        role: string;
    } | null;
    setUserInfo: (info: { username: string; role: string }) => void;
    logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
    userInfo: { username: 'Admin', role: 'admin' }, // Mocking logged in user
    setUserInfo: (info) => set({ userInfo: info }),
    logout: () => set({ userInfo: null }),
}));
