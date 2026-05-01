import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CircleAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import type { OfflineFlowNodeKind } from '../../api/offline';
import { getOfflineNodeKindClassName, getOfflineNodeKindLabel } from './offlineNodeKinds';
import { getTaskStatusIcon, isRunningStatus } from './executionPresentation';

export interface FlowCanvasNodeData {
    taskId: string;
    kind: OfflineFlowNodeKind;
    selected: boolean;
    onToggleSelection: (taskId: string) => void;
    isEditing?: boolean;
    onRename?: (newId: string) => void;
    onCancelRename?: () => void;
    validationError?: string | null;
    status?: string | null;
    [key: string]: unknown;
}

function FlowCanvasNodeComponent(props: { data: FlowCanvasNodeData; selected?: boolean }) {
    const { data, selected: rfSelected } = props;
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const draftTaskIdRef = useRef(data.taskId);
    const isComposingRef = useRef(false);
    const editableLabelRef = useRef<HTMLElement>(null);
    const labelRef = useRef<HTMLElement>(null);

    useEffect(() => {
        draftTaskIdRef.current = data.taskId;
    }, [data.isEditing, data.taskId]);

    useEffect(() => {
        if (!data.isEditing || !editableLabelRef.current) {
            return;
        }

        editableLabelRef.current.textContent = data.taskId;
        editableLabelRef.current.focus();

        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        const range = document.createRange();
        range.selectNodeContents(editableLabelRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
    }, [data.isEditing, data.taskId]);

    const handleRenameCommit = () => {
        if (isComposingRef.current) {
            return;
        }

        data.onRename?.(draftTaskIdRef.current);
    };

    const updateTooltipVisibility = () => {
        if (!labelRef.current) {
            setTooltipOpen(false);
            return false;
        }

        const isOverflowing = labelRef.current.scrollWidth > labelRef.current.clientWidth;
        return isOverflowing;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
        const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };

        if (nativeEvent.isComposing || isComposingRef.current || nativeEvent.keyCode === 229) {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            handleRenameCommit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (editableLabelRef.current) {
                editableLabelRef.current.textContent = data.taskId;
            }
            draftTaskIdRef.current = data.taskId;
            data.onCancelRename?.();
        }

        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
    };

    const StatusIcon = data.status ? getTaskStatusIcon(data.status) : null;
    const isRunning = data.status ? isRunningStatus(data.status) : false;

    return (
        <>
            <Handle
                type="target"
                position={Position.Top}
                className="flow-canvas-handle"
            />
            <div className={`flow-canvas-node${rfSelected ? ' is-rf-selected' : ''}${data.selected ? ' is-checked' : ''}${data.status ? ` has-status is-${data.status.toLowerCase()}` : ''}`}>
                <label
                    className="flow-canvas-node-check"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <input
                        type="checkbox"
                        checked={data.selected}
                        onChange={() => data.onToggleSelection(data.taskId)}
                    />
                </label>
                {data.isEditing ? (
                    <strong
                        ref={editableLabelRef}
                        className="flow-canvas-node-label is-editing nodrag nopan nowheel"
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        aria-label="编辑节点名称"
                        spellCheck={false}
                        onCompositionStart={() => {
                            isComposingRef.current = true;
                        }}
                        onCompositionEnd={(e) => {
                            isComposingRef.current = false;
                            draftTaskIdRef.current = e.currentTarget.textContent ?? '';
                        }}
                        onKeyDown={handleKeyDown}
                        onKeyUp={(e) => e.stopPropagation()}
                        onInput={(e) => {
                            draftTaskIdRef.current = e.currentTarget.textContent ?? '';
                        }}
                        onBlur={handleRenameCommit}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {data.taskId}
                    </strong>
                ) : (
                    <TooltipProvider delayDuration={200}>
                        <Tooltip open={tooltipOpen}>
                            <TooltipTrigger asChild>
                                <strong 
                                    ref={labelRef}
                                    className="flow-canvas-node-label"
                                    onMouseEnter={() => {
                                        setTooltipOpen(updateTooltipVisibility());
                                    }}
                                    onFocus={() => {
                                        setTooltipOpen(updateTooltipVisibility());
                                    }}
                                    onMouseLeave={() => setTooltipOpen(false)}
                                    onBlur={() => setTooltipOpen(false)}
                                >
                                    {data.taskId}
                                </strong>
                            </TooltipTrigger>
                            <TooltipContent 
                                className="tooltip-content" 
                                side="top"
                                onPointerDownOutside={(e) => e.preventDefault()}
                            >
                                {data.taskId}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
                <span className={`flow-canvas-node-kind is-${getOfflineNodeKindClassName(data.kind)}`}>
                    {getOfflineNodeKindLabel(data.kind)}
                </span>
                
                {/* Status Indicator */}
                {StatusIcon && (
                    <div className={`flow-canvas-node-status-icon is-${data.status?.toLowerCase()}${isRunning ? ' is-animated' : ''}`}>
                        <StatusIcon size={14} />
                    </div>
                )}

                {data.validationError && (
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flow-canvas-node-error-icon">
                                    <CircleAlert size={14} />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent 
                                className="tooltip-content is-danger" 
                                side="bottom"
                            >
                                {data.validationError}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
            <Handle
                type="source"
                position={Position.Bottom}
                className="flow-canvas-handle"
            />
        </>
    );
}

export const FlowCanvasNode = memo(FlowCanvasNodeComponent);
