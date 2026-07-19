import type { ComponentType } from 'react';

type MonacoEditorComponent = ComponentType<Record<string, unknown>>;
type MonacoEditorReactModule = typeof import('@monaco-editor/react');

let monacoEditorPackagePromise: Promise<MonacoEditorReactModule> | null = null;
let monacoEditorModulePromise: Promise<{ default: MonacoEditorComponent }> | null = null;
let monacoEditorRuntimePromise: Promise<unknown> | null = null;

function loadMonacoEditorPackage() {
    if (!monacoEditorPackagePromise) {
        monacoEditorPackagePromise = import('@monaco-editor/react');
    }

    return monacoEditorPackagePromise;
}

/**
 * Lazy load and memoize @monaco-editor/react
 */
export function loadSqlEditorModule() {
    if (!monacoEditorModulePromise) {
        monacoEditorModulePromise = loadMonacoEditorPackage().then((mod) => ({
            default: mod.default as MonacoEditorComponent,
        }));
    }

    return monacoEditorModulePromise;
}

/**
 * Preload the React wrapper and initialize Monaco itself.
 * Importing @monaco-editor/react only warms the wrapper chunk; Monaco workers
 * and language services are initialized by the loader on first editor mount
 * unless we explicitly do it ahead of time.
 */
export function preloadSqlEditorModule() {
    if (!monacoEditorRuntimePromise) {
        monacoEditorRuntimePromise = loadMonacoEditorPackage()
            .then((mod) => mod.loader.init())
            .catch((error) => {
                monacoEditorRuntimePromise = null;
                throw error;
            });
    }

    return Promise.all([
        loadSqlEditorModule(),
        monacoEditorRuntimePromise,
    ]).then(() => undefined);
}
