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
