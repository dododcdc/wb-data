import { describe, expect, it } from 'vitest';

import { validateSaveFlowDependencies } from './saveFlowDependencyValidation';

describe('validateSaveFlowDependencies', () => {
    it('blocks save with generic feedback when implicit dependencies exist', () => {
        expect(validateSaveFlowDependencies({
            nodeIds: ['a', 'b', 'c'],
            edges: [{ source: 'a', target: 'b' }],
        })).toEqual({
            allowed: false,
            feedback: {
                tone: 'error',
                title: '保存失败',
                detail: '当前 Flow 存在未明确配置的依赖关系，请先在画布中补全依赖线后再保存。',
            },
        });
    });

    it('allows save when no implicit dependencies would be introduced', () => {
        expect(validateSaveFlowDependencies({
            nodeIds: ['a', 'b', 'c'],
            edges: [
                { source: 'a', target: 'b' },
                { source: 'c', target: 'b' },
            ],
        })).toEqual({ allowed: true, feedback: null });
    });
});
