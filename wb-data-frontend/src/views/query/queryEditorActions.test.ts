/**
 * Tests for query-specific editor actions
 * These are scene-owned actions beyond the shared core (Cmd/Ctrl+Enter execution).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupQueryEditorActions } from './queryEditorActions';
import type * as Monaco from 'monaco-editor';

describe('queryEditorActions', () => {
    let mockEditor: Monaco.editor.IStandaloneCodeEditor;
    let mockMonaco: typeof Monaco;
    let addActionSpy: ReturnType<typeof vi.fn>;
    let mockDisposable: Monaco.IDisposable;

    beforeEach(() => {
        mockDisposable = { dispose: vi.fn() };
        addActionSpy = vi.fn().mockReturnValue(mockDisposable);

        mockEditor = {
            addAction: addActionSpy,
            getSelection: vi.fn(),
            getModel: vi.fn(),
        } as unknown as Monaco.editor.IStandaloneCodeEditor;

        mockMonaco = {
            KeyMod: {
                CtrlCmd: 2048,
            },
            KeyCode: {
                Enter: 3,
            },
        } as unknown as typeof Monaco;
    });

    describe('setupQueryEditorActions', () => {
        it('should register Cmd/Ctrl+Enter to execute query', () => {
            const onExecute = vi.fn();
            setupQueryEditorActions(mockMonaco, mockEditor, { onExecute });

            expect(addActionSpy).toHaveBeenCalledWith(expect.objectContaining({
                id: 'execute-query',
                label: 'Execute SQL',
                keybindings: [2048 | 3],
                run: expect.any(Function),
            }));
        });

        it('should execute selected SQL when selection exists', () => {
            const onExecute = vi.fn();
            const mockSelection = {
                isEmpty: () => false,
            };
            const mockModel = {
                getValueInRange: vi.fn().mockReturnValue('SELECT * FROM users'),
            };

            mockEditor.getSelection = vi.fn().mockReturnValue(mockSelection);
            mockEditor.getModel = vi.fn().mockReturnValue(mockModel);

            setupQueryEditorActions(mockMonaco, mockEditor, { onExecute });

            const action = addActionSpy.mock.calls[0][0];
            action.run(mockEditor);

            expect(mockModel.getValueInRange).toHaveBeenCalledWith(mockSelection);
            expect(onExecute).toHaveBeenCalledWith('SELECT * FROM users');
        });

        it('should execute statement-at-cursor when no selection exists', () => {
            const onExecute = vi.fn();
            const getStatementAtCursor = vi.fn().mockReturnValue('SELECT id FROM users');
            const mockSelection = {
                isEmpty: () => true,
            };

            mockEditor.getSelection = vi.fn().mockReturnValue(mockSelection);

            setupQueryEditorActions(mockMonaco, mockEditor, {
                onExecute,
                getStatementAtCursor,
            });

            const action = addActionSpy.mock.calls[0][0];
            action.run(mockEditor);

            expect(getStatementAtCursor).toHaveBeenCalledWith(mockEditor);
            expect(onExecute).toHaveBeenCalledWith('SELECT id FROM users');
        });

        it('should execute all SQL when no selection and no getStatementAtCursor provided', () => {
            const onExecute = vi.fn();
            const mockSelection = {
                isEmpty: () => true,
            };
            const mockModel = {
                getValue: vi.fn().mockReturnValue('SELECT * FROM orders'),
            };

            mockEditor.getSelection = vi.fn().mockReturnValue(mockSelection);
            mockEditor.getModel = vi.fn().mockReturnValue(mockModel);

            setupQueryEditorActions(mockMonaco, mockEditor, { onExecute });

            const action = addActionSpy.mock.calls[0][0];
            action.run(mockEditor);

            expect(mockModel.getValue).toHaveBeenCalled();
            expect(onExecute).toHaveBeenCalledWith('SELECT * FROM orders');
        });

        it('should return a dispose function that cleans up the action', () => {
            const onExecute = vi.fn();
            const dispose = setupQueryEditorActions(mockMonaco, mockEditor, { onExecute });

            dispose();

            expect(mockDisposable.dispose).toHaveBeenCalled();
        });

        it('should handle null selection gracefully', () => {
            const onExecute = vi.fn();
            const mockModel = {
                getValue: vi.fn().mockReturnValue('SELECT 1'),
            };

            mockEditor.getSelection = vi.fn().mockReturnValue(null);
            mockEditor.getModel = vi.fn().mockReturnValue(mockModel);

            setupQueryEditorActions(mockMonaco, mockEditor, { onExecute });

            const action = addActionSpy.mock.calls[0][0];
            action.run(mockEditor);

            expect(onExecute).toHaveBeenCalledWith('SELECT 1');
        });

        it('should handle null model gracefully', () => {
            const onExecute = vi.fn();
            const mockSelection = {
                isEmpty: () => false,
            };

            mockEditor.getSelection = vi.fn().mockReturnValue(mockSelection);
            mockEditor.getModel = vi.fn().mockReturnValue(null);

            setupQueryEditorActions(mockMonaco, mockEditor, { onExecute });

            const action = addActionSpy.mock.calls[0][0];
            action.run(mockEditor);

            // Should execute with empty string or not crash
            expect(onExecute).toHaveBeenCalled();
        });
    });
});
