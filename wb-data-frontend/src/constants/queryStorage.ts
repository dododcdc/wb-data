export const DEFAULT_DATASOURCE_STORAGE_KEY = 'query-default-datasource-id';
export const LAST_DATASOURCE_STORAGE_KEY = 'query-last-datasource-id';
export const LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY = 'query-last-database-by-datasource-v2';

export function getStoredDefaultDataSourceId(): string {
    try {
        return localStorage.getItem(DEFAULT_DATASOURCE_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

export function getStoredLastDataSourceId(): string {
    try {
        return localStorage.getItem(LAST_DATASOURCE_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

export function getStoredLastDatabaseByDataSource(): Record<string, string> {
    try {
        const rawValue = localStorage.getItem(LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY);
        if (!rawValue) {
            return {};
        }

        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
            if (typeof value === 'string' && value.trim()) {
                acc[key] = value;
            }
            return acc;
        }, {});
    } catch {
        return {};
    }
}
