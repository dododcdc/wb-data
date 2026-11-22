import { CronExpressionParser } from 'cron-parser';
import type { OfflineSchedulePeriod } from '../../../api/offline';
export { POPULAR_TIMEZONES, TIMEZONES, getTimezoneOffset } from '@/lib/timezones';

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

export type HourlyScheduleMode = 'CONTINUOUS' | 'DISCRETE';

export interface HourlyScheduleSpec {
    mode: HourlyScheduleMode;
    startHour: number;
    endHour: number;
    step: number;
    hours: number[];
}

export const ALL_HOURS: number[] = Array.from({ length: 24 }, (_, hour) => hour);

export const DEFAULT_HOURLY_SPEC: HourlyScheduleSpec = {
    mode: 'CONTINUOUS',
    startHour: 0,
    endHour: 23,
    step: 1,
    hours: ALL_HOURS,
};

export interface SchedulePeriodParts {
    minute: number;
    hour: number;
    dayOfMonth: number;
    /** 1=周一 … 7=周日（cron 周日字段接受 0-7，统一写 1-7） */
    dayOfWeek: number;
    month: number;
    hourly?: HourlyScheduleSpec;
}

const FIXED_NUMBER = /^\d{1,2}$/;
const STEP_ALL_PATTERN = /^\*\/(\d{1,2})$/;
const RANGE_OR_STEP_PATTERN = /^(\d{1,2})-(\d{1,2})(?:\/(\d{1,2}))?$/;
const MAX_FORMATTED_HOURS = 6;

function parseFixedInt(raw: string, min: number, max: number): number | null {
    if (!FIXED_NUMBER.test(raw)) return null;
    const parsed = Number(raw);
    return parsed >= min && parsed <= max ? parsed : null;
}

function parseRangeHours(expr: string): { start: number; end: number; step: number; hours: number[] } | null {
    const match = RANGE_OR_STEP_PATTERN.exec(expr);
    if (!match) return null;
    const start = parseFixedInt(match[1], 0, 23);
    const end = parseFixedInt(match[2], 0, 23);
    const step = match[3] ? parseFixedInt(match[3], 1, 23) : 1;
    if (start === null || end === null || step === null || start >= end) return null;
    const hours: number[] = [];
    for (let h = start; h <= end; h += step) hours.push(h);
    return { start, end, step, hours };
}

/** Parses Cron hour field for standard HOURLY schedules; rejects < 2 firing hours to keep DAILY unambiguous. */
export function parseHourlyHourField(hourField: string): HourlyScheduleSpec | null {
    const trimmed = hourField.trim();
    if (!trimmed) return null;
    if (trimmed === '*') {
        return { mode: 'CONTINUOUS', startHour: 0, endHour: 23, step: 1, hours: [...ALL_HOURS] };
    }
    const stepAll = STEP_ALL_PATTERN.exec(trimmed);
    if (stepAll) {
        const step = parseFixedInt(stepAll[1], 1, 23);
        if (step === null) return null;
        const hours: number[] = [];
        for (let h = 0; h <= 23; h += step) hours.push(h);
        if (hours.length < 2) return null;
        return { mode: 'CONTINUOUS', startHour: 0, endHour: 23, step, hours };
    }
    if (trimmed.includes(',')) {
        const collected = new Set<number>();
        for (const rawToken of trimmed.split(',')) {
            const token = rawToken.trim();
            if (!token) return null;
            const single = parseFixedInt(token, 0, 23);
            if (single !== null) {
                collected.add(single);
                continue;
            }
            const range = parseRangeHours(token);
            if (!range) return null;
            range.hours.forEach((h) => collected.add(h));
        }
        const hours = Array.from(collected).sort((a, b) => a - b);
        if (hours.length < 2) return null;
        return { mode: 'DISCRETE', startHour: 0, endHour: 23, step: 1, hours };
    }
    const range = parseRangeHours(trimmed);
    if (!range || range.hours.length < 2) return null;
    return { mode: 'CONTINUOUS', startHour: range.start, endHour: range.end, step: range.step, hours: range.hours };
}

/** Expands an editable HourlyScheduleSpec into a deduplicated sorted list of execution hours (0..23). */
export function expandHourlySpecHours(spec: HourlyScheduleSpec): number[] {
    if (spec.mode === 'DISCRETE') {
        return Array.from(new Set(spec.hours.map((h) => Math.trunc(h)).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)))
            .sort((a, b) => a - b);
    }
    const start = Math.min(Math.max(Math.trunc(spec.startHour) || 0, 0), 22);
    const end = Math.min(Math.max(Math.trunc(spec.endHour) || 0, start + 1), 23);
    const step = Math.min(Math.max(Math.trunc(spec.step) || 1, 1), 23);
    const hours: number[] = [];
    for (let h = start; h <= end; h += step) hours.push(h);
    return hours;
}

/** Returns sorted firing hours (0..23) for a valid HOURLY cron, or null when invalid or < 2 hours. */
export function parseHourlyCronHours(cron: string): number[] | null {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    if (parseFixedInt(minute, 0, 59) === null || dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') {
        return null;
    }
    return parseHourlyHourField(hour)?.hours ?? null;
}

/** Returns sorted hours required by downstream that upstream does not cover, or null if either cron is non-standard. */
export function getMissingHourlyHours(
    downstreamCron: string | null | undefined,
    upstreamCron: string | null | undefined,
): number[] | null {
    if (!downstreamCron || !upstreamCron) return null;
    const downstream = parseHourlyCronHours(downstreamCron);
    const upstream = parseHourlyCronHours(upstreamCron);
    if (!downstream || !upstream) return null;
    const upstreamSet = new Set(upstream);
    return downstream.filter((h) => !upstreamSet.has(h));
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

export function formatHourlyHoursLabel(hours: number[]): string {
    const sorted = Array.from(new Set(hours.filter((h) => h >= 0 && h <= 23))).sort((a, b) => a - b);
    if (sorted.length === 0) return '';
    const head = sorted.slice(0, MAX_FORMATTED_HOURS).map(pad2).join('、');
    if (sorted.length > MAX_FORMATTED_HOURS) {
        return `${head} 等 ${sorted.length} 个小时`;
    }
    return `${head} 时`;
}

export function formatHourlyScheduleSummary(minute: number, spec?: HourlyScheduleSpec): string {
    if (!spec) return `${minute} 分`;
    if (spec.mode === 'DISCRETE') {
        const hours = expandHourlySpecHours(spec);
        if (hours.length === 24) return `${minute} 分`;
        return `${formatHourlyHoursLabel(hours)} · ${minute} 分`;
    }
    const start = Math.min(Math.max(Math.trunc(spec.startHour) || 0, 0), 22);
    const end = Math.min(Math.max(Math.trunc(spec.endHour) || 0, start + 1), 23);
    const step = Math.min(Math.max(Math.trunc(spec.step) || 1, 1), 23);
    if (start === 0 && end === 23) {
        return step === 1 ? `${minute} 分` : `每 ${step} 小时 · ${minute} 分`;
    }
    const range = `${pad2(start)}–${pad2(end)} 时`;
    return step === 1 ? `${range} · ${minute} 分` : `${range}（每 ${step} 小时）· ${minute} 分`;
}

/** Mirrors the backend inference: only unambiguous standard shapes map to a period. */
export function inferPeriodFromCron(cron: string): OfflineSchedulePeriod {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return 'CUSTOM';
    if (parseHourlyCronHours(cron) !== null) {
        return 'HOURLY';
    }
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
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
    const base: SchedulePeriodParts = {
        minute: Number(minute),
        hour: period === 'HOURLY' ? 0 : Number(hour),
        dayOfMonth: period === 'MONTHLY' || period === 'YEARLY' ? Number(dayOfMonth) : 1,
        dayOfWeek: period === 'WEEKLY' ? Number(dayOfWeek) : 1,
        month: period === 'YEARLY' ? Number(month) : 1,
    };
    if (period === 'HOURLY') {
        const hourly = parseHourlyHourField(hour);
        if (hourly) base.hourly = hourly;
    }
    return base;
}

function buildHourlyField(spec?: HourlyScheduleSpec): string {
    if (!spec) return '*';
    if (spec.mode === 'DISCRETE') {
        const hours = expandHourlySpecHours(spec);
        if (hours.length === 0 || hours.length === 24) return '*';
        return hours.join(',');
    }
    const start = Math.min(Math.max(Math.trunc(spec.startHour) || 0, 0), 22);
    const end = Math.min(Math.max(Math.trunc(spec.endHour) || 0, start + 1), 23);
    const step = Math.min(Math.max(Math.trunc(spec.step) || 1, 1), 23);
    if (start === 0 && end === 23) {
        return step === 1 ? '*' : `*/${step}`;
    }
    return step === 1 ? `${start}-${end}` : `${start}-${end}/${step}`;
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
            return `${minute} ${buildHourlyField(parts.hourly)} * * *`;
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
