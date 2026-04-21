type Edge = { source: string; target: string };

type Input = { nodeIds: string[]; edges: Edge[] };

import { hasImplicitDependenciesAfterSaveRoundTrip } from './implicitDependencyValidation';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';

export function validateSaveFlowDependencies({ nodeIds, edges }: Input): { allowed: boolean; feedback: FeedbackPayload | null } {
    const hasImplicit = hasImplicitDependenciesAfterSaveRoundTrip({ nodeIds, edges });
    if (hasImplicit) {
        return {
            allowed: false,
            feedback: {
                tone: 'error',
                title: '保存失败',
                detail: '当前 Flow 存在未明确配置的依赖关系，请先在画布中补全依赖线后再保存。',
            },
        };
    }
    return { allowed: true, feedback: null };
}
