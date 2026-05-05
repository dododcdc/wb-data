export const POPULAR_TIMEZONES = [
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Singapore',
    'Asia/Tokyo',
    'America/New_York',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'UTC',
];

export const TIMEZONES = (Intl as any).supportedValuesOf?.('timeZone') as string[] || [
    'UTC',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
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
