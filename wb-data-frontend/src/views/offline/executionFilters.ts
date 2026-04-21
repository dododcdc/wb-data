export function buildExecutionListSearchParams(groupId: number, flowPath: string, requestedBy?: number | null) {
    const params = new URLSearchParams({
        groupId: String(groupId),
        flowPath,
    });
    if (requestedBy != null) {
        params.set('requestedBy', String(requestedBy));
    }
    return params;
}
