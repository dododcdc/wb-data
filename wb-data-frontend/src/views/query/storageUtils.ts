/**
 * Query 页面 localStorage 相关工具
 */

// ==================== Storage Keys ====================

export const DEFAULT_DATASOURCE_STORAGE_KEY = 'query-default-datasource-id';
export const LAST_DATASOURCE_STORAGE_KEY = 'query-last-datasource-id';
export const LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY = 'query-last-database-by-datasource-v2';

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
    // Only keep names returned by the metadata API. Never inject an unknown
    // fallback (e.g. the previous datasource's database) into the options list.
    const merged: string[] = [];

    const pushUnique = (database?: string) => {
        const normalized = database?.trim();
        if (!normalized) return;
        if (merged.some(item => item.toLowerCase() === normalized.toLowerCase())) return;
        merged.push(normalized);
    };

    databases.forEach(pushUnique);
    void fallbackDatabase;

    return merged;
}

/** Pick a database that actually exists in the loaded list. */
export function pickSelectedDatabase(
    databases: string[],
    preferred?: string,
    connectionDefault?: string,
): string {
    const list = mergeDatabaseOptions(databases);
    const findInList = (name?: string) => {
        const normalized = name?.trim();
        if (!normalized) return '';
        return list.find(item => item.toLowerCase() === normalized.toLowerCase()) ?? '';
    };

    // Prefer the datasource-configured database, then per-datasource memory, then first.
    return findInList(connectionDefault) || findInList(preferred) || list[0] || '';
}

/**
 * Resolve which database to select after a metadata load.
 * On datasource switch, ignore per-DS memory entirely — shared engines can list the
 * previous schema, so a sticky remembered name must not beat the connection default.
 * Switch policy is strictly: connectionDefault || list[0] (never remembered).
 */
export function resolveDatabaseAfterLoad(
    databases: string[],
    options: {
        connectionDefault?: string;
        rememberedDatabase?: string;
        ignoreRemembered?: boolean;
    },
): string {
    if (options.ignoreRemembered) {
        // Switch / ignore-remembered: never consult memory — only connection default or first.
        return pickSelectedDatabase(databases, undefined, options.connectionDefault);
    }
    return pickSelectedDatabase(databases, options.rememberedDatabase, options.connectionDefault);
}
