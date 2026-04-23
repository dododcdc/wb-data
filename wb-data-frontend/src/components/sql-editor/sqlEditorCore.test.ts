import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setupSqlEditorCore } from './sqlEditorCore';
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
});
