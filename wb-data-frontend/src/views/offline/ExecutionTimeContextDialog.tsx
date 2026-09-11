import { useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import type { FlowParameterDefinitionSnapshot } from '../../api/offline';
import { Button } from '../../components/ui/button';
import { DateTimePicker } from '../../components/ui/DateTimePicker';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';

interface ExecutionTimeContextDialogProps {
    open: boolean;
    timezone: string | null;
    parameterKeys: string[];
    definitions?: FlowParameterDefinitionSnapshot[];
    plannedTime: string;
    parameterOverrides?: Record<string, string>;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onPlannedTimeChange: (value: string) => void;
    onParameterOverridesChange?: (overrides: Record<string, string>) => void;
    onConfirm: () => void;
}

export function ExecutionTimeContextDialog({
    open,
    timezone,
    parameterKeys,
    definitions = [],
    plannedTime,
    parameterOverrides = {},
    pending,
    onOpenChange,
    onPlannedTimeChange,
    onParameterOverridesChange,
    onConfirm,
}: ExecutionTimeContextDialogProps) {
    const [overridesExpanded, setOverridesExpanded] = useState(false);
    const requiresPlannedTime = parameterKeys.length > 0;
    const hasDefinitions = definitions.length > 0;

    const handleOverrideChange = (key: string, value: string) => {
        if (!onParameterOverridesChange) return;
        onParameterOverridesChange({ ...parameterOverrides, [key]: value });
    };

    const handleOverrideEnabled = (key: string, enabled: boolean) => {
        if (!onParameterOverridesChange) return;
        const next = { ...parameterOverrides };
        if (enabled) next[key] = '';
        else delete next[key];
        onParameterOverridesChange(next);
    };

    const handleClearOverrides = () => {
        if (onParameterOverridesChange) {
            onParameterOverridesChange({});
        }
    };

    const overrideCount = Object.keys(parameterOverrides).length;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent style={{ maxWidth: '540px' }}>
                <DialogHeader>
                    <DialogTitle>{requiresPlannedTime ? '选择参考计划时间' : '执行参数设置'}</DialogTitle>
                    <DialogDescription>
                        {requiresPlannedTime
                            ? `当前 Flow 定义了 ${parameterKeys.map((key) => `\${${key}}`).join('、')} 等计划时间参数。请选择这次执行要模拟的计划时间。`
                            : '本次调试执行将使用当前 Flow 绑定的参数。您也可以临时提供覆盖值。'}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-4 space-y-4">
                    {requiresPlannedTime ? (
                        <div>
                            <label className="mb-1.5 block text-sm font-medium">
                                计划执行时间 <span className="text-destructive">*</span>
                            </label>
                            <DateTimePicker
                                value={plannedTime}
                                timezone={timezone ?? 'Asia/Shanghai'}
                                disabled={pending}
                                placeholder="选择或指定计划执行时间"
                                onChange={onPlannedTimeChange}
                            />
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                按 Flow 运行时区 {timezone ?? 'Asia/Shanghai'} 解释；执行开始时间会在 Kestra 真正开始本次执行时自动记录。
                            </p>
                        </div>
                    ) : null}

                    {hasDefinitions ? (
                        <div className="rounded-md border p-3 bg-muted/20">
                            <div className="flex items-center justify-between">
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setOverridesExpanded((prev) => !prev)}
                                >
                                    {overridesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    <SlidersHorizontal size={13} />
                                    <span>参数临时覆盖</span>
                                    {overrideCount > 0 ? (
                                        <span className="ml-1 rounded-full bg-primary/10 text-primary px-1.5 py-0.2 text-[10px]">
                                            已覆盖 {overrideCount} 项
                                        </span>
                                    ) : null}
                                </button>
                                {overrideCount > 0 ? (
                                    <button
                                        type="button"
                                        className="text-xs text-primary hover:underline"
                                        onClick={handleClearOverrides}
                                    >
                                        重置全部
                                    </button>
                                ) : null}
                            </div>

                            {overridesExpanded ? (
                                <div className="mt-3 space-y-2.5 max-h-48 overflow-y-auto pr-1">
                                    {definitions.map((def) => {
                                        const isOverridden = def.key in parameterOverrides;
                                        const desc = def.valueSource === 'CONSTANT'
                                            ? `固定值: ${def.constantValue ?? '""'}`
                                            : `时间 (${def.timeBasis === 'EXECUTION_START_TIME' ? '执行开始时间' : '计划时间'})`;

                                        return (
                                            <div key={def.key} className="flex items-center gap-2 text-xs">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`覆盖参数 ${def.key}`}
                                                    checked={isOverridden}
                                                    disabled={pending}
                                                    className="size-4 shrink-0 accent-primary"
                                                    onChange={(event) => handleOverrideEnabled(def.key, event.target.checked)}
                                                />
                                                <div className="w-28 shrink-0 truncate" title={def.key}>
                                                    <code className="font-semibold">{`\${${def.key}}`}</code>
                                                </div>
                                                <div className="flex-1">
                                                    <Input
                                                        size={1}
                                                        aria-label={`参数 ${def.key} 覆盖值`}
                                                        className={`h-7 text-xs ${isOverridden ? 'border-primary bg-primary/5' : ''}`}
                                                        placeholder={desc}
                                                        value={parameterOverrides[def.key] ?? ''}
                                                        onChange={(e) => handleOverrideChange(def.key, e.target.value)}
                                                        disabled={pending || !isOverridden}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <p className="text-[11px] text-muted-foreground">
                                        临时覆盖仅对本次调试有效，不修改参数组定义。
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                        取消
                    </Button>
                    <Button onClick={onConfirm} disabled={pending || (requiresPlannedTime && !plannedTime)}>
                        {pending ? <LoaderCircle className="animate-spin" /> : null}
                        开始执行
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
