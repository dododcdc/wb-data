import { useEffect, useMemo, useState } from 'react';
import { Clock3, LoaderCircle, RefreshCw, Search, Sparkles } from 'lucide-react';

import {
    getParameterGroup,
    previewParameterGroup,
    type ParameterDefinition,
    type ParameterGroup,
    type ParameterGroupSummary,
    type ParameterPreview,
    type ParameterPreviewValue,
} from '../../api/parameterGroups';
import { DateTimePicker } from '../../components/ui/DateTimePicker';
import { SimpleSelect } from '../../components/SimpleSelect';
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
import { TIMEZONES } from '../offline/ScheduleUtils';

interface ParameterPreviewDialogProps {
    open: boolean;
    groupId: number;
    parameterGroup: ParameterGroupSummary | null;
    onOpenChange: (open: boolean) => void;
}

function toLocalInputValue(date: Date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

function renderValue(value: unknown) {
    if (value == null) return 'null';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function formatParameterRule(def?: ParameterDefinition, previewVal?: ParameterPreviewValue): string {
    const source = def?.valueSource ?? previewVal?.valueSource;
    if (source === 'CONSTANT') {
        const val = def?.constantValue ?? (previewVal?.value !== undefined ? String(previewVal.value) : '');
        return val ? `"${val}"` : '固定常量';
    }
    const basis = (def?.timeBasis ?? previewVal?.timeBasis) === 'EXECUTION_START_TIME' ? '执行开始时间' : '计划时间';
    const offset = def?.offsetDays ?? 0;
    const offsetStr = offset === 0 ? '' : offset > 0 ? ` + ${offset} 天` : ` - ${Math.abs(offset)} 天`;
    const formatStr = def?.format ? ` (${def.format})` : '';
    return `${basis}${offsetStr}${formatStr}`;
}

export default function ParameterPreviewDialog({
    open,
    groupId,
    parameterGroup,
    onOpenChange,
}: ParameterPreviewDialogProps) {
    const [plannedTime, setPlannedTime] = useState('');
    const [executionStartTime, setExecutionStartTime] = useState('');
    const [runtimeTimezone, setRuntimeTimezone] = useState('');
    const [preview, setPreview] = useState<ParameterPreview | null>(null);
    const [detail, setDetail] = useState<ParameterGroup | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [calculating, setCalculating] = useState(false);
    const [error, setError] = useState('');
    const [keyword, setKeyword] = useState('');

    const timeRequirements = useMemo(() => {
        const definitions = detail?.definitions ?? [];
        return {
            hasTimeParameters: definitions.some((definition) => definition.valueSource === 'SYSTEM_TIME'),
            requiresPlannedTime: definitions.some((definition) => (
                definition.valueSource === 'SYSTEM_TIME'
                && (definition.timeBasis ?? 'PLANNED_TIME') === 'PLANNED_TIME'
            )),
            requiresExecutionStartTime: definitions.some((definition) => (
                definition.valueSource === 'SYSTEM_TIME'
                && definition.timeBasis === 'EXECUTION_START_TIME'
            )),
        };
    }, [detail?.definitions]);

    const timezoneOptions = useMemo(() => {
        const timezones = runtimeTimezone && !TIMEZONES.includes(runtimeTimezone)
            ? [runtimeTimezone, ...TIMEZONES]
            : TIMEZONES;
        return timezones.map((timezone) => ({ value: timezone, label: timezone }));
    }, [runtimeTimezone]);

    const calculate = async () => {
        if (!parameterGroup || !detail || !timeRequirements.hasTimeParameters) return;
        if (!runtimeTimezone) {
            setError('请选择任务运行时区');
            return;
        }
        if (timeRequirements.requiresPlannedTime && !plannedTime) {
            setError('请选择计划时间');
            return;
        }
        if (timeRequirements.requiresExecutionStartTime && !executionStartTime) {
            setError('请选择执行开始时间');
            return;
        }

        setCalculating(true);
        setError('');
        try {
            const res = await previewParameterGroup(groupId, parameterGroup.id, {
                plannedTime: timeRequirements.requiresPlannedTime ? plannedTime : null,
                executionStartTime: timeRequirements.requiresExecutionStartTime ? executionStartTime : null,
                runtimeTimezone,
                overrides: {},
            });
            setPreview(res);
        } catch (cause) {
            setError(getErrorMessage(cause, '参数预览失败'));
        } finally {
            setCalculating(false);
        }
    };

    useEffect(() => {
        if (!open || !parameterGroup) {
            setPreview(null);
            setDetail(null);
            return;
        }
        setPlannedTime('');
        setExecutionStartTime('');
        setRuntimeTimezone('');
        setPreview(null);
        setDetail(null);
        setCalculating(false);
        setKeyword('');
        setError('');

        let cancelled = false;
        setDetailLoading(true);
        getParameterGroup(groupId, parameterGroup.id)
            .then((res) => {
                if (!cancelled) setDetail(res);
            })
            .catch((cause) => {
                if (!cancelled) setError(getErrorMessage(cause, '参数定义加载失败'));
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, parameterGroup, groupId]);

    const fillCurrentContext = () => {
        const now = toLocalInputValue(new Date());
        if (timeRequirements.requiresPlannedTime) setPlannedTime(now);
        if (timeRequirements.requiresExecutionStartTime) setExecutionStartTime(now);
        setRuntimeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    };

    // Build unified parameter list merging definitions and resolved preview values
    const parameterItems = useMemo(() => {
        const previewMap = new Map<string, ParameterPreviewValue>();
        if (preview?.values) {
            for (const val of preview.values) {
                previewMap.set(val.key, val);
            }
        }

        const defs = detail?.definitions || [];
        const seenKeys = new Set<string>();
        const list = defs.map((def) => {
            seenKeys.add(def.key);
            const previewVal = previewMap.get(def.key);
            return {
                key: def.key,
                description: def.description,
                valueSource: def.valueSource,
                timeBasis: def.timeBasis,
                ruleText: formatParameterRule(def, previewVal),
                value: previewVal?.value ?? (def.valueSource === 'CONSTANT' ? def.constantValue ?? '' : undefined),
            };
        });

        // Add any preview values not in definitions (fallback)
        if (preview?.values) {
            for (const val of preview.values) {
                if (!seenKeys.has(val.key)) {
                    list.push({
                        key: val.key,
                        description: null,
                        valueSource: val.valueSource,
                        timeBasis: val.timeBasis,
                        ruleText: formatParameterRule(undefined, val),
                        value: val.value,
                    });
                }
            }
        }

        return list;
    }, [detail?.definitions, preview?.values]);

    const filteredItems = useMemo(() => {
        if (!keyword.trim()) return parameterItems;
        const q = keyword.trim().toLowerCase();
        return parameterItems.filter(
            (item) =>
                item.key.toLowerCase().includes(q) ||
                (item.description && item.description.toLowerCase().includes(q)) ||
                (item.value !== undefined && String(item.value).toLowerCase().includes(q)),
        );
    }, [parameterItems, keyword]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="parameter-preview-dialog">
                <DialogHeader className="parameter-preview-header">
                    <DialogTitle>参数组预览</DialogTitle>
                    <DialogDescription>
                        {parameterGroup ? `${parameterGroup.name} · v${parameterGroup.version}` : '选择一个参数组'}
                    </DialogDescription>
                </DialogHeader>

                <div className="parameter-preview-dialog-body">
                    <div className="parameter-preview-banner">
                        {preview || !timeRequirements.hasTimeParameters
                            ? <Sparkles size={14} className="text-amber-500 shrink-0" />
                            : <Clock3 size={14} className="text-amber-500 shrink-0" />}
                        <div className="parameter-preview-banner-text">
                            {detailLoading
                                ? <span className="skeleton-line parameter-preview-banner-skeleton" role="status" aria-label="正在加载参数定义" />
                                : !timeRequirements.hasTimeParameters
                                    ? '该参数组仅包含固定值，无需提供时间上下文。'
                                    : preview
                                        ? <>时间参数已按 <code>{runtimeTimezone}</code> 和你提供的时间上下文计算。</>
                                        : '时间参数尚未计算。请明确提供任务运行时区和所需时间后再计算。'}
                        </div>
                    </div>

                    {timeRequirements.hasTimeParameters ? (
                        <div className="parameter-preview-context-card">
                            <div className="parameter-preview-context-title">
                                <div>
                                    <Clock3 size={14} className="text-muted-foreground" />
                                    <span>预览时间上下文</span>
                                </div>
                                <Button type="button" variant="ghost" size="sm" onClick={fillCurrentContext}>
                                    使用浏览器当前时间与时区
                                </Button>
                            </div>
                            <div className="parameter-preview-controls">
                                {timeRequirements.requiresPlannedTime ? (
                                    <div className="parameter-preview-field">
                                        <span>计划时间 <b>*</b></span>
                                        <DateTimePicker
                                            ariaLabel="计划时间"
                                            placeholder="选择计划时间"
                                            value={plannedTime}
                                            timezone={runtimeTimezone || null}
                                            onChange={setPlannedTime}
                                        />
                                    </div>
                                ) : null}
                                {timeRequirements.requiresExecutionStartTime ? (
                                    <div className="parameter-preview-field">
                                        <span>执行开始时间 <b>*</b></span>
                                        <DateTimePicker
                                            ariaLabel="执行开始时间"
                                            placeholder="选择执行开始时间"
                                            value={executionStartTime}
                                            timezone={runtimeTimezone || null}
                                            onChange={setExecutionStartTime}
                                        />
                                    </div>
                                ) : null}
                                <div className="parameter-preview-field">
                                    <span>任务运行时区 <b>*</b></span>
                                    <SimpleSelect
                                        ariaLabel="任务运行时区"
                                        value={runtimeTimezone}
                                        placeholder="选择任务运行时区"
                                        className="parameter-select"
                                        options={timezoneOptions}
                                        onChange={setRuntimeTimezone}
                                    />
                                </div>
                                <div className="parameter-preview-calc-action">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        aria-label="计算预览"
                                        className="parameter-preview-calc-btn"
                                        disabled={calculating || detailLoading}
                                        onClick={() => void calculate()}
                                    >
                                        {calculating ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        <span>{preview ? '重新计算' : '计算预览'}</span>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* Result Filter & Table */}
                    <div className="parameter-preview-result-container">
                        <div className="parameter-preview-toolbar">
                            <div className="parameter-preview-search">
                                <Search size={13} className="text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="搜索参数名 (${key})、描述或示例值..."
                                    value={keyword}
                                    onChange={(e) => setKeyword(e.target.value)}
                                />
                            </div>
                            <div className="parameter-preview-count">
                                共 {parameterItems.length} 个参数
                                {keyword.trim() && `（匹配 ${filteredItems.length} 个）`}
                            </div>
                        </div>

                        <div className="parameter-preview-table-wrap">
                            <table className="parameter-preview-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '32%' }}>参数名</th>
                                        <th style={{ width: '38%' }}>取值规则</th>
                                        <th style={{ width: '30%' }}>示例推演值</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detailLoading && parameterItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={3} className="parameter-preview-loading-cell">
                                                <LoaderCircle size={20} className="animate-spin text-muted-foreground" />
                                                <span>正在推演参数值…</span>
                                            </td>
                                        </tr>
                                    ) : filteredItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={3} className="parameter-preview-empty-row">
                                                {keyword.trim() ? '未找到匹配的参数' : '该参数组暂无参数定义'}
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredItems.map((item) => (
                                            <tr key={item.key}>
                                                <td>
                                                    <div className="parameter-preview-key-cell">
                                                        <code className="parameter-preview-key">{'${' + item.key + '}'}</code>
                                                        {item.description ? (
                                                            <span className="parameter-preview-desc">{item.description}</span>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="parameter-preview-rule-cell">
                                                        <span className={`parameter-preview-source-badge is-${item.valueSource.toLowerCase()}`}>
                                                            {item.valueSource === 'CONSTANT' ? '固定值' : '运行时日期'}
                                                        </span>
                                                        <span className="parameter-preview-rule-text">{item.ruleText}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <code className="parameter-preview-value">
                                                        {item.value === undefined ? '待计算' : renderValue(item.value)}
                                                    </code>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {error ? <p className="parameter-form-error" role="alert">{error}</p> : null}
                </div>

                <DialogFooter className="parameter-preview-footer">
                    <Button type="button" variant="default" onClick={() => onOpenChange(false)}>
                        关闭
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
