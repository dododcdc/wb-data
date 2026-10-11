import { getExecutionStatusLabel, isActiveStatus } from '../../components/execution/executionPresentation';

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

export type InstanceStateTone = 'success' | 'failed' | 'running' | 'warning' | 'neutral';

export function getInstanceStateTone(state: string | null | undefined): InstanceStateTone {
    switch (state) {
        case 'SUCCESS': return 'success';
        case 'MISSED':
        case 'GATE_TIMEOUT':
        case 'PAUSED_BY_POLICY':
            return 'failed';
        case 'WAITING_UPSTREAM':
        case 'PENDING_FIRE':
            return 'warning';
        case 'NOT_DUE':
        case 'SCHEDULE_DISABLED':
        case 'NO_SCHEDULE':
        case 'UNSYNCED':
        case 'NOT_FIRED':
            return 'neutral';
        default:
            if (state === 'FAILED' || state === 'KILLED' || state === 'CANCELLED') return 'failed';
            if (isActiveStatus(state)) return 'running';
            return 'neutral';
    }
}

export function isActiveInstanceState(state: string | null | undefined) {
    return state === 'WAITING_UPSTREAM' || state === 'PENDING_FIRE' || isActiveStatus(state);
}
