import type * as Monaco from 'monaco-editor';

/**
 * Shared default SQL Monaco editor options
 */
export const defaultSqlEditorOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
    theme: 'warm-parchment',
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    padding: { top: 8, bottom: 8 },
};
