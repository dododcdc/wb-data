import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeEditorDialog } from './NodeEditorDialog';
import type { OfflineFlowNode } from '../../api/offline';

// Mock the shared SqlEditor to verify SQL nodes use it
vi.mock('../../components/sql-editor/SqlEditor', () => ({
    SqlEditor: ({ value }: { value: string }) => <div data-testid="shared-sql-editor">{value}</div>,
}));

// Mock the sql editor module for Shell nodes
vi.mock('../../components/sql-editor/sqlEditorModule', () => ({
    loadSqlEditorModule: () => Promise.resolve({
        default: ({ value }: { value: string }) => <div data-testid="raw-monaco-editor">{value}</div>,
    }),
}));

// Mock the sql editor theme
vi.mock('../../components/sql-editor/sqlEditorTheme', () => ({
    registerSqlEditorTheme: vi.fn(),
}));

// Mock data source hook
vi.mock('./useNodeEditorDataSources', () => ({
    useNodeEditorDataSources: () => ({
        currentDataSourceId: undefined,
        selectedDataSource: null,
        options: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        handleSearchKeywordChange: vi.fn(),
        loadMore: vi.fn(),
        setCurrentDataSourceId: vi.fn(),
    }),
}));

// Mock data source rules
vi.mock('./nodeEditorDataSourceRules', () => ({
    buildNodeEditorDataSourceOptions: () => [],
}));

afterEach(() => {
    cleanup();
});

const makeSqlNode = (overrides?: Partial<OfflineFlowNode>): OfflineFlowNode => ({
    taskId: 'sql_1',
    kind: 'SQL',
    scriptContent: 'select 1',
    dataSourceId: 7,
    ...overrides,
} as OfflineFlowNode);

const makeShellNode = (overrides?: Partial<OfflineFlowNode>): OfflineFlowNode => ({
    taskId: 'shell_1',
    kind: 'SHELL',
    scriptContent: 'echo hello',
    ...overrides,
} as OfflineFlowNode);

describe('NodeEditorDialog', () => {
    it('uses the shared SqlEditor for SQL nodes and shows the data source picker', () => {
        render(
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeSqlNode()}
                content="select 1"
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />,
        );

        const editor = screen.getByTestId('shared-sql-editor');
        expect(editor.textContent).toBe('select 1');
        expect(screen.getByText('数据源')).toBeTruthy();
    });

    it('uses the shared SqlEditor for HIVE_SQL nodes', () => {
        render(
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeSqlNode({ kind: 'HIVE_SQL', taskId: 'hive_1' })}
                content="select * from t"
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />,
        );

        const editor = screen.getByTestId('shared-sql-editor');
        expect(editor.textContent).toBe('select * from t');
    });

    it('does not render the data source picker for Shell nodes', () => {
        render(
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeShellNode()}
                content="echo hello"
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />,
        );

        // Shell nodes should NOT have the data source label
        expect(screen.queryByText('数据源')).toBeNull();
    });

    it('returns null when activeNode is null', () => {
        const { container } = render(
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={null}
                content=""
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />,
        );

        expect(container.innerHTML).toBe('');
    });

    it('uses the shared close affordance contract for the top-bar close action', () => {
        const onOpenChange = vi.fn();

        render(
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeShellNode()}
                content="echo hello"
                onOpenChange={onOpenChange}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />,
        );

        const closeButton = screen.getByRole('button', { name: '关闭' });
        expect(closeButton.getAttribute('data-slot')).toBe('dialog-close');
        expect(closeButton.className).toContain('dialog-close-button');

        fireEvent.click(closeButton);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
