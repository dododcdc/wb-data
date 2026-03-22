import { useState, useEffect, useRef, useMemo, lazy, Suspense, useCallback, useLayoutEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import type { AllotmentHandle } from 'allotment';
import { Play, Loader2, Code2, Wand2, Download, FileText, Sheet, Database, ChevronRight, ChevronDown, ChevronUp, Search, PanelLeftClose, PanelLeft } from 'lucide-react';
import { getMetadataDatabases, getMetadataTables, getMetadataColumns, executeQuery, getDialectMetadata, TableSummary, ColumnMetadata, QueryResult, DialectMetadata } from '../api/query';
import { getDataSourcePage, DataSource } from '../api/datasource';
import { DataSourceSelect } from '../components/DataSourceSelect';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useKeyboardFocusMode } from '../hooks/useKeyboardFocusMode';
import './Query.css';

// Lazy load Monaco Editor for performance (~3MB savings on initial load)
const Editor = lazy(() => import('@monaco-editor/react').then(mod => ({ default: mod.default })));

function EditorLoader() {
    return (
        <div className="editor-loader">
            <Loader2 className="animate-spin" size={24} />
            <span>加载编辑器...</span>
        </div>
    );
}


const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const DS_PAGE_SIZE = 50;
const SIDEBAR_STORAGE_KEY = 'query-sidebar-collapsed';
const LEGACY_SIDEBAR_SIZE_STORAGE_KEY = 'query-sidebar-size';
const SIDEBAR_EXPANDED_WIDTH_STORAGE_KEY = 'query-sidebar-expanded-width';
const LEGACY_EDITOR_SIZE_STORAGE_KEY = 'query-editor-size';
const RESULT_PANEL_COLLAPSED_STORAGE_KEY = 'query-result-collapsed';
const RESULT_PANEL_EXPANDED_HEIGHT_STORAGE_KEY = 'query-result-expanded-height';
const RESULT_PANEL_AUTO_OPEN_STORAGE_KEY = 'query-result-auto-open';
const SIDEBAR_DEFAULT_WIDTH_PX = 300;
const SIDEBAR_MIN_WIDTH_PX = 250;
const SIDEBAR_MAX_WIDTH_PX = 600;
const QUERY_MAIN_MIN_WIDTH_PX = 600;
const QUERY_MAIN_DEFAULT_WIDTH_PX = 1100;
const QUERY_EDITOR_DEFAULT_HEIGHT_PX = 520;
const QUERY_EDITOR_MIN_HEIGHT_PX = 220;
const RESULT_PANEL_COLLAPSED_HEIGHT_PX = 44;
const RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX = RESULT_PANEL_COLLAPSED_HEIGHT_PX;
const RESULT_PANEL_DEFAULT_HEIGHT_PX = 320;
const SIDEBAR_TOGGLE_TRANSITION_MS = 160;
const FALLBACK_SQL_KEYWORDS = [
    'SELECT',
    'FROM',
    'WHERE',
    'JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'INNER JOIN',
    'GROUP BY',
    'ORDER BY',
    'HAVING',
    'LIMIT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'CREATE',
    'ALTER',
    'DROP',
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'DISTINCT',
    'AS',
    'AND',
    'OR',
    'NOT',
    'IN',
    'EXISTS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
];

type MonacoEditorInstance = Monaco.editor.IStandaloneCodeEditor;

type QueryEditorError = {
    response?: {
        data?: {
            message?: string;
        };
    };
    message?: string;
};

function mergeDatabaseOptions(databases: string[], fallbackDatabase?: string) {
    const merged: string[] = [];

    const pushUnique = (database?: string) => {
        const normalized = database?.trim();
        if (!normalized) return;
        if (merged.some(item => item.toLowerCase() === normalized.toLowerCase())) return;
        merged.push(normalized);
    };

    pushUnique(fallbackDatabase);
    databases.forEach(pushUnique);

    return merged;
}

function clampSidebarWidth(width: number) {
    if (!Number.isFinite(width)) {
        return SIDEBAR_DEFAULT_WIDTH_PX;
    }

    return Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, Math.round(width)));
}

function parseStoredSidebarWidth(rawWidth: unknown) {
    const width = Number(rawWidth);
    if (!Number.isFinite(width) || width <= 0) {
        return null;
    }

    return clampSidebarWidth(width);
}

function parseStoredPositiveNumber(rawValue: unknown) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }

    return Math.round(value);
}

function getStoredSidebarCollapsed() {
    try {
        const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
        return saved !== 'false'; // 默认隐藏，除非明确保存为 'false'
    } catch {
        return true;
    }
}

function getStoredSidebarExpandedWidth() {
    try {
        const savedWidth = localStorage.getItem(SIDEBAR_EXPANDED_WIDTH_STORAGE_KEY);
        if (savedWidth) {
            const parsedWidth = parseStoredSidebarWidth(savedWidth);
            if (parsedWidth !== null) {
                return parsedWidth;
            }
        }

        const legacySizes = localStorage.getItem(LEGACY_SIDEBAR_SIZE_STORAGE_KEY);
        if (legacySizes) {
            const parsed = JSON.parse(legacySizes);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const parsedWidth = parseStoredSidebarWidth(parsed[0]);
                if (parsedWidth !== null) {
                    return parsedWidth;
                }
            }
        }
    } catch {
        // Ignore storage access failures and fall back to defaults.
    }

    return SIDEBAR_DEFAULT_WIDTH_PX;
}

function getStoredResultCollapsed() {
    try {
        const saved = localStorage.getItem(RESULT_PANEL_COLLAPSED_STORAGE_KEY);
        return saved !== 'false';
    } catch {
        return true;
    }
}

function getStoredResultAutoOpen() {
    try {
        const saved = localStorage.getItem(RESULT_PANEL_AUTO_OPEN_STORAGE_KEY);
        return saved !== 'false';
    } catch {
        return true;
    }
}

function getStoredResultExpandedHeight() {
    try {
        const savedHeight = localStorage.getItem(RESULT_PANEL_EXPANDED_HEIGHT_STORAGE_KEY);
        if (savedHeight) {
            const parsedHeight = parseStoredPositiveNumber(savedHeight);
            if (parsedHeight !== null) {
                return Math.max(RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX, parsedHeight);
            }
        }

        const legacySizes = localStorage.getItem(LEGACY_EDITOR_SIZE_STORAGE_KEY);
        if (legacySizes) {
            const parsed = JSON.parse(legacySizes);
            if (Array.isArray(parsed) && parsed.length === 2) {
                const legacyHeight = Number(parsed[1]);
                if (Number.isFinite(legacyHeight) && legacyHeight >= RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX) {
                    return Math.round(legacyHeight);
                }
            }
        }
    } catch {
        // Ignore storage access failures and fall back to defaults.
    }

    return RESULT_PANEL_DEFAULT_HEIGHT_PX;
}

function getHorizontalSizes(sidebarCollapsed: boolean, sidebarExpandedWidth: number, totalWidth?: number) {
    const resolvedTotalWidth = Number.isFinite(totalWidth) && totalWidth && totalWidth > 0
        ? totalWidth
        : QUERY_MAIN_DEFAULT_WIDTH_PX;

    if (sidebarCollapsed) {
        return [0, resolvedTotalWidth];
    }

    const maxSidebarWidth = Math.max(0, resolvedTotalWidth - QUERY_MAIN_MIN_WIDTH_PX);
    const nextSidebarWidth = Math.min(clampSidebarWidth(sidebarExpandedWidth), maxSidebarWidth);
    const nextMainWidth = Math.max(QUERY_MAIN_MIN_WIDTH_PX, resolvedTotalWidth - nextSidebarWidth);

    return [nextSidebarWidth, nextMainWidth];
}

function getVerticalSizes(resultCollapsed: boolean, resultExpandedHeight: number, totalHeight?: number) {
    const resolvedTotalHeight = Number.isFinite(totalHeight) && totalHeight && totalHeight > 0
        ? totalHeight
        : QUERY_EDITOR_DEFAULT_HEIGHT_PX + RESULT_PANEL_DEFAULT_HEIGHT_PX;

    if (resultCollapsed) {
        return [
            Math.max(0, resolvedTotalHeight - RESULT_PANEL_COLLAPSED_HEIGHT_PX),
            RESULT_PANEL_COLLAPSED_HEIGHT_PX,
        ];
    }

    const maxResultHeight = Math.max(
        RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX,
        resolvedTotalHeight - QUERY_EDITOR_MIN_HEIGHT_PX,
    );
    const nextResultHeight = Math.min(
        Math.max(RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX, Math.round(resultExpandedHeight)),
        maxResultHeight,
    );
    const nextEditorHeight = Math.max(QUERY_EDITOR_MIN_HEIGHT_PX, resolvedTotalHeight - nextResultHeight);

    return [nextEditorHeight, nextResultHeight];
}

export default function Query() {
    useKeyboardFocusMode();

    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [selectedDsId, setSelectedDsId] = useState<string>('');
    const [selectedDs, setSelectedDs] = useState<DataSource | null>(null);
    const [dsKeyword, setDsKeyword] = useState('');
    const [loadingDs, setLoadingDs] = useState(false);
    const [loadingDsMore, setLoadingDsMore] = useState(false);
    const [dsPage, setDsPage] = useState(1);
    const [dsHasMore, setDsHasMore] = useState(true);
    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDb, setSelectedDb] = useState<string>('');
    const [dbKeyword, setDbKeyword] = useState('');
    const [loadingDatabases, setLoadingDatabases] = useState(false);
    const [tables, setTables] = useState<TableSummary[]>([]);
    const [tableKeyword, setTableKeyword] = useState('');
    const [tableKeywordCommitted, setTableKeywordCommitted] = useState('');
    const [tablePage, setTablePage] = useState(1);
    const [tableHasMore, setTableHasMore] = useState(true);
    const [tableTotal, setTableTotal] = useState(0);
    const [loadingTables, setLoadingTables] = useState(false);
    const [loadingMoreTables, setLoadingMoreTables] = useState(false);
    const [columnCache, setColumnCache] = useState<Map<string, ColumnMetadata[]>>(new Map());
    const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());
    const [dialectMetadata, setDialectMetadata] = useState<DialectMetadata | null>(null);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [sql, setSql] = useState('');
    const [result, setResult] = useState<QueryResult | null>(null);
    const [queryError, setQueryError] = useState<string>('');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
    const editorRef = useRef<MonacoEditorInstance | null>(null);
    const composingRef = useRef(false);
    const dsRequestIdRef = useRef(0);
    const databasesRequestIdRef = useRef(0);
    const dialectRequestIdRef = useRef(0);
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const tableLoadingRequestKeysRef = useRef<Set<string>>(new Set());
    const tableListPendingCountRef = useRef(0);
    const tableMorePendingCountRef = useRef(0);
    const activeDsIdRef = useRef('');
    const activeDbRef = useRef('');
    const tableKeywordCommittedRef = useRef('');
    const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
    const horizontalSplitterRef = useRef<AllotmentHandle | null>(null);
    const verticalSplitterRef = useRef<AllotmentHandle | null>(null);
    const sidebarTransitionTimerRef = useRef<number | null>(null);
    const resultTransitionTimerRef = useRef<number | null>(null);
    const horizontalLayoutSizesRef = useRef<number[] | null>(null);
    const querySplitterRef = useRef<HTMLDivElement | null>(null);
    const verticalLayoutSizesRef = useRef<number[] | null>(null);
    const queryContentRef = useRef<HTMLDivElement | null>(null);
    const [tableScrollElement, setTableScrollElement] = useState<HTMLDivElement | null>(null);
    const TABLE_PAGE_SIZE = 200;

    const getActiveDataSource = useCallback(() => {
        if (selectedDs && String(selectedDs.id) === selectedDsId) {
            return selectedDs;
        }
        return dataSources.find(item => String(item.id) === selectedDsId) ?? null;
    }, [dataSources, selectedDs, selectedDsId]);

    const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
    const [sidebarExpandedWidth, setSidebarExpandedWidth] = useState(getStoredSidebarExpandedWidth);
    const [sidebarTransitioning, setSidebarTransitioning] = useState(false);
    const [resultCollapsed, setResultCollapsed] = useState(getStoredResultCollapsed);
    const [resultExpandedHeight, setResultExpandedHeight] = useState(getStoredResultExpandedHeight);
    const [resultAutoOpen, setResultAutoOpen] = useState(getStoredResultAutoOpen);
    const [resultTransitioning, setResultTransitioning] = useState(false);

    const initialHorizontalSizes = useMemo(() => {
        return getHorizontalSizes(sidebarCollapsed, sidebarExpandedWidth);
    }, [sidebarCollapsed, sidebarExpandedWidth]);

    const initialVerticalSizes = useMemo(() => {
        return getVerticalSizes(resultCollapsed, resultExpandedHeight);
    }, [resultCollapsed, resultExpandedHeight]);

    const virtualizer = useVirtualizer({
        count: tables.length,
        getScrollElement: () => tableScrollElement,
        estimateSize: () => 36,
        overscan: 10,
    });

    const handleTableScrollRef = useCallback((node: HTMLDivElement | null) => {
        if (tableScrollRef.current === node) return;
        tableScrollRef.current = node;
        setTableScrollElement(node);
    }, []);

    const persistSidebarCollapsed = useCallback((collapsed: boolean) => {
        try {
            localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
        } catch {
            // Ignore storage access failures and keep the in-memory state.
        }
    }, []);

    const persistSidebarExpandedWidth = useCallback((width: number) => {
        try {
            localStorage.setItem(SIDEBAR_EXPANDED_WIDTH_STORAGE_KEY, String(width));
            localStorage.removeItem(LEGACY_SIDEBAR_SIZE_STORAGE_KEY);
        } catch {
            // Ignore storage access failures and keep the in-memory state.
        }
    }, []);

    const persistResultCollapsed = useCallback((collapsed: boolean) => {
        try {
            localStorage.setItem(RESULT_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
        } catch {
            // Ignore storage access failures and keep the in-memory state.
        }
    }, []);

    const persistResultExpandedHeight = useCallback((height: number) => {
        try {
            localStorage.setItem(RESULT_PANEL_EXPANDED_HEIGHT_STORAGE_KEY, String(height));
            localStorage.removeItem(LEGACY_EDITOR_SIZE_STORAGE_KEY);
        } catch {
            // Ignore storage access failures and keep the in-memory state.
        }
    }, []);

    const persistResultAutoOpen = useCallback((autoOpen: boolean) => {
        try {
            localStorage.setItem(RESULT_PANEL_AUTO_OPEN_STORAGE_KEY, String(autoOpen));
        } catch {
            // Ignore storage access failures and keep the in-memory state.
        }
    }, []);

    const startSidebarTransition = useCallback(() => {
        if (sidebarTransitionTimerRef.current !== null) {
            window.clearTimeout(sidebarTransitionTimerRef.current);
        }

        setSidebarTransitioning(true);
        sidebarTransitionTimerRef.current = window.setTimeout(() => {
            setSidebarTransitioning(false);
            sidebarTransitionTimerRef.current = null;
        }, SIDEBAR_TOGGLE_TRANSITION_MS + 40);
    }, []);

    const toggleSidebar = useCallback(() => {
        startSidebarTransition();
        setSidebarCollapsed(prev => {
            const next = !prev;
            persistSidebarCollapsed(next);
            return next;
        });
    }, [persistSidebarCollapsed, startSidebarTransition]);

    const setResultPanelState = useCallback((collapsed: boolean, { manual = false }: { manual?: boolean } = {}) => {
        setResultCollapsed(current => current === collapsed ? current : collapsed);
        persistResultCollapsed(collapsed);

        if (manual) {
            const nextAutoOpen = !collapsed;
            setResultAutoOpen(nextAutoOpen);
            persistResultAutoOpen(nextAutoOpen);
        }
    }, [persistResultAutoOpen, persistResultCollapsed]);

    const startResultTransition = useCallback(() => {
        if (resultTransitionTimerRef.current !== null) {
            window.clearTimeout(resultTransitionTimerRef.current);
        }

        setResultTransitioning(true);
        resultTransitionTimerRef.current = window.setTimeout(() => {
            setResultTransitioning(false);
            resultTransitionTimerRef.current = null;
        }, SIDEBAR_TOGGLE_TRANSITION_MS + 40);
    }, []);

    const toggleResultPanel = useCallback(() => {
        startResultTransition();
        setResultPanelState(!resultCollapsed, { manual: true });
    }, [resultCollapsed, setResultPanelState, startResultTransition]);

    const getCurrentHorizontalTotalWidth = useCallback(() => {
        const cachedSizes = horizontalLayoutSizesRef.current;
        if (cachedSizes && cachedSizes.length === 2) {
            const total = cachedSizes[0] + cachedSizes[1];
            if (Number.isFinite(total) && total > 0) {
                return total;
            }
        }

        const measuredWidth = querySplitterRef.current?.clientWidth;
        if (typeof measuredWidth === 'number' && measuredWidth > 0) {
            return measuredWidth;
        }

        return QUERY_MAIN_DEFAULT_WIDTH_PX;
    }, []);

    const getCurrentVerticalTotalHeight = useCallback(() => {
        const cachedSizes = verticalLayoutSizesRef.current;
        if (cachedSizes && cachedSizes.length === 2) {
            const total = cachedSizes[0] + cachedSizes[1];
            if (Number.isFinite(total) && total > 0) {
                return total;
            }
        }

        const measuredHeight = queryContentRef.current?.clientHeight;
        if (typeof measuredHeight === 'number' && measuredHeight > 0) {
            return measuredHeight;
        }

        return QUERY_EDITOR_DEFAULT_HEIGHT_PX + RESULT_PANEL_DEFAULT_HEIGHT_PX;
    }, []);

    useLayoutEffect(() => {
        const nextSizes = getHorizontalSizes(
            sidebarCollapsed,
            sidebarExpandedWidth,
            getCurrentHorizontalTotalWidth(),
        );
        horizontalLayoutSizesRef.current = nextSizes;
        horizontalSplitterRef.current?.resize(nextSizes);
    }, [getCurrentHorizontalTotalWidth, sidebarCollapsed, sidebarExpandedWidth]);

    useLayoutEffect(() => {
        const nextSizes = getVerticalSizes(
            resultCollapsed,
            resultExpandedHeight,
            getCurrentVerticalTotalHeight(),
        );
        verticalLayoutSizesRef.current = nextSizes;
        verticalSplitterRef.current?.resize(nextSizes);
    }, [getCurrentVerticalTotalHeight, resultCollapsed, resultExpandedHeight]);

    useEffect(() => {
        persistSidebarExpandedWidth(sidebarExpandedWidth);
    }, [persistSidebarExpandedWidth, sidebarExpandedWidth]);

    useEffect(() => {
        persistResultExpandedHeight(resultExpandedHeight);
    }, [persistResultExpandedHeight, resultExpandedHeight]);

    useEffect(() => {
        return () => {
            if (sidebarTransitionTimerRef.current !== null) {
                window.clearTimeout(sidebarTransitionTimerRef.current);
            }
            if (resultTransitionTimerRef.current !== null) {
                window.clearTimeout(resultTransitionTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                toggleSidebar();
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                toggleResultPanel();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [toggleResultPanel, toggleSidebar]);

    useEffect(() => {
        activeDsIdRef.current = selectedDsId;
    }, [selectedDsId]);

    useEffect(() => {
        activeDbRef.current = selectedDb;
    }, [selectedDb]);

    useEffect(() => {
        tableKeywordCommittedRef.current = tableKeywordCommitted;
    }, [selectedDb, selectedDsId, tableKeywordCommitted]);

    // Close export menu on backdrop click or Escape
    useEffect(() => {
        if (resultCollapsed) {
            setShowExportMenu(false);
            return;
        }
        if (!showExportMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setShowExportMenu(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowExportMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [resultCollapsed, showExportMenu]);

    // Debounced search for DataSources
    useEffect(() => {
        const timer = setTimeout(() => {
            setDataSources([]);
            setDsHasMore(true);
            setDsPage(1);
            setLoadingDsMore(false);
            loadDataSources({ page: 1, keyword: dsKeyword, append: false });
        }, 300);
        return () => clearTimeout(timer);
    }, [dsKeyword]);

    useEffect(() => {
        if (selectedDsId) {
            const activeDataSource = getActiveDataSource();

            setDbKeyword('');
            setSelectedDb('');
            setDatabases([]);
            setTables([]);
            setColumnCache(new Map());
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTableTotal(0);
            loadDatabases(Number(selectedDsId), activeDataSource?.databaseName);
            loadDialect(Number(selectedDsId));
        } else {
            setDatabases([]);
            setSelectedDb('');
            setDbKeyword('');
            setTables([]);
            setColumnCache(new Map());
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTableTotal(0);
            setDialectMetadata(null);
            setSelectedDs(null);
        }
    }, [getActiveDataSource, selectedDsId]);

    useEffect(() => {
        if (selectedDsId && selectedDb) {
            setTableKeyword('');
            setTableKeywordCommitted('');
            setTablePage(1);
            setTableHasMore(true);
            setTableTotal(0);
            setColumnCache(new Map());
            loadTables(Number(selectedDsId), selectedDb);
        }
    }, [selectedDsId, selectedDb]);

    useEffect(() => {
        if (!selectedDsId || !selectedDb) return;
        const timer = setTimeout(() => {
            setTablePage(1);
            setTableHasMore(true);
            loadTables(Number(selectedDsId), selectedDb, tableKeywordCommitted, 1, false);
        }, 300);
        return () => clearTimeout(timer);
    }, [selectedDb, selectedDsId, tableKeywordCommitted]);

    useEffect(() => {
        setExpandedTables(new Set());
    }, [selectedDsId, selectedDb]);

    const toggleTableExpand = (tableName: string) => {
        setExpandedTables(prev => {
            const next = new Set(prev);
            if (next.has(tableName)) {
                next.delete(tableName);
            } else {
                next.add(tableName);
                if (!columnCache.has(tableName) && selectedDsId && selectedDb) {
                    loadColumns(Number(selectedDsId), selectedDb, tableName);
                }
            }
            return next;
        });
    };

    const loadDataSources = async ({ page, keyword, append }: { page: number; keyword: string; append: boolean; }) => {
        const requestId = ++dsRequestIdRef.current;
        if (append) {
            setLoadingDsMore(true);
        } else {
            setLoadingDs(true);
        }
        try {
            const data = await getDataSourcePage({ page, size: DS_PAGE_SIZE, keyword });
            if (requestId !== dsRequestIdRef.current) {
                return;
            }
            setDataSources((prev) => {
                if (!append) {
                    return data.records;
                }
                const existingIds = new Set(prev.map(item => item.id));
                const merged = [...prev, ...data.records.filter(item => !existingIds.has(item.id))];
                return merged;
            });
            const hasMore = data.pages ? data.current < data.pages : data.records.length === DS_PAGE_SIZE;
            setDsPage(data.current || page);
            setDsHasMore(hasMore);
        } catch (error) {
            console.error('Failed to load data sources', error);
        } finally {
            if (requestId === dsRequestIdRef.current) {
                if (append) {
                    setLoadingDsMore(false);
                } else {
                    setLoadingDs(false);
                }
            }
        }
    };

    const loadMoreDataSources = () => {
        if (loadingDs || loadingDsMore || !dsHasMore) {
            return;
        }
        loadDataSources({ page: dsPage + 1, keyword: dsKeyword, append: true });
    };

    const loadDialect = async (id: number) => {
        const requestId = ++dialectRequestIdRef.current;
        try {
            const data = await getDialectMetadata(id);
            if (requestId !== dialectRequestIdRef.current) return;
            if (activeDsIdRef.current !== String(id)) return;
            setDialectMetadata(data);
        } catch (error) {
            console.error('Failed to load dialect metadata', error);
        }
    };

    const loadDatabases = async (id: number, fallbackDatabase?: string) => {
        const requestId = ++databasesRequestIdRef.current;
        setLoadingDatabases(true);
        try {
            const data = await getMetadataDatabases(id);
            if (requestId !== databasesRequestIdRef.current) return;
            if (activeDsIdRef.current !== String(id)) return;
            const mergedDatabases = mergeDatabaseOptions(data, fallbackDatabase);
            setDatabases(mergedDatabases);
            setSelectedDb(mergedDatabases[0] ?? '');
        } catch (error) {
            console.error('Failed to load databases', error);
        } finally {
            if (requestId === databasesRequestIdRef.current) {
                setLoadingDatabases(false);
            }
        }
    };

    const loadTables = async (dsId: number, dbName: string, keyword?: string, page: number = 1, append: boolean = false) => {
        const normalizedKeyword = (keyword ?? '').trim();
        const requestKey = `${dsId}::${dbName}::${normalizedKeyword}::${page}`;
        if (tableLoadingRequestKeysRef.current.has(requestKey)) {
            return;
        }
        tableLoadingRequestKeysRef.current.add(requestKey);

        if (append) {
            tableMorePendingCountRef.current += 1;
            setLoadingMoreTables(true);
        } else {
            tableListPendingCountRef.current += 1;
            setLoadingTables(true);
        }
        try {
            const result = await getMetadataTables(dsId, dbName, normalizedKeyword || undefined, page, TABLE_PAGE_SIZE);
            const isStale =
                activeDsIdRef.current !== String(dsId) ||
                activeDbRef.current !== dbName ||
                tableKeywordCommittedRef.current.trim() !== normalizedKeyword;
            if (isStale) {
                return;
            }

            if (append) {
                setTables(prev => {
                    const existing = new Set(prev.map(table => table.name));
                    const next = result.data.filter(table => !existing.has(table.name));
                    return [...prev, ...next];
                });
            } else {
                setTables(result.data);
            }
            setTableTotal(result.total);
            const loadedSoFar = append ? (page - 1) * TABLE_PAGE_SIZE + result.data.length : result.data.length;
            setTableHasMore(loadedSoFar < result.total);
            setTablePage(prev => (append ? Math.max(prev, page) : page));
        } catch (error) {
            console.error('Failed to load tables', error);
        } finally {
            tableLoadingRequestKeysRef.current.delete(requestKey);
            if (append) {
                tableMorePendingCountRef.current = Math.max(0, tableMorePendingCountRef.current - 1);
                if (tableMorePendingCountRef.current === 0) {
                    setLoadingMoreTables(false);
                }
            } else {
                tableListPendingCountRef.current = Math.max(0, tableListPendingCountRef.current - 1);
                if (tableListPendingCountRef.current === 0) {
                    setLoadingTables(false);
                }
            }
        }
    };

    const loadColumns = async (dsId: number, dbName: string, tableName: string) => {
        if (columnCache.has(tableName)) return;
        setLoadingColumns(prev => new Set(prev).add(tableName));
        try {
            const cols = await getMetadataColumns(dsId, dbName, tableName);
            setColumnCache(prev => new Map(prev).set(tableName, cols));
        } catch (error) {
            console.error('Failed to load columns for', tableName, error);
        } finally {
            setLoadingColumns(prev => {
                const next = new Set(prev);
                next.delete(tableName);
                return next;
            });
        }
    };

    const handleTableScroll = useCallback(() => {
        const el = tableScrollRef.current;
        if (!el || loadingMoreTables || !tableHasMore || !selectedDsId || !selectedDb) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight - scrollTop - clientHeight < 100) {
            loadTables(Number(selectedDsId), selectedDb, tableKeywordCommitted || undefined, tablePage + 1, true);
        }
    }, [loadingMoreTables, tableHasMore, selectedDsId, selectedDb, tableKeywordCommitted, tablePage]);

    const selectedDsOption = useMemo(() => {
        if (!selectedDs) {
            return null;
        }
        return { label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs };
    }, [selectedDs]);

    const dataSourceOptions = useMemo(() => {
        const base = dataSources.map(ds => ({ label: ds.name, value: String(ds.id), type: ds.type, raw: ds }));
        if (!selectedDs || base.some(opt => opt.value === String(selectedDs.id))) {
            return base;
        }
        return [{ label: selectedDs.name, value: String(selectedDs.id), type: selectedDs.type, raw: selectedDs }, ...base];
    }, [dataSources, selectedDs]);

    const filteredDatabases = useMemo(() => {
        if (!dbKeyword) {
            return databases;
        }
        const normalized = dbKeyword.toLowerCase();
        return databases.filter(db => db.toLowerCase().includes(normalized));
    }, [databases, dbKeyword]);

    const databaseOptions = useMemo(() => {
        return filteredDatabases.map(db => ({ label: db, value: db }));
    }, [filteredDatabases]);

    const selectedDbOption = useMemo(() => {
        if (!selectedDb) {
            return null;
        }
        return { label: selectedDb, value: selectedDb };
    }, [selectedDb]);

    const hasHiddenMetadataHint =
        sidebarCollapsed &&
        Boolean(selectedDsId && selectedDb) &&
        (loadingTables || loadingMoreTables || tableTotal > 0);

    const hasHiddenResultHint =
        resultCollapsed &&
        (loadingQuery || Boolean(queryError) || Boolean(result));

    const resultStatusText = useMemo(() => {
        if (loadingQuery) {
            return '执行中...';
        }
        if (queryError) {
            return '执行失败';
        }
        if (!result) {
            return '运行 SQL 后显示';
        }
        if (result.columns.length > 0) {
            return `${result.rows.length} 条记录${typeof result.executionTimeMs === 'number' ? ` • ${result.executionTimeMs}ms` : ''}`;
        }
        if (result.message && result.message !== 'Success') {
            return '已返回执行信息';
        }
        if (typeof result.executionTimeMs === 'number') {
            return `执行完成 • ${result.executionTimeMs}ms`;
        }
        return '执行完成';
    }, [loadingQuery, queryError, result]);

    const resultOutputLabel = useMemo(() => {
        if (loadingQuery) {
            return '运行中';
        }
        if (queryError) {
            return '错误输出';
        }
        if (!result) {
            return '结果输出';
        }
        if (result.columns.length > 0) {
            return '结果集';
        }
        return '执行信息';
    }, [loadingQuery, queryError, result]);

    const resultToneClass = queryError
        ? 'is-error'
        : loadingQuery
            ? 'is-running'
            : result
                ? 'is-ready'
                : 'is-idle';

    const handleRunQuery = useCallback(async (sqlToRun?: string) => {
        let finalSql = sqlToRun;

        // If no explicit SQL provided (e.g. from button click), check for selection
        if (!finalSql && editorRef.current) {
            const selection = editorRef.current.getSelection();
            if (selection && !selection.isEmpty()) {
                finalSql = editorRef.current.getModel()?.getValueInRange(selection);
            }
        }

        // Fallback to full editor content if still no specific SQL
        finalSql = finalSql ?? sql;

        if (!selectedDsId) {
            alert('请先选择数据源');
            return;
        }
        if (!finalSql.trim()) {
            alert('Nothing to run - 请输入 SQL 语句');
            return;
        }
        setQueryError('');
        if (resultAutoOpen) {
            setResultPanelState(false);
        }
        setLoadingQuery(true);
        try {
            const data = await executeQuery(Number(selectedDsId), finalSql, selectedDb);
            setResult(data);
            setQueryError('');
        } catch (error: unknown) {
            const requestError = error as QueryEditorError;
            const message = requestError.response?.data?.message
                || requestError.message
                || '执行查询失败';
            setQueryError(message);
            setResultPanelState(false);
        } finally {
            setLoadingQuery(false);
        }
    }, [resultAutoOpen, selectedDb, selectedDsId, setResultPanelState, sql]);

    // ── SQL Formatting ──────────────────────────────────────────────────────
    const handleFormat = async () => {
        if (!editorRef.current) return;
        const raw = editorRef.current.getValue();
        try {
            const { format } = await import('sql-formatter');
            const formatted = format(raw, { language: 'sql', tabWidth: 4, keywordCase: 'upper' });
            editorRef.current.setValue(formatted);
        } catch {
            // If sql-formatter can't parse it, leave as-is
        }
    };

    // ── Result Export ────────────────────────────────────────────────────────
    const exportFileName = () => {
        const ds = selectedDs || dataSources.find(d => String(d.id) === selectedDsId);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `query-result-${ds?.name ?? 'export'}-${ts}`;
    };

    const exportCsv = () => {
        if (!result) return;
        const header = result.columns.map(c => c.name).join(',');
        const rows = result.rows.map(row =>
            result.columns.map(c => {
                const val = String(row[c.name] ?? '');
                return val.includes(',') || val.includes('\n') || val.includes('"')
                    ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(',')
        );
        const csv = [header, ...rows].join('\n');
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        triggerDownload(blob, `${exportFileName()}.csv`);
        setShowExportMenu(false);
    };

    const exportExcel = async () => {
        if (!result) return;
        const XLSX = await import('xlsx');
        const data = [
            result.columns.map(c => c.name),
            ...result.rows.map(row => result.columns.map(c => row[c.name] ?? ''))
        ];
        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Result');
        XLSX.writeFile(wb, `${exportFileName()}.xlsx`);
        setShowExportMenu(false);
    };

    const triggerDownload = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    /**
     * Extracts the SQL statement the cursor is currently on.
     * Splits the full text by semicolons and finds the segment that contains
     * the cursor's character offset position — like DataGrip.
     */
    const getStatementAtCursor = useCallback((editor: MonacoEditorInstance): string => {
        const model = editor.getModel();
        const position = editor.getPosition();
        if (!model || !position) return sql;

        const fullText = model.getValue();
        const cursorOffset = model.getOffsetAt(position);

        // Split statements by semicolons
        const stmts: { start: number; end: number; text: string }[] = [];
        let start = 0;
        for (let i = 0; i <= fullText.length; i++) {
            if (i === fullText.length || fullText[i] === ';') {
                const text = fullText.slice(start, i).trim();
                if (text) stmts.push({ start, end: i, text });
                start = i + 1;
            }
        }

        // Find the statement where the cursor is
        for (const stmt of stmts) {
            if (cursorOffset >= stmt.start && cursorOffset <= stmt.end + 1) {
                return stmt.text;
            }
        }

        // Fallback: return the full SQL
        return fullText.trim();
    }, [sql]);

    const handleRunQueryRef = useRef(handleRunQuery);
    useEffect(() => {
        handleRunQueryRef.current = handleRunQuery;
    }, [handleRunQuery]);

    const getStatementAtCursorRef = useRef(getStatementAtCursor);
    useEffect(() => {
        getStatementAtCursorRef.current = getStatementAtCursor;
    }, [getStatementAtCursor]);

    const tablesRef = useRef(tables);
    useEffect(() => {
        tablesRef.current = tables;
    }, [tables]);

    const databasesRef = useRef(databases);
    useEffect(() => {
        databasesRef.current = databases;
    }, [databases]);

    const columnCacheRef = useRef(columnCache);
    useEffect(() => {
        columnCacheRef.current = columnCache;
    }, [columnCache]);

    const dialectMetadataRef = useRef(dialectMetadata);
    useEffect(() => {
        dialectMetadataRef.current = dialectMetadata;
    }, [dialectMetadata]);

    const handleEditorDidMount = (editor: MonacoEditorInstance, monaco: typeof Monaco) => {
        monaco.editor.defineTheme('warm-parchment', {
            base: 'vs',
            inherit: true,
            rules: [
                { token: '', foreground: '3D3A36' },
                { token: 'comment', foreground: 'A09A90', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'B85C3A' },
                { token: 'string', foreground: '6B8E5A' },
                { token: 'number', foreground: 'B07D48' },
                { token: 'operator', foreground: '5B5B58' },
                { token: 'identifier', foreground: '3D3A36' },
                { token: 'type', foreground: '7A6B5D' },
                { token: 'delimiter', foreground: '8A8A86' },
                { token: 'predefined', foreground: 'B85C3A' },
            ],
            colors: {
                'editor.background': '#F8F7F4',
                'editor.foreground': '#3D3A36',
                'editor.lineHighlightBackground': '#F0EDE6',
                'editor.selectionBackground': '#E3D9CC',
                'editor.inactiveSelectionBackground': '#EDE8E0',
                'editorCursor.foreground': '#D97757',
                'editorLineNumber.foreground': '#C5C0B8',
                'editorLineNumber.activeForeground': '#8A8A86',
                'editorIndentGuide.background': '#E8E4DC',
                'editorIndentGuide.activeBackground': '#D5D0C8',
                'editor.selectionHighlightBackground': '#E8DFD4',
                'editorBracketMatch.background': '#E8DFD4',
                'editorBracketMatch.border': '#C4A882',
                'editorGutter.background': '#F8F7F4',
                'editorWidget.background': '#F3F1EC',
                'editorWidget.border': '#E3DED5',
                'editorSuggestWidget.background': '#F8F7F4',
                'editorSuggestWidget.border': '#E3DED5',
                'editorSuggestWidget.selectedBackground': '#EFECE6',
                'editorSuggestWidget.highlightForeground': '#D97757',
            },
        });

        monaco.editor.setTheme('warm-parchment');

        editorRef.current = editor;

        // Register custom completion provider for SQL
        completionProviderRef.current?.dispose();
        const provider = monaco.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: ['.', ' '],
            provideCompletionItems: (model, position) => {
                const word = model.getWordUntilPosition(position);
                const lineContent = model.getLineContent(position.lineNumber);
                const textBeforeCursor = lineContent.substring(0, position.column - 1);

                const range: Monaco.IRange = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };

                const suggestions: Monaco.languages.CompletionItem[] = [];
                const suggestionKeys = new Set<string>();
                const currentTables = tablesRef.current;
                const currentDatabases = databasesRef.current;
                const currentColumnCache = columnCacheRef.current;
                const currentDialect = dialectMetadataRef.current;
                const normalizedWord = (word.word || '').toLowerCase();
                const selectedDatabase = activeDbRef.current.toLowerCase();

                const buildPrefixRank = (candidate: string) => {
                    const normalizedCandidate = candidate.toLowerCase();
                    if (!normalizedWord) return '2';
                    if (normalizedCandidate === normalizedWord) return '0';
                    if (normalizedCandidate.startsWith(normalizedWord)) return '1';
                    if (normalizedCandidate.includes(normalizedWord)) return '2';
                    return '3';
                };

                const pushSuggestion = (
                    item: Monaco.languages.CompletionItem,
                    categoryRank: string,
                    dedupeKey?: string,
                ) => {
                    const labelText = typeof item.label === 'string' ? item.label : item.label.label;
                    const key = dedupeKey ?? `${item.kind}:${labelText.toLowerCase()}:${item.detail ?? ''}`;
                    if (suggestionKeys.has(key)) {
                        return;
                    }

                    suggestionKeys.add(key);
                    suggestions.push({
                        ...item,
                        sortText: `${categoryRank}${buildPrefixRank(labelText)}-${labelText.toLowerCase()}`,
                    });
                };

                // --- Extract Aliases ---
                const fullText = model.getValue();
                const aliases: Record<string, string> = {};
                // Match "FROM table alias", "FROM schema.table AS alias", "JOIN table alias", or ", table alias"
                const aliasRegex = /(?:FROM|JOIN|,)\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)(?:\s+AS)?\s+([a-zA-Z0-9_]+)/gi;
                const reservedWords = new Set(['WHERE', 'ON', 'GROUP', 'ORDER', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'JOIN', 'SELECT', 'LIMIT', 'HAVING', 'AND', 'OR', 'AS']);
                let match: RegExpExecArray | null;
                while ((match = aliasRegex.exec(fullText)) !== null) {
                    const tableName = match[1].toLowerCase();
                    const aliasName = match[2].toLowerCase();
                    if (!reservedWords.has(aliasName.toUpperCase()) && !reservedWords.has(tableName.toUpperCase())) {
                        aliases[aliasName] = tableName;
                    }
                }

                // 1. Column suggestions for "table." or "alias."
                const lastDotIndex = textBeforeCursor.lastIndexOf('.');
                if (lastDotIndex !== -1) {
                    const parts = textBeforeCursor.trim().split(/[\s,()=<>]+/); // Split by boundary characters
                    const lastPart = parts[parts.length - 1]; // e.g. "t1" or "t1." or "t1.id."

                    const dotParts = lastPart.split('.');
                    // If we have at least one dot, the identifier is the part just before the last dot
                    if (dotParts.length >= 2) {
                        const identifier = dotParts[dotParts.length - 2].toLowerCase();
                        const isDatabaseQualifier = currentDatabases.some(db => db.toLowerCase() === identifier);
                        if (isDatabaseQualifier) {
                            if (identifier === selectedDatabase) {
                                currentTables.forEach(table => {
                                    pushSuggestion({
                                        label: table.name,
                                        kind: monaco.languages.CompletionItemKind.Struct,
                                        insertText: table.name,
                                        detail: `Table in ${identifier}`,
                                        documentation: table.remarks,
                                        range,
                                    }, '10', `db-table:${identifier}:${table.name.toLowerCase()}`);
                                });
                            }
                            return { suggestions };
                        }

                        const actualTableName = aliases[identifier] || identifier;

                        const table = currentTables.find(t => t.name.toLowerCase() === actualTableName);
                        const cachedCols = currentColumnCache.get(actualTableName) || currentColumnCache.get(table?.name || '');
                        if (cachedCols) {
                            cachedCols.forEach(col => {
                                pushSuggestion({
                                    label: col.name,
                                    kind: monaco.languages.CompletionItemKind.Field,
                                    insertText: col.name,
                                    detail: `${actualTableName} Column (${col.type})`,
                                    documentation: col.remarks,
                                    range,
                                }, '00', `column:${actualTableName}:${col.name.toLowerCase()}`);
                            });
                            return { suggestions };
                        }

                        const matchedTable = currentTables.find(t => t.name.toLowerCase() === actualTableName);
                        if (matchedTable && selectedDsId && selectedDb) {
                            loadColumns(Number(selectedDsId), selectedDb, matchedTable.name);
                        }
                        return { suggestions };
                    }
                }

                // 2. Context-aware database/table suggestions after relation keywords
                const relationContextMatch = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_]*)$/i.exec(textBeforeCursor);
                if (relationContextMatch) {
                    currentDatabases.forEach(database => {
                        pushSuggestion({
                            label: database,
                            kind: monaco.languages.CompletionItemKind.Module,
                            insertText: database,
                            detail: 'Database',
                            range,
                        }, '05', `database:${database.toLowerCase()}`);
                    });
                    currentTables.forEach(table => {
                        pushSuggestion({
                            label: table.name,
                            kind: monaco.languages.CompletionItemKind.Struct,
                            insertText: table.name,
                            detail: `Table (${table.type})`,
                            documentation: table.remarks,
                            range,
                        }, '08', `table:${table.name.toLowerCase()}`);
                    });
                    return { suggestions };
                }

                const useContextMatch = /\b(USE|DATABASE|SCHEMA)\s+([a-zA-Z0-9_]*)$/i.exec(textBeforeCursor);
                if (useContextMatch) {
                    currentDatabases.forEach(database => {
                        pushSuggestion({
                            label: database,
                            kind: monaco.languages.CompletionItemKind.Module,
                            insertText: database,
                            detail: 'Database',
                            range,
                        }, '02', `database:${database.toLowerCase()}`);
                    });
                    return { suggestions };
                }

                // 3. Add General SQL Keywords and Functions from Dialect
                const keywordSuggestions = currentDialect?.keywords?.length
                    ? currentDialect.keywords
                    : FALLBACK_SQL_KEYWORDS;

                keywordSuggestions.forEach(keyword => {
                    pushSuggestion({
                        label: keyword,
                        kind: monaco.languages.CompletionItemKind.Keyword,
                        insertText: keyword,
                        range,
                    }, '70', `keyword:${keyword.toLowerCase()}`);
                });

                if (currentDialect) {
                    currentDialect.dataTypes.forEach(dt => {
                        pushSuggestion({
                            label: dt,
                            kind: monaco.languages.CompletionItemKind.TypeParameter,
                            insertText: dt,
                            detail: 'Data Type',
                            range,
                        }, '60', `datatype:${dt.toLowerCase()}`);
                    });

                    currentDialect.functions.forEach(func => {
                        pushSuggestion({
                            label: func.name,
                            kind: monaco.languages.CompletionItemKind.Function,
                            insertText: func.signature || `${func.name}($0)`,
                            insertTextRules: (func.signature || `${func.name}($0)`).includes('$')
                                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                                : undefined,
                            detail: 'Function',
                            documentation: func.description,
                            range,
                        }, '50', `function:${func.name.toLowerCase()}`);
                    });
                }

                currentDatabases.forEach(database => {
                    pushSuggestion({
                        label: database,
                        kind: monaco.languages.CompletionItemKind.Module,
                        insertText: database,
                        detail: 'Database',
                        range,
                    }, '20', `database:${database.toLowerCase()}`);
                });

                currentTables.forEach(table => {
                    pushSuggestion({
                        label: table.name,
                        kind: monaco.languages.CompletionItemKind.Struct,
                        insertText: table.name,
                        detail: `Table (${table.type})`,
                        documentation: table.remarks,
                        range,
                    }, '30', `table:${table.name.toLowerCase()}`);
                });

                currentColumnCache.forEach((cols, tblName) => {
                    cols.forEach(col => {
                        pushSuggestion({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: col.name,
                            detail: `Column of ${tblName} (${col.type})`,
                            range,
                        }, '40', `column:${tblName}:${col.name.toLowerCase()}`);
                    });
                });

                return { suggestions };
            },
        });

        // Store provider to dispose on unmount
        completionProviderRef.current = provider;

        // Add Cmd+Enter / Ctrl+Enter: run selection if exists, else only the statement under the cursor
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const selection = editor.getSelection();
            if (selection && !selection.isEmpty()) {
                const selectedText = editor.getModel()?.getValueInRange(selection);
                handleRunQueryRef.current(selectedText);
            } else {
                const stmt = getStatementAtCursorRef.current(editor);
                handleRunQueryRef.current(stmt);
            }
        });

        // Add Shift+Alt+F (Win/Linux) or Shift+Cmd+F (Mac): format SQL
        const formatKeybinding = isMac
            ? monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF
            : monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF;
        editor.addAction({
            id: 'format-sql',
            label: 'Format SQL',
            keybindings: [formatKeybinding],
            run: () => handleFormat(),
        });
    };

    useEffect(() => {
        return () => {
            completionProviderRef.current?.dispose();
            completionProviderRef.current = null;
        };
    }, []);

    return (
        <div
            ref={querySplitterRef}
            className={`query-splitter h-full flex w-full ${sidebarTransitioning ? 'sidebar-transitioning' : ''}`.trim()}
        >
            <Allotment
                ref={horizontalSplitterRef}
                className="query-splitter-panel"
                defaultSizes={initialHorizontalSizes}
                onChange={(sizes) => {
                    horizontalLayoutSizesRef.current = sizes;
                }}
                onDragEnd={(sizes) => {
                    horizontalLayoutSizesRef.current = sizes;
                    const sidebarSize = sizes[0];
                    if (typeof sidebarSize === 'number' && sidebarSize > 0) {
                        const nextWidth = clampSidebarWidth(sidebarSize);
                        setSidebarExpandedWidth(currentWidth => currentWidth === nextWidth ? currentWidth : nextWidth);
                        persistSidebarExpandedWidth(nextWidth);
                    }
                }}
                onVisibleChange={(index, visible) => {
                    if (index === 0) {
                        const nextCollapsed = !visible;
                        setSidebarCollapsed(current => current === nextCollapsed ? current : nextCollapsed);
                        persistSidebarCollapsed(nextCollapsed);
                    }
                }}
            >
                {/* 左侧元数据面板 */}
                <Allotment.Pane
                    preferredSize={SIDEBAR_DEFAULT_WIDTH_PX}
                    minSize={SIDEBAR_MIN_WIDTH_PX}
                    maxSize={SIDEBAR_MAX_WIDTH_PX}
                    visible={!sidebarCollapsed}
                    className="metadata-panel-wrapper"
                >
                    <aside className={`metadata-panel ${sidebarCollapsed ? 'sidebar-hidden' : 'sidebar-visible'}`}>
                        <div className="metadata-header">
                            <span className="metadata-title">表结构</span>
                            {selectedDsId && selectedDb && tableTotal > 0 && (
                                <span className="metadata-total-count">共 {tableTotal} 张表</span>
                            )}
                        </div>
                        {selectedDsId && selectedDb && (
                            <div className="metadata-search">
                                <Search size={14} className="metadata-search-icon" />
                                <input
                                    type="text"
                                    className="metadata-search-input"
                                    aria-label="搜索表名"
                                    placeholder="搜索表名..."
                                    value={tableKeyword}
                                    onChange={(e) => {
                                        setTableKeyword(e.target.value);
                                        if (!composingRef.current) {
                                            setTableKeywordCommitted(e.target.value);
                                        }
                                    }}
                                    onCompositionStart={() => { composingRef.current = true; }}
                                    onCompositionEnd={(e) => {
                                        composingRef.current = false;
                                        const val = (e.target as HTMLInputElement).value;
                                        setTableKeyword(val);
                                        setTableKeywordCommitted(val);
                                    }}
                                />
                            </div>
                        )}
                        <div
                            className="metadata-content"
                            ref={handleTableScrollRef}
                            onScroll={handleTableScroll}
                        >
                            {loadingTables ? (
                                <div className="metadata-empty">
                                    <Loader2 size={24} className="animate-spin" />
                                    <span>加载中...</span>
                                </div>
                            ) : tables.length === 0 ? (
                                <div className="metadata-empty">
                                    <Database size={32} className="metadata-empty-icon" />
                                    <span>{selectedDsId && selectedDb ? (tableKeyword ? '未找到匹配的表' : '该数据库下没有表') : '请先选择数据源和数据库'}</span>
                                </div>
                            ) : (
                                <div
                                    style={{
                                        height: `${virtualizer.getTotalSize()}px`,
                                        width: '100%',
                                        position: 'relative',
                                    }}
                                >
                                    {virtualizer.getVirtualItems().map(virtualRow => {
                                        const table = tables[virtualRow.index];
                                        if (!table) return null;
                                        const isExpanded = expandedTables.has(table.name);
                                        const cols = columnCache.get(table.name);
                                        const isLoadingCols = loadingColumns.has(table.name);
                                        return (
                                            <div
                                                key={table.name}
                                                data-index={virtualRow.index}
                                                ref={virtualizer.measureElement}
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    transform: `translateY(${virtualRow.start}px)`,
                                                }}
                                            >
                                                <div className="metadata-item">
                                                    <button
                                                        type="button"
                                                        className="metadata-item-header"
                                                        onClick={() => toggleTableExpand(table.name)}
                                                        aria-expanded={isExpanded}
                                                        aria-label={`${isExpanded ? '收起' : '展开'} ${table.name} 字段`}
                                                    >
                                                        {isExpanded
                                                            ? <ChevronDown size={14} className="metadata-chevron" />
                                                            : <ChevronRight size={14} className="metadata-chevron" />
                                                        }
                                                        <Database size={14} className="metadata-icon" />
                                                        <span className="metadata-item-name">{table.name}</span>
                                                    </button>
                                                    {isExpanded && (
                                                        <ul className="metadata-columns">
                                                            {isLoadingCols ? (
                                                                <li className="metadata-column-loading">
                                                                    <Loader2 size={12} className="animate-spin" />
                                                                    <span>加载字段...</span>
                                                                </li>
                                                            ) : cols ? (
                                                                <>
                                                                    {cols.slice(0, 50).map(col => (
                                                                        <li key={col.name} className="metadata-column">
                                                                            <span className="column-name">{col.name}</span>
                                                                            <span className="column-type">{col.type}</span>
                                                                        </li>
                                                                    ))}
                                                                    {cols.length > 50 && (
                                                                        <li className="metadata-more">
                                                                            还有 {cols.length - 50} 个字段...
                                                                        </li>
                                                                    )}
                                                                </>
                                                            ) : null}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {loadingMoreTables && (
                                <div className="metadata-loading-more">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>加载更多...</span>
                                </div>
                            )}
                        </div>
                    </aside>
                </Allotment.Pane>

                {/* 右侧主内容区 */}
                <Allotment.Pane minSize={QUERY_MAIN_MIN_WIDTH_PX} preferredSize="100%" className="query-main-wrapper">
                    <header className={`query-toolbar ${sidebarCollapsed ? '' : 'has-left-separator'}`.trim()}>
                        <div className="toolbar-left">
                            <TooltipProvider delayDuration={400}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            className={`sidebar-toggle-button toolbar-sidebar-toggle ${hasHiddenMetadataHint ? 'has-notice' : ''}`}
                                            onClick={toggleSidebar}
                                            aria-label={sidebarCollapsed ? '展开表结构' : '收起表结构'}
                                        >
                                            {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
                                            {hasHiddenMetadataHint ? <span className="sidebar-toggle-notice" aria-hidden="true" /> : null}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        {sidebarCollapsed ? '展开表结构' : '收起表结构'} <kbd>{isMac ? '⌘' : 'Ctrl'}+B</kbd>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <span className="toolbar-divider" />
                            <DataSourceSelect
                                options={dataSourceOptions}
                                value={String(selectedDsId)}
                                selectedOption={selectedDsOption}
                                onChange={(val, option) => {
                                    setSelectedDsId(val);
                                    setDsKeyword('');
                                    if (option?.raw) {
                                        setSelectedDs(option.raw as DataSource);
                                        return;
                                    }
                                    const fallback = dataSources.find(ds => String(ds.id) === val) || null;
                                    setSelectedDs(fallback);
                                }}
                                onInputChange={(val) => setDsKeyword(val)}
                                loading={loadingDs}
                                loadingMore={loadingDsMore}
                                hasMore={dsHasMore}
                                onLoadMore={loadMoreDataSources}
                                placeholder="搜索并选择数据源..."
                                theme="light"
                                disableClientFilter
                                virtualize
                                virtualItemSize={32}
                                ariaLabel="数据源选择"
                                emptyText={dsKeyword ? '未找到匹配的数据源' : '暂无数据源'}
                            />
                            {selectedDsId && (
                                <>
                                    <span className="breadcrumb-divider">/</span>
                                    <DataSourceSelect
                                        options={databaseOptions}
                                        value={selectedDb}
                                        selectedOption={selectedDbOption}
                                        onChange={(val) => setSelectedDb(val)}
                                        onInputChange={(val) => setDbKeyword(val)}
                                        loading={loadingDatabases}
                                        placeholder="选择数据库"
                                        theme="light"
                                        disableClientFilter
                                        ariaLabel="数据库选择"
                                        emptyText={dbKeyword ? '未找到匹配数据库' : '暂无数据库'}
                                    />
                                </>
                            )}
                        </div>
                        <div className="toolbar-right">
                            <TooltipProvider delayDuration={400}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            className="format-button-inline"
                                            onClick={handleFormat}
                                            aria-label="格式化 SQL"
                                        >
                                            <Wand2 size={16} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        格式化 <kbd>{isMac ? '⌘' : 'Ctrl'}+⇧+F</kbd>
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            className="run-button"
                                            onClick={() => handleRunQuery()}
                                            aria-label="执行 SQL"
                                        >
                                            {loadingQuery ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="white" />}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content" side="bottom">
                                        执行 <kbd>{isMac ? '⌘' : 'Ctrl'}+↵</kbd>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </header>

                    <div
                        ref={queryContentRef}
                        className={`query-content-splitter ${resultTransitioning ? 'result-transitioning' : ''}`.trim()}
                    >
                        <Allotment
                            ref={verticalSplitterRef}
                            vertical
                            defaultSizes={initialVerticalSizes}
                            onChange={(sizes) => {
                                verticalLayoutSizesRef.current = sizes;
                            }}
                            onDragEnd={(sizes) => {
                                verticalLayoutSizesRef.current = sizes;
                                const resultPaneSize = sizes[1];
                                if (typeof resultPaneSize === 'number' && resultPaneSize > RESULT_PANEL_COLLAPSED_HEIGHT_PX) {
                                    const nextHeight = Math.max(RESULT_PANEL_MIN_EXPANDED_HEIGHT_PX, Math.round(resultPaneSize));
                                    setResultExpandedHeight(currentHeight => currentHeight === nextHeight ? currentHeight : nextHeight);
                                    persistResultExpandedHeight(nextHeight);
                                }
                            }}
                        >
                        <Allotment.Pane preferredSize="60%" className="query-editor-wrapper relative">
                            <section className="editor-section">

                                <div className="editor-wrapper">
                                    <Suspense fallback={<EditorLoader />}>
                                        <Editor
                                            height="100%"
                                            language="sql"
                                            theme="warm-parchment"
                                            value={sql}
                                            loading={<EditorLoader />}
                                            onChange={(value) => setSql(value || '')}
                                            onMount={handleEditorDidMount}
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 14,
                                                quickSuggestions: {
                                                    other: true,
                                                    comments: false,
                                                    strings: false,
                                                },
                                                quickSuggestionsDelay: 120,
                                                suggestOnTriggerCharacters: true,
                                                lineNumbers: 'on',
                                                lineNumbersMinChars: 2,
                                                lineDecorationsWidth: 8,
                                                glyphMargin: false,
                                                scrollBeyondLastLine: false,
                                                automaticLayout: true,
                                                padding: { top: 12, bottom: 12 },
                                                fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                                roundedSelection: false,
                                                cursorStyle: 'line',
                                                renderLineHighlight: 'all',
                                            }}
                                        />
                                    </Suspense>
                                </div>
                            </section>
                        </Allotment.Pane>

                        <Allotment.Pane
                            minSize={RESULT_PANEL_COLLAPSED_HEIGHT_PX}
                            preferredSize="40%"
                            className={`query-result-wrapper ${resultCollapsed ? 'is-collapsed' : ''}`.trim()}
                        >
                            <section className={`results-section ${resultCollapsed ? 'collapsed' : ''}`.trim()}>
                                <div className="section-header">
                                    <div className="section-header-left">
                                        <div className={`result-output-tab ${resultToneClass}`.trim()}>
                                            <span className="result-output-tab-dot" aria-hidden="true" />
                                            <span>{resultOutputLabel}</span>
                                        </div>
                                        <div className={`result-summary ${resultToneClass}`.trim()}>
                                            {loadingQuery ? <Loader2 size={12} className="animate-spin" /> : null}
                                            <span>{resultStatusText}</span>
                                        </div>
                                    </div>
                                    <div className="section-header-right">
                                        {!resultCollapsed && result && (
                                            <div className="result-info">
                                                找到 {result.rows.length} 条记录 • 耗时 {result.executionTimeMs}ms
                                            </div>
                                        )}
                                        {!resultCollapsed && result && result.columns.length > 0 && (
                                            <div className="export-wrapper" ref={exportMenuRef}>
                                                <button
                                                    className="export-button"
                                                    onClick={() => setShowExportMenu(v => !v)}
                                                    title="导出结果"
                                                    aria-haspopup="menu"
                                                    aria-expanded={showExportMenu}
                                                >
                                                    <Download size={14} />
                                                    <span>导出</span>
                                                </button>
                                                {showExportMenu && (
                                                    <div className="export-menu" role="menu">
                                                        <button className="export-menu-item" role="menuitem" onClick={exportCsv}>
                                                            <FileText size={14} />
                                                            <span>导出 CSV</span>
                                                        </button>
                                                        <button className="export-menu-item" role="menuitem" onClick={exportExcel}>
                                                            <Sheet size={14} />
                                                            <span>导出 Excel (.xlsx)</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <TooltipProvider delayDuration={400}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className={`section-toggle-button ${hasHiddenResultHint ? 'has-notice' : ''}`.trim()}
                                                        onClick={toggleResultPanel}
                                                        aria-label={resultCollapsed ? '展开查询结果' : '收起查询结果'}
                                                    >
                                                        {resultCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                        {hasHiddenResultHint ? <span className="sidebar-toggle-notice" aria-hidden="true" /> : null}
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent className="tooltip-content" side="top">
                                                    {resultCollapsed ? '展开查询结果' : '收起查询结果'} <kbd>{isMac ? '⌘' : 'Ctrl'}+J</kbd>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                </div>
                                {!resultCollapsed && (
                                    <div className="results-container">
                                        {loadingQuery && !result ? (
                                            <div className="empty-results">
                                                <Loader2 size={32} className="animate-spin empty-icon" />
                                                <span>正在执行 SQL，请稍候...</span>
                                            </div>
                                        ) : queryError ? (
                                            <div className="result-error">
                                                <span>执行失败：{queryError}</span>
                                            </div>
                                        ) : !result ? (
                                            <div className="empty-results">
                                                <Code2 size={48} className="empty-icon" />
                                                <span>暂无查询结果。请运行 SQL 语句以查看数据。</span>
                                            </div>
                                        ) : result.message !== 'Success' && (!result.columns || result.columns.length === 0) ? (
                                            <div className="result-message">
                                                <strong>执行信息：</strong>
                                                <pre>{result.message}</pre>
                                            </div>
                                        ) : (
                                            <table className="results-table">
                                                <thead>
                                                    <tr>
                                                        {result.columns.map(col => (
                                                            <th key={col.name}>
                                                                <div className="th-content">
                                                                    <span className="th-name">{col.name}</span>
                                                                    <span className="th-type">{col.type}</span>
                                                                </div>
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {result.rows.map((row, idx) => (
                                                        <tr key={idx}>
                                                            {result.columns.map(col => (
                                                                <td key={col.name} title={String(row[col.name] ?? '')}>
                                                                    {String(row[col.name] ?? '')}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                )}
                            </section>
                        </Allotment.Pane>
                    </Allotment>
                    </div>
                </Allotment.Pane>
            </Allotment>
        </div>
    );
}
