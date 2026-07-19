import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeEditorDialog } from './NodeEditorDialog';
import type { OfflineFlowNode } from '../../api/offline';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { DataSourceOption } from '../../components/DataSourceSelect';

const dataSourceSelectPropsSpy = vi.fn();

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

vi.mock('../../components/DataSourceSelect', () => ({
    DataSourceSelect: (props: {
        value?: string;
        selectedOption?: DataSourceOption | null;
        options: DataSourceOption[];
    }) => {
        dataSourceSelectPropsSpy(props);
        return <div data-testid="data-source-select">{props.value ?? props.selectedOption?.value ?? ''}</div>;
    },
}));

// Mock data source hook
vi.mock('./useNodeEditorDataSources', () => ({
    prefetchNodeEditorDataSources: vi.fn(() => Promise.resolve()),
    useNodeEditorDataSources: ({ initialDataSourceId }: { initialDataSourceId?: number }) => ({
        currentDataSourceId: initialDataSourceId,
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
    dataSourceSelectPropsSpy.mockClear();
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
            <TooltipProvider>
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeSqlNode()}
                content="select 1"
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />
            </TooltipProvider>,
        );

        const editor = screen.getByTestId('shared-sql-editor');
        expect(editor.textContent).toBe('select 1');
        expect(screen.getByText('数据源')).toBeTruthy();
    });

    it('keeps the selected data source value visible while the selected option is resolving', () => {
        vi.mocked(dataSourceSelectPropsSpy).mockClear();

        render(
            <TooltipProvider>
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeSqlNode()}
                content="select 1"
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />
            </TooltipProvider>,
        );

        expect(dataSourceSelectPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
            value: '7',
        }));
        expect(screen.getByTestId('data-source-select').textContent).toBe('7');
    });

    it('uses the shared SqlEditor for HIVE_SQL nodes', () => {
        render(
            <TooltipProvider>
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeSqlNode({ kind: 'HIVE_SQL', taskId: 'hive_1' })}
                content="select * from t"
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />
            </TooltipProvider>,
        );

        const editor = screen.getByTestId('shared-sql-editor');
        expect(editor.textContent).toBe('select * from t');
    });

    it('does not render the data source picker for Shell nodes', () => {
        render(
            <TooltipProvider>
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeShellNode()}
                content="echo hello"
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />
            </TooltipProvider>,
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
            <TooltipProvider>
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeShellNode()}
                content="echo hello"
                onOpenChange={onOpenChange}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />
            </TooltipProvider>,
        );

        const closeButton = screen.getByRole('button', { name: '关闭' });
        expect(closeButton.getAttribute('data-slot')).toBe('dialog-close');
        expect(closeButton.className).toContain('dialog-close-button');

        fireEvent.click(closeButton);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
