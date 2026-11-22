import { describe, expect, it } from 'vitest';
import {
    buildCronFromPeriodParts,
    inferPeriodFromCron,
    parsePeriodPartsFromCron,
} from './ScheduleUtils';

describe('inferPeriodFromCron', () => {
    it('maps standard shapes to periods', () => {
        expect(inferPeriodFromCron('30 * * * *')).toBe('HOURLY');
        expect(inferPeriodFromCron('0 2 * * *')).toBe('DAILY');
        expect(inferPeriodFromCron('0 2 * * 1')).toBe('WEEKLY');
        expect(inferPeriodFromCron('15 3 1 * *')).toBe('MONTHLY');
        expect(inferPeriodFromCron('0 0 1 1 *')).toBe('YEARLY');
    });

    it('falls back to CUSTOM for non-standard shapes', () => {
        expect(inferPeriodFromCron('* * * * *')).toBe('CUSTOM');
        expect(inferPeriodFromCron('*/5 * * * *')).toBe('CUSTOM');
        expect(inferPeriodFromCron('0 1,8,13 * * *')).toBe('CUSTOM');
        expect(inferPeriodFromCron('0 2 * * 1,3,5')).toBe('CUSTOM');
        expect(inferPeriodFromCron('not a cron')).toBe('CUSTOM');
        expect(inferPeriodFromCron('')).toBe('CUSTOM');
    });
});

describe('parsePeriodPartsFromCron', () => {
    it('extracts parts from standard crons', () => {
        expect(parsePeriodPartsFromCron('45 * * * *')).toEqual({ minute: 45, hour: 0, dayOfMonth: 1, dayOfWeek: 1, month: 1 });
        expect(parsePeriodPartsFromCron('30 6 * * *')).toEqual({ minute: 30, hour: 6, dayOfMonth: 1, dayOfWeek: 1, month: 1 });
        expect(parsePeriodPartsFromCron('30 6 * * 5')).toEqual({ minute: 30, hour: 6, dayOfMonth: 1, dayOfWeek: 5, month: 1 });
        expect(parsePeriodPartsFromCron('5 12 20 * *')).toEqual({ minute: 5, hour: 12, dayOfMonth: 20, dayOfWeek: 1, month: 1 });
        expect(parsePeriodPartsFromCron('0 0 1 10 *')).toEqual({ minute: 0, hour: 0, dayOfMonth: 1, dayOfWeek: 1, month: 10 });
    });

    it('returns null for custom crons', () => {
        expect(parsePeriodPartsFromCron('*/5 * * * *')).toBeNull();
    });
});

describe('buildCronFromPeriodParts', () => {
    it('builds standard crons for each period', () => {
        const base = { minute: 45, hour: 6, dayOfMonth: 20, dayOfWeek: 5, month: 10 };
        expect(buildCronFromPeriodParts('HOURLY', base)).toBe('45 * * * *');
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
