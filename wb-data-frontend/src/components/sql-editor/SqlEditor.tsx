import { lazy, Suspense, useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { loadSqlEditorModule } from './sqlEditorModule';
import { defaultSqlEditorOptions } from './sqlEditorOptions';
import { setupSqlEditorCore } from './sqlEditorCore';

export interface SqlEditorProps {
    value: string;
    onChange?: (value: string) => void;
    options?: Monaco.editor.IStandaloneEditorConstructionOptions;
    completionProvider?: Monaco.languages.CompletionItemProvider;
    onMount?: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
}

/**
 * Shared SQL Editor component
 * A thin wrapper around Monaco editor with SQL-specific defaults
 */
const LazyMonacoEditor = lazy(() => loadSqlEditorModule());

export function SqlEditor({
    value,
    onChange,
    options,
    completionProvider,
    onMount,
}: SqlEditorProps) {
    const disposeRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        return () => {
            disposeRef.current?.();
        };
    }, []);

    const handleEditorDidMount = (
        editor: Monaco.editor.IStandaloneCodeEditor,
        monaco: typeof Monaco,
    ) => {
        // Setup shared SQL editor core
        const dispose = setupSqlEditorCore(monaco, editor, completionProvider);
        disposeRef.current = dispose;

        // Call optional onMount callback
        onMount?.(editor, monaco);
    };

    return (
        <Suspense fallback={<div>Loading SQL editor…</div>}>
            <LazyMonacoEditor
                value={value}
                onChange={onChange}
                options={{ ...defaultSqlEditorOptions, ...options }}
                onMount={handleEditorDidMount}
            />
        </Suspense>
    );
}
