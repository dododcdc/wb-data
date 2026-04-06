import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { loadQueryEditorModule } from '../../queryEditorModule';

const Editor = lazy(loadQueryEditorModule);

function EditorLoader() {
    return (
        <div className="flex h-full w-full items-center justify-center p-8 text-gray-500 bg-white">
            <Loader2 className="mr-2 h-6 w-6 animate-spin opacity-50" />
            <span className="text-sm font-medium">配置查询编辑器...</span>
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
