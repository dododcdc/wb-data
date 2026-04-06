import type { ComponentType } from 'react';

type QueryEditorComponent = ComponentType<Record<string, unknown>>;

let queryEditorModulePromise: Promise<{ default: QueryEditorComponent }> | null = null;

export function loadQueryEditorModule() {
    if (!queryEditorModulePromise) {
        queryEditorModulePromise = import('@monaco-editor/react').then((mod) => ({
            default: mod.default as QueryEditorComponent,
        }));
    }

    return queryEditorModulePromise;
}
