import { describe, expect, it } from 'vitest';

import type { OfflineRepoTreeNode } from '../../api/offline';
import { renderScheduleBadge } from './offlineTreeBadges';

function flow(overrides: Partial<OfflineRepoTreeNode> = {}): OfflineRepoTreeNode {
    return {
        id: '_flows/task/flow.yaml',
        kind: 'FLOW',
        name: 'task',
        path: '_flows/task/flow.yaml',
        children: [],
        scheduleState: 'NONE',
        schedulePeriod: null,
        dependencyCount: 0,
        ...overrides,
    };
}

describe('renderScheduleBadge', () => {
    it('returns null when the flow has no schedule', () => {
        expect(renderScheduleBadge(flow())).toBeNull();
    });

    it('returns null for non-flow nodes', () => {
        expect(renderScheduleBadge(flow({
            kind: 'DIRECTORY',
            scheduleState: 'ENABLED',
            schedulePeriod: 'DAILY',
        }))).toBeNull();
    });

    it('renders the enabled period badge with a tooltip', () => {
        expect(renderScheduleBadge(flow({ scheduleState: 'ENABLED', schedulePeriod: 'DAILY' }))).toEqual({
            icon: { name: 'wb-schedule-d' },
            title: '天调度 · 已启用',
        });
    });

    it('renders the disabled variant for a paused schedule', () => {
        expect(renderScheduleBadge(flow({ scheduleState: 'DISABLED', schedulePeriod: 'HOURLY' }))).toEqual({
            icon: { name: 'wb-schedule-h-disabled' },
            title: '小时调度 · 已停用',
        });
    });

    it.each(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'] as const)('maps %s to its letter badge', (period) => {
        const badge = renderScheduleBadge(flow({ scheduleState: 'ENABLED', schedulePeriod: period }));
        expect(badge).not.toBeNull();
        expect(JSON.stringify(badge)).toContain('wb-schedule-');
    });
});
