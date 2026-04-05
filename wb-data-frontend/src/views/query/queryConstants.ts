/**
 * Query 页面常量
 */

// ==================== 分页和限制 ====================

export const DS_PAGE_SIZE = 50;
export const TABLE_PAGE_SIZE = 200;

// ==================== 执行配置 ====================

export const QUERY_EXECUTION_TIMEOUT_MS = 10_000;
export const EXPORT_TASK_POLL_INTERVAL_MS = 2_000;
export const EXPORT_MAX_ROWS = 100_000;
export const PINNED_RESULT_LIMIT = 5;

// ==================== SQL 关键字 ====================

export const FALLBACK_SQL_KEYWORDS = [
    'SELECT',
    'FROM',
    'WHERE',
    'JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'INNER JOIN',
    'GROUP BY',
    'ORDER BY',
    'HAVING',
    'LIMIT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'CREATE',
    'ALTER',
    'DROP',
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'DISTINCT',
    'AS',
    'AND',
    'OR',
    'NOT',
    'IN',
    'EXISTS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
];

export const SQL_ALIAS_RESERVED_WORDS = new Set([
    'WHERE',
    'ON',
    'GROUP',
    'ORDER',
    'LEFT',
    'RIGHT',
    'INNER',
    'OUTER',
    'JOIN',
    'SELECT',
    'LIMIT',
    'HAVING',
    'AND',
    'OR',
    'UNION',
    'BY',
]);

// ==================== 平台检测 ====================

export const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
