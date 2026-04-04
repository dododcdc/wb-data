import { useQuery } from '@tanstack/react-query';
import { getAuthContext } from '@/api/auth';
import { useAuthStore } from '@/utils/auth';

export const AUTH_CONTEXT_QUERY_KEY = ['auth', 'context'] as const;

export function useAuthContext(groupId?: number) {
    const token = useAuthStore((s) => s.token);

    return useQuery({
        queryKey: [...AUTH_CONTEXT_QUERY_KEY, groupId],
        queryFn: () => getAuthContext(groupId),
        enabled: !!token,
        staleTime: 5 * 60 * 1000,
    });
}
