import { CronExpressionParser } from 'cron-parser';
import type { OfflineSchedulePeriod } from '../../api/offline';

export const POPULAR_TIMEZONES = [
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'America/New_York',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'UTC',
];

export const TIMEZONES = ((Intl as unknown) as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') || [
    'UTC',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'America/New_York',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Australia/Sydney',
];

export function getTimezoneOffset(timezone: string): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'shortOffset',
        }).formatToParts(new Date());
        const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
        return offset.startsWith('GMT') ? offset.replace('GMT', 'UTC') : offset;
    } catch {
        return '';
    }
}

export function formatPreviewTime(iso: string, timezone: string): string {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const map: Record<string, string> = {};
    parts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

/** Returns true when cron parses successfully for the given timezone. */
export function isValidCronExpression(cron: string, timezone?: string): boolean {
    const expression = cron.trim() || '0 2 * * *';
    try {
        CronExpressionParser.parse(expression, { tz: timezone || undefined });
        return true;
    } catch {
        return false;
    }
}

export interface SchedulePeriodParts {
    minute: number;
    hour: number;
    dayOfMonth: number;
    /** 1=周一 … 7=周日（cron 周日字段接受 0-7，统一写 1-7） */
    dayOfWeek: number;
    month: number;
}

const FIXED_NUMBER = /^\d{1,2}$/;

/** Mirrors the backend migration inference: only unambiguous standard shapes map to a period. */
export function inferPeriodFromCron(cron: string): OfflineSchedulePeriod {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return 'CUSTOM';
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    if (FIXED_NUMBER.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return 'HOURLY';
    }
    if (FIXED_NUMBER.test(minute) && FIXED_NUMBER.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return 'DAILY';
    }
    if (FIXED_NUMBER.test(minute) && FIXED_NUMBER.test(hour) && FIXED_NUMBER.test(dayOfMonth) && month === '*' && dayOfWeek === '*') {
        return 'MONTHLY';
    }
    if (FIXED_NUMBER.test(minute) && FIXED_NUMBER.test(hour) && dayOfMonth === '*' && month === '*' && FIXED_NUMBER.test(dayOfWeek)) {
        return 'WEEKLY';
    }
    if (FIXED_NUMBER.test(minute) && FIXED_NUMBER.test(hour) && FIXED_NUMBER.test(dayOfMonth) && FIXED_NUMBER.test(month) && dayOfWeek === '*') {
        return 'YEARLY';
    }
    return 'CUSTOM';
}

/** Parses a standard-shape cron into editable parts; returns null when the cron is not a standard shape. */
export function parsePeriodPartsFromCron(cron: string): SchedulePeriodParts | null {
    const period = inferPeriodFromCron(cron);
    if (period === 'CUSTOM') return null;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/);
    return {
        minute: Number(minute),
        hour: period === 'HOURLY' ? 0 : Number(hour),
        dayOfMonth: period === 'MONTHLY' || period === 'YEARLY' ? Number(dayOfMonth) : 1,
        dayOfWeek: period === 'WEEKLY' ? Number(dayOfWeek) : 1,
        month: period === 'YEARLY' ? Number(month) : 1,
    };
}

/** Builds the cron for a standard period from editable parts. */
export function buildCronFromPeriodParts(period: Exclude<OfflineSchedulePeriod, 'CUSTOM'>, parts: SchedulePeriodParts): string {
    const minute = Math.min(Math.max(Math.trunc(parts.minute) || 0, 0), 59);
    const hour = Math.min(Math.max(Math.trunc(parts.hour) || 0, 0), 23);
    const dayOfMonth = Math.min(Math.max(Math.trunc(parts.dayOfMonth) || 1, 1), 31);
    const dayOfWeek = Math.min(Math.max(Math.trunc(parts.dayOfWeek) || 1, 1), 7);
    const month = Math.min(Math.max(Math.trunc(parts.month) || 1, 1), 12);
    switch (period) {
        case 'HOURLY':
            return `${minute} * * * *`;
        case 'DAILY':
            return `${minute} ${hour} * * *`;
        case 'WEEKLY':
            return `${minute} ${hour} * * ${dayOfWeek}`;
        case 'MONTHLY':
            return `${minute} ${hour} ${dayOfMonth} * *`;
        case 'YEARLY':
            return `${minute} ${hour} ${dayOfMonth} ${month} *`;
    }
}

export const DEFAULT_PERIOD_PARTS: SchedulePeriodParts = { minute: 0, hour: 2, dayOfMonth: 1, dayOfWeek: 1, month: 1 };

