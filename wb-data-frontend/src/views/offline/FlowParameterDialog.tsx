import { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    GripVertical,
    RefreshCw,
    Search,
    Trash2,
    Unlink,
} from 'lucide-react';

import type {
    FlowParameterBinding,
    FlowParameterBindingItem,
    FlowParameterDefinitionSnapshot,
} from '../../api/offline';
import {
    getParameterGroup,
    getParameterGroupPage,
    type ParameterDefinition,
    type ParameterGroup,
    type ParameterGroupSummary,
} from '../../api/parameterGroups';
import { SearchableCombobox, type SearchableComboboxOption } from '../../components/SearchableCombobox';
import { Button } from '../../components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import { getErrorMessage } from '../../utils/error';

import './FlowParameterDialog.css';

interface FlowParameterDialogProps {
    open: boolean;
    groupId: number;
    binding: FlowParameterBinding | null | undefined;
    onOpenChange: (open: boolean) => void;
    onStage: (binding: FlowParameterBinding | null) => void;
}

function toBindingItem(group: ParameterGroup): FlowParameterBindingItem {
    return {
        parameterGroupId: group.id,
        code: group.code,
        name: group.name,
        boundVersion: group.version,
        currentVersion: group.version,
        status: 'CURRENT',
        definitions: group.definitions.map((definition) => ({
            key: definition.key,
            valueSource: definition.valueSource,
            constantValue: definition.constantValue,
            format: definition.format,
            offsetDays: definition.offsetDays,
            timeBasis: definition.timeBasis,
            description: definition.description,
            sortOrder: definition.sortOrder,
        })),
    };
}

function describeDefinition(definition: ParameterDefinition | FlowParameterDefinitionSnapshot) {
    if (definition.valueSource === 'CONSTANT') {
        return definition.constantValue != null && definition.constantValue !== ''
            ? `固定值: ${definition.constantValue}`
            : '固定值';
    }
    const basis = definition.timeBasis === 'EXECUTION_START_TIME' ? '执行开始时间' : '计划时间';
    const offset = definition.offsetDays === 0
        ? ''
        : ` · ${definition.offsetDays > 0 ? '+' : ''}${definition.offsetDays} 天`;
    return `${basis} · ${definition.format || 'yyyyMMdd'}${offset}`;
}

export function FlowParameterDialog({
    open,
    groupId,
    binding,
    onOpenChange,
    onStage,
}: FlowParameterDialogProps) {
    const [availableGroups, setAvailableGroups] = useState<ParameterGroupSummary[]>([]);
    const [boundItems, setBoundItems] = useState<FlowParameterBindingItem[]>([]);
    const [selectedToAddId, setSelectedToAddId] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
    const [searchFilters, setSearchFilters] = useState<Record<number, string>>({});
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [addingGroup, setAddingGroup] = useState(false);
    const [error, setError] = useState('');
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    // Initial load: parse existing bindings from binding prop
    useEffect(() => {
        if (!open) return;
        setError('');
        setSelectedToAddId('');
        setSearchFilters({});

        if (binding?.bindings && binding.bindings.length > 0) {
            setBoundItems(binding.bindings.map((it) => ({
                ...it,
                definitions: it.definitions.map((d) => ({ ...d })),
            })));
        } else if (binding?.parameterGroupId != null) {
            setBoundItems([{
                parameterGroupId: binding.parameterGroupId,
                code: binding.code,
                name: binding.name,
                boundVersion: binding.boundVersion,
                currentVersion: binding.currentVersion,
                status: binding.status,
                definitions: binding.definitions.map((d) => ({ ...d })),
            }]);
        } else {
            setBoundItems([]);
        }

        setLoadingGroups(true);
        let active = true;
        getParameterGroupPage({ groupId, page: 1, size: 100, status: 'ACTIVE' })
            .then((page) => {
                if (active) {
                    setAvailableGroups(page?.records || []);
                }
            })
            .catch((cause) => {
                if (active) {
                    setError(getErrorMessage(cause, '参数组列表加载失败'));
                }
            })
            .finally(() => {
                if (active) {
                    setLoadingGroups(false);
                }
            });

        return () => {
            active = false;
        };
    }, [binding, groupId, open]);

    // Handle adding a new parameter group
    const handleAddGroup = async (targetIdStr: string) => {
        if (!targetIdStr) return;
        const targetId = Number(targetIdStr);
        if (boundItems.some((item) => item.parameterGroupId === targetId)) {
            setSelectedToAddId('');
            return;
        }

        setAddingGroup(true);
        setError('');
        try {
            const groupDetail = await getParameterGroup(groupId, targetId);
            const newItem = toBindingItem(groupDetail);
            setBoundItems((prev) => [...prev, newItem]);
            setSelectedToAddId('');
        } catch (cause) {
            setError(getErrorMessage(cause, '添加参数组失败'));
        } finally {
            setAddingGroup(false);
        }
    };

    // Handle updating an outdated group to latest
    const handleUpgradeGroup = async (item: FlowParameterBindingItem, index: number) => {
        if (item.parameterGroupId == null) return;
        setError('');
        try {
            const groupDetail = await getParameterGroup(groupId, item.parameterGroupId);
            const updated = toBindingItem(groupDetail);
            setBoundItems((prev) => {
                const next = [...prev];
                next[index] = updated;
                return next;
            });
        } catch (cause) {
            setError(getErrorMessage(cause, '更新参数组失败'));
        }
    };

    // Handle removing a group
    const handleRemoveGroup = (index: number) => {
        setBoundItems((prev) => prev.filter((_, i) => i !== index));
    };

    // Handle moving items up/down
    const handleMove = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= boundItems.length || toIndex >= boundItems.length) {
            return;
        }
        setBoundItems((prev) => {
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };

    // Toggle expand/collapse
    const toggleExpand = (id: number) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Options for add selector (excluding already added groups)
    const addOptions: SearchableComboboxOption[] = useMemo(() => {
        const boundIdSet = new Set(boundItems.map((it) => it.parameterGroupId).filter(Boolean));
        return availableGroups
            .filter((g) => !boundIdSet.has(g.id))
            .map((g) => ({
                value: String(g.id),
                label: g.name,
                subLabel: g.code,
                badge: `v${g.version}`,
                count: g.parameterCount,
                description: g.description,
                keywords: [g.code, g.name, g.description || ''],
            }));
    }, [availableGroups, boundItems]);

    // Compute merged parameter definitions & overridden status map
    const { mergedDefinitions, overriddenKeysByGroupIndex } = useMemo(() => {
        const merged = new Map<string, FlowParameterDefinitionSnapshot>();
        const overrides: Record<number, Set<string>> = {};

        boundItems.forEach((item, index) => {
            overrides[index] = new Set<string>();
            item.definitions.forEach((def) => {
                if (merged.has(def.key)) {
                    overrides[index].add(def.key);
                } else {
                    merged.set(def.key, def);
                }
            });
        });

        return {
            mergedDefinitions: Array.from(merged.values()),
            overriddenKeysByGroupIndex: overrides,
        };
    }, [boundItems]);

    // Check if configuration changed
    const isUnchanged = useMemo(() => {
        const initialBindings = binding?.bindings && binding.bindings.length > 0
            ? binding.bindings
            : binding?.parameterGroupId != null
                ? [{
                    parameterGroupId: binding.parameterGroupId,
                    code: binding.code,
                    name: binding.name,
                    boundVersion: binding.boundVersion,
                    currentVersion: binding.currentVersion,
                    status: binding.status,
                    definitions: binding.definitions,
                }]
                : [];

        if (initialBindings.length !== boundItems.length) return false;
        return initialBindings.every((init, idx) => {
            const current = boundItems[idx];
            return init.parameterGroupId === current?.parameterGroupId && init.boundVersion === current?.boundVersion;
        });
    }, [binding, boundItems]);

    // Check overall status across bound items
    const compositeStatus = useMemo((): FlowParameterBinding['status'] => {
        if (boundItems.length === 0) return 'CURRENT';
        if (boundItems.some((it) => it.status === 'MISSING')) return 'MISSING';
        if (boundItems.some((it) => it.status === 'ARCHIVED')) return 'ARCHIVED';
        if (boundItems.some((it) => it.status === 'OUTDATED')) return 'OUTDATED';
        return 'CURRENT';
    }, [boundItems]);

    const handleConfirmStage = () => {
        if (boundItems.length === 0) {
            onStage(null);
            onOpenChange(false);
            return;
        }

        const primaryGroup = boundItems[0];
        onStage({
            parameterGroupId: primaryGroup.parameterGroupId,
            code: primaryGroup.code,
            name: primaryGroup.name,
            boundVersion: primaryGroup.boundVersion,
            currentVersion: primaryGroup.currentVersion,
            status: compositeStatus,
            definitions: mergedDefinitions,
            bindings: boundItems,
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flow-parameter-dialog"
                style={{ maxWidth: '640px' }}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>任务参数</DialogTitle>
                    <DialogDescription>
                        可引用多个参数组。排在靠前的参数组具有更高的参数覆盖优先级。
                    </DialogDescription>
                </DialogHeader>

                <div className="flow-parameter-dialog-body">
                    {/* Add Parameter Group Bar */}
                    <div className="flow-parameter-add-bar">
                        <div className="flow-parameter-add-select">
                            <SearchableCombobox
                                id="flow-parameter-add-select"
                                ariaLabel="参数组"
                                value={selectedToAddId}
                                options={addOptions}
                                placeholder={
                                    loadingGroups
                                        ? '正在加载可用参数组…'
                                        : addOptions.length === 0
                                            ? '暂无更多可用参数组'
                                            : '选择或搜索要添加的参数组…'
                                }
                                emptyText="未找到匹配的参数组"
                                disabled={loadingGroups || addingGroup || addOptions.length === 0}
                                onChange={(val) => {
                                    setSelectedToAddId(val);
                                    void handleAddGroup(val);
                                }}
                            />
                        </div>
                    </div>

                    {/* Bound Parameter Groups List */}
                    <div className="flow-parameter-groups-list">
                        {boundItems.length === 0 ? (
                            <div className="flow-parameter-empty-state">
                                尚未引入任何参数组。请在上方选择并添加参数组。
                            </div>
                        ) : (
                            boundItems.map((item, index) => {
                                const isExpanded = item.parameterGroupId != null && expandedIds.has(item.parameterGroupId);
                                const searchFilter = (item.parameterGroupId != null ? searchFilters[item.parameterGroupId] : '') || '';
                                const filteredDefinitions = item.definitions.filter((d) => (
                                    d.key.toLowerCase().includes(searchFilter.toLowerCase())
                                    || (d.description && d.description.toLowerCase().includes(searchFilter.toLowerCase()))
                                ));
                                const isDragging = draggedIndex === index;

                                return (
                                    <div
                                        key={item.parameterGroupId ?? item.code}
                                        className={`flow-parameter-group-card ${isDragging ? 'is-dragging' : ''} ${dragOverIndex === index && !isDragging ? 'is-drag-over' : ''}`}
                                        draggable
                                        onDragStart={(e) => {
                                            if ((e.target as HTMLElement).closest('button, input, [role="button"]')) {
                                                e.preventDefault();
                                                return;
                                            }
                                            setDraggedIndex(index);
                                            e.dataTransfer.effectAllowed = 'move';
                                            e.dataTransfer.setData('text/plain', String(index));
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (dragOverIndex !== index) {
                                                setDragOverIndex(index);
                                            }
                                        }}
                                        onDragLeave={(e) => {
                                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                                setDragOverIndex(null);
                                            }
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            const fromStr = e.dataTransfer.getData('text/plain');
                                            const from = fromStr !== '' ? parseInt(fromStr, 10) : draggedIndex;
                                            if (from !== null && !isNaN(from) && from !== index) {
                                                handleMove(from, index);
                                            }
                                            setDraggedIndex(null);
                                            setDragOverIndex(null);
                                        }}
                                        onDragEnd={() => {
                                            setDraggedIndex(null);
                                            setDragOverIndex(null);
                                        }}
                                    >
                                        {/* Card Header */}
                                        <div className="flow-parameter-card-header">
                                            <div className="flow-parameter-card-drag-handle" title="拖拽调整优先级顺序">
                                                <GripVertical size={16} />
                                            </div>

                                            <div className="flow-parameter-card-priority" title="优先级序号（排在前面优先级高）">
                                                #{index + 1}
                                            </div>

                                            <div
                                                className="flow-parameter-card-main-info"
                                                onClick={() => item.parameterGroupId && toggleExpand(item.parameterGroupId)}
                                            >
                                                <span className="flow-parameter-card-name">
                                                    {item.name || item.code}
                                                </span>
                                                <span className="flow-parameter-card-meta">
                                                    v{item.boundVersion} · {item.definitions.length} 个参数
                                                </span>
                                                {item.status === 'OUTDATED' ? (
                                                    <span className="flow-parameter-badge is-outdated">
                                                        有新版 v{item.currentVersion}
                                                    </span>
                                                ) : item.status === 'ARCHIVED' ? (
                                                    <span className="flow-parameter-badge is-archived">已归档</span>
                                                ) : item.status === 'MISSING' ? (
                                                    <span className="flow-parameter-badge is-missing">不存在</span>
                                                ) : null}
                                            </div>

                                            <div className="flow-parameter-card-actions">
                                                {item.status === 'OUTDATED' ? (
                                                    <button
                                                        type="button"
                                                        className="flow-parameter-action-btn is-upgrade"
                                                        title="更新到最新版本"
                                                        onClick={() => void handleUpgradeGroup(item, index)}
                                                    >
                                                        <RefreshCw size={13} />
                                                        <span>更新</span>
                                                    </button>
                                                ) : null}

                                                <button
                                                    type="button"
                                                    className="flow-parameter-action-icon-btn is-remove"
                                                    title="移除此参数组"
                                                    onClick={() => handleRemoveGroup(index)}
                                                >
                                                    <Trash2 size={14} />
                                                </button>

                                                <button
                                                    type="button"
                                                    className="flow-parameter-action-icon-btn"
                                                    onClick={() => item.parameterGroupId && toggleExpand(item.parameterGroupId)}
                                                >
                                                    {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expanded Definitions Panel */}
                                        {isExpanded ? (
                                            <div
                                                className="flow-parameter-card-body"
                                                draggable={false}
                                                onDragStart={(e) => e.stopPropagation()}
                                            >
                                                {item.definitions.length > 5 ? (
                                                    <div className="flow-parameter-search-bar">
                                                        <Search size={13} className="flow-parameter-search-icon" />
                                                        <input
                                                            type="text"
                                                            placeholder="搜索参数名 (${key}) 或描述..."
                                                            value={searchFilter}
                                                            onChange={(e) => {
                                                                if (item.parameterGroupId) {
                                                                    setSearchFilters((prev) => ({
                                                                        ...prev,
                                                                        [item.parameterGroupId!]: e.target.value,
                                                                    }));
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                ) : null}

                                                <div className="flow-parameter-items-list">
                                                    {filteredDefinitions.length === 0 ? (
                                                        <div className="flow-parameter-items-empty">无匹配参数</div>
                                                    ) : (
                                                        filteredDefinitions.map((def) => {
                                                            const isOverridden = overriddenKeysByGroupIndex[index]?.has(def.key);

                                                            return (
                                                                <div
                                                                    key={def.key}
                                                                    className={`flow-parameter-item-row ${isOverridden ? 'is-overridden' : ''}`}
                                                                >
                                                                    <div className="flow-parameter-item-left">
                                                                        <code>{'${' + def.key + '}'}</code>
                                                                        {def.description ? (
                                                                            <span className="flow-parameter-item-desc">
                                                                                ({def.description})
                                                                            </span>
                                                                        ) : null}
                                                                    </div>

                                                                    <div className="flow-parameter-item-right">
                                                                        {isOverridden ? (
                                                                            <span className="flow-parameter-overridden-badge" title="已被上方更高优先级的参数组覆盖">
                                                                                已被上层覆盖
                                                                            </span>
                                                                        ) : null}
                                                                        <span className="flow-parameter-item-val">
                                                                            {describeDefinition(def)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {error ? (
                        <div className="flow-parameter-error" role="alert">
                            <AlertCircle size={15} />
                            <span>{error}</span>
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="flow-parameter-dialog-footer">
                    <div>
                        {boundItems.length > 0 ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setBoundItems([]);
                                }}
                            >
                                <Unlink size={14} aria-hidden="true" style={{ marginRight: 4 }} /> 清空所有绑定
                            </Button>
                        ) : null}
                    </div>
                    <div className="flow-parameter-dialog-actions">
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={isUnchanged && !error}
                            onClick={handleConfirmStage}
                        >
                            暂存绑定
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
