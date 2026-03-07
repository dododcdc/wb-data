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

    const handleRunQuery = async () => {
        if (!selectedDsId || !sql) return;
        setLoadingQuery(true);
        try {
            const data = await executeQuery(Number(selectedDsId), sql);
            setResult(data);
        } catch (error) {
            console.error('Failed to execute query', error);
        } finally {
            setLoadingQuery(false);
        }
    };

    const handleEditorDidMount = (editor: any, monaco: any) => {
        editorRef.current = editor;

        // Register custom completion provider for SQL
        monaco.languages.registerCompletionItemProvider('sql', {
            provideCompletionItems: (model: any, position: any) => {
                const word = model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };

                const suggestions: any[] = [];

                // 1. Add table suggestions
                metadata.forEach(table => {
                    suggestions.push({
                        label: table.name,
                        kind: monaco.languages.CompletionItemKind.Struct,
                        insertText: table.name,
                        detail: `Table (${table.type})`,
                        documentation: table.remarks,
                        range: range,
                    });

                    // 2. Add column suggestions for each table (optional prefix)
                    table.columns.forEach(col => {
                        suggestions.push({
                            label: `${table.name}.${col.name}`,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: col.name, // Usually users type 'table.' and expect column
                            filterText: `${table.name}.${col.name}`,
                            detail: `${table.name} Column (${col.type})`,
                            documentation: col.remarks,
                            range: range,
                        });

                        // Also add raw column name as suggestion
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: col.name,
                            detail: `Column (${col.type}) from ${table.name}`,
                            range: range,
                        });
                    });
                });

                return { suggestions };
            },
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
                                onClick={handleRunQuery}
                                disabled={loadingQuery || !selectedDsId}
                            >
                                {loadingQuery ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="currentColor" />}
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
