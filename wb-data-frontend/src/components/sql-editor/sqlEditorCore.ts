import type * as Monaco from 'monaco-editor';
import { registerSqlEditorTheme } from './sqlEditorTheme';
import { formatSqlContent, type SqlFormatOptions } from './sqlFormatting';

export interface SqlEditorCoreOptions {
    getFormatOptions?: () => SqlFormatOptions | undefined;
}

/**
 * Apply formatted SQL while preserving Monaco's undo stack whenever a text model is attached.
 */
export function applyFormattedSqlToEditor(
    editor: Monaco.editor.IStandaloneCodeEditor,
    formattedSql: string,
): boolean {
    const currentValue = editor.getValue();
    if (formattedSql === currentValue) {
        return false;
    }

    const model = editor.getModel?.();
    if (model && typeof editor.executeEdits === 'function') {
        editor.pushUndoStop?.();
        editor.executeEdits('format-sql', [
            {
                range: model.getFullModelRange(),
                text: formattedSql,
                forceMoveMarkers: true,
            },
        ]);
        editor.pushUndoStop?.();
        return true;
    }

    editor.setValue(formattedSql);
    return true;
}

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
    options?: SqlEditorCoreOptions,
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
            const readOnlyOptionId = monaco?.editor?.EditorOption?.readOnly;
            const isReadOnly = readOnlyOptionId !== undefined && typeof ed.getOption === 'function'
                ? Boolean(ed.getOption(readOnlyOptionId))
                : Boolean(ed.getRawOptions?.()?.readOnly);
            if (isReadOnly) {
                return;
            }
            const currentValue = ed.getValue();
            const formatted = formatSqlContent(currentValue, options?.getFormatOptions?.());
            applyFormattedSqlToEditor(ed as Monaco.editor.IStandaloneCodeEditor, formatted);
        },
    });

    // Return dispose function
    return () => {
        formatAction.dispose();
    };
}
