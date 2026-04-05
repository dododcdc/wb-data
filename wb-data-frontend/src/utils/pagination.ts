export const PAGE_SIZE_OPTIONS = [10, 20, 50];
export const DEFAULT_PAGE_SIZE = 10;

export function parsePageParam(value: string | null): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parsePageSizeParam(value: string | null): number {
    const parsed = Number(value);
    return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

export function formatTimestamp(value?: string | null): string {
    if (!value) return '--';

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return value;

    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const day = String(parsedDate.getDate()).padStart(2, '0');
    const hours = String(parsedDate.getHours()).padStart(2, '0');
    const minutes = String(parsedDate.getMinutes()).padStart(2, '0');
    const seconds = String(parsedDate.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
