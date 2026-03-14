import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Database, Table, Columns, Loader2, Code2, Wand2, Download, FileText, Sheet } from 'lucide-react';
import { format as formatSql } from 'sql-formatter';
import * as XLSX from 'xlsx';
import { getMetadataDatabases, getMetadataTables, executeQuery, getDialectMetadata, TableMetadata, QueryResult, DialectMetadata } from '../api/query';
import { getDataSourcePage, DataSource } from '../api/datasource';
import { DataSourceSelect } from '../components/DataSourceSelect';
import { Splitter } from '@ark-ui/react/splitter';
import { Tooltip } from '@ark-ui/react/tooltip';
import './Query.css';

export default function Query() {
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [selectedDsId, setSelectedDsId] = useState<string>('');
    const [dsKeyword, setDsKeyword] = useState('');
    const [loadingDs, setLoadingDs] = useState(false);
    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDb, setSelectedDb] = useState<string>('');
    const [metadata, setMetadata] = useState<TableMetadata[]>([]);
    const [dialectMetadata, setDialectMetadata] = useState<DialectMetadata | null>(null);
    const [loadingMetadata, setLoadingMetadata] = useState(false);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [sql, setSql] = useState('');
    const [result, setResult] = useState<QueryResult | null>(null);
    const [queryError, setQueryError] = useState<string>('');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const editorRef = useRef<any>(null);

    useEffect(() => {
        loadDataSources();
    }, []);

    // Debounced search for DataSources
    useEffect(() => {
        const timer = setTimeout(() => {
            loadDataSources(dsKeyword);
        }, 300);
        return () => clearTimeout(timer);
    }, [dsKeyword]);

    useEffect(() => {
        if (selectedDsId) {
            loadDatabases(Number(selectedDsId));
            loadDialect(Number(selectedDsId));
        } else {
            setDatabases([]);
            setSelectedDb('');
            setMetadata([]);
            setDialectMetadata(null);
        }
    }, [selectedDsId]);

    useEffect(() => {
        if (selectedDsId && selectedDb) {
            loadMetadata(Number(selectedDsId), selectedDb);
        }
    }, [selectedDsId, selectedDb]);

    const loadDataSources = async (keyword?: string) => {
        setLoadingDs(true);
        try {
            const data = await getDataSourcePage({ page: 1, size: 50, keyword });
            setDataSources(data.records);
        } catch (error) {
            console.error('Failed to load data sources', error);
        } finally {
            setLoadingDs(false);
        }
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
        setLoadingMetadata(true);
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
            setLoadingMetadata(false);
        }
    };

    const loadMetadata = async (id: number, dbName: string) => {
        setLoadingMetadata(true);
        try {
            const data = await getMetadataTables(id, dbName);
            setMetadata(data);
        } catch (error) {
            console.error('Failed to load metadata', error);
        } finally {
            setLoadingMetadata(false);
        }
    };

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
            const data = await executeQuery(Number(selectedDsId), finalSql);
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
        const ds = dataSources.find(d => String(d.id) === selectedDsId);
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

    const metadataRef = useRef(metadata);
    useEffect(() => {
        metadataRef.current = metadata;
    }, [metadata]);

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
                const currentMetadata = metadataRef.current;
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

                        const table = currentMetadata.find(t => t.name.toLowerCase() === actualTableName);
                        if (table) {
                            table.columns.forEach(col => {
                                suggestions.push({
                                    label: col.name,
                                    kind: monaco.languages.CompletionItemKind.Field,
                                    insertText: col.name,
                                    detail: `${table.name} Column (${col.type})`,
                                    documentation: col.remarks,
                                    range: range,
                                });
                            });
                            return { suggestions };
                        }
                    }
                }

                // 2. Context-aware table suggestions (after FROM or JOIN)
                const isAfterFromOrJoin = /\b(FROM|JOIN)\s+$/i.test(textBeforeCursor);
                if (isAfterFromOrJoin) {
                    currentMetadata.forEach(table => {
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

                // 4. Add all tables to general search
                currentMetadata.forEach(table => {
                    suggestions.push({
                        label: table.name,
                        kind: monaco.languages.CompletionItemKind.Struct,
                        insertText: table.name,
                        detail: `Table (${table.type})`,
                        documentation: table.remarks,
                        range: range,
                        sortText: '5'
                    });

                    // 5. Add columns to general search (optional but helpful)
                    table.columns.forEach(col => {
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: col.name,
                            detail: `Column of ${table.name} (${col.type})`,
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

        // Add Shift+Alt+F: format SQL
        editor.addAction({
            id: 'format-sql',
            label: 'Format SQL',
            keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
            run: () => handleFormat(),
        });
    };

    return (
        <Splitter.Root
            className="query-splitter"
            panels={[
                { id: 'sidebar', minSize: 15, maxSize: 40 },
                { id: 'main' }
            ]}
            defaultSize={[20, 80]}
        >
            <Splitter.Panel id="sidebar" className="query-splitter-panel">
                <aside className="metadata-sidebar">
                    <div className="sidebar-header">
                        <span>库表导航</span>
                        <Database size={14} className="node-icon" />
                    </div>
                    <div className="sidebar-content">
                        {loadingMetadata ? (
                            <div className="loading-state">
                                <Loader2 className="animate-spin" size={20} />
                                <span>加载元数据中...</span>
                            </div>
                        ) : metadata.length > 0 ? (
                            <div className="metadata-tree">
                                {metadata.map(table => (
                                    <details key={table.name} className="table-node">
                                        <summary className="table-summary">
                                            <Table size={14} className="node-icon" />
                                            <span>{table.name}</span>
                                        </summary>
                                        <ul className="column-list">
                                            {table.columns.map(col => (
                                                <li key={col.name} className="column-node">
                                                    <Columns size={12} className="node-icon" />
                                                    <span className="col-name">{col.name}</span>
                                                    <span className="col-type">{col.type}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <Database size={32} className="empty-icon" />
                                <span>请先选择数据源</span>
                            </div>
                        )}
                    </div>
                </aside>
            </Splitter.Panel>

            <Splitter.ResizeTrigger id="sidebar:main" className="splitter-trigger">
                <Splitter.ResizeTriggerIndicator className="splitter-indicator" />
            </Splitter.ResizeTrigger>

            <Splitter.Panel id="main" className="query-splitter-panel">
                <main className="query-main">
                    <header className="query-toolbar">
                        <div className="toolbar-left">
                            <DataSourceSelect
                                options={dataSources.map(ds => ({ label: ds.name, value: String(ds.id), type: ds.type }))}
                                value={String(selectedDsId)}
                                onChange={(val) => setSelectedDsId(val)}
                                onInputChange={(val) => setDsKeyword(val)}
                                loading={loadingDs}
                                placeholder="搜索并选择数据源..."
                                theme="light"
                            />
                            {selectedDsId && (
                                <>
                                    <span className="breadcrumb-divider">/</span>
                                    <DataSourceSelect
                                        options={databases.map(db => ({ label: db, value: db }))}
                                        value={selectedDb}
                                        onChange={(val) => setSelectedDb(val)}
                                        placeholder="选择数据库"
                                        theme="light"
                                    />
                                </>
                            )}
                        </div>
                        <div className="toolbar-right">
                            <Tooltip.Root openDelay={400} closeDelay={0} closeOnPointerDown={true}>
                                <Tooltip.Trigger asChild>
                                    <button
                                        className="format-button-inline"
                                        onClick={handleFormat}
                                    >
                                        <Wand2 size={16} />
                                        <span>格式化</span>
                                    </button>
                                </Tooltip.Trigger>
                                <Tooltip.Positioner>
                                    <Tooltip.Content className="tooltip-content">
                                        格式化 (Ctrl+Shift+F)
                                    </Tooltip.Content>
                                </Tooltip.Positioner>
                            </Tooltip.Root>
                            <Tooltip.Root openDelay={400} closeDelay={0} closeOnPointerDown={true}>
                                <Tooltip.Trigger asChild>
                                    <button
                                        className="run-button"
                                        onClick={() => handleRunQuery()}
                                    >
                                        {loadingQuery ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="white" />}
                                        <span>Run</span>
                                    </button>
                                </Tooltip.Trigger>
                                <Tooltip.Positioner>
                                    <Tooltip.Content className="tooltip-content">
                                        执行 (Ctrl+Enter)
                                    </Tooltip.Content>
                                </Tooltip.Positioner>
                            </Tooltip.Root>
                        </div>
                    </header>

                    <Splitter.Root
                        className="query-vertical-splitter"
                        orientation="vertical"
                        panels={[
                            { id: 'editor', minSize: 30 },
                            { id: 'results', minSize: 20 }
                        ]}
                        defaultSize={[50, 50]}
                    >
                        <Splitter.Panel id="editor" className="query-splitter-panel-vertical">
                            <section className="editor-section">

                                <div className="editor-wrapper">
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
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
                                            padding: { top: 12, bottom: 12 },
                                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                            roundedSelection: false,
                                            cursorStyle: 'line',
                                            renderLineHighlight: 'all',
                                        }}
                                    />
                                </div>
                            </section>
                        </Splitter.Panel>

                        <Splitter.ResizeTrigger id="editor:results" className="splitter-trigger-vertical">
                            <Splitter.ResizeTriggerIndicator className="splitter-indicator-vertical" />
                        </Splitter.ResizeTrigger>

                        <Splitter.Panel id="results" className="query-splitter-panel-vertical">
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
                                            <div className="export-wrapper">
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
                        </Splitter.Panel>
                    </Splitter.Root>
                </main>
            </Splitter.Panel>
        </Splitter.Root>
    );
}
