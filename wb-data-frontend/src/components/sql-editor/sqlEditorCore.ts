import type * as Monaco from 'monaco-editor';
import { registerSqlEditorTheme } from './sqlEditorTheme';
import { formatSqlContent } from './sqlFormatting';

/**
 * Setup shared SQL editor core functionality:
 * - Registers the warm-parchment theme
 * - Adds the Format SQL action (Ctrl+Shift+F / Cmd+Shift+F)
 * 
 * Scene-specific features (completion, execution) should be registered separately.
 * Returns a dispose function to clean up resources.
 */
export function setupSqlEditorCore(
    monaco: typeof Monaco,
    editor: Monaco.editor.IStandaloneCodeEditor,
): () => void {
    // Register theme
    registerSqlEditorTheme(monaco);

    // Add format SQL action
    const formatAction = editor.addAction({
        id: 'format-sql',
        label: 'Format SQL',
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        ],
        run: (ed) => {
            const currentValue = ed.getValue();
            const formatted = formatSqlContent(currentValue);
            if (formatted !== currentValue) {
                ed.setValue(formatted);
            }
        },
    });

    // Return dispose function
    return () => {
        formatAction.dispose();
    };
}
