import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqlEditor } from './SqlEditor';
import { loadSqlEditorModule } from './sqlEditorModule';

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
});
