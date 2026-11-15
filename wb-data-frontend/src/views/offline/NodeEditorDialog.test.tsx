import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeEditorDialog } from './NodeEditorDialog';
import type { OfflineFlowNode } from '../../api/offline';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { DataSourceOption } from '../../components/DataSourceSelect';

const dataSourceSelectPropsSpy = vi.fn();
const sqlEditorPropsSpy = vi.fn();
const transferNodeDialogPropsSpy = vi.fn();

// Mock the shared SqlEditor to verify SQL nodes use it
vi.mock('../../components/sql-editor/SqlEditor', () => ({
    SqlEditor: (props: { value: string; options?: unknown }) => {
        sqlEditorPropsSpy(props);
        return <div data-testid="shared-sql-editor">{props.value}</div>;
    },
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

vi.mock('./transfer/TransferNodeDialog', () => ({
    TransferNodeDialog: (props: unknown) => {
        transferNodeDialogPropsSpy(props);
        return <div data-testid="transfer-node-dialog" />;
    },
}));

afterEach(() => {
    cleanup();
    dataSourceSelectPropsSpy.mockClear();
    sqlEditorPropsSpy.mockClear();
    transferNodeDialogPropsSpy.mockClear();
});

const makeSqlNode = (overrides?: Partial<OfflineFlowNode>): OfflineFlowNode => ({
    taskId: 'sql_1',
    kind: 'MYSQL',
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

const makeTransferNode = (overrides?: Partial<OfflineFlowNode>): OfflineFlowNode => ({
    taskId: 'transfer_1',
    kind: 'TRANSFER',
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

        const toolbar = document.querySelector('.dialog-toolbar');
        expect(toolbar?.className).toContain('offline-node-editor-toolbar');
        expect(dataSourceSelectPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
            size: 'compact',
        }));
        expect(sqlEditorPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
            options: expect.objectContaining({
                padding: { top: 8, bottom: 8 },
            }),
        }));
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

    it('routes transfer nodes to the transfer configuration dialog', () => {
        render(
            <TooltipProvider>
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeTransferNode()}
                content=""
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />
            </TooltipProvider>,
        );

        expect(screen.getByTestId('transfer-node-dialog')).toBeTruthy();
        expect(screen.queryByTestId('raw-monaco-editor')).toBeNull();
    });

    it('reopens transfer nodes with a local transfer draft before the last saveable transfer', () => {
        const saveableTransfer = {
            source: { dataSourceId: 1, dataSourceType: 'MYSQL' as const, table: 'orders' },
            target: { dataSourceId: 2, dataSourceType: 'HIVE' as const, table: 'dwd_orders', writeMode: 'append' as const },
            fieldMappings: [{ target: 'id', kind: 'source_field' as const, source: 'id' }],
            partitions: [],
        };
        const localDraft = {
            ...saveableTransfer,
            target: { ...saveableTransfer.target, table: 'dwd_payments' },
            fieldMappings: [],
        };

        render(
            <TooltipProvider>
            <NodeEditorDialog
                open
                groupId={1}
                activeNode={makeTransferNode({
                    transfer: saveableTransfer,
                    transferDraft: localDraft,
                    transferDraftValid: false,
                })}
                content=""
                onOpenChange={() => {}}
                onTempSave={() => {}}
                onContentChange={() => {}}
            />
            </TooltipProvider>,
        );

        expect(transferNodeDialogPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
            value: localDraft,
        }));
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
        expect(closeButton.className).toContain('offline-node-editor-close');

        fireEvent.click(closeButton);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('renders the SQL format button for SQL nodes and formats HiveSQL with leading commas', () => {
        const onContentChange = vi.fn();
        render(
            <TooltipProvider>
                <NodeEditorDialog
                    open
                    groupId={1}
                    activeNode={makeSqlNode({ kind: 'HIVE_SQL', taskId: 'hive_fmt' })}
                    content="select a, b, c from ods.orders where dt = '^[bizdate]'"
                    onOpenChange={() => {}}
                    onTempSave={() => {}}
                    onContentChange={onContentChange}
                />
            </TooltipProvider>,
        );

        expect(sqlEditorPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
            formatOptions: { language: 'hive', commaPosition: 'before' },
        }));

        const formatBtn = screen.getByTestId('sql-format-button');
        expect((formatBtn as HTMLButtonElement).disabled).toBe(false);
        expect(formatBtn.textContent).toBe('');
        expect(formatBtn.getAttribute('aria-label')).toBe('格式化 SQL');
        fireEvent.click(formatBtn);

        expect(onContentChange).toHaveBeenCalledWith([
            'SELECT',
            '  a',
            '  , b',
            '  , c',
            'FROM',
            '  ods.orders',
            'WHERE',
            "  dt = '^[bizdate]'",
        ].join('\n'));
    });

    it('hides the SQL format button for Shell and Transfer nodes and disables it on empty SQL', () => {
        const { rerender } = render(
            <TooltipProvider>
                <NodeEditorDialog
                    open
                    groupId={1}
                    activeNode={makeSqlNode({ kind: 'HIVE_SQL', taskId: 'hive_empty' })}
                    content="   "
                    onOpenChange={() => {}}
                    onTempSave={() => {}}
                    onContentChange={() => {}}
                />
            </TooltipProvider>,
        );

        expect((screen.getByTestId('sql-format-button') as HTMLButtonElement).disabled).toBe(true);

        rerender(
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
        expect(screen.queryByTestId('sql-format-button')).toBeNull();

        rerender(
            <TooltipProvider>
                <NodeEditorDialog
                    open
                    groupId={1}
                    activeNode={makeTransferNode()}
                    content=""
                    onOpenChange={() => {}}
                    onTempSave={() => {}}
                    onContentChange={() => {}}
                />
            </TooltipProvider>,
        );
        expect(screen.queryByTestId('sql-format-button')).toBeNull();
    });
});
