export function buildExecutionListSearchParams(flowPath: string, requestedBy?: number | null) {
    const params = new URLSearchParams({
        flowPath,
    });
    if (requestedBy != null) {
        params.set('requestedBy', String(requestedBy));
    }
    return params;
}
