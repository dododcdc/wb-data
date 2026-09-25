import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { getAuthContext, selectGroupContext } from '@/api/auth';
import { useAuthStore } from '@/utils/auth';
import { AUTH_CONTEXT_REFRESH_EVENT } from '@/utils/request';

export const AUTH_CONTEXT_QUERY_KEY = ['auth', 'context'] as const;

export function refreshAuthContext(queryClient: QueryClient) {
    return queryClient.invalidateQueries(
        { queryKey: AUTH_CONTEXT_QUERY_KEY },
        { cancelRefetch: false },
    );
}

export async function selectAuthGroup(queryClient: QueryClient, groupId: number) {
    const snapshot = useAuthStore.getState();
    if (!snapshot.token || groupId === snapshot.currentGroup?.id) return false;
    const version = snapshot.contextVersion + 1;
    useAuthStore.setState({ contextVersion: version, switchingGroup: true });
    void queryClient.cancelQueries({ queryKey: AUTH_CONTEXT_QUERY_KEY });
    const isCurrent = () => {
        const state = useAuthStore.getState();
        return state.token === snapshot.token && state.contextVersion === version
            && state.currentGroup?.id === snapshot.currentGroup?.id;
    };
    try {
        const context = await selectGroupContext(groupId);
        if (!isCurrent()) return false;
        useAuthStore.getState().setAuthContext(context);
        return true;
    } catch (error) {
        if (!isCurrent()) return false;
        throw error;
    } finally {
        const state = useAuthStore.getState();
        if (state.token === snapshot.token && state.contextVersion === version) {
            useAuthStore.setState({ switchingGroup: false });
        }
    }
}

export function useAuthContext() {
    const token = useAuthStore((s) => s.token);
    const version = useAuthStore((s) => s.contextVersion);
    const groupId = useAuthStore((s) => s.currentGroup?.id);
    const switchingGroup = useAuthStore((s) => s.switchingGroup);
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: [...AUTH_CONTEXT_QUERY_KEY, version, token, groupId],
        queryFn: async ({ signal }) => {
            const isCurrent = () => {
                const state = useAuthStore.getState();
                return !signal.aborted && state.token === token && state.contextVersion === version
                    && state.currentGroup?.id === groupId && !state.switchingGroup;
            };
            try {
                const context = await getAuthContext(groupId, signal);
                if (isCurrent()) useAuthStore.getState().setAuthContext(context);
                return context;
            } catch (error) {
                if (isCurrent() && isAxiosError(error)
                    && (error.response?.status === 403 || error.response?.status === 404)) {
                    // Unscoped refresh lets the server choose a fallback without ending the session.
                    useAuthStore.setState((state) => ({
                        currentGroup: null,
                        permissions: [],
                        systemAdmin: false,
                        accessibleGroups: groupId == null ? [] : state.accessibleGroups.filter((group) => group.id !== groupId),
                    }));
                }
                throw error;
            }
        },
        enabled: !!token && !switchingGroup,
        staleTime: 30_000,
        refetchOnMount: 'always',
        refetchOnWindowFocus: 'always',
        refetchInterval: 60_000,
        refetchIntervalInBackground: true,
        retry: false,
    });

    useEffect(() => {
        if (!token || switchingGroup) return;
        const refresh = () => { void refreshAuthContext(queryClient); };
        window.addEventListener(AUTH_CONTEXT_REFRESH_EVENT, refresh);
        window.addEventListener('focus', refresh);
        return () => {
            window.removeEventListener(AUTH_CONTEXT_REFRESH_EVENT, refresh);
            window.removeEventListener('focus', refresh);
        };
    }, [queryClient, switchingGroup, token]);

    return query;
}
