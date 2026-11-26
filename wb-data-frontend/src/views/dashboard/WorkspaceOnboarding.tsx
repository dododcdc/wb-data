import { useMemo } from 'react';
import { Check, GitBranch, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { WorkspaceSummaryResponse } from '../../api/workspace';
import { Button } from '../../components/ui/button';
import { StatusPill } from '../../components/ui/list/StatusPill';
import {
    formatCount,
    gitSyncStatusInfo,
    resolveLastQueryContext,
    resolveRoleLabel,
} from './dashboardUtils';

interface WorkspaceOnboardingProps {
    summary: WorkspaceSummaryResponse;
    canWriteDataSource: boolean;
    canUseQuery: boolean;
    canWriteOffline: boolean;
}

interface OnboardingStep {
    num: number;
    title: string;
    description: string;
    done: boolean;
    recommended: boolean;
    actionLabel: string;
    href: string;
    enabled: boolean;
}

export function WorkspaceOnboarding({
    summary,
    canWriteDataSource,
    canUseQuery,
    canWriteOffline,
}: WorkspaceOnboardingProps) {
    const navigate = useNavigate();
    const offline = summary.offline;
    const hasDataSource = (summary.datasources?.total ?? 0) > 0;
    const lastQueryContext = useMemo(
        () => resolveLastQueryContext(summary.datasources?.items),
        [summary.datasources?.items],
    );
    const hasUsedQuery = Boolean(lastQueryContext?.fromHistory);

    const steps: OnboardingStep[] = useMemo(() => {
        const step1Done = hasDataSource;
        const step2Done = hasDataSource && hasUsedQuery;
        const step3Done = false;
        const recommendedStep = !step1Done ? 1 : !step2Done ? 2 : 3;

        return [
            {
                num: 1,
                title: '登记并测试首个数据源',
                description: '支持通过插件加载 MySQL、PostgreSQL、Hive 和 ClickHouse 驱动，创建前可直接测试连接连通性。',
                done: step1Done,
                recommended: recommendedStep === 1,
                actionLabel: step1Done ? '查看数据源' : '登记数据源',
                href: '/datasources',
                enabled: summary.datasources != null && (step1Done || canWriteDataSource),
            },
            {
                num: 2,
                title: '用自助查询验证表结构与数据',
                description: '选择已连通的数据源编写并格式化探索性 SQL，确认字段口径并导出样本结果。',
                done: step2Done,
                recommended: recommendedStep === 2,
                actionLabel: step2Done ? '继续查询' : '打开自助查询',
                href: '/query',
                enabled: canUseQuery,
            },
            {
                num: 3,
                title: '在离线开发编排首个任务并提交推送',
                description: '画布自动保存为草稿，支持即时调试执行；推送远端并同步 Kestra 后，周期调度才会正式生效。',
                done: step3Done,
                recommended: recommendedStep === 3,
                actionLabel: '进入离线开发',
                href: '/offline',
                enabled: offline != null && canWriteOffline,
            },
        ];
    }, [canUseQuery, canWriteDataSource, canWriteOffline, hasDataSource, hasUsedQuery, offline, summary.datasources]);

    const completedCount = steps.filter((step) => step.done).length;
    const progressPercent = completedCount === 0 ? 4 : Math.round((completedCount / steps.length) * 100);
    const syncInfo = summary.gitSync ? gitSyncStatusInfo(summary.gitSync.latestStatus) : null;

    return (
        <div className="wb-home-page is-onboarding animate-enter">
            {/* 1. PageHeader */}
            <header className="wb-page-header">
                <div className="wb-page-header-copy">
                    <h1 className="wb-page-title">{summary.groupName}</h1>
                    <div className="wb-page-meta">
                        <StatusPill tone="neutral" dot={false}>
                            {resolveRoleLabel(summary.role)}
                        </StatusPill>
                        {offline?.branch ? (
                            <span className="wb-branch-chip">
                                <GitBranch size={12} aria-hidden="true" />
                                <span>{offline.branch}</span>
                            </span>
                        ) : null}
                        <StatusPill tone="info">工作区已初始化</StatusPill>
                        <span className="wb-commit-summary">
                            完成基础配置后，首页将自动切换为项目组运行工作台
                        </span>
                    </div>
                </div>

                {summary.datasources && canWriteDataSource ? (
                    <div className="wb-page-actions">
                        <Button className="wb-btn-brand" onClick={() => navigate('/datasources')}>
                            <Plus size={15} />
                            <span>新建数据源</span>
                        </Button>
                    </div>
                ) : null}
            </header>

            {/* 2. 3 步启动清单 */}
            <section className="wb-section-panel" aria-label="工作区启动清单">
                <div className="wb-section-header">
                    <div>
                        <h2 className="wb-section-title">启动工作区：3 步完成首条任务链路</h2>
                        <p className="wb-section-subtitle">
                            按顺序登记连接、验证 SQL 并创建首个离线任务，状态随项目组进展自动更新
                        </p>
                    </div>
                    <div className="wb-progress-wrap">
                        <span className="wb-progress-count">已完成 {completedCount} / 3</span>
                        <div className="wb-progress-track" aria-hidden="true">
                            <div className="wb-progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>
                    </div>
                </div>

                <div className="wb-onboarding-steps">
                    {steps.map((step) => (
                        <div className="wb-onboarding-step" key={step.num}>
                            <div className="wb-onboarding-step-left">
                                <span
                                    className={`wb-step-badge${step.done ? ' is-done' : step.recommended ? ' is-recommended' : ''}`}
                                    aria-hidden="true"
                                >
                                    {step.done ? <Check size={14} /> : step.num}
                                </span>
                                <div className="wb-onboarding-step-copy">
                                    <div className="wb-onboarding-step-title-row">
                                        <h3>{step.title}</h3>
                                        <StatusPill
                                            tone={step.done ? 'success' : step.recommended ? 'info' : 'neutral'}
                                            dot={false}
                                        >
                                            {step.done ? '已完成' : step.recommended ? '当前推荐' : '待开始'}
                                        </StatusPill>
                                    </div>
                                    <p>{step.description}</p>
                                </div>
                            </div>

                            {step.enabled ? (
                                <Button
                                    variant={step.recommended ? 'default' : 'outline'}
                                    className={step.recommended ? 'wb-btn-brand' : undefined}
                                    onClick={() => navigate(step.href)}
                                >
                                    {step.actionLabel}
                                </Button>
                            ) : (
                                <span className="wb-step-readonly-note">需对应写权限</span>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* 3. 底部配置状态条 */}
            {(summary.members || summary.gitSync) ? (
                <section
                    className={`wb-metric-strip ${summary.members && summary.gitSync ? 'cols-2' : 'cols-1'}`}
                    aria-label="项目组基础配置状态"
                >
                    {summary.members ? (
                        <div className="wb-config-cell">
                            <div>
                                <div className="wb-metric-label">项目组成员</div>
                                <div className="wb-config-value">
                                    <span className="wb-mono-num">{formatCount(summary.members.totalCount)}</span> 人已加入工作区
                                </div>
                            </div>
                            <Link className="wb-section-more-link" to="/group-settings">
                                管理成员
                            </Link>
                        </div>
                    ) : null}

                    {summary.gitSync && syncInfo ? (
                        <div className="wb-config-cell">
                            <div>
                                <div className="wb-metric-label">Git 远端与 Kestra 同步</div>
                                <div className="wb-config-value">
                                    <span>{summary.gitSync.configured ? '已配置同步' : '待配置'}</span>
                                    <StatusPill tone={summary.gitSync.configured ? syncInfo.tone : 'warning'}>
                                        {summary.gitSync.configured ? syncInfo.label : '仅影响正式调度同步'}
                                    </StatusPill>
                                </div>
                            </div>
                            <Link className="wb-section-more-link" to="/group-settings">
                                前往项目组设置
                            </Link>
                        </div>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}
