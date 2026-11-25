import type { OperationsExecutionTaskRun } from '../../api/operations';
import { getExecutionStatusLabel, isActiveStatus } from '../../components/execution/executionPresentation';

export interface NodeTimelineSpan {
    hasBar: boolean;
    leftPct: number;
    widthPct: number;
}

function parseTimestampMs(raw: string | null | undefined): number | null {
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Computes relative [left%, width%] timeline bars for each node within the execution window.
 * Skipped or unscheduled tasks return hasBar=false.
 */
export function computeNodeTimelineSpans(
    taskRuns: OperationsExecutionTaskRun[],
    executionStartDate: string | null | undefined,
    executionEndDate: string | null | undefined,
): Map<string, NodeTimelineSpan> {
    const result = new Map<string, NodeTimelineSpan>();
    const points: number[] = [];

    const execStartMs = parseTimestampMs(executionStartDate);
    const execEndMs = parseTimestampMs(executionEndDate);
    if (execStartMs != null) points.push(execStartMs);
    if (execEndMs != null) points.push(execEndMs);

    const parsedTasks = taskRuns.map((task) => {
        const startMs = task.status === 'SKIPPED' ? null : parseTimestampMs(task.startDate);
        let endMs = task.status === 'SKIPPED' ? null : parseTimestampMs(task.endDate);
        if (startMs != null && endMs == null && typeof task.durationMs === 'number' && task.durationMs >= 0) {
            endMs = startMs + task.durationMs;
        }
        if (startMs != null) points.push(startMs);
        if (endMs != null) points.push(endMs);
        return { task, startMs, endMs };
    });

    if (points.length === 0) {
        for (const task of taskRuns) {
            result.set(task.taskId, { hasBar: false, leftPct: 0, widthPct: 0 });
        }
        return result;
    }

    const minMs = Math.min(...points);
    const maxMs = Math.max(...points);
    const totalMs = Math.max(0, maxMs - minMs);

    for (const { task, startMs, endMs } of parsedTasks) {
        if (startMs == null) {
            result.set(task.taskId, { hasBar: false, leftPct: 0, widthPct: 0 });
            continue;
        }
        if (totalMs === 0) {
            result.set(task.taskId, { hasBar: true, leftPct: 0, widthPct: 0 });
            continue;
        }
        const resolvedEnd = endMs ?? maxMs;
        const clampedStart = Math.max(minMs, Math.min(maxMs, startMs));
        const clampedEnd = Math.max(clampedStart, Math.min(maxMs, resolvedEnd));
        const leftPct = Math.round(((clampedStart - minMs) / totalMs) * 1000) / 10;
        const widthPct = Math.round(((clampedEnd - clampedStart) / totalMs) * 1000) / 10;
        result.set(task.taskId, {
            hasBar: true,
            leftPct: Math.min(100, Math.max(0, leftPct)),
            widthPct: Math.min(100 - Math.min(100, Math.max(0, leftPct)), Math.max(0, widthPct)),
        });
    }
    return result;
}

export function getInstanceStateLabel(state: string | null | undefined) {
    switch (state) {
        case 'NOT_DUE': return '未到点火时间';
        case 'PENDING_FIRE': return '等待触发';
        case 'MISSED': return '疑似漏触发';
        case 'SCHEDULE_DISABLED': return '调度已停用';
        case 'NO_SCHEDULE': return '未配置调度';
        case 'WAITING_UPSTREAM': return '等待上游';
        case 'GATE_TIMEOUT': return '等待上游超时';
        case 'PAUSED_BY_POLICY': return '上一期失败已暂停';
        case 'UNSYNCED': return '未同步';
        case 'NOT_FIRED': return '未触发';
        default: return getExecutionStatusLabel(state);
    }
}

export type InstanceStateTone = 'success' | 'forced-success' | 'failed' | 'running' | 'warning' | 'neutral';

export function getInstanceStateTone(state: string | null | undefined): InstanceStateTone {
    switch (state) {
        case 'FORCE_SUCCESS': return 'forced-success';
        case 'SUCCESS': return 'success';
        case 'MISSED':
        case 'GATE_TIMEOUT':
        case 'PAUSED_BY_POLICY':
            return 'failed';
        case 'WAITING_UPSTREAM':
        case 'PENDING_FIRE':
        case 'RETRIED':
            return 'warning';
        case 'NOT_DUE':
        case 'SCHEDULE_DISABLED':
        case 'NO_SCHEDULE':
        case 'UNSYNCED':
        case 'NOT_FIRED':
        case 'SKIPPED':
        case 'NOT_RUN':
            return 'neutral';
        default:
            if (state === 'FAILED' || state === 'KILLED' || state === 'CANCELLED') return 'failed';
            if (isActiveStatus(state)) return 'running';
            return 'neutral';
    }
}

export function isActiveInstanceState(state: string | null | undefined) {
    return state === 'WAITING_UPSTREAM' || state === 'PENDING_FIRE' || state === 'RETRIED' || isActiveStatus(state);
}
