import type { FileTreeRowDecoration } from '@pierre/trees';

import type { OfflineRepoTreeNode } from '../../api/offline';

const PERIOD_META = {
    HOURLY: { letter: 'H', label: '小时' },
    DAILY: { letter: 'D', label: '天' },
    WEEKLY: { letter: 'W', label: '周' },
    MONTHLY: { letter: 'M', label: '月' },
    YEARLY: { letter: 'Y', label: '年' },
    CUSTOM: { letter: 'C', label: '自定义' },
} as const;

type SchedulePeriod = keyof typeof PERIOD_META;

function badgeSymbol(id: string, letter: string, circleColor: string, letterColor: string): string {
    return `<symbol id="${id}" viewBox="0 0 16 16">`
        + `<circle cx="8" cy="8" r="7" fill="${circleColor}"/>`
        + `<text x="8" y="8" text-anchor="middle" dominant-baseline="central"`
        + ` font-size="10" font-weight="600" font-family="inherit" fill="${letterColor}">${letter}</text>`
        + `</symbol>`;
}

export const SCHEDULE_BADGE_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute">${
    Object.values(PERIOD_META).map(({ letter }) => {
        const key = letter.toLowerCase();
        return badgeSymbol(`wb-schedule-${key}`, letter, '#1e40af', '#ffffff')
            + badgeSymbol(`wb-schedule-${key}-disabled`, letter, '#9ca3af', '#e5e7eb');
    }).join('')
}</svg>`;

export function renderScheduleBadge(node: OfflineRepoTreeNode): FileTreeRowDecoration | null {
    if (node.kind !== 'FLOW' || node.scheduleState === 'NONE' || !node.schedulePeriod) {
        return null;
    }
    const meta = PERIOD_META[node.schedulePeriod as SchedulePeriod];
    if (!meta) {
        return null;
    }
    const enabled = node.scheduleState === 'ENABLED';
    return {
        icon: { name: `wb-schedule-${meta.letter.toLowerCase()}${enabled ? '' : '-disabled'}` },
        title: `${meta.label}调度 · ${enabled ? '已启用' : '已停用'}`,
    };
}
