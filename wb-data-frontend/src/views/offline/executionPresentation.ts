import { CheckCircle2, Clock, LoaderCircle, PlayCircle, XCircle } from 'lucide-react';

export type ExecutionDotTone = 'neutral' | 'running' | 'success' | 'failed';
export type ExecutionProgressTone = 'neutral' | 'running' | 'success' | 'failed';

export interface ExecutionPresentation {
    dotTone: ExecutionDotTone;
    progressTone: ExecutionProgressTone;
    animated: boolean;
}

export function isRunningStatus(status: string | null | undefined) {
    return status === 'RUNNING' || status === 'PAUSED';
}

export function isActiveStatus(status: string | null | undefined) {
    return isRunningStatus(status) || status === 'CREATED' || status === 'QUEUED';
}

export function getExecutionStatusLabel(status: string | null | undefined) {
    if (status === 'SUCCESS') return '成功';
    if (status === 'FAILED') return '失败';
    if (status === 'CANCELLED') return '已取消';
    if (status === 'KILLED') return '已停止';
    if (status === 'QUEUED' || status === 'CREATED') return '就绪';
    if (status === 'PAUSED') return '已暂停';
    if (isRunningStatus(status)) return '执行中';
    return status || '等待执行';
}

export function getExecutionPresentation(status: string | null | undefined): ExecutionPresentation {
    if (status === 'SUCCESS') {
        return {
            dotTone: 'success',
            progressTone: 'success',
            animated: false,
        };
    }
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'KILLED') {
        return {
            dotTone: 'failed',
            progressTone: 'failed',
            animated: false,
        };
    }
    if (isActiveStatus(status)) {
        return {
            dotTone: 'running',
            progressTone: 'running',
            animated: isRunningStatus(status),
        };
    }
    return {
        dotTone: 'neutral',
        progressTone: 'neutral',
        animated: false,
    };
}

export const taskStatusIcon = {
    SUCCESS: CheckCircle2,
    FAILED: XCircle,
    RUNNING: LoaderCircle,
    CREATED: Clock,
    QUEUED: Clock,
    PAUSED: PlayCircle,
    CANCELLED: XCircle,
    KILLED: XCircle,
} as const;

export function getTaskStatusIcon(status: string | null | undefined) {
    return taskStatusIcon[status as keyof typeof taskStatusIcon] || Clock;
}
