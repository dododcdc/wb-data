import { useEffect, useRef } from 'react';
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
export function SqlEditor({
    value,
    onChange,
    options,
    completionProvider,
    onMount,
}: SqlEditorProps) {
    const MonacoEditor = loadSqlEditorModule();
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
        <MonacoEditor
            value={value}
            onChange={onChange}
            options={{ ...defaultSqlEditorOptions, ...options }}
            onMount={handleEditorDidMount}
        />
    );
}
