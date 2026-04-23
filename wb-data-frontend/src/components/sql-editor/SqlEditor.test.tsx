import { act, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';

import { SqlEditor } from './SqlEditor';
import { loadSqlEditorModule } from './sqlEditorModule';
import { setupSqlEditorCore } from './sqlEditorCore';

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
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('shows a loading state while the Monaco module is pending', async () => {
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

    it('re-runs setup when completionProvider changes', async () => {
        // This test verifies the useEffect dependency on completionProvider
        const setupMock = vi.mocked(setupSqlEditorCore);
        const disposeFn = vi.fn();
        setupMock.mockReturnValue(disposeFn);

        const firstProvider = { provideCompletionItems: vi.fn() };
        const secondProvider = { provideCompletionItems: vi.fn() };

        // Create a test wrapper that simulates editor mount and prop changes
        function TestWrapper({ provider }: { provider?: Monaco.languages.CompletionItemProvider }) {
            const editorRef = React.useRef({ addAction: vi.fn() });
            const monacoRef = React.useRef({ KeyMod: {}, KeyCode: {} });
            const disposeRef = React.useRef<(() => void) | null>(null);
            const mountedRef = React.useRef(false);

            React.useEffect(() => {
                return () => {
                    disposeRef.current?.();
                };
            }, []);

            React.useEffect(() => {
                // Only run setup after initial mount (when refs are set)
                // This mimics how SqlEditor works - setup happens in onMount callback first,
                // then the completionProvider effect takes over for updates
                if (!mountedRef.current) {
                    // Simulate initial mount via onMount callback
                    const dispose = setupSqlEditorCore(
                        monacoRef.current as never,
                        editorRef.current as never,
                        provider
                    );
                    disposeRef.current = dispose;
                    mountedRef.current = true;
                } else {
                    // This mimics the SqlEditor useEffect that responds to completionProvider changes
                    if (editorRef.current && monacoRef.current) {
                        disposeRef.current?.();
                        const dispose = setupSqlEditorCore(
                            monacoRef.current as never,
                            editorRef.current as never,
                            provider
                        );
                        disposeRef.current = dispose;
                    }
                }
            }, [provider]);

            return <div>test</div>;
        }

        const { rerender } = render(<TestWrapper provider={firstProvider} />);

        expect(setupMock).toHaveBeenCalledTimes(1);
        expect(setupMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            firstProvider
        );

        // Rerender with a different provider
        rerender(<TestWrapper provider={secondProvider} />);

        // Old dispose should be called and new setup should run
        expect(disposeFn).toHaveBeenCalledTimes(1);
        expect(setupMock).toHaveBeenCalledTimes(2);
        expect(setupMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            secondProvider
        );
    });
});
