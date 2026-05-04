// wb-data-frontend/src/views/offline/formatUtils.ts

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

const timeOnlyFormatter = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

export function formatDateTime(value: string | null | undefined) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return dateFormatter.format(date).replace(/\//g, '-');
}

export function formatTime(value: string | null | undefined) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return timeOnlyFormatter.format(date);
}

export function formatDuration(start: string | null, end: string | null) {
    if (!start || !end) return '—';
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    if (durationMs < 0) return '—';
    const seconds = durationMs / 1000;
    if (seconds < 1) return '< 1s';
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds.toFixed(0)}s`;
}

export function formatElapsed(start: string | null, end: string | null) {
    if (!start) return '';
    const endDate = end ? new Date(end) : new Date();
    const durationMs = endDate.getTime() - new Date(start).getTime();
    if (durationMs < 0) return '';
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}
