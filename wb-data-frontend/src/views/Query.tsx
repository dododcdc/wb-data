import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Database, Table, Columns, Loader2, Code2 } from 'lucide-react';
import { getMetadataTables, executeQuery, TableMetadata, QueryResult } from '../api/query';
import { getDataSourcePage, DataSource } from '../api/datasource';
import { DataSourceSelect } from '../components/DataSourceSelect';
import './Query.css';

export default function Query() {
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [selectedDsId, setSelectedDsId] = useState<string>('');
    const [metadata, setMetadata] = useState<TableMetadata[]>([]);
    const [loadingMetadata, setLoadingMetadata] = useState(false);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [sql, setSql] = useState('SELECT * FROM users LIMIT 10;');
    const [result, setResult] = useState<QueryResult | null>(null);
    const editorRef = useRef<any>(null);

    useEffect(() => {
        loadDataSources();
    }, []);

    useEffect(() => {
        if (selectedDsId) {
            loadMetadata(Number(selectedDsId));
        }
    }, [selectedDsId]);

    const loadDataSources = async () => {
        try {
            const data = await getDataSourcePage({ page: 1, size: 100 });
            setDataSources(data.records);
        } catch (error) {
            console.error('Failed to load data sources', error);
        }
    };

    const loadMetadata = async (id: number) => {
        setLoadingMetadata(true);
        try {
            const data = await getMetadataTables(id);
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
        <div className="query-container">
            <aside className="metadata-sidebar">
                <div className="sidebar-header">
                    <Database size={16} />
                    <span>Schema Explorer</span>
                </div>
                <div className="sidebar-content">
                    {loadingMetadata ? (
                        <div className="loading-state">
                            <Loader2 className="animate-spin" />
                            <span>Loading schema...</span>
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
                        <div className="empty-state">Select a datasource to view schema</div>
                    )}
                </div>
            </aside>

            <main className="query-main">
                <header className="query-toolbar">
                    <div className="toolbar-left">
                        <DataSourceSelect
                            options={dataSources.map(ds => ({ label: ds.name, value: String(ds.id) }))}
                            value={String(selectedDsId)}
                            onChange={(val) => setSelectedDsId(val)}
                            placeholder="Select DataSource"
                        />
                    </div>
                    <div className="toolbar-right">
                        <button
                            className="run-button"
                            onClick={handleRunQuery}
                            disabled={loadingQuery || !selectedDsId}
                        >
                            {loadingQuery ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
                            <span>Run SQL</span>
                        </button>
                    </div>
                </header>

                <section className="editor-section">
                    <div className="editor-tab">
                        <Code2 size={14} />
                        <span>SQL Editor</span>
                    </div>
                    <Editor
                        height="400px"
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
                            padding: { top: 10, bottom: 10 }
                        }}
                    />
                </section>

                <section className="results-section">
                    <div className="section-header">
                        <span>Results</span>
                        {result && (
                            <span className="result-info">
                                {result.rows.length} rows in {result.executionTimeMs}ms
                            </span>
                        )}
                    </div>
                    <div className="results-container">
                        {!result ? (
                            <div className="empty-results">No query results yet. Run a query to see data.</div>
                        ) : result.message !== 'Success' && (!result.columns || result.columns.length === 0) ? (
                            <div className="result-message">{result.message}</div>
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
                                                <td key={col.name}>{String(row[col.name] ?? '')}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}
