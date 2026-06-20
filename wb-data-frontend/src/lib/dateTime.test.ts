import { describe, expect, it } from 'vitest';

import {
    formatBrowserDateTime,
    formatLocalDateTime,
    formatRangeDuration,
    getUtcOffsetLabel,
    parseLocalDateTime,
    validateLocalRange,
} from './dateTime';

describe('dateTime', () => {
    it('round-trips a valid browser-local second-precision value', () => {
        const value = '2024-02-29 08:30:05';

        expect(formatLocalDateTime(parseLocalDateTime(value)!)).toBe(value);
    });

    it('rejects impossible or malformed local values', () => {
        expect(parseLocalDateTime('2025-02-29 08:30:05')).toBeNull();
        expect(parseLocalDateTime('2025-01-01T08:30')).toBeNull();
    });

    it('formats API instants with a full browser-local year and seconds', () => {
        const date = new Date(2026, 0, 2, 3, 4, 5);

        expect(formatBrowserDateTime(date.toISOString())).toBe('2026-01-02 03:04:05');
    });

    it('formats UTC offsets and elapsed range duration', () => {
        const start = new Date(2026, 0, 1, 0, 0, 0);
        const end = new Date(start.getTime() + 90_061_000);

        expect(getUtcOffsetLabel(start)).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
        expect(formatRangeDuration(start, end)).toBe('1天 1小时 1分 1秒');
    });

    it('rejects reversed ranges while accepting equal boundaries', () => {
        expect(validateLocalRange('2026-01-02 00:00:00', '2026-01-01 23:59:59'))
            .toBe('开始时间不能晚于结束时间');
        expect(validateLocalRange('2026-01-02 00:00:00', '2026-01-02 00:00:00'))
            .toBeNull();
    });
});
