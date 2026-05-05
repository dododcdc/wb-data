import React, { useMemo, useState } from 'react';
import { CronExpressionParser } from 'cron-parser';
import { LoaderCircle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Combobox, ComboboxInput, ComboboxTrigger, ComboboxContent, ComboboxItem, ComboboxEmpty } from '../../components/ui/combobox';
import { SegmentedCronInput } from './SegmentedCronInput';
import { type OfflineFlowSchedule, type OfflineScheduleResponse } from '../../api/offline';
import { TIMEZONES, POPULAR_TIMEZONES, getTimezoneOffset, formatPreviewTime } from './ScheduleUtils';
import './ScheduleDialog.css';

interface ScheduleDialogProps {
    open: boolean;
    schedule: OfflineScheduleResponse | null;
    cron: string;
    timezone: string;
    saving: boolean;
    flowId: string | null;
    onOpenChange: (open: boolean) => void;
    onCronChange: (cron: string) => void;
    onTimezoneChange: (timezone: string) => void;
    onSave: () => void;
    onToggle: (enabled: boolean) => void;
}

export function ScheduleDialog(props: ScheduleDialogProps) {
    const {
        open,
        schedule,
        cron,
        timezone,
        saving,
        flowId,
        onOpenChange,
        onCronChange,
        onTimezoneChange,
        onSave,
        onToggle,
    } = props;

    const [tzQuery, setTzQuery] = useState('');

    const preview = useMemo(() => {
        const currentCron = cron || '0 2 * * *';
        try {
            const interval = CronExpressionParser.parse(currentCron, { tz: timezone || undefined });
            const times: string[] = [];
            for (let i = 0; i < 5; i++) {
                times.push(interval.next().toISOString());
            }
            return { type: 'ok' as const, times };
        } catch {
            return { type: 'error' as const };
        }
    }, [cron, timezone]);

    const filteredTimezones = useMemo(() => {
        const q = tzQuery.toLowerCase();
        const matching = tzQuery
            ? TIMEZONES.filter((tz) => tz.toLowerCase().includes(q))
            : TIMEZONES;
        const popularSet = new Set(POPULAR_TIMEZONES);
        const popular = matching.filter((tz) => popularSet.has(tz));
        const rest = matching
            .filter((tz) => !popularSet.has(tz))
            .sort((a, b) => a.localeCompare(b));
        return { popular: popular.slice(0, 20), rest: rest.slice(0, 100) };
    }, [tzQuery]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent 
                style={{ maxWidth: '640px' }} 
                className="offline-schedule-dialog-standard"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>调度配置</DialogTitle>
                    <DialogDescription className="sr-only">
                        Configure scheduling settings for {flowId || 'the current flow'}.
                    </DialogDescription>
                </DialogHeader>

                <div className="dialog-body form-content">
                    <div className="form-main-panel" style={{ padding: '24px 32px' }}>
                        <div className="config-section">
                            <h3 className="sub-section-title">核心设置</h3>
                            
                            <div className="input-group">
                                <label>运行时区</label>
                                <Combobox
                                    value={timezone}
                                    onInputValueChange={setTzQuery}
                                    onValueChange={(value) => {
                                        onTimezoneChange(value);
                                        setTzQuery('');
                                    }}
                                    disabled={saving}
                                >
                                    <div className="offline-combobox-wrapper">
                                        <ComboboxInput
                                            placeholder="搜索时区..."
                                            disabled={saving}
                                        />
                                        <ComboboxTrigger />
                                    </div>
                                    <ComboboxContent>
                                        {filteredTimezones.popular.map((tz) => (
                                            <ComboboxItem key={tz} value={tz}>
                                                <span className="offline-tz-name">{tz}</span>
                                                <span className="offline-tz-offset">{getTimezoneOffset(tz)}</span>
                                            </ComboboxItem>
                                        ))}
                                        {filteredTimezones.popular.length > 0 && filteredTimezones.rest.length > 0 && (
                                            <div className="offline-tz-divider" />
                                        )}
                                        {filteredTimezones.rest.map((tz) => (
                                            <ComboboxItem key={tz} value={tz}>
                                                <span className="offline-tz-name">{tz}</span>
                                                <span className="offline-tz-offset">{getTimezoneOffset(tz)}</span>
                                            </ComboboxItem>
                                        ))}
                                        {filteredTimezones.popular.length === 0 && filteredTimezones.rest.length === 0 && (
                                            <ComboboxEmpty>未找到匹配的时区</ComboboxEmpty>
                                        )}
                                    </ComboboxContent>
                                </Combobox>
                            </div>

                            <div className="input-group">
                                <label style={{ marginBottom: 12 }}>Cron 表达式</label>
                                <div className={saving ? 'opacity-50 pointer-events-none' : ''}>
                                    <SegmentedCronInput
                                        value={cron || '0 2 * * *'}
                                        onChange={onCronChange}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="panel-divider" />

                        <div className="config-section">
                            <h3 className="sub-section-title">调度预览</h3>
                            <div className="offline-schedule-preview">
                                {preview.type === 'error' ? (
                                    <div className="offline-schedule-preview-list">
                                        <div className="offline-schedule-preview-item" style={{ color: 'var(--color-error)' }}>
                                            无效的 Cron 表达式
                                        </div>
                                    </div>
                                ) : (
                                    <div className="offline-schedule-preview-list">
                                        {preview.times.map((t, i) => (
                                            <div key={i} className="offline-schedule-preview-item">
                                                <span className="offline-schedule-preview-time">{formatPreviewTime(t, timezone)}</span>
                                                <span className="offline-schedule-preview-tz">{timezone}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="config-section">
                            <div className="offline-schedule-toggle-card">
                                <div className="offline-schedule-toggle-info">
                                    <span className="offline-schedule-toggle-label">启用自动调度</span>
                                    <span className="offline-schedule-toggle-hint">开启后，任务将根据上述配置自动触发执行</span>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-label="启用调度"
                                    aria-checked={schedule?.enabled ?? false}
                                    disabled={saving}
                                    onClick={() => onToggle(!(schedule?.enabled ?? false))}
                                    className="offline-switch"
                                >
                                    <span className="offline-switch-thumb" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="console-form-footer">
                    <div className="footer-left">
                        <p className="test-note" style={{ margin: 0 }}>配置仅在“保存”并“推送”后生效</p>
                    </div>
                    <div className="footer-right">
                        <Button variant="ghost" className="cancel-btn" onClick={() => onOpenChange(false)} disabled={saving}>
                            取消
                        </Button>
                        <button className="submit-btn" onClick={onSave} disabled={saving || preview.type === 'error'}>
                            {saving ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {saving ? '正在暂存...' : '暂存配置'}
                        </button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
