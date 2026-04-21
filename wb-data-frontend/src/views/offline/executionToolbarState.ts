interface ExecuteButtonStateParams {
    activeFlowPath: string | null;
    canWrite: boolean;
}

export function isExecuteButtonDisabled({ activeFlowPath, canWrite }: ExecuteButtonStateParams) {
    return !activeFlowPath || !canWrite;
}
