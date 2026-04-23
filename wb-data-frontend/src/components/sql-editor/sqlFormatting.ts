import { format } from 'sql-formatter';

/**
 * Format SQL content using sql-formatter.
 * Returns the original SQL if formatting throws an error.
 */
export function formatSqlContent(rawSql: string): string {
    if (!rawSql.trim()) {
        return rawSql;
    }

    try {
        return format(rawSql, { language: 'sql', keywordCase: 'upper' });
    } catch {
        return rawSql;
    }
}
