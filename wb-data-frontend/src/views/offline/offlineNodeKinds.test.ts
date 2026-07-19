import { describe, expect, it } from 'vitest';

import {
    getAllowedDataSourceTypes,
    getOfflineNodeDefaultScript,
    getOfflineNodeKindDescription,
    getOfflineNodeKindLabel,
    getOfflineNodeScriptExtension,
    isOfflineFlowNodeKind,
} from './offlineNodeKinds';

describe('offline node kinds', () => {
    it('recognizes transfer nodes and exposes scriptless helper defaults', () => {
        expect(isOfflineFlowNodeKind('TRANSFER')).toBe(true);
        expect(getOfflineNodeKindLabel('TRANSFER')).toBe('Transfer');
        expect(getOfflineNodeKindDescription('TRANSFER')).toBe('数据传输节点');
        expect(getAllowedDataSourceTypes('TRANSFER')).toEqual([]);
        expect(getOfflineNodeScriptExtension('TRANSFER')).toBe('');
        expect(getOfflineNodeDefaultScript('TRANSFER')).toBe('');
    });
});
