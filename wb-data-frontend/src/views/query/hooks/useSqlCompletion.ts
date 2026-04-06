/**
 * SQL 智能补全 hook
 * 从 Query.tsx 的 handleEditorDidMount 中提取，负责所有 Monaco 补全逻辑。
 *
 * 职责：
 * 1. 根据光标位置判断上下文（SELECT list / WHERE / FROM / 表.字段）
 * 2. 根据上下文提供数据库、表、字段、关键字、函数等补全建议
 * 3. 支持异步加载字段信息（通过 loadColumns）
 */

import { useCallback, useRef, useEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import type { TableSummary, ColumnMetadata, DialectMetadata } from '../../../api/query';
import { getCurrentStatement, parseSqlSourceTables, isSelectListContext, isExpressionClauseContext } from '../sqlUtils';
import { FALLBACK_SQL_KEYWORDS } from '../queryConstants';

// ==================== Types ====================

export interface SqlCompletionDeps {
    /** 当前可用的表列表 */
    tables: TableSummary[];
    /** 当前可用的数据库列表 */
    databases: string[];
    /** 已加载的字段缓存 (tableName → columns) */
    columnCache: Map<string, ColumnMetadata[]>;
    /** 数据源方言信息（关键字、函数、数据类型） */
    dialectMetadata: DialectMetadata | null;
    /** 当前活跃的数据源 ID */
    activeDsId: string;
    /** 当前活跃的数据库名 */
    activeDb: string;
    /** 异步加载指定表的字段 */
    loadColumns: (dsId: number, dbName: string, tableName: string) => Promise<ColumnMetadata[] | null>;
}

// ==================== Internal helpers ====================

/**
 * 构建前缀匹配排名，用于 sortText 排序。
 * - '0' = 精确匹配
 * - '1' = 前缀匹配
 * - '2' = 包含匹配
 * - '3' = 不匹配
 */
function buildPrefixRank(candidate: string, normalizedWord: string): string {
    const normalizedCandidate = candidate.toLowerCase();
    if (!normalizedWord) return '2';
    if (normalizedCandidate === normalizedWord) return '0';
    if (normalizedCandidate.startsWith(normalizedWord)) return '1';
    if (normalizedCandidate.includes(normalizedWord)) return '2';
    return '3';
}

// ==================== Hook ====================

/**
 * 提供 SQL 补全 provider 的注册函数。
 *
 * 用法（在 handleEditorDidMount 中）：
 * ```
 * const provider = registerCompletionProvider(monaco);
 * completionProviderRef.current = provider;
 * ```
 */
export function useSqlCompletion(deps: SqlCompletionDeps) {
    // 所有依赖都通过 ref 传递，避免 provider 重建
    const tablesRef = useRef(deps.tables);
    const databasesRef = useRef(deps.databases);
    const columnCacheRef = useRef(deps.columnCache);
    const dialectMetadataRef = useRef(deps.dialectMetadata);
    const activeDsIdRef = useRef(deps.activeDsId);
    const activeDbRef = useRef(deps.activeDb);
    const loadColumnsRef = useRef(deps.loadColumns);

    useEffect(() => { tablesRef.current = deps.tables; }, [deps.tables]);
    useEffect(() => { databasesRef.current = deps.databases; }, [deps.databases]);
    useEffect(() => { columnCacheRef.current = deps.columnCache; }, [deps.columnCache]);
    useEffect(() => { dialectMetadataRef.current = deps.dialectMetadata; }, [deps.dialectMetadata]);
    useEffect(() => { activeDsIdRef.current = deps.activeDsId; }, [deps.activeDsId]);
    useEffect(() => { activeDbRef.current = deps.activeDb; }, [deps.activeDb]);
    useEffect(() => { loadColumnsRef.current = deps.loadColumns; }, [deps.loadColumns]);

    /**
     * 注册 Monaco 补全 provider，返回 disposable。
     * 调用方需自行管理 dispose 生命周期。
     */
    const registerCompletionProvider = useCallback((monaco: typeof Monaco) => {
        return monaco.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: ['.', ' '],
            provideCompletionItems: async (model, position) => {
                const word = model.getWordUntilPosition(position);
                const fullText = model.getValue();
                const cursorOffset = model.getOffsetAt(position);
                const currentStatement = getCurrentStatement(fullText, cursorOffset);
                const textBeforeCursor = currentStatement.textBeforeCursor;
                const statementSourceTables = parseSqlSourceTables(currentStatement.text);

                const range: Monaco.IRange = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };

                const suggestions: Monaco.languages.CompletionItem[] = [];
                const suggestionKeys = new Set<string>();
                const currentTables = tablesRef.current;
                const currentDatabases = databasesRef.current;
                const currentColumnCache = columnCacheRef.current;
                const currentDialect = dialectMetadataRef.current;
                const normalizedWord = (word.word || '').toLowerCase();
                const selectedDatabase = activeDbRef.current.toLowerCase();
                const aliases = statementSourceTables.reduce<Record<string, string>>((acc, sourceTable) => {
                    if (sourceTable.alias) {
                        acc[sourceTable.alias.toLowerCase()] = sourceTable.tableName.toLowerCase();
                    }
                    return acc;
                }, {});

                // ---- Helper: deduplicated push ----
                const pushSuggestion = (
                    item: Monaco.languages.CompletionItem,
                    categoryRank: string,
                    dedupeKey?: string,
                ) => {
                    const labelText = typeof item.label === 'string' ? item.label : item.label.label;
                    const key = dedupeKey ?? `${item.kind}:${labelText.toLowerCase()}:${item.detail ?? ''}`;
                    if (suggestionKeys.has(key)) return;

                    suggestionKeys.add(key);
                    suggestions.push({
                        ...item,
                        sortText: `${categoryRank}${buildPrefixRank(labelText, normalizedWord)}-${labelText.toLowerCase()}`,
                    });
                };

                // ---- Helper: push columns for all source tables ----
                const pushSourceColumnSuggestions = async (categoryRank: string) => {
                    const sourceColumns = await Promise.all(statementSourceTables.map(async sourceTable => {
                        const normalizedDatabase = sourceTable.databaseName?.toLowerCase();
                        if (normalizedDatabase && normalizedDatabase !== selectedDatabase) {
                            return { sourceTable, columns: null, resolvedTableName: sourceTable.tableName };
                        }

                        const matchedTable = currentTables.find(table => table.name.toLowerCase() === sourceTable.tableName.toLowerCase());
                        const resolvedTableName = matchedTable?.name || sourceTable.tableName;
                        let cachedCols = currentColumnCache.get(resolvedTableName) || currentColumnCache.get(sourceTable.tableName);

                        if (!cachedCols) {
                            const dsId = activeDsIdRef.current;
                            const db = activeDbRef.current;
                            if (dsId && db) {
                                cachedCols = await loadColumnsRef.current(
                                    Number(dsId),
                                    db,
                                    matchedTable?.name || sourceTable.tableName,
                                ) || undefined;
                            }
                        }

                        return { sourceTable, columns: cachedCols ?? null, resolvedTableName };
                    }));

                    sourceColumns.forEach(({ sourceTable, columns, resolvedTableName }) => {
                        if (!columns) return;

                        const needsQualifiedInsert = Boolean(sourceTable.alias) || statementSourceTables.length > 1;
                        const qualifier = sourceTable.alias || resolvedTableName;

                        columns.forEach(col => {
                            const insertText = needsQualifiedInsert ? `${qualifier}.${col.name}` : col.name;
                            const sourceLabel = sourceTable.alias
                                ? `${sourceTable.alias} (${resolvedTableName})`
                                : resolvedTableName;

                            pushSuggestion({
                                label: col.name,
                                kind: monaco.languages.CompletionItemKind.Field,
                                insertText,
                                filterText: `${col.name} ${insertText} ${resolvedTableName}`,
                                detail: `${sourceLabel} Column (${col.type})`,
                                documentation: col.remarks,
                                range,
                            }, categoryRank, `source-column:${sourceLabel.toLowerCase()}:${col.name.toLowerCase()}`);
                        });
                    });
                };

                // ================================================================
                // 1. Column suggestions for "table." or "alias."
                // ================================================================
                const lastDotIndex = textBeforeCursor.lastIndexOf('.');
                if (lastDotIndex !== -1) {
                    const parts = textBeforeCursor.trim().split(/[\s,()=<>]+/);
                    const lastPart = parts[parts.length - 1];

                    const dotParts = lastPart.split('.');
                    if (dotParts.length >= 2) {
                        const identifier = dotParts[dotParts.length - 2].toLowerCase();
                        const isDatabaseQualifier = currentDatabases.some(db => db.toLowerCase() === identifier);
                        if (isDatabaseQualifier) {
                            if (identifier === selectedDatabase) {
                                currentTables.forEach(table => {
                                    pushSuggestion({
                                        label: table.name,
                                        kind: monaco.languages.CompletionItemKind.Struct,
                                        insertText: table.name,
                                        detail: `Table in ${identifier}`,
                                        documentation: table.remarks,
                                        range,
                                    }, '10', `db-table:${identifier}:${table.name.toLowerCase()}`);
                                });
                            }
                            return { suggestions };
                        }

                        const actualTableName = aliases[identifier] || identifier;

                        const table = currentTables.find(t => t.name.toLowerCase() === actualTableName);
                        let cachedCols = currentColumnCache.get(actualTableName) || currentColumnCache.get(table?.name || '');
                        if (cachedCols) {
                            cachedCols.forEach(col => {
                                pushSuggestion({
                                    label: col.name,
                                    kind: monaco.languages.CompletionItemKind.Field,
                                    insertText: col.name,
                                    detail: `${actualTableName} Column (${col.type})`,
                                    documentation: col.remarks,
                                    range,
                                }, '00', `column:${actualTableName}:${col.name.toLowerCase()}`);
                            });
                            return { suggestions };
                        }

                        const matchedTable = currentTables.find(t => t.name.toLowerCase() === actualTableName);
                        const dsId = activeDsIdRef.current;
                        const db = activeDbRef.current;
                        if (matchedTable && dsId && db) {
                            cachedCols = await loadColumnsRef.current(Number(dsId), db, matchedTable.name) || undefined;
                        }

                        if (cachedCols) {
                            cachedCols.forEach(col => {
                                pushSuggestion({
                                    label: col.name,
                                    kind: monaco.languages.CompletionItemKind.Field,
                                    insertText: col.name,
                                    detail: `${actualTableName} Column (${col.type})`,
                                    documentation: col.remarks,
                                    range,
                                }, '00', `column:${actualTableName}:${col.name.toLowerCase()}`);
                            });
                        }
                        return { suggestions };
                    }
                }

                // ================================================================
                // 2. Column suggestions inside SELECT list
                // ================================================================
                if (isSelectListContext(currentStatement.text, textBeforeCursor) && statementSourceTables.length > 0) {
                    await pushSourceColumnSuggestions('01');
                }

                // ================================================================
                // 3. Column suggestions inside WHERE / ON / HAVING / GROUP BY / ORDER BY
                // ================================================================
                if (isExpressionClauseContext(textBeforeCursor) && statementSourceTables.length > 0) {
                    statementSourceTables.forEach(sourceTable => {
                        if (!sourceTable.alias) return;

                        pushSuggestion({
                            label: sourceTable.alias,
                            kind: monaco.languages.CompletionItemKind.Variable,
                            insertText: sourceTable.alias,
                            detail: `${sourceTable.alias} alias of ${sourceTable.tableName}`,
                            range,
                        }, '02', `alias:${sourceTable.alias.toLowerCase()}`);
                    });

                    await pushSourceColumnSuggestions('01');
                }

                // ================================================================
                // 4. Context-aware database/table suggestions after FROM/JOIN/INTO
                // ================================================================
                const relationContextMatch = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_]*)$/i.exec(textBeforeCursor);
                if (relationContextMatch) {
                    currentDatabases.forEach(database => {
                        pushSuggestion({
                            label: database,
                            kind: monaco.languages.CompletionItemKind.Module,
                            insertText: database,
                            detail: 'Database',
                            range,
                        }, '05', `database:${database.toLowerCase()}`);
                    });
                    currentTables.forEach(table => {
                        pushSuggestion({
                            label: table.name,
                            kind: monaco.languages.CompletionItemKind.Struct,
                            insertText: table.name,
                            detail: `Table (${table.type})`,
                            documentation: table.remarks,
                            range,
                        }, '08', `table:${table.name.toLowerCase()}`);
                    });
                    return { suggestions };
                }

                const useContextMatch = /\b(USE|DATABASE|SCHEMA)\s+([a-zA-Z0-9_]*)$/i.exec(textBeforeCursor);
                if (useContextMatch) {
                    currentDatabases.forEach(database => {
                        pushSuggestion({
                            label: database,
                            kind: monaco.languages.CompletionItemKind.Module,
                            insertText: database,
                            detail: 'Database',
                            range,
                        }, '02', `database:${database.toLowerCase()}`);
                    });
                    return { suggestions };
                }

                // ================================================================
                // 5. General SQL keywords and functions from dialect
                // ================================================================
                const keywordSuggestions = currentDialect?.keywords?.length
                    ? currentDialect.keywords
                    : FALLBACK_SQL_KEYWORDS;

                keywordSuggestions.forEach(keyword => {
                    pushSuggestion({
                        label: keyword,
                        kind: monaco.languages.CompletionItemKind.Keyword,
                        insertText: keyword,
                        range,
                    }, '70', `keyword:${keyword.toLowerCase()}`);
                });

                if (currentDialect) {
                    currentDialect.dataTypes.forEach(dt => {
                        pushSuggestion({
                            label: dt,
                            kind: monaco.languages.CompletionItemKind.TypeParameter,
                            insertText: dt,
                            detail: 'Data Type',
                            range,
                        }, '60', `datatype:${dt.toLowerCase()}`);
                    });

                    currentDialect.functions.forEach(func => {
                        pushSuggestion({
                            label: func.name,
                            kind: monaco.languages.CompletionItemKind.Function,
                            insertText: func.signature || `${func.name}($0)`,
                            insertTextRules: (func.signature || `${func.name}($0)`).includes('$')
                                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                                : undefined,
                            detail: 'Function',
                            documentation: func.description,
                            range,
                        }, '50', `function:${func.name.toLowerCase()}`);
                    });
                }

                // 6. General database / table / column suggestions
                currentDatabases.forEach(database => {
                    pushSuggestion({
                        label: database,
                        kind: monaco.languages.CompletionItemKind.Module,
                        insertText: database,
                        detail: 'Database',
                        range,
                    }, '20', `database:${database.toLowerCase()}`);
                });

                currentTables.forEach(table => {
                    pushSuggestion({
                        label: table.name,
                        kind: monaco.languages.CompletionItemKind.Struct,
                        insertText: table.name,
                        detail: `Table (${table.type})`,
                        documentation: table.remarks,
                        range,
                    }, '30', `table:${table.name.toLowerCase()}`);
                });

                currentColumnCache.forEach((cols, tblName) => {
                    cols.forEach(col => {
                        pushSuggestion({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: col.name,
                            detail: `Column of ${tblName} (${col.type})`,
                            range,
                        }, '40', `column:${tblName}:${col.name.toLowerCase()}`);
                    });
                });

                return { suggestions };
            },
        });
    }, []);

    return { registerCompletionProvider };
}
