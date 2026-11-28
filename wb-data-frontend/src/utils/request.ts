import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from './auth';
import { getActiveOfflineBranchForRequest } from './offlineBranchStore';

export const AUTH_CONTEXT_REFRESH_EVENT = 'wbdata:auth-context-refresh';

const GROUP_OFFLINE_PATH_RE = /\/api\/v1\/groups\/(\d+)\/offline(?:\/|$)/;
const LEGACY_OFFLINE_PATH_RE = /\/api\/v1\/offline(?:\/|$)/;

function resolveOfflineRequestGroupId(url: string | undefined, currentGroupId: number | undefined): number | null {
    if (!url) {
        return null;
    }
    const groupMatch = GROUP_OFFLINE_PATH_RE.exec(url);
    if (groupMatch) {
        const parsed = Number(groupMatch[1]);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (LEGACY_OFFLINE_PATH_RE.test(url) && typeof currentGroupId === 'number' && currentGroupId > 0) {
        return currentGroupId;
    }
    return null;
}

const request = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    timeout: 10000,
});

// Keep the dispatch-time session/group, not whichever session receives the response.
const requestScopes = new WeakMap<InternalAxiosRequestConfig, {
    token: string | null;
    contextVersion: number;
    groupId: number | undefined;
}>();

request.interceptors.request.use(
    (config) => {
        const { token, contextVersion, currentGroup } = useAuthStore.getState();
        requestScopes.set(config, { token, contextVersion, groupId: currentGroup?.id });
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        const offlineGroupId = resolveOfflineRequestGroupId(config.url, currentGroup?.id);
        if (offlineGroupId !== null && !config.headers['X-Offline-Branch']) {
            const activeBranch = getActiveOfflineBranchForRequest(offlineGroupId);
            if (activeBranch) {
                config.headers['X-Offline-Branch'] = activeBranch;
            }
        }
        return config;
    },
    (error) => Promise.reject(error)
);

request.interceptors.response.use(
    (response) => {
        if (response.config.responseType === 'blob') {
            return response.data;
        }
        const res = response.data;
        if (res.code === 200 || res.code === 0 || res.success) {
            return res.data;
        }
        return Promise.reject(new Error(res.message || 'Error occurred'));
    },
    (error) => {
        const scope = error.config && requestScopes.get(error.config);
        const state = useAuthStore.getState();
        const isCurrentSession = scope?.token && scope.token === state.token && scope.contextVersion === state.contextVersion;
        const url = error.config?.url || '';
        if (isCurrentSession && error.response?.status === 401 && !url.includes('/auth/login')) {
            state.clearAuth();
            window.location.href = '/login';
        } else if (isCurrentSession && scope.groupId === state.currentGroup?.id
            && error.response?.status === 403 && !url.includes('/auth/context')) {
            // Refresh the active query once; do not replay the forbidden operation.
            window.dispatchEvent(new Event(AUTH_CONTEXT_REFRESH_EVENT));
        }
        return Promise.reject(error);
    }
);

export default request;
