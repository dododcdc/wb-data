import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AxiosError } from 'axios';
import type { Edge, Node } from '@xyflow/react';
import {
    createOfflineDocumentDebugExecution,
    getOfflineExecution,
    getOfflineSchedule,
    listOfflineExecutions,
    stopAllOfflineExecutions,
    stopOfflineExecution,
    type OfflineExecutionDetail,
    type OfflineExecutionListItem,
    type OfflineFlowDocument,
    type OfflineScheduleResponse,
} from '../../api/offline';
import type { FeedbackPayload } from '../../hooks/useOperationFeedback';
import { getErrorMessage } from '../../utils/error';
import { buildDraftExecutionRequest } from './draftExecution';
import { isActiveStatus } from './executionPresentation';
import { updateFlowScheduleDraft, type FlowDraftSession } from './flowDraftController';

interface UseFlowExecutionAndScheduleParams {
    groupId: number | null;
    activeFlowPath: string | null;
    draftSession: FlowDraftSession | null;
    flowDocument: OfflineFlowDocument | null;
    selectedTaskIds: string[];
    nodeEditorOpen: boolean;
    defaultTimezone: string;
    canvasNodesRef: MutableRefObject<Node[]>;
    canvasEdgesRef: MutableRefObject<Edge[]>;
    setDraftSession: (session: FlowDraftSession) => void;
    showFeedback: (payload: FeedbackPayload) => void;
}

export function useFlowExecutionAndSchedule({
    groupId,
    activeFlowPath,
    draftSession,
    flowDocument,
    selectedTaskIds,
    nodeEditorOpen,
    defaultTimezone,
    canvasNodesRef,
    canvasEdgesRef,
    setDraftSession,
    showFeedback,
}: UseFlowExecutionAndScheduleParams) {
    const [executionDialogOpen, setExecutionDialogOpen] = useState(false);
    const [executions, setExecutions] = useState<OfflineExecutionListItem[]>([]);
    const [executionsLoading, setExecutionsLoading] = useState(false);
    const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
    const [executionDetail, setExecutionDetail] = useState<OfflineExecutionDetail | null>(null);
    const [executionDetailLoading, setExecutionDetailLoading] = useState(false);
    const [executionActionPending, setExecutionActionPending] = useState<string | null>(null);
    const [executionRequestedByFilter, setExecutionRequestedByFilter] = useState<number | null>(null);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [schedule, setSchedule] = useState<OfflineScheduleResponse | null>(null);
    const [, setScheduleLoading] = useState(false);
    const [scheduleSaving] = useState(false);
    const [scheduleCron, setScheduleCron] = useState('');
    const [scheduleTimezone, setScheduleTimezone] = useState(defaultTimezone);
    const groupIdRef = useRef(groupId);
    const actionVersionRef = useRef(0);

    useEffect(() => {
        if (groupIdRef.current !== groupId) {
            groupIdRef.current = groupId;
            actionVersionRef.current += 1;
        }
    }, [groupId]);

    const captureGroupActionGuard = useCallback((expectedGroupId: number | null) => {
        const version = actionVersionRef.current;
        return () => groupIdRef.current === expectedGroupId && actionVersionRef.current === version;
    }, []);

    const resetExecutionAndSchedule = useCallback(() => {
        setSchedule(null);
        setExecutionDialogOpen(false);
        setExecutions([]);
        setActiveExecutionId(null);
        setExecutionDetail(null);
    }, []);

    const loadExecutionDetail = useCallback(async (executionId: string, silent = false) => {
        if (!groupId) return;
        if (!silent) setExecutionDetailLoading(true);
        try {
            const detail = await getOfflineExecution(groupId, executionId);
            setActiveExecutionId(executionId);
            setExecutionDetail(detail);
            setExecutions((current) => current.map((item) => {
                if (item.executionId !== executionId) {
                    return item;
                }
                let durationMs = item.durationMs;
                if (detail.startDate && detail.endDate) {
                    durationMs = new Date(detail.endDate).getTime() - new Date(detail.startDate).getTime();
                }
                return {
                    ...item,
                    status: detail.status,
                    startDate: detail.startDate,
                    endDate: detail.endDate,
                    durationMs,
                };
            }));
        } catch (error) {
            if (!silent) {
                showFeedback({
                    tone: 'error',
                    title: '执行详情读取失败',
                    detail: getErrorMessage(error, '暂时无法读取执行详情。'),
                });
            }
        } finally {
            if (!silent) setExecutionDetailLoading(false);
        }
    }, [groupId, showFeedback]);

    const refreshExecutions = useCallback(async (preferExecutionId?: string | null, requestedByOverride?: number | null) => {
        if (!groupId || !activeFlowPath) return;
        setExecutionsLoading(true);
        try {
            const nextExecutions = await listOfflineExecutions(
                groupId,
                activeFlowPath,
                requestedByOverride === undefined ? executionRequestedByFilter : requestedByOverride,
            );
            setExecutions(nextExecutions);
            const fallbackId = preferExecutionId && nextExecutions.some((item) => item.executionId === preferExecutionId)
                ? preferExecutionId
                : nextExecutions[0]?.executionId ?? null;
            if (fallbackId) {
                await loadExecutionDetail(fallbackId);
            } else {
                setActiveExecutionId(null);
                setExecutionDetail(null);
            }
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '执行记录读取失败',
                detail: getErrorMessage(error, '暂时无法读取当前 Flow 的执行记录。'),
            });
        } finally {
            setExecutionsLoading(false);
        }
    }, [activeFlowPath, executionRequestedByFilter, groupId, loadExecutionDetail, showFeedback]);

    useEffect(() => {
        if (!executionDialogOpen || !activeFlowPath) return;
        void refreshExecutions(null);
    }, [activeFlowPath, executionDialogOpen, refreshExecutions]);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null;
        if (executionDialogOpen && activeExecutionId && executionDetail && isActiveStatus(executionDetail.status)) {
            timer = setInterval(() => {
                void loadExecutionDetail(activeExecutionId, true);
            }, 3000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [activeExecutionId, executionDetail, executionDialogOpen, loadExecutionDetail]);

    const execute = useCallback(async () => {
        if (!groupId || !activeFlowPath || !flowDocument) return;
        if (nodeEditorOpen) {
            showFeedback({
                tone: 'error',
                title: '请先处理当前节点编辑',
                detail: '请先点击应用暂存或关闭节点编辑器，再执行当前 Flow。',
            });
            return;
        }
        if (selectedTaskIds.length === 0) {
            showFeedback({
                tone: 'error',
                title: '请选择要执行的节点',
                detail: '请在画布上勾选需要参与调试的节点。',
            });
            return;
        }

        try {
            const response = await createOfflineDocumentDebugExecution(buildDraftExecutionRequest({
                groupId,
                flowPath: activeFlowPath,
                flowDocument,
                canvasNodes: canvasNodesRef.current,
                canvasEdges: canvasEdgesRef.current,
                selectedTaskIds,
            }));
            showFeedback({
                tone: 'success',
                title: '调试执行已提交',
                detail: `执行 ID：${response.executionId}`,
            });
            setExecutionDialogOpen(true);
            await refreshExecutions(response.executionId);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '调试执行失败',
                detail: getErrorMessage(error, '暂时无法触发调试执行。'),
            });
        }
    }, [activeFlowPath, canvasEdgesRef, canvasNodesRef, flowDocument, groupId, nodeEditorOpen, refreshExecutions, selectedTaskIds, showFeedback]);

    const stopExecution = useCallback(async (executionId: string) => {
        if (!groupId || !activeFlowPath) return;
        setExecutionActionPending(executionId);
        try {
            await stopOfflineExecution(groupId, executionId);
            showFeedback({
                tone: 'info',
                title: '已请求停止执行',
                detail: `执行 ${executionId} 正在等待 Kestra 收敛状态。`,
            });
            await refreshExecutions(executionId);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '停止执行失败',
                detail: getErrorMessage(error, '暂时无法停止当前执行。'),
            });
        } finally {
            setExecutionActionPending(null);
        }
    }, [activeFlowPath, groupId, refreshExecutions, showFeedback]);

    const stopAllExecutions = useCallback(async () => {
        if (!groupId || !activeFlowPath) return;
        setExecutionActionPending('ALL');
        try {
            const stoppedCount = await stopAllOfflineExecutions(groupId, activeFlowPath);
            showFeedback({
                tone: 'info',
                title: '已发送批量停止请求',
                detail: stoppedCount > 0 ? `共请求停止 ${stoppedCount} 条执行。` : '当前没有运行中的执行。',
            });
            await refreshExecutions(activeExecutionId);
        } catch (error) {
            showFeedback({
                tone: 'error',
                title: '停止全部执行失败',
                detail: getErrorMessage(error, '暂时无法停止当前 Flow 的执行。'),
            });
        } finally {
            setExecutionActionPending(null);
        }
    }, [activeExecutionId, activeFlowPath, groupId, refreshExecutions, showFeedback]);

    const loadScheduleSnapshot = useCallback(async (path: string) => {
        if (!groupId) return;

        if (draftSession?.workingDraft.schedule) {
            const draftSchedule = draftSession.workingDraft.schedule;
            setScheduleCron(draftSchedule.cron);
            setScheduleTimezone(draftSchedule.timezone || defaultTimezone);
            setSchedule({
                groupId,
                path,
                triggerId: 'schedule',
                cron: draftSchedule.cron,
                timezone: draftSchedule.timezone,
                enabled: draftSchedule.enabled,
                contentHash: '',
                fileUpdatedAt: 0,
            });
            return;
        }

        const isCurrentGroupAction = captureGroupActionGuard(groupId);
        setScheduleLoading(true);
        try {
            const nextSchedule = await getOfflineSchedule(groupId, path);
            if (!isCurrentGroupAction()) return;
            setSchedule(nextSchedule);
            setScheduleCron(nextSchedule.cron);
            setScheduleTimezone(nextSchedule.timezone ?? defaultTimezone);
        } catch (error) {
            if (!isCurrentGroupAction()) return;
            if (error instanceof AxiosError && error.response?.status === 404) {
                setSchedule(null);
                setScheduleCron('0 2 * * *');
                setScheduleTimezone(defaultTimezone);
                return;
            }
            showFeedback({
                tone: 'error',
                title: '调度配置读取失败',
                detail: '',
            });
        } finally {
            if (isCurrentGroupAction()) {
                setScheduleLoading(false);
            }
        }
    }, [captureGroupActionGuard, defaultTimezone, draftSession?.workingDraft.schedule, groupId, showFeedback]);

    const stageSchedule = useCallback(async () => {
        if (!draftSession) return;
        const nextSession = updateFlowScheduleDraft(draftSession, {
            cron: scheduleCron,
            timezone: scheduleTimezone,
            enabled: schedule?.enabled ?? false,
        });
        setDraftSession(nextSession);
        setScheduleDialogOpen(false);
        showFeedback({
            tone: 'success',
            title: '调度配置已暂存',
            detail: '',
        });
    }, [draftSession, schedule?.enabled, scheduleCron, scheduleTimezone, setDraftSession, showFeedback]);

    const toggleSchedule = useCallback(async (enabled: boolean) => {
        if (!draftSession) return;
        const nextSession = updateFlowScheduleDraft(draftSession, {
            cron: scheduleCron,
            timezone: scheduleTimezone,
            enabled,
        });
        setDraftSession(nextSession);
        setSchedule((prev) => prev ? { ...prev, enabled } : {
            groupId: groupId!,
            path: activeFlowPath!,
            triggerId: 'schedule',
            cron: scheduleCron,
            timezone: scheduleTimezone,
            enabled,
            contentHash: '',
            fileUpdatedAt: 0,
        });
        showFeedback({
            tone: 'success',
            title: enabled ? '调度开启已暂存' : '调度关闭已暂存',
            detail: '保存 Flow 后生效。',
        });
    }, [activeFlowPath, draftSession, groupId, scheduleCron, scheduleTimezone, setDraftSession, showFeedback]);

    return {
        executionDialogOpen,
        setExecutionDialogOpen,
        executions,
        executionsLoading,
        activeExecutionId,
        executionDetail,
        executionDetailLoading,
        executionActionPending,
        executionRequestedByFilter,
        setExecutionRequestedByFilter,
        scheduleDialogOpen,
        setScheduleDialogOpen,
        schedule,
        scheduleCron,
        setScheduleCron,
        scheduleTimezone,
        setScheduleTimezone,
        scheduleSaving,
        refreshExecutions,
        loadExecutionDetail,
        execute,
        stopExecution,
        stopAllExecutions,
        loadScheduleSnapshot,
        stageSchedule,
        toggleSchedule,
        resetExecutionAndSchedule,
    };
}
