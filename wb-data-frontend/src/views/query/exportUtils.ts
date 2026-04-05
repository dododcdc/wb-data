/**
 * Query 页面导出相关工具
 */

import { QueryExportTask, QueryExportTaskStatus } from '../../api/query';

// ==================== 类型 ====================

export interface ExportTaskMeta {
    label: string;
    toneClass: string;
}

// ==================== 导出任务工具 ====================

export function upsertExportTask(currentTasks: QueryExportTask[], nextTask: QueryExportTask): QueryExportTask[] {
    const remainingTasks = currentTasks.filter((task) => task.taskId !== nextTask.taskId);
    return [nextTask, ...remainingTasks].sort((left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
}

export function getExportTaskStatusMeta(status: QueryExportTaskStatus): ExportTaskMeta {
    switch (status) {
        case 'PENDING':
            return { label: '排队中', toneClass: 'is-pending' };
        case 'RUNNING':
            return { label: '导出中', toneClass: 'is-running' };
        case 'SUCCESS':
            return { label: '已完成', toneClass: 'is-success' };
        case 'FAILED':
            return { label: '失败', toneClass: 'is-error' };
        default:
            return { label: status, toneClass: 'is-pending' };
    }
}

// ==================== 时间格式化 ====================

export function formatTaskTimestamp(timestamp: string): string {
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(timestamp));
    } catch {
        return timestamp;
    }
}

// ==================== 导出格式化 ====================

export function getFormatLabel(format: 'csv' | 'xlsx'): string {
    return format === 'csv' ? 'CSV' : 'Excel';
}

export function formatResultTabLabel(tabNumber: number): string {
    return `结果 ${tabNumber}`;
}
