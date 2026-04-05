/**
 * Query 页面 localStorage 相关工具
 */

// ==================== Storage Keys ====================

export const DEFAULT_DATASOURCE_STORAGE_KEY = 'query-default-datasource-id';
export const LAST_DATASOURCE_STORAGE_KEY = 'query-last-datasource-id';
export const LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY = 'query-last-database-by-datasource';

// ==================== DataSource Storage ====================

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

// ==================== Platform Detection ====================

export function shouldPreferDefaultDataSourceOnMount(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigationEntry?.type) {
        return navigationEntry.type === 'reload';
    }

    // Fallback for older browsers.
    return performance.navigation?.type === performance.navigation.TYPE_RELOAD;
}

// ==================== Database Utilities ====================

export function mergeDatabaseOptions(databases: string[], fallbackDatabase?: string): string[] {
    const merged: string[] = [];

    const pushUnique = (database?: string) => {
        const normalized = database?.trim();
        if (!normalized) return;
        if (merged.some(item => item.toLowerCase() === normalized.toLowerCase())) return;
        merged.push(normalized);
    };

    pushUnique(fallbackDatabase);
    databases.forEach(pushUnique);

    return merged;
}
