import { lazy, Suspense, useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { loadSqlEditorModule } from './sqlEditorModule';
import { defaultSqlEditorOptions } from './sqlEditorOptions';
import { setupSqlEditorCore } from './sqlEditorCore';

export interface SqlEditorProps {
    value: string;
    onChange?: (value: string) => void;
    options?: Monaco.editor.IStandaloneEditorConstructionOptions;
    onMount?: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
}

/**
 * Shared SQL Editor component
 * A thin wrapper around Monaco editor with SQL-specific defaults.
 * The shared core registers theme and format action.
 * Scene-specific features (completion, execution) are registered via onMount callback.
 */
const LazyMonacoEditor = lazy(() => loadSqlEditorModule());

export function SqlEditor({
    value,
    onChange,
    options,
    onMount,
}: SqlEditorProps) {
    const disposeRef = useRef<(() => void) | null>(null);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);

    useEffect(() => {
        return () => {
            disposeRef.current?.();
        };
    }, []);

    const handleEditorDidMount = (
        editor: Monaco.editor.IStandaloneCodeEditor,
        monaco: typeof Monaco,
    ) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Setup shared SQL editor core (theme + format action)
        const dispose = setupSqlEditorCore(monaco, editor);
        disposeRef.current = dispose;

        // Call optional onMount callback for scene-specific setup
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
