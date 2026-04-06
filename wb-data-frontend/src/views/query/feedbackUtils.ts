/**
 * Query 页面反馈状态构建工具
 */

import { QueryFeedbackState } from './types';
import { QUERY_EXECUTION_TIMEOUT_MS } from './queryConstants';
import { QueryResult } from '../../api/query';

// ==================== 类型 ====================

export interface QueryFeedback {
    state: QueryFeedbackState;
    toneClass: string;
    label: string;
    summary: string;
    title: string;
    description: string;
}

// ==================== 反馈构建 ====================

export function buildQueryFeedback({
    result,
    queryError,
    loadingQuery,
    queryLoadingVisible,
}: {
    result: QueryResult | null;
    queryError: string | null;
    loadingQuery: boolean;
    queryLoadingVisible: boolean;
}): QueryFeedback {
    const executionTimeSuffix = result && typeof result.executionTimeMs === 'number'
        ? ` • ${result.executionTimeMs}ms`
        : '';

    if (loadingQuery && !queryError && !result && queryLoadingVisible) {
        return {
            state: 'running',
            toneClass: 'is-running',
            label: '运行中',
            summary: '',
            title: '查询正在执行',
            description: '',
        };
    }

    if (queryError) {
        const isTimeoutError =
            queryError.includes('超时') ||
            queryError.toLowerCase().includes('timeout');

        return {
            state: isTimeoutError ? 'timeout' : 'error',
            toneClass: 'is-error',
            label: isTimeoutError ? '执行超时' : '错误输出',
            summary: isTimeoutError ? `请求超过 ${QUERY_EXECUTION_TIMEOUT_MS / 1000} 秒未完成` : '执行失败',
            title: isTimeoutError ? '查询执行超时' : '查询执行失败',
            description: queryError,
        };
    }

    if (!result) {
        return {
            state: 'idle',
            toneClass: 'is-idle',
            label: '结果输出',
            summary: '',
            title: '等待执行 SQL',
            description: '运行 SQL 后，这里会展示结果集、执行信息、错误明细和导出操作。',
        };
    }

    if (result.columns.length > 0 && result.rows.length === 0) {
        return {
            state: 'empty',
            toneClass: 'is-ready',
            label: '空结果',
            summary: `0 条记录${executionTimeSuffix}`,
            title: '查询执行成功，但没有返回记录',
            description: '可以继续补充筛选条件，或检查当前数据库和查询条件是否正确。',
        };
    }

    if (result.columns.length > 0) {
        const truncatedSuffix = result.truncated ? '（已截断）' : '';
        const truncatedDescription = result.truncated
            ? `当前仅展示前 ${result.rowLimit} 行结果。若需缩小范围，请在 SQL 中显式添加 LIMIT。`
            : null;
        return {
            state: 'success',
            toneClass: 'is-ready',
            label: '结果集',
            summary: `${result.rows.length} 条记录${truncatedSuffix}${executionTimeSuffix}`,
            title: '查询执行成功',
            description: truncatedDescription
                ?? (result.message && result.message !== 'Success' ? result.message : '结果集已返回，可继续查看、筛选或导出。'),
        };
    }

    return {
        state: 'message',
        toneClass: 'is-ready',
        label: '执行信息',
        summary: `已返回执行信息${executionTimeSuffix}`,
        title: 'SQL 已执行',
        description: result.message && result.message !== 'Success'
            ? result.message
            : '本次执行没有返回表格结果。',
    };
}
