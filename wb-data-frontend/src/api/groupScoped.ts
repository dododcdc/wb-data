export function groupScopedPath(groupId: number, path: string) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `/api/v1/groups/${encodeURIComponent(String(groupId))}${normalizedPath}`;
}

export function omitGroupId<T extends { groupId?: number }>(payload: T): Omit<T, 'groupId'> {
    const rest = { ...payload } as Omit<T, 'groupId'> & { groupId?: number };
    delete rest.groupId;
    return rest;
}
