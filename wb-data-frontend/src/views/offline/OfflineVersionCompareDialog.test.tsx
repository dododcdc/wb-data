import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getOfflineFlowSnapshot, getOfflineFlowSnapshotFile } from '../../api/offline';
import { OfflineVersionCompareDialog } from './OfflineVersionCompareDialog';

vi.mock('../../api/offline', async () => {
    const actual = await vi.importActual<typeof import('../../api/offline')>('../../api/offline');
    return { ...actual, getOfflineFlowSnapshot: vi.fn(), getOfflineFlowSnapshotFile: vi.fn() };
});

vi.mock('@monaco-editor/react', () => ({
    DiffEditor: ({ original, modified, language }: { original: string; modified: string; language: string }) => (
        <div data-testid="diff-editor" data-language={language}>{original}|{modified}</div>
    ),
}));

describe('OfflineVersionCompareDialog', () => {
    it('loads both revisions and renders raw file differences', async () => {
        vi.mocked(getOfflineFlowSnapshot).mockImplementation((_groupId, _path, rev) => Promise.resolve({
            revision: rev,
            document: {} as never,
            files: [{ path: 'scripts/example.sql', sha256: rev === 'old' ? 'old' : 'new', size: 8, content: null }],
            nodeMetadata: {},
        }));
        vi.mocked(getOfflineFlowSnapshotFile).mockImplementation((_groupId, _path, rev) => Promise.resolve({
            path: 'scripts/example.sql',
            sha256: rev,
            size: 8,
            content: rev === 'old' ? 'select 1;' : 'select 2;',
        }));

        render(
            <OfflineVersionCompareDialog
                groupId={4}
                path="_flows/example/flow.yaml"
                base={{ revision: 'old', label: '旧版本' }}
                target={{ revision: 'new', label: '新版本' }}
                open
                onOpenChange={vi.fn()}
            />,
        );

        expect(await screen.findByText('scripts/example.sql')).toBeTruthy();
        expect((await screen.findByTestId('diff-editor')).textContent).toBe('select 1;|select 2;');
        expect(screen.getByTestId('diff-editor').getAttribute('data-language')).toBe('sql');
    });
});
