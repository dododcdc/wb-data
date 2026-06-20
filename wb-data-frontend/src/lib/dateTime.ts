const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function pad2(value: number) {
    return String(value).padStart(2, '0');
}

export function parseLocalDateTime(value: string) {
    const match = LOCAL_DATE_TIME_PATTERN.exec(value);
    if (!match) return null;

    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const date = new Date(year, month - 1, day, hour, minute, second);

    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
        || date.getHours() !== hour
        || date.getMinutes() !== minute
        || date.getSeconds() !== second
    ) {
        return null;
    }

    return date;
}

export function formatLocalDateTime(date: Date) {
    return [
        `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
        `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
    ].join(' ');
}

export function formatBrowserDateTime(value: string | Date | null | undefined) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : formatLocalDateTime(date);
}

export function getBrowserTimeZoneName() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '浏览器本地时区';
}

export function getUtcOffsetLabel(date: Date) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(offsetMinutes);
    return `UTC${sign}${pad2(Math.floor(absoluteMinutes / 60))}:${pad2(absoluteMinutes % 60)}`;
}

export function formatRangeDuration(start: Date, end: Date) {
    let seconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
    const days = Math.floor(seconds / 86_400);
    seconds %= 86_400;
    const hours = Math.floor(seconds / 3_600);
    seconds %= 3_600;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const parts: string[] = [];

    if (days) parts.push(`${days}天`);
    if (hours) parts.push(`${hours}小时`);
    if (minutes) parts.push(`${minutes}分`);
    if (remainingSeconds || parts.length === 0) parts.push(`${remainingSeconds}秒`);

    return parts.join(' ');
}

export function validateLocalRange(from: string, to: string) {
    const start = parseLocalDateTime(from);
    const end = parseLocalDateTime(to);
    if (!start || !end) return '时间范围无效';
    if (start.getTime() > end.getTime()) return '开始时间不能晚于结束时间';
    return null;
}
