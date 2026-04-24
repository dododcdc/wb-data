import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { Database, Inbox, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
} from '../../components/ui/dialog';
import { cn } from '../../lib/utils';
import { SqlEditor } from '../../components/sql-editor/SqlEditor';
import { loadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';
import { registerSqlEditorTheme } from '../../components/sql-editor/sqlEditorTheme';
import type { OfflineFlowNode } from '../../api/offline';
import { OfflineDataSourcePicker } from './OfflineDataSourcePicker';
import { useNodeEditorDataSources } from './useNodeEditorDataSources';
import {
    buildNodeEditorDataSourceOptions,
} from './nodeEditorDataSourceRules';
import {
    getOfflineNodeKindDescription,
    getOfflineNodeKindLabel,
    isSqlEditorNodeKind,
} from './offlineNodeKinds';

/**
 * Lazy-loaded Monaco Editor for non-SQL nodes (Shell scripts).
 * SQL/HiveSQL nodes use the shared SqlEditor component instead.
 */
const LazyEditor = lazy(() => loadSqlEditorModule());

export interface NodeEditorDialogProps {
    open: boolean;
    activeNode: OfflineFlowNode | null;
    groupId: number | null;
    content: string;
    onOpenChange: (open: boolean) => void;
    onTempSave: (content: string, dataSourceId?: number, dataSourceType?: string) => void;
    onContentChange: (content: string) => void;
    onDraftChange?: (content: string, dataSourceId?: number, dataSourceType?: string) => void;
}

export function NodeEditorDialog({
    open,
    activeNode,
    groupId,
    content,
    onOpenChange,
    onTempSave,
    onContentChange,
    onDraftChange,
}: NodeEditorDialogProps) {
    const latestContentRef = useRef(content);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const {
        currentDataSourceId,
        selectedDataSource,
        options: dataSourceOptions,
        loading: dataSourcesLoading,
        loadingMore: dataSourcesLoadingMore,
        hasMore: dataSourcesHasMore,
        handleSearchKeywordChange,
        loadMore: loadMoreDataSources,
        setCurrentDataSourceId,
    } = useNodeEditorDataSources({
        open,
        kind: activeNode?.kind ?? 'SHELL',
        groupId,
        initialDataSourceId: activeNode?.dataSourceId,
    });
    const dataSourceSelectOptions = useMemo(() => buildNodeEditorDataSourceOptions(dataSourceOptions), [dataSourceOptions]);

    useEffect(() => {
        latestContentRef.current = content;
    }, [content]);

    useEffect(() => {
        if (!open) return;
        onDraftChange?.(latestContentRef.current, currentDataSourceId, selectedDataSource?.type);
    }, [currentDataSourceId, onDraftChange, open, selectedDataSource?.type]);

    useEffect(() => {
        if (!open || !editorRef.current) {
            return;
        }

        const frameId = window.requestAnimationFrame(() => {
            editorRef.current?.focus();
        });

        return () => window.cancelAnimationFrame(frameId);
    }, [open, activeNode?.taskId]);

    /**
     * onMount for shared SqlEditor (SQL/HiveSQL nodes).
     * The shared core handles theme + format action automatically;
     * we just need a reference for focus management.
     */
    const handleSqlEditorMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor, _monaco: typeof Monaco) => {
        editorRef.current = editor;
        editor.focus();
    }, []);

    /**
     * onMount for Shell nodes (raw Monaco Editor without shared SQL core).
     * Registers theme manually since Shell doesn't go through SqlEditor.
     */
    const handleShellEditorMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
        editorRef.current = editor;
        registerSqlEditorTheme(monaco);
        monaco.editor.setTheme('warm-parchment');
        editor.focus();
    }, []);

    if (!activeNode) return null;
    const isSqlNode = isSqlEditorNodeKind(activeNode.kind);
    const currentDS = selectedDataSource;

    const handleAttemptClose = () => onOpenChange(false);

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) handleAttemptClose(); }}>
            <DialogPortal>
                <DialogOverlay className="fixed inset-0 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" style={{ zIndex: 1050 }} />
                <DialogContent 
                    className="fixed inset-0 flex flex-col bg-white max-h-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100" 
                    style={{ zIndex: 1050 }}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    <div className="flex items-center justify-between border-b px-4 py-2 bg-[#fdfcfb] shadow-sm z-10">
                        <div className="flex items-center gap-5">
                            {/* Identity Section */}
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border",
                                    activeNode.kind === 'SQL'
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                        : activeNode.kind === 'HIVE_SQL'
                                            ? "bg-amber-50 text-amber-700 border-amber-100"
                                            : "bg-gray-100 text-gray-600 border-gray-200"
                                )}>
                                    {getOfflineNodeKindLabel(activeNode.kind)}
                                </div>
                                <DialogTitle className="text-sm font-mono font-medium text-gray-600">
                                    {activeNode.taskId}
                                </DialogTitle>
                                <DialogDescription className="sr-only">
                                    {getOfflineNodeKindDescription(activeNode.kind)}: {activeNode.taskId}
                                </DialogDescription>
                            </div>

                            <div className="h-4 w-[1px] bg-gray-200" />

                            {/* Config Section */}
                            {isSqlNode && (
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5 text-gray-500">
                                        <Database size={14} strokeWidth={2.5} />
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">数据源</span>
                                    </div>
                                    <div className="min-w-[260px]">
                                        <OfflineDataSourcePicker
                                            options={dataSourceSelectOptions}
                                            selectedOption={currentDS ? {
                                                label: currentDS.name,
                                                value: String(currentDS.id),
                                                type: currentDS.type,
                                                raw: currentDS,
                                            } : null}
                                            onSelect={(option) => {
                                                setCurrentDataSourceId(Number(option.value));
                                            }}
                                            onSearch={handleSearchKeywordChange}
                                            loading={dataSourcesLoading}
                                            loadingMore={dataSourcesLoadingMore}
                                            hasMore={dataSourcesHasMore}
                                            onLoadMore={loadMoreDataSources}
                                            placeholder={activeNode.kind === 'HIVE_SQL' ? '选择 Hive 数据源...' : '选择数据源...'}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <TooltipProvider delayDuration={300}>
                            <div className="flex items-center gap-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="p-1.5 rounded hover:bg-white hover:shadow-sm text-gray-500 hover:text-indigo-600 transition-all active:scale-95"
                                            aria-label="关闭并保留草稿"
                                            onClick={() => onTempSave(content, currentDataSourceId, currentDS?.type)}
                                        >
                                            <Inbox size={18} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content z-[2100]" side="bottom">
                                        关闭编辑器并保留当前草稿
                                    </TooltipContent>
                                </Tooltip>

                                <div className="w-[1px] h-4 bg-gray-200 mx-1" />

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="p-1.5 rounded hover:bg-white hover:shadow-sm text-gray-400 hover:text-red-500 transition-all active:scale-95"
                                            aria-label="关闭"
                                            onClick={handleAttemptClose}
                                        >
                                            <X size={20} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="tooltip-content z-[2100]" side="bottom">
                                        关闭
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                        </TooltipProvider>
                    </div>
                    <div
                        className="flex-1 min-h-0 relative"
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            event.nativeEvent.stopImmediatePropagation?.();
                        }}
                    >
                        {isSqlNode ? (
                            <SqlEditor
                                value={content}
                                onChange={(value) => onContentChange(value ?? '')}
                                onMount={handleSqlEditorMount}
                                options={{
                                    lineNumbersMinChars: 3,
                                    padding: { top: 14, bottom: 14 },
                                }}
                            />
                        ) : (
                            <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">编辑器加载中...</div>}>
                                <LazyEditor
                                    height="100%"
                                    width="100%"
                                    onMount={handleShellEditorMount}
                                    language="shell"
                                    theme="warm-parchment"
                                    value={content}
                                    onChange={(value: string | undefined) => onContentChange(value ?? '')}
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        lineNumbers: 'on',
                                        lineNumbersMinChars: 3,
                                        wordWrap: 'on',
                                        automaticLayout: true,
                                        scrollBeyondLastLine: false,
                                        tabSize: 2,
                                        padding: { top: 14, bottom: 14 },
                                    }}
                                />
                            </Suspense>
                        )}
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
