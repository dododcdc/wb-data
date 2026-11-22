import type { GitSyncConfig } from '../../../api/gitSettings';

export interface DeploymentStatus {
    label: string;
    detail: string;
    tone: 'confirmed' | 'pending' | 'unknown';
}

export function resolveDeploymentStatus(config: GitSyncConfig | null | undefined): DeploymentStatus | null {
    if (!config) return null;
    const running = ['CREATED', 'QUEUED', 'RUNNING', 'PENDING'].includes(config.lastSyncStatus ?? '');
    if (running) {
        return { label: '同步中', detail: '同步执行尚未结束，当前部署状态等待确认', tone: 'pending' };
    }
    if (config.deploymentEvidence === 'CONFIRMED' && config.lastDeployedSha) {
        const shortSha = config.lastDeployedSha.slice(0, 7);
        return {
            label: `当前线上 ${shortSha}`,
            detail: `最近确认部署：${config.lastDeployedSha}${config.lastDeployedAt ? ` · ${config.lastDeployedAt}` : ''}`,
            tone: 'confirmed',
        };
    }
    if (config.lastSyncStatus === 'FAILED') {
        return { label: '推送未生效', detail: '最近一次同步失败，实际部署内容需要重新确认', tone: 'unknown' };
    }
    return { label: '状态未知', detail: '尚未取得可信的 Kestra 部署证据', tone: 'unknown' };
}
