import { lazy, Suspense } from 'react';
import type * as Monaco from 'monaco-editor';
import { loadQueryEditorModule } from '../../queryEditorModule';
import '../../RouteSkeletons.css';


const Editor = lazy(loadQueryEditorModule);

function EditorLoader() {
    return (
        <div className="route-skeleton-query-editor h-full w-full absolute inset-0">
            <div className="route-skeleton-query-gutter" />
            <div className="route-skeleton-query-editor-lines">
                <div className="route-skeleton-block route-skeleton-query-line long" />
                <div className="route-skeleton-block route-skeleton-query-line medium" />
                <div className="route-skeleton-block route-skeleton-query-line short" />
                <div className="route-skeleton-block route-skeleton-query-line long" style={{ opacity: 0.8 }} />
                <div className="route-skeleton-block route-skeleton-query-line medium" style={{ opacity: 0.6 }} />
                <div className="route-skeleton-block route-skeleton-query-line short" style={{ opacity: 0.4 }} />
            </div>
        </div>
    );
}

export interface QueryEditorProps {
    sql: string;
    setSql: (val: string) => void;
    handleEditorDidMount: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
}

export function QueryEditor({ sql, setSql, handleEditorDidMount }: QueryEditorProps) {
    return (
        <section className="editor-section h-full w-full relative">
            <div className="editor-wrapper h-full w-full absolute inset-0">
                <Suspense fallback={<EditorLoader />}>
                    <Editor
                        height="100%"
                        width="100%"
                        language="sql"
                        theme="warm-parchment"
                        value={sql}
                        loading={<EditorLoader />}
                        onChange={(value: string | undefined) => setSql(value || '')}
                        onMount={handleEditorDidMount}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            quickSuggestions: {
                                other: true,
                                comments: false,
                                strings: false,
                            },
                            quickSuggestionsDelay: 120,
                            suggestOnTriggerCharacters: true,
                            lineNumbers: 'on',
                            lineNumbersMinChars: 2,
                            lineDecorationsWidth: 8,
                            glyphMargin: false,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            padding: { top: 12, bottom: 12 },
                            fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            roundedSelection: false,
                            cursorStyle: 'line',
                            renderLineHighlight: 'all',
                        }}
                    />
                </Suspense>
            </div>
        </section>
    );
}
