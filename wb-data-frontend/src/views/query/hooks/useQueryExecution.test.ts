import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQueryExecution } from './useQueryExecution';

const {
    executeQueryMock,
    createQueryExportTaskMock,
    listQueryExportTasksMock,
    getQueryExportTaskDownloadUrlMock,
    getTokenMock,
} = vi.hoisted(() => ({
    executeQueryMock: vi.fn(),
    createQueryExportTaskMock: vi.fn(),
    listQueryExportTasksMock: vi.fn(),
    getQueryExportTaskDownloadUrlMock: vi.fn((taskId: string) => `/download/${taskId}`),
    getTokenMock: vi.fn(() => 'token-1'),
}));

vi.mock('../../../api/query', () => ({
    executeQuery: executeQueryMock,
    createQueryExportTask: createQueryExportTaskMock,
    listQueryExportTasks: listQueryExportTasksMock,
    getQueryExportTaskDownloadUrl: getQueryExportTaskDownloadUrlMock,
}));

vi.mock('../../../utils/auth', () => ({
    getToken: getTokenMock,
}));

describe('useQueryExecution download feedback', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows user-visible feedback when export download fails', async () => {
        listQueryExportTasksMock.mockResolvedValue([]);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            text: vi.fn().mockResolvedValue('{"message":"下载地址已失效"}'),
        }));

        const showFeedback = vi.fn();
        const params = {
            sql: 'select 1',
            result: null,
            queryError: '',
            loadingQuery: false,
            setResult: vi.fn(),
            setQueryError: vi.fn(),
            setLoadingQuery: vi.fn(),
            setSql: vi.fn(),
            selectedDsId: '1',
            selectedDb: '',
            getActiveDataSource: () => null,
            resultAutoOpen: false,
            resultCollapsed: false,
            setResultPanelState: vi.fn(),
            editorRef: { current: null },
            monacoRef: { current: null },
            showFeedback,
        } as Parameters<typeof useQueryExecution>[0] & { showFeedback: typeof showFeedback };

        const { result } = renderHook(() => useQueryExecution(params));

        await act(async () => {
            await result.current.downloadExportTask('task-1');
        });

        expect(showFeedback).toHaveBeenCalledWith({
            tone: 'error',
            title: '下载失败',
            detail: '下载地址已失效',
        });
    });

    it('falls back to the default message when the server response has no usable text', async () => {
        listQueryExportTasksMock.mockResolvedValue([]);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            text: vi.fn().mockResolvedValue('{"message":"   "}'),
        }));

        const showFeedback = vi.fn();
        const params = {
            sql: 'select 1',
            result: null,
            queryError: '',
            loadingQuery: false,
            setResult: vi.fn(),
            setQueryError: vi.fn(),
            setLoadingQuery: vi.fn(),
            setSql: vi.fn(),
            selectedDsId: '1',
            selectedDb: '',
            getActiveDataSource: () => null,
            resultAutoOpen: false,
            resultCollapsed: false,
            setResultPanelState: vi.fn(),
            editorRef: { current: null },
            monacoRef: { current: null },
            showFeedback,
        } as Parameters<typeof useQueryExecution>[0] & { showFeedback: typeof showFeedback };

        const { result } = renderHook(() => useQueryExecution(params));

        await act(async () => {
            await result.current.downloadExportTask('task-2');
        });

        expect(showFeedback).toHaveBeenCalledWith({
            tone: 'error',
            title: '下载失败',
            detail: '导出文件下载失败，请稍后重试。',
        });
    });
});
