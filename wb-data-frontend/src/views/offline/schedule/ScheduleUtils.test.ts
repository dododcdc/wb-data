import { describe, expect, it } from 'vitest';
import {
    ALL_HOURS,
    buildCronFromPeriodParts,
    formatHourlyScheduleSummary,
    getMissingHourlyHours,
    inferPeriodFromCron,
    parsePeriodPartsFromCron,
} from './ScheduleUtils';

describe('inferPeriodFromCron', () => {
    it('maps standard shapes including continuous and discrete hourly expressions to periods', () => {
        expect(inferPeriodFromCron('30 * * * *')).toBe('HOURLY');
        expect(inferPeriodFromCron('15 8-22 * * *')).toBe('HOURLY');
        expect(inferPeriodFromCron('0 */2 * * *')).toBe('HOURLY');
        expect(inferPeriodFromCron('15 8-22/2 * * *')).toBe('HOURLY');
        expect(inferPeriodFromCron('0 1,3,14 * * *')).toBe('HOURLY');
        expect(inferPeriodFromCron('0 1,8,13 * * *')).toBe('HOURLY');
        expect(inferPeriodFromCron('0 2 * * *')).toBe('DAILY');
        expect(inferPeriodFromCron('0 2 * * 1')).toBe('WEEKLY');
        expect(inferPeriodFromCron('15 3 1 * *')).toBe('MONTHLY');
        expect(inferPeriodFromCron('0 0 1 1 *')).toBe('YEARLY');
    });

    it('falls back to CUSTOM for non-standard shapes', () => {
        expect(inferPeriodFromCron('* * * * *')).toBe('CUSTOM');
        expect(inferPeriodFromCron('*/5 * * * *')).toBe('CUSTOM');
        expect(inferPeriodFromCron('0 22-6 * * *')).toBe('CUSTOM');
        expect(inferPeriodFromCron('0 10-14/6 * * *')).toBe('CUSTOM');
        expect(inferPeriodFromCron('0 2 * * 1,3,5')).toBe('CUSTOM');
        expect(inferPeriodFromCron('not a cron')).toBe('CUSTOM');
        expect(inferPeriodFromCron('')).toBe('CUSTOM');
    });
});

describe('parsePeriodPartsFromCron', () => {
    it('extracts parts from standard crons', () => {
        expect(parsePeriodPartsFromCron('45 * * * *')).toEqual({
            minute: 45,
            hour: 0,
            dayOfMonth: 1,
            dayOfWeek: 1,
            month: 1,
            hourly: {
                mode: 'CONTINUOUS',
                startHour: 0,
                endHour: 23,
                step: 1,
                hours: ALL_HOURS,
            },
        });
        expect(parsePeriodPartsFromCron('15 8-22/2 * * *')).toEqual({
            minute: 15,
            hour: 0,
            dayOfMonth: 1,
            dayOfWeek: 1,
            month: 1,
            hourly: {
                mode: 'CONTINUOUS',
                startHour: 8,
                endHour: 22,
                step: 2,
                hours: [8, 10, 12, 14, 16, 18, 20, 22],
            },
        });
        expect(parsePeriodPartsFromCron('15 14,1,3 * * *')).toEqual({
            minute: 15,
            hour: 0,
            dayOfMonth: 1,
            dayOfWeek: 1,
            month: 1,
            hourly: {
                mode: 'DISCRETE',
                startHour: 0,
                endHour: 23,
                step: 1,
                hours: [1, 3, 14],
            },
        });
        expect(parsePeriodPartsFromCron('30 6 * * *')).toEqual({ minute: 30, hour: 6, dayOfMonth: 1, dayOfWeek: 1, month: 1 });
        expect(parsePeriodPartsFromCron('30 6 * * 5')).toEqual({ minute: 30, hour: 6, dayOfMonth: 1, dayOfWeek: 5, month: 1 });
        expect(parsePeriodPartsFromCron('5 12 20 * *')).toEqual({ minute: 5, hour: 12, dayOfMonth: 20, dayOfWeek: 1, month: 1 });
        expect(parsePeriodPartsFromCron('0 0 1 10 *')).toEqual({ minute: 0, hour: 0, dayOfMonth: 1, dayOfWeek: 1, month: 10 });
    });

    it('returns null for custom crons', () => {
        expect(parsePeriodPartsFromCron('*/5 * * * *')).toBeNull();
        expect(parsePeriodPartsFromCron('0 22-6 * * *')).toBeNull();
    });
});

describe('buildCronFromPeriodParts', () => {
    it('builds standard crons for each period', () => {
        const base = { minute: 45, hour: 6, dayOfMonth: 20, dayOfWeek: 5, month: 10 };
        expect(buildCronFromPeriodParts('HOURLY', base)).toBe('45 * * * *');
        expect(buildCronFromPeriodParts('HOURLY', {
            ...base,
            hourly: { mode: 'CONTINUOUS', startHour: 0, endHour: 23, step: 3, hours: [] },
        })).toBe('45 */3 * * *');
        expect(buildCronFromPeriodParts('HOURLY', {
            ...base,
            hourly: { mode: 'CONTINUOUS', startHour: 8, endHour: 22, step: 1, hours: [] },
        })).toBe('45 8-22 * * *');
        expect(buildCronFromPeriodParts('HOURLY', {
            ...base,
            hourly: { mode: 'CONTINUOUS', startHour: 8, endHour: 22, step: 2, hours: [] },
        })).toBe('45 8-22/2 * * *');
        expect(buildCronFromPeriodParts('HOURLY', {
            ...base,
            hourly: { mode: 'DISCRETE', startHour: 0, endHour: 23, step: 1, hours: [14, 1, 3, 1] },
        })).toBe('45 1,3,14 * * *');
        expect(buildCronFromPeriodParts('HOURLY', {
            ...base,
            hourly: { mode: 'DISCRETE', startHour: 0, endHour: 23, step: 1, hours: ALL_HOURS },
        })).toBe('45 * * * *');
        expect(buildCronFromPeriodParts('DAILY', base)).toBe('45 6 * * *');
        expect(buildCronFromPeriodParts('WEEKLY', base)).toBe('45 6 * * 5');
        expect(buildCronFromPeriodParts('MONTHLY', base)).toBe('45 6 20 * *');
        expect(buildCronFromPeriodParts('YEARLY', base)).toBe('45 6 20 10 *');
    });

    it('clamps out-of-range values', () => {
        const wild = { minute: 99, hour: 25, dayOfMonth: 0, dayOfWeek: 9, month: 13 };
        expect(buildCronFromPeriodParts('DAILY', wild)).toBe('59 23 * * *');
        expect(buildCronFromPeriodParts('MONTHLY', wild)).toBe('59 23 1 * *');
        expect(buildCronFromPeriodParts('WEEKLY', wild)).toBe('59 23 * * 7');
        expect(buildCronFromPeriodParts('YEARLY', wild)).toBe('59 23 1 12 *');
    });

    it('round-trips with parse for standard crons', () => {
        for (const [period, cron] of [
            ['HOURLY', '20 * * * *'],
            ['HOURLY', '20 */2 * * *'],
            ['HOURLY', '20 8-22 * * *'],
            ['HOURLY', '20 8-22/2 * * *'],
            ['HOURLY', '20 1,3,14 * * *'],
            ['DAILY', '20 9 * * *'],
            ['WEEKLY', '20 9 * * 3'],
            ['MONTHLY', '20 9 15 * *'],
            ['YEARLY', '20 9 15 3 *'],
        ] as const) {
            const parts = parsePeriodPartsFromCron(cron);
            expect(parts).not.toBeNull();
            expect(buildCronFromPeriodParts(period, parts!)).toBe(cron);
        }
    });
});

describe('hourly dependency helpers', () => {
    it('computes missing hours between downstream and upstream hourly crons', () => {
        expect(getMissingHourlyHours('15 1,3,14 * * *', '0 * * * *')).toEqual([]);
        expect(getMissingHourlyHours('15 1,3,14 * * *', '0 8-22 * * *')).toEqual([1, 3]);
        expect(getMissingHourlyHours('15 8-12/2 * * *', '0 8,10,12 * * *')).toEqual([]);
        expect(getMissingHourlyHours('0 2 * * *', '0 * * * *')).toBeNull();
    });

    it('formats readable hourly schedule summaries', () => {
        expect(formatHourlyScheduleSummary(17, parsePeriodPartsFromCron('17 * * * *')?.hourly)).toBe('17 分');
        expect(formatHourlyScheduleSummary(15, parsePeriodPartsFromCron('15 */2 * * *')?.hourly)).toBe('每 2 小时 · 15 分');
        expect(formatHourlyScheduleSummary(15, parsePeriodPartsFromCron('15 8-22 * * *')?.hourly)).toBe('08–22 时 · 15 分');
        expect(formatHourlyScheduleSummary(15, parsePeriodPartsFromCron('15 8-22/2 * * *')?.hourly)).toBe('08–22 时（每 2 小时）· 15 分');
        expect(formatHourlyScheduleSummary(15, parsePeriodPartsFromCron('15 1,3,14 * * *')?.hourly)).toBe('01、03、14 时 · 15 分');
    });
});
