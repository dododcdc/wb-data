interface ResolveSelectionStateAfterAddingNodeParams {
    currentSelectedTaskIds: string[];
    newTaskId: string;
}

interface NodeSelectionStateAfterAddingNode {
    nextActiveNodeId: string;
    nextSelectedTaskIds: string[];
}

export function resolveSelectionStateAfterAddingNode(
    params: ResolveSelectionStateAfterAddingNodeParams
): NodeSelectionStateAfterAddingNode {
    const { currentSelectedTaskIds, newTaskId } = params;

    return {
        nextActiveNodeId: newTaskId,
        nextSelectedTaskIds: [...currentSelectedTaskIds],
    };
}
