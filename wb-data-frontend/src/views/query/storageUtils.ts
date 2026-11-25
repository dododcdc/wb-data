/**
 * Query 页面 localStorage 相关工具
 */

export {
    DEFAULT_DATASOURCE_STORAGE_KEY,
    LAST_DATASOURCE_STORAGE_KEY,
    LAST_DATABASE_BY_DATASOURCE_STORAGE_KEY,
    getStoredDefaultDataSourceId,
    getStoredLastDataSourceId,
    getStoredLastDatabaseByDataSource,
} from '../../constants/queryStorage';

// ==================== Navigation Detection ====================

export function shouldPreferDefaultDataSourceOnMount(): boolean {
    if (typeof window === 'undefined' || typeof performance === 'undefined') {
        return false;
    }

    const navigationEntry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigationEntry?.type) {
        return navigationEntry.type === 'reload';
    }

    // Fallback for older browsers.
    return typeof performance.navigation?.type === 'number'
        && performance.navigation.type === performance.navigation.TYPE_RELOAD;
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
