import type { OfflineFlowDocument } from '../../api/offline';

export interface ExecutionTimeRequirement {
    requiresConfiguration: boolean;
    requiresPlannedTime: boolean;
    timezone: string | null;
    parameterKeys: string[];
}

export function getExecutionTimeRequirement(document: OfflineFlowDocument): ExecutionTimeRequirement {
    const definitions = document.parameterBinding?.definitions ?? [];
    const parameterKeys = definitions.filter((definition) => (
        definition.valueSource === 'SYSTEM_TIME'
        && (definition.timeBasis ?? 'PLANNED_TIME') === 'PLANNED_TIME'
    )).map((definition) => definition.key);
    const requiresPlannedTime = parameterKeys.length > 0;

    return {
        requiresConfiguration: definitions.length > 0,
        requiresPlannedTime,
        timezone: requiresPlannedTime ? document.runtimeTimezone ?? null : null,
        parameterKeys,
    };
}

export function defaultPlannedTimeValue(timezone: string | null): string {
    const timeZone = timezone || 'Asia/Shanghai';
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date());
        const get = (type: Intl.DateTimeFormatPartTypes) => (
            parts.find((part) => part.type === type)?.value ?? ''
        );
        const hour = get('hour') === '24' ? '00' : get('hour');
        return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
    } catch {
        return defaultPlannedTimeValue(null);
    }
}
