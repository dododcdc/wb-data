import type * as Monaco from 'monaco-editor';

/**
 * Register the "warm-parchment" theme
 * A warm, soft color scheme with improved readability
 */
export function registerSqlEditorTheme(monaco: typeof Monaco): void {
    monaco.editor.defineTheme('warm-parchment', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: '', foreground: '3D3A36' },
            { token: 'comment', foreground: 'A09A90', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'B85C3A' },
            { token: 'string', foreground: '6B8E5A' },
            { token: 'number', foreground: 'B07D48' },
            { token: 'operator', foreground: '5B5B58' },
            { token: 'identifier', foreground: '3D3A36' },
            { token: 'type', foreground: '7A6B5D' },
            { token: 'delimiter', foreground: '8A8A86' },
            { token: 'predefined', foreground: 'B85C3A' },
        ],
        colors: {
            'editor.background': '#F8F7F4',
            'editor.foreground': '#3D3A36',
            'editor.lineHighlightBackground': '#F0EDE6',
            'editor.selectionBackground': '#E3D9CC',
            'editor.inactiveSelectionBackground': '#EDE8E0',
            'editorCursor.foreground': '#D97757',
            'editorLineNumber.foreground': '#C5C0B8',
            'editorLineNumber.activeForeground': '#8A8A86',
            'editorIndentGuide.background': '#E8E4DC',
            'editorIndentGuide.activeBackground': '#D5D0C8',
            'editor.selectionHighlightBackground': '#E8DFD4',
            'editorBracketMatch.background': '#E8DFD4',
            'editorBracketMatch.border': '#C4A882',
            'editorGutter.background': '#F8F7F4',
            'editorWidget.background': '#F3F1EC',
            'editorWidget.border': '#E3DED5',
            'editorWidget.foreground': '#3D3A36',
            'editorSuggestWidget.background': '#F8F7F4',
            'editorSuggestWidget.border': '#E3DED5',
            'editorSuggestWidget.selectedBackground': '#EFECE6',
            'editorSuggestWidget.foreground': '#544C45',
            'editorSuggestWidget.selectedForeground': '#4B433C',
            'editorSuggestWidget.highlightForeground': '#82331A',
            'editorSuggestWidget.focusHighlightForeground': '#7A2E17',
            'editorSuggestWidget.selectedIconForeground': '#A66A47',
            'list.highlightForeground': '#93401F',
            'list.focusHighlightForeground': '#7A2E17',
            'list.focusForeground': '#2F2B27',
            'list.focusBackground': '#E9E2D7',
            'list.hoverForeground': '#3D3A36',
            'list.hoverBackground': '#F1ECE3',
        },
    });
}
