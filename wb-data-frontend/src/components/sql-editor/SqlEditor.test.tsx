import { act, render, screen, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';

vi.mock('./sqlEditorModule', () => ({
    loadSqlEditorModule: vi.fn(),
}));

vi.mock('./sqlEditorCore', () => ({
    setupSqlEditorCore: vi.fn(() => vi.fn()),
}));

vi.mock('./sqlEditorOptions', () => ({
    defaultSqlEditorOptions: {},
}));

describe('SqlEditor', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('shows a loading state while the Monaco module is pending', async () => {
        const { SqlEditor } = await import('./SqlEditor');
        const { loadSqlEditorModule } = await import('./sqlEditorModule');

        let resolveModule: (value: { default: (props: Record<string, unknown>) => JSX.Element }) => void;
        const modulePromise = new Promise<{ default: (props: Record<string, unknown>) => JSX.Element }>((resolve) => {
            resolveModule = resolve;
        });

        vi.mocked(loadSqlEditorModule).mockReturnValue(modulePromise);

        render(<SqlEditor value="SELECT 1" />);

        expect(screen.getByText('Loading SQL editor…')).not.toBeNull();

        await act(async () => {
            resolveModule!({
                default: () => <div data-testid="monaco-editor">editor</div>,
            });
            await modulePromise;
        });

        expect(await screen.findByTestId('monaco-editor')).not.toBeNull();
    });

    it('calls setupSqlEditorCore on mount', async () => {
        const { SqlEditor } = await import('./SqlEditor');
        const { loadSqlEditorModule } = await import('./sqlEditorModule');
        const { setupSqlEditorCore } = await import('./sqlEditorCore');

        const setupMock = vi.mocked(setupSqlEditorCore);
        const disposeFn = vi.fn();
        setupMock.mockReturnValue(disposeFn);

        let resolveModule: (value: { default: (props: Record<string, unknown>) => JSX.Element }) => void;
        const modulePromise = new Promise<{ default: (props: Record<string, unknown>) => JSX.Element }>((resolve) => {
            resolveModule = resolve;
        });

        function MockMonacoEditor(props: Record<string, unknown>) {
            const onMount = props.onMount as ((editor: never, monaco: never) => void) | undefined;

            React.useEffect(() => {
                onMount?.(
                    { addAction: vi.fn() } as never,
                    { KeyMod: {}, KeyCode: {} } as never,
                );
            }, [onMount]);

            return <div data-testid="monaco-editor">editor</div>;
        }

        vi.mocked(loadSqlEditorModule).mockReturnValue(modulePromise);

        render(<SqlEditor value="SELECT 1" />);

        await act(async () => {
            resolveModule!({
                default: MockMonacoEditor,
            });
            await modulePromise;
        });

        expect(setupMock).toHaveBeenCalledTimes(1);
        expect(setupMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
        );
    });
});
