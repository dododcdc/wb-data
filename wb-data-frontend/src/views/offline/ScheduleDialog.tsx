import { useMemo } from 'react';
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
import { SegmentedCronInput } from './SegmentedCronInput';
import { type OfflineScheduleResponse } from '../../api/offline';
import { formatPreviewTime } from './ScheduleUtils';
import '../../components/ui/form-input-group.css';
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
        onSave,
        onToggle,
    } = props;

    const preview = useMemo(() => {
        const currentCron = cron || '0 2 * * *';
        try {
            const interval = CronExpressionParser.parse(currentCron, { tz: timezone || undefined });
            const times: string[] = [];
            for (let i = 0; i < 5; i++) {
                const nextRun = interval.next().toISOString();
                if (!nextRun) {
                    throw new Error('Invalid next run time');
                }
                times.push(nextRun);
            }
            return { type: 'ok' as const, times };
        } catch {
            return { type: 'error' as const };
        }
    }, [cron, timezone]);

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
                            
                            <div className="form-input-group">
                                <label htmlFor="flow-runtime-timezone">Flow 运行时区</label>
                                <input
                                    id="flow-runtime-timezone"
                                    aria-label="Flow 运行时区"
                                    value={timezone}
                                    readOnly
                                    disabled
                                />
                                <small>运行时区在创建 Flow 时确定，调度与时间参数共同使用该时区。</small>
                            </div>

                            <div className="form-input-group">
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
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            取消
                        </Button>
                        <Button variant="default" onClick={onSave} disabled={saving || preview.type === 'error'}>
                            {saving ? <LoaderCircle size={14} className="offline-spin" style={{ marginRight: 8 }} /> : null}
                            {saving ? '正在暂存...' : '暂存配置'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
