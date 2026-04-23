import type { ComponentType } from 'react';

type MonacoEditorComponent = ComponentType<Record<string, unknown>>;

let monacoEditorModulePromise: Promise<{ default: MonacoEditorComponent }> | null = null;

/**
 * Lazy load and memoize @monaco-editor/react
 */
export function loadSqlEditorModule() {
    if (!monacoEditorModulePromise) {
        monacoEditorModulePromise = import('@monaco-editor/react').then((mod) => ({
            default: mod.default as MonacoEditorComponent,
        }));
    }

    return monacoEditorModulePromise;
}
