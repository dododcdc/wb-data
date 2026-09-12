import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { Braces, Database, LoaderCircle, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from '../../components/ui/dialog';
import { cn } from '../../lib/utils';
import { SqlEditor } from '../../components/sql-editor/SqlEditor';
import { loadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';
import { registerSqlEditorTheme } from '../../components/sql-editor/sqlEditorTheme';
import type { FlowParameterDefinitionSnapshot, OfflineFlowNode } from '../../api/offline';
import type { TransferConfig } from './transfer/transferTypes';
import { TransferNodeDialog, type TransferNodeDraftState } from './transfer/TransferNodeDialog';
import { DataSourceSelect } from '../../components/DataSourceSelect';
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
    parameterDefinitions?: FlowParameterDefinitionSnapshot[];
    onOpenChange: (open: boolean) => void;
    onTempSave: (content: string, dataSourceId?: number, dataSourceType?: string) => void;
    onContentChange: (content: string) => void;
    onDraftChange?: (content: string, dataSourceId?: number, dataSourceType?: string) => void;
    onTransferChange?: (transferDraft: TransferConfig, state: TransferNodeDraftState) => void;
}

export function NodeEditorDialog({
    open,
    activeNode,
    groupId,
    content,
    parameterDefinitions = [],
    onOpenChange,
    onContentChange,
    onDraftChange,
    onTransferChange,
}: NodeEditorDialogProps) {
    const latestContentRef = useRef(content);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
    const [paramMenuOpen, setParamMenuOpen] = useState(false);
    const paramMenuRef = useRef<HTMLDivElement | null>(null);
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
    const currentDS = selectedDataSource;
    const dataSourceSelectOptions = useMemo(() => buildNodeEditorDataSourceOptions(dataSourceOptions), [dataSourceOptions]);
    const dataSourceSelectValue = currentDataSourceId === undefined ? undefined : String(currentDataSourceId);
    const selectedDataSourceOption = useMemo(() => {
        if (currentDS) {
            return {
                label: currentDS.name,
                value: String(currentDS.id),
                type: currentDS.type,
                raw: currentDS,
            };
        }
        if (!dataSourceSelectValue) {
            return null;
        }
        return dataSourceSelectOptions.find((option) => option.value === dataSourceSelectValue) ?? null;
    }, [currentDS, dataSourceSelectOptions, dataSourceSelectValue]);

    useEffect(() => {
        latestContentRef.current = content;
    }, [content]);

    useEffect(() => {
        if (!open) return;
        onDraftChange?.(latestContentRef.current, currentDataSourceId, selectedDataSourceOption?.type);
    }, [currentDataSourceId, onDraftChange, open, selectedDataSourceOption?.type]);

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
    const handleSqlEditorMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
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

    const handleTransferDraftChange = useCallback((transferDraft: TransferConfig, state: TransferNodeDraftState) => {
        onTransferChange?.(transferDraft, state);
    }, [onTransferChange]);

    const handleInsertParameter = useCallback((key: string) => {
        const editor = editorRef.current;
        const textToInsert = `\${${key}}`;
        if (!editor) {
            onContentChange(content ? `${content} ${textToInsert}` : textToInsert);
            return;
        }
        const selection = editor.getSelection();
        if (selection) {
            const op: Monaco.editor.ISingleEditOperation = {
                range: selection,
                text: textToInsert,
                forceMoveMarkers: true,
            };
            editor.executeEdits('parameter-insert', [op]);
            editor.focus();
        } else {
            editor.trigger('keyboard', 'type', { text: textToInsert });
            editor.focus();
        }
    }, [content, onContentChange]);

    useEffect(() => {
        if (!paramMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (paramMenuRef.current && !paramMenuRef.current.contains(e.target as Node)) {
                setParamMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [paramMenuOpen]);

    if (!activeNode) return null;
    const isSqlNode = isSqlEditorNodeKind(activeNode.kind);
    const supportsParameters = activeNode.kind === 'SQL';
    const isTransferNode = activeNode.kind === 'TRANSFER';

    const handleAttemptClose = () => onOpenChange(false);

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) handleAttemptClose(); }}>
            <DialogContent
                ref={(el) => { setDialogEl(el); }}
                onOpenAutoFocus={(e) => e.preventDefault()}
                hideClose
                fullScreen
            >
                <div className="dialog-toolbar flex items-center justify-between gap-4 bg-[#fdfcfb] shadow-sm z-10">
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
                                    <DataSourceSelect
                                        options={dataSourceSelectOptions}
                                        menuContainer={dialogEl}
                                        value={dataSourceSelectValue}
                                        selectedOption={selectedDataSourceOption}
                                        onChange={(val, option) => {
                                            const nextDataSourceId = val ? Number(val) : undefined;
                                            setCurrentDataSourceId(nextDataSourceId);
                                            onDraftChange?.(latestContentRef.current, nextDataSourceId, option?.type);
                                        }}
                                        onInputChange={handleSearchKeywordChange}
                                        loading={dataSourcesLoading}
                                        loadingMore={dataSourcesLoadingMore}
                                        hasMore={dataSourcesHasMore}
                                        onLoadMore={loadMoreDataSources}
                                        placeholder={activeNode.kind === 'HIVE_SQL' ? '选择 Hive 数据源...' : '选择数据源...'}
                                    />
                                </div>
                            </div>
                        )}

                        {supportsParameters && parameterDefinitions && parameterDefinitions.length > 0 && (
                            <>
                                <div className="h-4 w-[1px] bg-gray-200" />
                                <div className="relative" ref={paramMenuRef}>
                                    <button
                                        type="button"
                                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-dashed border-gray-300 hover:border-gray-400 text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-xs"
                                        title="插入任务参数到 SQL"
                                        onClick={() => setParamMenuOpen((prev) => !prev)}
                                    >
                                        <Braces size={13} className="text-gray-500" />
                                        <span>插入参数</span>
                                        <span className="text-[10px] text-gray-400">({parameterDefinitions.length})</span>
                                    </button>

                                    {paramMenuOpen && (
                                        <div className="absolute left-0 top-full mt-1.5 w-64 rounded-md border border-gray-200 bg-white shadow-lg p-1.5 z-[2200]">
                                            <div className="text-[11px] font-semibold text-gray-500 px-2 py-1 border-b border-gray-100 mb-1">
                                                点击插入参数到光标处
                                            </div>
                                            <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                                {parameterDefinitions.map((param) => (
                                                    <button
                                                        key={param.key}
                                                        type="button"
                                                        className="w-full flex items-center justify-between text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 transition-colors group"
                                                        onClick={() => {
                                                            handleInsertParameter(param.key);
                                                            setParamMenuOpen(false);
                                                        }}
                                                    >
                                                        <code className="font-semibold text-emerald-700 group-hover:underline">
                                                            :{param.key}
                                                        </code>
                                                        <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                                                            {param.valueSource === 'SYSTEM_TIME' ? (param.format ?? '时间') : (param.constantValue ?? '固定值')}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label="关闭"
                                        data-slot="dialog-close"
                                        className="dialog-close-button"
                                        onClick={handleAttemptClose}
                                    >
                                        <X size={18} />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent className="tooltip-content z-[2100]" side="bottom">
                                    关闭
                                </TooltipContent>
                            </Tooltip>
                        </div>
                </div>
                <div
                    className="flex-1 min-h-0 relative"
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        event.nativeEvent.stopImmediatePropagation?.();
                    }}
                >
                    {isTransferNode ? (
                        <TransferNodeDialog
                            groupId={groupId}
                            value={activeNode.transferDraft ?? activeNode.transfer}
                            onChange={() => {}}
                            onDraftChange={handleTransferDraftChange}
                            menuContainer={dialogEl}
                        />
                    ) : isSqlNode ? (
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
                        <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400" role="status"><LoaderCircle size={20} className="offline-spin" aria-hidden="true" /><span className="sr-only">编辑器加载中</span></div>}>
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
        </Dialog>
    );
}
