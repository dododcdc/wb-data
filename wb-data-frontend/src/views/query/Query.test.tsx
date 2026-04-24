import { cleanup, render } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionDispose = vi.hoisted(() => vi.fn());
const completionDispose = vi.hoisted(() => vi.fn());
const registerCompletionProviderMock = vi.hoisted(() => vi.fn(() => ({ dispose: completionDispose })));
const setupQueryEditorActionsMock = vi.hoisted(() => vi.fn(() => actionDispose));

vi.mock('../../utils/auth', () => ({
    useAuthStore: (selector: (state: {
        currentGroup: { id: string } | null;
        permissions: string[];
        systemAdmin: boolean;
    }) => unknown) => selector({
        currentGroup: { id: 'group-1' },
        permissions: [],
        systemAdmin: false,
    }),
}));

vi.mock('../../hooks/useKeyboardFocusMode', () => ({
    useKeyboardFocusMode: vi.fn(),
}));

vi.mock('../../hooks/useDelayedBusy', () => ({
    useDelayedBusy: vi.fn(() => false),
}));

vi.mock('./hooks/useKeyboardShortcuts', () => ({
    useKeyboardShortcuts: vi.fn(),
}));

vi.mock('./hooks/useQueryEditor', () => ({
    useQueryEditor: vi.fn(() => ({
        sql: 'SELECT 1',
        result: null,
        queryError: null,
        loadingQuery: false,
        setSql: vi.fn(),
        setResult: vi.fn(),
        setQueryError: vi.fn(),
        setLoadingQuery: vi.fn(),
    })),
}));

vi.mock('./hooks/useQueryExecution', () => ({
    useQueryExecution: vi.fn(() => ({
        showExportMenu: false,
        setShowExportMenu: vi.fn(),
        showExportTasksMenu: false,
        setShowExportTasksMenu: vi.fn(),
        exportMenuRef: { current: null },
        exportTasksMenuRef: { current: null },
        exportState: null,
        exportTasks: [],
        loadingExportTasks: false,
        activeExportTaskCount: 0,
        shouldShowExportTasksButton: false,
        savedResults: [],
        activeResultTab: 0,
        setActiveResultTab: vi.fn(),
        currentResultTabNumber: 0,
        activeSavedResult: null,
        hasCurrentResultTab: false,
        displayedResult: null,
        displayedQueryError: null,
        currentResultCanPin: false,
        handleRunQuery: vi.fn(),
        handleFormat: vi.fn(),
        handlePinCurrentResult: vi.fn(),
        handleCloseSavedResult: vi.fn(),
        handleToggleSavedResultPin: vi.fn(),
        handleFillSavedSql: vi.fn(),
        createAsyncExportTask: vi.fn(),
        downloadExportTask: vi.fn(),
        loadExportTasks: vi.fn(),
    })),
}));

vi.mock('./hooks/useMetadata', () => ({
    useMetadata: vi.fn(() => ({
        selectedDsId: null,
        defaultDsId: null,
        dsKeyword: '',
        loadingDs: false,
        loadingDsMore: false,
        dsHasMore: false,
        selectedDsOption: null,
        dataSourceOptions: [],
        setDsKeyword: vi.fn(),
        setSelectedDb: vi.fn(),
        applySelectedDataSource: vi.fn(),
        loadMoreDataSources: vi.fn(),
        toggleDefaultDataSource: vi.fn(),
        getActiveDataSource: vi.fn(),
        databases: [],
        selectedDb: null,
        dbKeyword: '',
        loadingDatabases: false,
        databaseOptions: [],
        selectedDbOption: null,
        setDbKeyword: vi.fn(),
        tables: [],
        tableKeyword: '',
        tableTotal: 0,
        loadingTables: false,
        loadingMoreTables: false,
        expandedTables: new Set(),
        setTableKeyword: vi.fn(),
        setTableKeywordCommitted: vi.fn(),
        handleTableScroll: vi.fn(),
        handleTableScrollRef: { current: null },
        toggleTableExpand: vi.fn(),
        tableScrollElement: null,
        columnCache: new Map(),
        loadingColumns: false,
        loadColumns: vi.fn(),
        dialectMetadata: null,
        activeDsIdRef: { current: null },
        activeDbRef: { current: null },
    })),
}));

vi.mock('./hooks/useLayoutPersistence', () => ({
    useLayoutPersistence: vi.fn(() => ({
        sidebarCollapsed: false,
        sidebarExpandedWidth: 280,
        sidebarTransitioning: false,
        resultCollapsed: false,
        resultExpandedHeight: 240,
        resultAutoOpen: false,
        resultTransitioning: false,
        toggleSidebar: vi.fn(),
        setSidebarWidth: vi.fn(),
        toggleResultPanel: vi.fn(),
        setResultPanelState: vi.fn(),
        setResultExpandedHeight: vi.fn(),
    })),
    getHorizontalSizes: vi.fn(() => [280, 720]),
    getVerticalSizes: vi.fn(() => [560, 240]),
    SIDEBAR_DEFAULT_WIDTH_PX: 280,
    SIDEBAR_MIN_WIDTH_PX: 220,
    SIDEBAR_MAX_WIDTH_PX: 420,
    QUERY_MAIN_MIN_WIDTH_PX: 640,
    QUERY_MAIN_DEFAULT_WIDTH_PX: 1000,
    RESULT_PANEL_COLLAPSED_HEIGHT_PX: 40,
    RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX: 160,
    RESULT_PANEL_DEFAULT_HEIGHT_PX: 240,
    QUERY_EDITOR_DEFAULT_HEIGHT_PX: 560,
}));

vi.mock('./hooks/useSqlCompletion', () => ({
    useSqlCompletion: vi.fn(() => ({
        registerCompletionProvider: registerCompletionProviderMock,
    })),
}));

vi.mock('./queryEditorActions', () => ({
    setupQueryEditorActions: setupQueryEditorActionsMock,
}));

vi.mock('allotment', () => {
    const Pane = React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(({ children }, ref) => (
        <div ref={ref}>{children}</div>
    ));
    const Allotment = Object.assign(
        React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(({ children }, ref) => {
            React.useImperativeHandle(ref, () => ({
                resize: vi.fn(),
            }) as unknown as HTMLDivElement, []);

            return <div>{children}</div>;
        }),
        { Pane },
    );

    return { Allotment };
});

vi.mock('./components/QuerySidebar', () => ({
    QuerySidebar: () => <div data-testid="query-sidebar" />,
}));

vi.mock('./components/QueryToolbar', () => ({
    QueryToolbar: () => <div data-testid="query-toolbar" />,
}));

vi.mock('./components/QueryResultsPanel', () => ({
    QueryResultsPanel: () => <div data-testid="query-results-panel" />,
}));

vi.mock('./components/QueryEditor', () => ({
    QueryEditor: ({ handleEditorDidMount }: {
        handleEditorDidMount: (editor: {
            addCommand: (keybinding: number, callback: () => void) => { dispose: () => void };
            getSelection: () => null;
            getModel: () => null;
            getPosition: () => null;
        }, monaco: {
            KeyMod: { CtrlCmd: number };
            KeyCode: { Enter: number };
        }) => void;
    }) => {
        React.useEffect(() => {
            handleEditorDidMount(
                {
                    addCommand: vi.fn(() => ({ dispose: vi.fn() })),
                    getSelection: vi.fn(() => null),
                    getModel: vi.fn(() => null),
                    getPosition: vi.fn(() => null),
                },
                {
                    KeyMod: { CtrlCmd: 2048 },
                    KeyCode: { Enter: 3 },
                },
            );
        }, [handleEditorDidMount]);

        return <div data-testid="query-editor" />;
    },
}));

describe('Query', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('disposes query actions and completion provider on unmount', async () => {
        const { default: Query } = await import('./Query');

        const { unmount } = render(<Query />);

        expect(setupQueryEditorActionsMock).toHaveBeenCalledTimes(1);
        expect(registerCompletionProviderMock).toHaveBeenCalledTimes(1);

        unmount();

        expect(actionDispose).toHaveBeenCalledTimes(1);
        expect(completionDispose).toHaveBeenCalledTimes(1);
    });
});
