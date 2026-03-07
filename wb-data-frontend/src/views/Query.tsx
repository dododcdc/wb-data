import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Database, Table, Columns, Loader2, Code2 } from 'lucide-react';
import { getMetadataDatabases, getMetadataTables, executeQuery, TableMetadata, QueryResult } from '../api/query';
import { getDataSourcePage, DataSource } from '../api/datasource';
import { DataSourceSelect } from '../components/DataSourceSelect';
import { Splitter } from '@ark-ui/react/splitter';
import './Query.css';

export default function Query() {
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [selectedDsId, setSelectedDsId] = useState<string>('');
    const [dsKeyword, setDsKeyword] = useState('');
    const [loadingDs, setLoadingDs] = useState(false);
    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDb, setSelectedDb] = useState<string>('');
    const [metadata, setMetadata] = useState<TableMetadata[]>([]);
    const [loadingMetadata, setLoadingMetadata] = useState(false);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [sql, setSql] = useState('');
    const [result, setResult] = useState<QueryResult | null>(null);
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
        } else {
            setDatabases([]);
            setSelectedDb('');
            setMetadata([]);
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
        const finalSql = sqlToRun ?? sql;
        if (!selectedDsId || !finalSql.trim()) return;
        setLoadingQuery(true);
        try {
            const data = await executeQuery(Number(selectedDsId), finalSql);
            setResult(data);
        } catch (error) {
            console.error('Failed to execute query', error);
        } finally {
            setLoadingQuery(false);
        }
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

    const handleEditorDidMount = (editor: any, monaco: any) => {
        editorRef.current = editor;

        const SQL_KEYWORDS = [
            'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'LIMIT', 'ORDER BY', 'GROUP BY',
            'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'AS',
            'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'DATABASE',
            'IN', 'IS', 'NULL', 'NOT', 'EXISTS', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
            'DISTINCT', 'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC'
        ];

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

                // 1. Column suggestions for "table." or "."
                const lastDotIndex = textBeforeCursor.lastIndexOf('.');
                if (lastDotIndex !== -1) {
                    const parts = textBeforeCursor.trim().split(/\s+/);
                    const lastPart = parts[parts.length - 1];
                    const tableName = lastPart.split('.')[0];

                    const table = currentMetadata.find(t => t.name.toLowerCase() === tableName.toLowerCase());
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

                // 3. Add General SQL Keywords
                SQL_KEYWORDS.forEach(keyword => {
                    suggestions.push({
                        label: keyword,
                        kind: monaco.languages.CompletionItemKind.Keyword,
                        insertText: keyword,
                        range: range,
                        sortText: '9' // Lower priority than context-specific matches
                    });
                });

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

        // Add Cmd+Enter / Ctrl+Enter: run only the statement under the cursor
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const stmt = getStatementAtCursorRef.current(editor);
            handleRunQueryRef.current(stmt);
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
                                theme="dark"
                            />
                            {selectedDsId && (
                                <>
                                    <span className="breadcrumb-divider">/</span>
                                    <DataSourceSelect
                                        options={databases.map(db => ({ label: db, value: db }))}
                                        value={selectedDb}
                                        onChange={(val) => setSelectedDb(val)}
                                        placeholder="选择数据库"
                                        theme="dark"
                                    />
                                </>
                            )}
                        </div>
                        <div className="toolbar-right">
                            <button
                                className="run-button"
                                onClick={() => handleRunQuery()}
                                disabled={loadingQuery || !selectedDsId || !sql}
                                title="执行查询 (Cmd+Enter)"
                            >
                                {loadingQuery ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="white" />}
                                <span>执行查询</span>
                            </button>
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
                                <div className="editor-tabs-container">
                                    <div className="editor-tab active">
                                        <Code2 size={13} />
                                        <span>SQL 编辑器</span>
                                    </div>
                                </div>
                                <div className="editor-wrapper">
                                    <Editor
                                        height="100%"
                                        language="sql"
                                        theme="vs-dark"
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
                                    {result && (
                                        <div className="result-info">
                                            找到 {result.rows.length} 条记录 • 耗时 {result.executionTimeMs}ms
                                        </div>
                                    )}
                                </div>
                                <div className="results-container">
                                    {!result ? (
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
