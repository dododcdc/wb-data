import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback } from 'react';
import { Play, Loader2, Code2, Wand2, Download, FileText, Sheet, Database, ChevronRight, ChevronDown, Search, PanelLeftClose, PanelLeft } from 'lucide-react';
import { format as formatSql } from 'sql-formatter';
import * as XLSX from 'xlsx';
import { getMetadataDatabases, getMetadataTables, getMetadataColumns, executeQuery, getDialectMetadata, TableSummary, ColumnMetadata, QueryResult, DialectMetadata, PageResult } from '../api/query';
import { getDataSourcePage, DataSource } from '../api/datasource';
import { DataSourceSelect } from '../components/DataSourceSelect';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePanelRef } from 'react-resizable-panels';
import './Query.css';

// Lazy load Monaco Editor for performance (~3MB savings on initial load)
const Editor = lazy(() => import('@monaco-editor/react').then(mod => ({ default: mod.default })));

function EditorLoader() {
    return (
        <div className="editor-loader">
            <Loader2 className="animate-spin" size={24} />
            <span>加载编辑器...</span>
        </div>
    );
}


const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const DS_PAGE_SIZE = 50;

export default function Query() {
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [selectedDsId, setSelectedDsId] = useState<string>('');
    const [selectedDs, setSelectedDs] = useState<DataSource | null>(null);
    const [dsKeyword, setDsKeyword] = useState('');
    const [loadingDs, setLoadingDs] = useState(false);
    const [loadingDsMore, setLoadingDsMore] = useState(false);
    const [dsPage, setDsPage] = useState(1);
    const [dsHasMore, setDsHasMore] = useState(true);
    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDb, setSelectedDb] = useState<string>('');
    const [dbKeyword, setDbKeyword] = useState('');
    const [loadingDatabases, setLoadingDatabases] = useState(false);
    const [tables, setTables] = useState<TableSummary[]>([]);
    const [tableKeyword, setTableKeyword] = useState('');
    const [tableKeywordCommitted, setTableKeywordCommitted] = useState('');
    const [tablePage, setTablePage] = useState(1);
    const [tableHasMore, setTableHasMore] = useState(true);
    const [tableTotal, setTableTotal] = useState(0);
    const [loadingTables, setLoadingTables] = useState(false);
    const [loadingMoreTables, setLoadingMoreTables] = useState(false);
    const [columnCache, setColumnCache] = useState<Map<string, ColumnMetadata[]>>(new Map());
    const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());
    const [dialectMetadata, setDialectMetadata] = useState<DialectMetadata | null>(null);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [sql, setSql] = useState('');
    const [result, setResult] = useState<QueryResult | null>(null);
    const [queryError, setQueryError] = useState<string>('');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
    const editorRef = useRef<any>(null);
    const composingRef = useRef(false);
    const dsRequestIdRef = useRef(0);
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const [tableScrollElement, setTableScrollElement] = useState<HTMLDivElement | null>(null);
    const TABLE_PAGE_SIZE = 200;

    const SIDEBAR_STORAGE_KEY = 'query-sidebar-collapsed';
    const sidebarPanelRef = usePanelRef();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
    const userToggledRef = useRef(false);

    const virtualizer = useVirtualizer({
        count: tables.length,
        getScrollElement: () => tableScrollElement,
        estimateSize: () => 36,
        overscan: 10,
    });

    const handleTableScrollRef = useCallback((node: HTMLDivElement | null) => {
        if (tableScrollRef.current === node) return;
        tableScrollRef.current = node;
        setTableScrollElement(node);
    }, []);

    const toggleSidebar = useCallback(() => {
        const panel = sidebarPanelRef.current;
        if (!panel) return;
        userToggledRef.current = true;
        if (panel.isCollapsed()) {
            panel.expand();
        } else {
            panel.collapse();
        }
    }, [sidebarPanelRef]);

    const handleSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
        const panel = sidebarPanelRef.current;
        if (!panel) return;
        const collapsed = panel.isCollapsed();
        setSidebarCollapsed(prev => {
            if (prev !== collapsed) {
                try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed)); } catch {}
            }
            return collapsed;
        });
    }, [sidebarPanelRef]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                toggleSidebar();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [toggleSidebar]);

    useEffect(() => {
        if (sidebarCollapsed) {
            requestAnimationFrame(() => {
                sidebarPanelRef.current?.collapse();
            });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Close export menu on backdrop click or Escape
    useEffect(() => {
        if (!showExportMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setShowExportMenu(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowExportMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [showExportMenu]);

    // Debounced search for DataSources
    useEffect(() => {
        const timer = setTimeout(() => {
            setDataSources([]);
            setDsHasMore(true);
            setDsPage(1);
            setLoadingDsMore(false);
            loadDataSources({ page: 1, keyword: dsKeyword, append: false });
        }, 300);
        return () => clearTimeout(timer);
    }, [dsKeyword]);

    useEffect(() => {
        if (selectedDsId) {
            setDbKeyword('');
            setSelectedDb('');
            setDatabases([]);
            setTables([]);
            setColumnCache(new Map());
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTableTotal(0);
            loadDatabases(Number(selectedDsId));
            loadDialect(Number(selectedDsId));
        } else {
            setDatabases([]);
            setSelectedDb('');
            setDbKeyword('');
            setTables([]);
            setColumnCache(new Map());
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTableTotal(0);
            setDialectMetadata(null);
            setSelectedDs(null);
        }
    }, [selectedDsId]);

    useEffect(() => {
        if (selectedDsId && selectedDb) {
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTablePage(1);
            setTableHasMore(true);
            setTableTotal(0);
            setColumnCache(new Map());
            loadTables(Number(selectedDsId), selectedDb);
        }
    }, [selectedDsId, selectedDb]);

    useEffect(() => {
        if (!selectedDsId || !selectedDb) return;
        const timer = setTimeout(() => {
            setTablePage(1);
            setTableHasMore(true);
            loadTables(Number(selectedDsId), selectedDb, tableKeywordCommitted, 1, false);
        }, 300);
        return () => clearTimeout(timer);
    }, [tableKeywordCommitted]);

    useEffect(() => {
        setExpandedTables(new Set());
    }, [selectedDsId, selectedDb]);

    useEffect(() => {
        if (tables.length > 0 && sidebarCollapsed && !userToggledRef.current) {
            sidebarPanelRef.current?.expand();
        }
    }, [tables.length > 0]);

    const toggleTableExpand = (tableName: string) => {
        setExpandedTables(prev => {
            const next = new Set(prev);
            if (next.has(tableName)) {
                next.delete(tableName);
            } else {
                next.add(tableName);
                if (!columnCache.has(tableName) && selectedDsId && selectedDb) {
                    loadColumns(Number(selectedDsId), selectedDb, tableName);
                }
            }
            return next;
        });
    };

    const loadDataSources = async ({ page, keyword, append }: { page: number; keyword: string; append: boolean; }) => {
        const requestId = ++dsRequestIdRef.current;
        if (append) {
            setLoadingDsMore(true);
        } else {
            setLoadingDs(true);
        }
        try {
            const data = await getDataSourcePage({ page, size: DS_PAGE_SIZE, keyword });
            if (requestId !== dsRequestIdRef.current) {
                return;
            }
            setDataSources((prev) => {
                if (!append) {
                    return data.records;
                }
                const existingIds = new Set(prev.map(item => item.id));
                const merged = [...prev, ...data.records.filter(item => !existingIds.has(item.id))];
                return merged;
            });
            const hasMore = data.pages ? data.current < data.pages : data.records.length === DS_PAGE_SIZE;
            setDsPage(data.current || page);
            setDsHasMore(hasMore);
        } catch (error) {
            console.error('Failed to load data sources', error);
        } finally {
            if (requestId === dsRequestIdRef.current) {
                if (append) {
                    setLoadingDsMore(false);
                } else {
                    setLoadingDs(false);
                }
            }
        }
    };

    const loadMoreDataSources = () => {
        if (loadingDs || loadingDsMore || !dsHasMore) {
            return;
        }
        loadDataSources({ page: dsPage + 1, keyword: dsKeyword, append: true });
    };

    const loadDialect = async (id: number) => {
        try {
            const data = await getDialectMetadata(id);
            setDialectMetadata(data);
        } catch (error) {
            console.error('Failed to load dialect metadata', error);
        }
    };

    const loadDatabases = async (id: number) => {
        setLoadingDatabases(true);
        try {
            const data = await getMetadataDatabases(id);
            setDatabases(data);
            // Default select the first database if available
            if (data.length > 0) {
                setSelectedDb(data[0]);
            }
        } catch (error) {
            console.error('Failed to load databases', error);
        } finally {
            setLoadingDatabases(false);
        }
    };

    const loadTables = async (dsId: number, dbName: string, keyword?: string, page: number = 1, append: boolean = false) => {
        if (append) {
            setLoadingMoreTables(true);
        } else {
            setLoadingTables(true);
        }
        try {
            const result = await getMetadataTables(dsId, dbName, keyword || undefined, page, TABLE_PAGE_SIZE);
            if (append) {
                setTables(prev => [...prev, ...result.data]);
            } else {
                setTables(result.data);
            }
            setTableTotal(result.total);
            const loadedSoFar = append ? (page - 1) * TABLE_PAGE_SIZE + result.data.length : result.data.length;
            setTableHasMore(loadedSoFar < result.total);
            setTablePage(page);
        } catch (error) {
            console.error('Failed to load tables', error);
        } finally {
            setLoadingTables(false);
            setLoadingMoreTables(false);
        }
    };

    const loadColumns = async (dsId: number, dbName: string, tableName: string) => {
        if (columnCache.has(tableName)) return;
        setLoadingColumns(prev => new Set(prev).add(tableName));
        try {
            const cols = await getMetadataColumns(dsId, dbName, tableName);
            setColumnCache(prev => new Map(prev).set(tableName, cols));
        } catch (error) {
            console.error('Failed to load columns for', tableName, error);
        } finally {
            setLoadingColumns(prev => {
                const next = new Set(prev);
                next.delete(tableName);
                return next;
            });
        }
    };

    const handleTableScroll = useCallback(() => {
        const el = tableScrollRef.current;
        if (!el || loadingMoreTables || !tableHasMore || !selectedDsId || !selectedDb) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight - scrollTop - clientHeight < 100) {
            loadTables(Number(selectedDsId), selectedDb, tableKeywordCommitted || undefined, tablePage + 1, true);
        }
    }, [loadingMoreTables, tableHasMore, selectedDsId, selectedDb, tableKeywordCommitted, tablePage]);

    const selectedDsOption = useMemo(() => {
        if (!selectedDs) {
            return null;
        }
        return { label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs };
    }, [selectedDs]);

    const dataSourceOptions = useMemo(() => {
        const base = dataSources.map(ds => ({ label: ds.name, value: String(ds.id), type: ds.type, raw: ds }));
        if (!selectedDs || base.some(opt => opt.value === String(selectedDs.id))) {
            return base;
        }
        return [{ label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs }, ...base];
    }, [dataSources, selectedDs]);

    const filteredDatabases = useMemo(() => {
        if (!dbKeyword) {
            return databases;
        }
        const normalized = dbKeyword.toLowerCase();
        return databases.filter(db => db.toLowerCase().includes(normalized));
    }, [databases, dbKeyword]);

    const databaseOptions = useMemo(() => {
        return filteredDatabases.map(db => ({ label: db, value: db }));
    }, [filteredDatabases]);

    const selectedDbOption = useMemo(() => {
        if (!selectedDb) {
            return null;
        }
        return { label: selectedDb, value: selectedDb };
    }, [selectedDb]);

    const handleRunQuery = async (sqlToRun?: string) => {
        let finalSql = sqlToRun;

        // If no explicit SQL provided (e.g. from button click), check for selection
        if (!finalSql && editorRef.current) {
            const selection = editorRef.current.getSelection();
            if (selection && !selection.isEmpty()) {
                finalSql = editorRef.current.getModel()?.getValueInRange(selection);
            }
        }

        // Fallback to full editor content if still no specific SQL
        finalSql = finalSql ?? sql;

        if (!selectedDsId) {
            alert('请先选择数据源');
            return;
        }
        if (!finalSql.trim()) {
            alert('Nothing to run - 请输入 SQL 语句');
            return;
        }
        setLoadingQuery(true);
        try {
            const data = await executeQuery(Number(selectedDsId), finalSql, selectedDb);
            setResult(data);
            setQueryError('');
        } catch (error: any) {
            // axios 错误: error.response.data.message 包含后端返回的详细消息
            const message = error?.response?.data?.message 
                || error?.message 
                || '执行查询失败';
            setQueryError(message);
        } finally {
            setLoadingQuery(false);
        }
    };

    // ── SQL Formatting ──────────────────────────────────────────────────────
    const handleFormat = () => {
        if (!editorRef.current) return;
        const raw = editorRef.current.getValue();
        try {
            const formatted = formatSql(raw, { language: 'sql', tabWidth: 4, keywordCase: 'upper' });
            editorRef.current.setValue(formatted);
        } catch {
            // If sql-formatter can't parse it, leave as-is
        }
    };

    // ── Result Export ────────────────────────────────────────────────────────
    const exportFileName = () => {
        const ds = selectedDs || dataSources.find(d => String(d.id) === selectedDsId);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `query-result-${ds?.name ?? 'export'}-${ts}`;
    };

    const exportCsv = () => {
        if (!result) return;
        const header = result.columns.map(c => c.name).join(',');
        const rows = result.rows.map(row =>
            result.columns.map(c => {
                const val = String(row[c.name] ?? '');
                return val.includes(',') || val.includes('\n') || val.includes('"')
                    ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(',')
        );
        const csv = [header, ...rows].join('\n');
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        triggerDownload(blob, `${exportFileName()}.csv`);
        setShowExportMenu(false);
    };

    const exportExcel = () => {
        if (!result) return;
        const data = [
            result.columns.map(c => c.name),
            ...result.rows.map(row => result.columns.map(c => row[c.name] ?? ''))
        ];
        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Result');
        XLSX.writeFile(wb, `${exportFileName()}.xlsx`);
        setShowExportMenu(false);
    };

    const triggerDownload = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    /**
     * Extracts the SQL statement the cursor is currently on.
     * Splits the full text by semicolons and finds the segment that contains
     * the cursor's character offset position — like DataGrip.
     */
    const getStatementAtCursor = (editor: any): string => {
        const model = editor.getModel();
        const position = editor.getPosition();
        if (!model || !position) return sql;

        const fullText = model.getValue();
        const cursorOffset = model.getOffsetAt(position);

        // Split statements by semicolons
        const stmts: { start: number; end: number; text: string }[] = [];
        let start = 0;
        for (let i = 0; i <= fullText.length; i++) {
            if (i === fullText.length || fullText[i] === ';') {
                const text = fullText.slice(start, i).trim();
                if (text) stmts.push({ start, end: i, text });
                start = i + 1;
            }
        }

        // Find the statement where the cursor is
        for (const stmt of stmts) {
            if (cursorOffset >= stmt.start && cursorOffset <= stmt.end + 1) {
                return stmt.text;
            }
        }

        // Fallback: return the full SQL
        return fullText.trim();
    };

    const handleRunQueryRef = useRef(handleRunQuery);
    useEffect(() => {
        handleRunQueryRef.current = handleRunQuery;
    }, [handleRunQuery]);

    const getStatementAtCursorRef = useRef(getStatementAtCursor);
    useEffect(() => {
        getStatementAtCursorRef.current = getStatementAtCursor;
    }, [getStatementAtCursor]);

    const tablesRef = useRef(tables);
    useEffect(() => {
        tablesRef.current = tables;
    }, [tables]);

    const columnCacheRef = useRef(columnCache);
    useEffect(() => {
        columnCacheRef.current = columnCache;
    }, [columnCache]);

    const dialectMetadataRef = useRef(dialectMetadata);
    useEffect(() => {
        dialectMetadataRef.current = dialectMetadata;
    }, [dialectMetadata]);

    const handleEditorDidMount = (editor: any, monaco: any) => {
        editorRef.current = editor;

        // Register custom completion provider for SQL
        const provider = monaco.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: ['.'],
            provideCompletionItems: (model: any, position: any) => {
                const word = model.getWordUntilPosition(position);
                const lineContent = model.getLineContent(position.lineNumber);
                const textBeforeCursor = lineContent.substring(0, position.column - 1);

                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };

                const suggestions: any[] = [];
                const currentTables = tablesRef.current;
                const currentColumnCache = columnCacheRef.current;
                const currentDialect = dialectMetadataRef.current;

                // --- Extract Aliases ---
                const fullText = model.getValue();
                const aliases: Record<string, string> = {};
                // Match "FROM table alias", "FROM schema.table AS alias", "JOIN table alias", or ", table alias"
                const aliasRegex = /(?:FROM|JOIN|,)\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)(?:\s+AS)?\s+([a-zA-Z0-9_]+)/gi;
                const reservedWords = new Set(['WHERE', 'ON', 'GROUP', 'ORDER', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'JOIN', 'SELECT', 'LIMIT', 'HAVING', 'AND', 'OR', 'AS']);
                let match;
                while ((match = aliasRegex.exec(fullText)) !== null) {
                    const tableName = match[1].toLowerCase();
                    const aliasName = match[2].toLowerCase();
                    if (!reservedWords.has(aliasName.toUpperCase()) && !reservedWords.has(tableName.toUpperCase())) {
                        aliases[aliasName] = tableName;
                    }
                }

                // 1. Column suggestions for "table." or "alias."
                const lastDotIndex = textBeforeCursor.lastIndexOf('.');
                if (lastDotIndex !== -1) {
                    const parts = textBeforeCursor.trim().split(/[\s,()=<>]+/); // Split by boundary characters
                    const lastPart = parts[parts.length - 1]; // e.g. "t1" or "t1." or "t1.id."

                    const dotParts = lastPart.split('.');
                    // If we have at least one dot, the identifier is the part just before the last dot
                    if (dotParts.length >= 2) {
                        const identifier = dotParts[dotParts.length - 2].toLowerCase();
                        const actualTableName = aliases[identifier] || identifier;

                        const table = currentTables.find(t => t.name.toLowerCase() === actualTableName);
                        const cachedCols = currentColumnCache.get(actualTableName) || currentColumnCache.get(table?.name || '');
                        if (cachedCols) {
                            cachedCols.forEach(col => {
                                suggestions.push({
                                    label: col.name,
                                    kind: monaco.languages.CompletionItemKind.Field,
                                    insertText: col.name,
                                    detail: `${actualTableName} Column (${col.type})`,
                                    documentation: col.remarks,
                                    range: range,
                                });
                            });
                            return { suggestions };
                        }

                        const matchedTable = currentTables.find(t => t.name.toLowerCase() === actualTableName);
                        if (matchedTable && selectedDsId && selectedDb) {
                            loadColumns(Number(selectedDsId), selectedDb, matchedTable.name);
                        }
                        return { suggestions };
                    }
                }

                // 2. Context-aware table suggestions (after FROM or JOIN)
                const isAfterFromOrJoin = /\b(FROM|JOIN)\s+$/i.test(textBeforeCursor);
                if (isAfterFromOrJoin) {
                    currentTables.forEach(table => {
                        suggestions.push({
                            label: table.name,
                            kind: monaco.languages.CompletionItemKind.Struct,
                            insertText: table.name,
                            detail: `Table (${table.type})`,
                            documentation: table.remarks,
                            range: range,
                            sortText: '1' // Prioritize tables in this context
                        });
                    });
                    return { suggestions };
                }

                // 3. Add General SQL Keywords and Functions from Dialect
                if (currentDialect) {
                    currentDialect.keywords.forEach(keyword => {
                        suggestions.push({
                            label: keyword,
                            kind: monaco.languages.CompletionItemKind.Keyword,
                            insertText: keyword,
                            range: range,
                            sortText: '9' // Lower priority
                        });
                    });

                    currentDialect.dataTypes.forEach(dt => {
                        suggestions.push({
                            label: dt,
                            kind: monaco.languages.CompletionItemKind.TypeParameter,
                            insertText: dt,
                            detail: 'Data Type',
                            range: range,
                            sortText: '8'
                        });
                    });

                    currentDialect.functions.forEach(func => {
                        suggestions.push({
                            label: func.name,
                            kind: monaco.languages.CompletionItemKind.Function,
                            insertText: func.signature || `${func.name}($0)`,
                            insertTextRules: (func.signature || `${func.name}($0)`).includes('$')
                                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                                : undefined,
                            detail: 'Function',
                            documentation: func.description,
                            range: range,
                            sortText: '8'
                        });
                    });
                }

                currentTables.forEach(table => {
                    suggestions.push({
                        label: table.name,
                        kind: monaco.languages.CompletionItemKind.Struct,
                        insertText: table.name,
                        detail: `Table (${table.type})`,
                        documentation: table.remarks,
                        range: range,
                        sortText: '5'
                    });
                });

                currentColumnCache.forEach((cols, tblName) => {
                    cols.forEach(col => {
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: col.name,
                            detail: `Column of ${tblName} (${col.type})`,
                            range: range,
                            sortText: '7'
                        });
                    });
                });

                return { suggestions };
            },
        });

        // Store provider to dispose on unmount
        (editor as any)._completionProvider = provider;

        // Add Cmd+Enter / Ctrl+Enter: run selection if exists, else only the statement under the cursor
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const selection = editor.getSelection();
            if (selection && !selection.isEmpty()) {
                const selectedText = editor.getModel()?.getValueInRange(selection);
                handleRunQueryRef.current(selectedText);
            } else {
                const stmt = getStatementAtCursorRef.current(editor);
                handleRunQueryRef.current(stmt);
            }
        });

        // Add Shift+Alt+F (Win/Linux) or Shift+Cmd+F (Mac): format SQL
        const formatKeybinding = isMac
            ? monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF
            : monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF;
        editor.addAction({
            id: 'format-sql',
            label: 'Format SQL',
            keybindings: [formatKeybinding],
            run: () => handleFormat(),
        });
    };

    return (
        <div className="query-splitter">
            <ResizablePanelGroup className="query-splitter-panel" direction="horizontal">
                {/* 左侧元数据面板 */}
                <ResizablePanel
                    panelRef={sidebarPanelRef}
                    defaultSize={sidebarCollapsed ? 0 : 300}
                    minSize={250}
                    maxSize={600}
                    collapsible
                    collapsedSize={0}
                    onResize={handleSidebarResize}
                    className="metadata-panel-wrapper"
                >
                    <aside className={`metadata-panel ${!sidebarCollapsed ? 'sidebar-visible' : ''}`}>
                        <div className="metadata-header">
                            <span className="metadata-title">表结构</span>
                            {selectedDsId && selectedDb && tableTotal > 0 && (
                                <span className="metadata-total-count">共 {tableTotal} 张表</span>
                            )}
                        </div>
                        {selectedDsId && selectedDb && (
                            <div className="metadata-search">
                                <Search size={14} className="metadata-search-icon" />
                                <input
                                    type="text"
                                    className="metadata-search-input"
                                    placeholder="搜索表名..."
                                    value={tableKeyword}
                                    onChange={(e) => {
                                        setTableKeyword(e.target.value);
                                        if (!composingRef.current) {
                                            setTableKeywordCommitted(e.target.value);
                                        }
                                    }}
                                    onCompositionStart={() => { composingRef.current = true; }}
                                    onCompositionEnd={(e) => {
                                        composingRef.current = false;
                                        const val = (e.target as HTMLInputElement).value;
                                        setTableKeyword(val);
                                        setTableKeywordCommitted(val);
                                    }}
                                />
                            </div>
                        )}
                        <div
                            className="metadata-content"
                            ref={handleTableScrollRef}
                            onScroll={handleTableScroll}
                        >
                            {loadingTables ? (
                                <div className="metadata-empty">
                                    <Loader2 size={24} className="animate-spin" />
                                    <span>加载中...</span>
                                </div>
                            ) : tables.length === 0 ? (
                                <div className="metadata-empty">
                                    <Database size={32} className="metadata-empty-icon" />
                                    <span>{selectedDsId && selectedDb ? (tableKeyword ? '未找到匹配的表' : '该数据库下没有表') : '请先选择数据源和数据库'}</span>
                                </div>
                            ) : (
                                <div
                                    style={{
                                        height: `${virtualizer.getTotalSize()}px`,
                                        width: '100%',
                                        position: 'relative',
                                    }}
                                >
                                    {virtualizer.getVirtualItems().map(virtualRow => {
                                        const table = tables[virtualRow.index];
                                        if (!table) return null;
                                        const isExpanded = expandedTables.has(table.name);
                                        const cols = columnCache.get(table.name);
                                        const isLoadingCols = loadingColumns.has(table.name);
                                        return (
                                            <div
                                                key={table.name}
                                                data-index={virtualRow.index}
                                                ref={virtualizer.measureElement}
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    transform: `translateY(${virtualRow.start}px)`,
                                                }}
                                            >
                                                <div className="metadata-item">
                                                    <button
                                                        type="button"
                                                        className="metadata-item-header"
                                                        onClick={() => toggleTableExpand(table.name)}
                                                        aria-expanded={isExpanded}
                                                        aria-label={`${isExpanded ? '收起' : '展开'} ${table.name} 字段`}
                                                    >
                                                        {isExpanded
                                                            ? <ChevronDown size={14} className="metadata-chevron" />
                                                            : <ChevronRight size={14} className="metadata-chevron" />
                                                        }
                                                        <Database size={14} className="metadata-icon" />
                                                        <span className="metadata-item-name">{table.name}</span>
                                                    </button>
                                                    {isExpanded && (
                                                        <ul className="metadata-columns">
                                                            {isLoadingCols ? (
                                                                <li className="metadata-column-loading">
                                                                    <Loader2 size={12} className="animate-spin" />
                                                                    <span>加载字段...</span>
                                                                </li>
                                                            ) : cols ? (
                                                                <>
                                                                    {cols.slice(0, 50).map(col => (
                                                                        <li key={col.name} className="metadata-column">
                                                                            <span className="column-name">{col.name}</span>
                                                                            <span className="column-type">{col.type}</span>
                                                                        </li>
                                                                    ))}
                                                                    {cols.length > 50 && (
                                                                        <li className="metadata-more">
                                                                            还有 {cols.length - 50} 个字段...
                                                                        </li>
                                                                    )}
                                                                </>
                                                            ) : null}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {loadingMoreTables && (
                                <div className="metadata-loading-more">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>加载更多...</span>
                                </div>
                            )}
                        </div>
                    </aside>
                </ResizablePanel>

                <ResizableHandle className={`splitter-trigger-horizontal ${sidebarCollapsed ? 'splitter-hidden' : ''}`} data-orientation="horizontal" disabled={sidebarCollapsed}>
                    <div className="splitter-indicator-horizontal" />
                </ResizableHandle>

                {/* 右侧主内容区 */}
                <ResizablePanel defaultSize={800} minSize={600} className="query-main-wrapper">
                    <header className="query-toolbar">
                        <div className="toolbar-left">
                            <TooltipProvider delayDuration={400}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            className="sidebar-toggle-button toolbar-sidebar-toggle"
                                            onClick={toggleSidebar}
                                            aria-label={sidebarCollapsed ? '展开表结构' : '收起表结构'}
                                        >
                                            {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        {sidebarCollapsed ? '展开表结构' : '收起表结构'} <kbd>{isMac ? '⌘' : 'Ctrl'}+B</kbd>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <span className="toolbar-divider" />
                            <DataSourceSelect
                                options={dataSourceOptions}
                                value={String(selectedDsId)}
                                selectedOption={selectedDsOption}
                                onChange={(val, option) => {
                                    setSelectedDsId(val);
                                    setDsKeyword('');
                                    if (option?.raw) {
                                        setSelectedDs(option.raw);
                                        return;
                                    }
                                    const fallback = dataSources.find(ds => String(ds.id) === val) || null;
                                    setSelectedDs(fallback);
                                }}
                                onInputChange={(val) => setDsKeyword(val)}
                                loading={loadingDs}
                                loadingMore={loadingDsMore}
                                hasMore={dsHasMore}
                                onLoadMore={loadMoreDataSources}
                                placeholder="搜索并选择数据源..."
                                theme="light"
                                disableClientFilter
                                virtualize
                                virtualItemSize={32}
                                ariaLabel="数据源选择"
                                emptyText={dsKeyword ? '未找到匹配的数据源' : '暂无数据源'}
                            />
                            {selectedDsId && (
                                <>
                                    <span className="breadcrumb-divider">/</span>
                                    <DataSourceSelect
                                        options={databaseOptions}
                                        value={selectedDb}
                                        selectedOption={selectedDbOption}
                                        onChange={(val) => setSelectedDb(val)}
                                        onInputChange={(val) => setDbKeyword(val)}
                                        loading={loadingDatabases}
                                        placeholder="选择数据库"
                                        theme="light"
                                        disableClientFilter
                                        ariaLabel="数据库选择"
                                        emptyText={dbKeyword ? '未找到匹配数据库' : '暂无数据库'}
                                    />
                                </>
                            )}
                        </div>
                        <div className="toolbar-right">
                            <TooltipProvider delayDuration={400}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            className="format-button-inline"
                                            onClick={handleFormat}
                                            aria-label="格式化 SQL"
                                        >
                                            <Wand2 size={16} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        格式化 <kbd>{isMac ? '⌘' : 'Ctrl'}+⇧+F</kbd>
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            className="run-button"
                                            onClick={() => handleRunQuery()}
                                            aria-label="执行 SQL"
                                        >
                                            {loadingQuery ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="white" />}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        执行 <kbd>{isMac ? '⌘' : 'Ctrl'}+↵</kbd>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </header>

                    <ResizablePanelGroup className="query-vertical-splitter" direction="vertical">
                        <ResizablePanel defaultSize={60} minSize={30} className="query-splitter-panel-vertical">
                            <section className="editor-section">

                                <div className="editor-wrapper">
                                    <Suspense fallback={<EditorLoader />}>
                                        <Editor
                                            height="100%"
                                            language="sql"
                                            theme="vs"
                                            value={sql}
                                            onChange={(value) => setSql(value || '')}
                                            onMount={handleEditorDidMount}
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 14,
                                                lineNumbers: 'on',
                                                lineNumbersMinChars: 2,
                                                lineDecorationsWidth: 8,
                                                glyphMargin: false,
                                                scrollBeyondLastLine: false,
                                                automaticLayout: true,
                                                padding: { top: 12, bottom: 12 },
                                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                                roundedSelection: false,
                                                cursorStyle: 'line',
                                                renderLineHighlight: 'all',
                                            }}
                                        />
                                    </Suspense>
                                </div>
                            </section>
                        </ResizablePanel>

                        <ResizableHandle className="splitter-trigger-vertical" data-orientation="vertical">
                            <div className="splitter-indicator-vertical" />
                        </ResizableHandle>

                        <ResizablePanel defaultSize={40} minSize={20} className="query-splitter-panel-vertical">
                            <section className="results-section">
                                <div className="section-header">
                                    <span className="section-title">查询结果</span>
                                    <div className="section-header-right">
                                        {result && (
                                            <div className="result-info">
                                                找到 {result.rows.length} 条记录 • 耗时 {result.executionTimeMs}ms
                                            </div>
                                        )}
                                        {result && result.columns.length > 0 && (
                                            <div className="export-wrapper" ref={exportMenuRef}>
                                                <button
                                                    className="export-button"
                                                    onClick={() => setShowExportMenu(v => !v)}
                                                    title="导出结果"
                                                >
                                                    <Download size={14} />
                                                    <span>导出</span>
                                                </button>
                                                {showExportMenu && (
                                                    <div className="export-menu">
                                                        <button className="export-menu-item" onClick={exportCsv}>
                                                            <FileText size={14} />
                                                            <span>导出 CSV</span>
                                                        </button>
                                                        <button className="export-menu-item" onClick={exportExcel}>
                                                            <Sheet size={14} />
                                                            <span>导出 Excel (.xlsx)</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="results-container">
                                    {queryError ? (
                                        <div className="result-error">
                                            <span>执行失败：{queryError}</span>
                                        </div>
                                    ) : !result ? (
                                        <div className="empty-results">
                                            <Code2 size={48} className="empty-icon" />
                                            <span>暂无查询结果。请运行 SQL 语句以查看数据。</span>
                                        </div>
                                    ) : result.message !== 'Success' && (!result.columns || result.columns.length === 0) ? (
                                        <div className="result-message">
                                            <strong>执行信息：</strong>
                                            <pre>{result.message}</pre>
                                        </div>
                                    ) : (
                                        <table className="results-table">
                                            <thead>
                                                <tr>
                                                    {result.columns.map(col => (
                                                        <th key={col.name}>
                                                            <div className="th-content">
                                                                <span className="th-name">{col.name}</span>
                                                                <span className="th-type">{col.type}</span>
                                                            </div>
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.rows.map((row, idx) => (
                                                    <tr key={idx}>
                                                        {result.columns.map(col => (
                                                            <td key={col.name} title={String(row[col.name] ?? '')}>
                                                                {String(row[col.name] ?? '')}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </section>
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
