import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { applyFormattedSqlToEditor, setupSqlEditorCore } from './sqlEditorCore';
import { resetThemeRegistration } from './sqlEditorTheme';
import type * as Monaco from 'monaco-editor';

describe('setupSqlEditorCore', () => {
    let mockMonaco: typeof Monaco;
    let mockEditor: Monaco.editor.IStandaloneCodeEditor;
    let defineThemeSpy: ReturnType<typeof vi.fn>;
    let addActionSpy: ReturnType<typeof vi.fn>;
    let disposeSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        resetThemeRegistration();
        defineThemeSpy = vi.fn();
        addActionSpy = vi.fn().mockReturnValue({ dispose: vi.fn() });
        disposeSpy = vi.fn();

        mockMonaco = {
            editor: {
                defineTheme: defineThemeSpy,
            },
            KeyMod: {
                CtrlCmd: 2048,
                Shift: 1024,
            },
            KeyCode: {
                KeyF: 36,
            },
        } as never;

        mockEditor = {
            addAction: addActionSpy,
            getValue: vi.fn().mockReturnValue('SELECT * FROM users'),
            setValue: vi.fn(),
            dispose: disposeSpy,
        } as never;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers the warm-parchment theme', () => {
        setupSqlEditorCore(mockMonaco, mockEditor);

        expect(defineThemeSpy).toHaveBeenCalledWith('warm-parchment', expect.objectContaining({
            base: 'vs',
            inherit: true,
        }));
    });

    it('adds format SQL action to the editor', () => {
        setupSqlEditorCore(mockMonaco, mockEditor);

        expect(addActionSpy).toHaveBeenCalledWith(expect.objectContaining({
            id: 'format-sql',
            label: 'Format SQL',
        }));
    });

    it('returns a dispose function', () => {
        const dispose = setupSqlEditorCore(mockMonaco, mockEditor);

        expect(dispose).toBeInstanceOf(Function);
    });

    it('disposes the action when dispose is called', () => {
        const actionDisposeSpy = vi.fn();
        addActionSpy.mockReturnValue({ dispose: actionDisposeSpy });

        const dispose = setupSqlEditorCore(mockMonaco, mockEditor);
        dispose();

        expect(actionDisposeSpy).toHaveBeenCalled();
    });

    it('does not throw when disposing without errors', () => {
        const dispose = setupSqlEditorCore(mockMonaco, mockEditor);

        expect(() => dispose()).not.toThrow();
    });

    it('only registers theme once even when called multiple times', () => {
        setupSqlEditorCore(mockMonaco, mockEditor);
        setupSqlEditorCore(mockMonaco, mockEditor);
        setupSqlEditorCore(mockMonaco, mockEditor);

        expect(defineThemeSpy).toHaveBeenCalledTimes(1);
    });

    it('uses provided format options when format-sql action executes', () => {
        const executeEdits = vi.fn();
        const pushUndoStop = vi.fn();
        const fullRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 20 };
        const editorWithModel = {
            ...mockEditor,
            getValue: vi.fn().mockReturnValue('select a, b from tbl'),
            getModel: vi.fn().mockReturnValue({ getFullModelRange: () => fullRange }),
            executeEdits,
            pushUndoStop,
        } as unknown as Monaco.editor.IStandaloneCodeEditor;

        setupSqlEditorCore(mockMonaco, editorWithModel, {
            getFormatOptions: () => ({ language: 'hive', commaPosition: 'before' }),
        });

        const registeredAction = addActionSpy.mock.calls[0][0] as { run: (ed: Monaco.editor.IStandaloneCodeEditor) => void };
        registeredAction.run(editorWithModel);

        expect(pushUndoStop).toHaveBeenCalledTimes(2);
        expect(executeEdits).toHaveBeenCalledWith('format-sql', [
            {
                range: fullRange,
                text: 'SELECT\n  a\n  , b\nFROM\n  tbl',
                forceMoveMarkers: true,
            },
        ]);
    });

    it('applyFormattedSqlToEditor falls back to setValue without a model and skips no-op edits', () => {
        expect(applyFormattedSqlToEditor(mockEditor, 'SELECT * FROM users')).toBe(false);
        expect(mockEditor.setValue).not.toHaveBeenCalled();

        expect(applyFormattedSqlToEditor(mockEditor, 'SELECT id FROM users')).toBe(true);
        expect(mockEditor.setValue).toHaveBeenCalledWith('SELECT id FROM users');
    });

    it('skips format-sql action when editor is read-only', () => {
        const executeEdits = vi.fn();
        const setValue = vi.fn();
        const readOnlyEditor = {
            ...mockEditor,
            getValue: vi.fn().mockReturnValue('select a, b from tbl'),
            getRawOptions: vi.fn().mockReturnValue({ readOnly: true }),
            executeEdits,
            setValue,
        } as unknown as Monaco.editor.IStandaloneCodeEditor;

        setupSqlEditorCore(mockMonaco, readOnlyEditor, {
            getFormatOptions: () => ({ language: 'hive', commaPosition: 'before' }),
        });

        const registeredAction = addActionSpy.mock.calls[0][0] as { run: (ed: Monaco.editor.IStandaloneCodeEditor) => void };
        registeredAction.run(readOnlyEditor);

        expect(executeEdits).not.toHaveBeenCalled();
        expect(setValue).not.toHaveBeenCalled();
    });
});
