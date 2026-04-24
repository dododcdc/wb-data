/**
 * Query-specific editor actions
 * Registers query-page-specific keybindings like Cmd/Ctrl+Enter for execution.
 * Does NOT register format-sql action — that's owned by the shared editor core.
 */

import type * as Monaco from 'monaco-editor';

export interface QueryEditorActionOptions {
    /**
     * Callback to execute SQL (either selected text or statement-at-cursor)
     */
    onExecute: (sql: string) => void;

    /**
     * Optional function to extract statement at cursor.
     * If not provided, executes the full editor content when no selection exists.
     */
    getStatementAtCursor?: (editor: Monaco.editor.IStandaloneCodeEditor) => string;
}

/**
 * Setup query-specific editor actions.
 * Registers Cmd/Ctrl+Enter to execute selected SQL or statement-at-cursor.
 * 
 * Returns a dispose function to clean up the registered action.
 */
export function setupQueryEditorActions(
    monaco: typeof Monaco,
    editor: Monaco.editor.IStandaloneCodeEditor,
    options: QueryEditorActionOptions,
): () => void {
    const { onExecute, getStatementAtCursor } = options;

    // Register Cmd/Ctrl+Enter: run selection if exists, else statement-at-cursor or all
    const executeAction = editor.addAction({
        id: 'execute-query',
        label: 'Execute SQL',
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        ],
        run: (ed) => {
            const selection = ed.getSelection();
            const model = ed.getModel();

            // If there's a non-empty selection, execute the selected text
            if (selection && !selection.isEmpty() && model) {
                const selectedText = model.getValueInRange(selection);
                onExecute(selectedText || '');
                return;
            }

            // If getStatementAtCursor is provided, use it
            if (getStatementAtCursor) {
                const stmt = getStatementAtCursor(ed);
                onExecute(stmt);
                return;
            }

            // Fallback: execute all content
            const allContent = model?.getValue() ?? '';
            onExecute(allContent);
        },
    });

    // Return dispose function
    return () => {
        executeAction.dispose();
    };
}
