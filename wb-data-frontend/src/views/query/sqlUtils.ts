/**
 * Query 页面 SQL 解析工具
 */

import { SQL_ALIAS_RESERVED_WORDS } from './queryConstants';

// ==================== SQL 语句解析 ====================

export interface CurrentStatement {
    text: string;
    textBeforeCursor: string;
    textAfterCursor: string;
}

export function getCurrentStatement(fullText: string, cursorOffset: number): CurrentStatement {
    const safeOffset = Math.max(0, Math.min(cursorOffset, fullText.length));
    const statementStart = fullText.lastIndexOf(';', Math.max(0, safeOffset - 1)) + 1;
    const nextSemicolonIndex = fullText.indexOf(';', safeOffset);
    const statementEnd = nextSemicolonIndex === -1 ? fullText.length : nextSemicolonIndex;

    return {
        text: fullText.slice(statementStart, statementEnd),
        textBeforeCursor: fullText.slice(statementStart, safeOffset),
        textAfterCursor: fullText.slice(safeOffset, statementEnd),
    };
}

// ==================== SQL 源表解析 ====================

export interface SqlSourceTable {
    databaseName?: string;
    tableName: string;
    alias?: string;
}

export function parseSqlSourceTables(statement: string): SqlSourceTable[] {
    const fromMatch = /\bFROM\b/i.exec(statement);
    if (!fromMatch) {
        return [];
    }

    const fromClause = statement.slice(fromMatch.index);
    const sourceTables: SqlSourceTable[] = [];
    const sourceKeys = new Set<string>();
    const sourceRegex = /(?:\bFROM\b|\bJOIN\b|,)\s+(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/gi;

    let match: RegExpExecArray | null;
    while ((match = sourceRegex.exec(fromClause)) !== null) {
        const databaseName = match[1];
        const tableName = match[2];
        const alias = match[3];

        if (SQL_ALIAS_RESERVED_WORDS.has(tableName.toUpperCase())) {
            continue;
        }

        const normalizedAlias = alias && !SQL_ALIAS_RESERVED_WORDS.has(alias.toUpperCase()) ? alias : undefined;
        const sourceKey = `${databaseName?.toLowerCase() || ''}:${tableName.toLowerCase()}:${normalizedAlias?.toLowerCase() || ''}`;
        if (sourceKeys.has(sourceKey)) {
            continue;
        }

        sourceKeys.add(sourceKey);
        sourceTables.push({
            databaseName,
            tableName,
            alias: normalizedAlias,
        });
    }

    return sourceTables;
}

// ==================== SQL 上下文检测 ====================

export function isSelectListContext(statement: string, textBeforeCursor: string): boolean {
    const selectMatch = /^\s*SELECT\b/i.exec(statement);
    const fromMatch = /\bFROM\b/i.exec(statement);
    if (!selectMatch || !fromMatch) {
        return false;
    }

    const cursorIndex = textBeforeCursor.length;
    return cursorIndex >= selectMatch[0].length && cursorIndex <= fromMatch.index;
}

export function isExpressionClauseContext(textBeforeCursor: string): boolean {
    return (
        /\b(WHERE|AND|OR|ON|HAVING)\s+([a-zA-Z0-9_]*)$/i.test(textBeforeCursor) ||
        /\b(GROUP\s+BY|ORDER\s+BY)\s+([a-zA-Z0-9_]*)$/i.test(textBeforeCursor)
    );
}
