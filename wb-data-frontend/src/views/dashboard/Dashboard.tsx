import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Shield, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getWorkspaceSummary } from '../../api/workspace';
import { Button } from '../../components/ui/button';
import { StatusPill } from '../../components/ui/list/StatusPill';
import { useAuthStore } from '../../utils/auth';
import DashboardSkeleton from './DashboardSkeleton';
import { WorkspaceHome } from './WorkspaceHome';
import { WorkspaceOnboarding } from './WorkspaceOnboarding';
import { WorkspaceQueryHome } from './WorkspaceQueryHome';
import './Dashboard.css';

export default function Dashboard() {
    const currentGroup = useAuthStore((s) => s.currentGroup);
    const permissions = useAuthStore((s) => s.permissions);
    const systemAdmin = useAuthStore((s) => s.systemAdmin);
    const contextLoaded = useAuthStore((s) => s.contextLoaded);
    const groupId = currentGroup?.id ?? null;

    const hasPermission = (perm: string) => systemAdmin || permissions.includes(perm);
    const canWriteDataSource = hasPermission('datasource.write');
    const canUseQuery = hasPermission('query.use');
    const canExportQuery = hasPermission('query.export');
    const canWriteOffline = hasPermission('offline.write');

    const [branchState, setBranchState] = useState<{
        groupId: number | null;
        branch: string | undefined;
    }>({ groupId: null, branch: undefined });
    const selectedBranch = branchState.groupId === groupId ? branchState.branch : undefined;

    const summaryQuery = useQuery({
        queryKey: ['workspace-summary', groupId, selectedBranch ?? 'default'],
        queryFn: () => getWorkspaceSummary(groupId as number, selectedBranch),
        enabled: groupId != null,
        placeholderData: (previousData) => (
            previousData && previousData.groupId === groupId ? previousData : undefined
        ),
    });

    if (groupId == null) {
        if (!contextLoaded) {
            return <DashboardSkeleton />;
        }
        if (systemAdmin) {
            return (
                <div className="wb-home-page is-onboarding animate-enter">
                    <header className="wb-page-header">
                        <div className="wb-page-header-copy">
                            <h1 className="wb-page-title">系统管理工作台</h1>
                            <div className="wb-page-meta">
                                <StatusPill tone="neutral" dot={false}>系统管理员</StatusPill>
                                <span className="wb-commit-summary">
                                    当前尚未创建或选择项目组，可先配置用户账号与项目组工作区
                                </span>
                            </div>
                        </div>
                    </header>

                    <section className="wb-metric-strip cols-2" aria-label="系统管理入口">
                        <Link className="wb-admin-entry-cell" to="/groups">
                            <div className="wb-admin-entry-head">
                                <FolderOpen size={18} aria-hidden="true" />
                                <span>项目组管理</span>
                            </div>
                            <p>创建项目组、分配组管理员并初始化离线仓库工作区</p>
                        </Link>
                        <Link className="wb-admin-entry-cell" to="/users">
                            <div className="wb-admin-entry-head">
                                <Users size={18} aria-hidden="true" />
                                <span>用户管理</span>
                            </div>
                            <p>维护系统账号、启用状态与重置登录密码</p>
                        </Link>
                    </section>
                </div>
            );
        }
        return (
            <div className="wb-home-page is-onboarding animate-enter">
                <section className="wb-section-panel wb-home-empty-state" aria-label="无项目组提示">
                    <Shield size={28} aria-hidden="true" />
                    <h1>尚未加入任何项目组</h1>
                    <p>请联系系统管理员将账号加入对应项目组后，即可使用数据源、自助查询与离线开发功能。</p>
                </section>
            </div>
        );
    }

    if (summaryQuery.isLoading) {
        return <DashboardSkeleton />;
    }

    if (summaryQuery.isError || !summaryQuery.data) {
        const message = summaryQuery.error instanceof Error
            ? summaryQuery.error.message
            : '读取项目组工作区摘要失败，请稍后重试。';
        return (
            <div className="wb-home-page animate-enter">
                <section className="wb-section-panel wb-home-error-state" role="alert">
                    <div>
                        <h2>工作区首页加载失败</h2>
                        <p>{message}</p>
                    </div>
                    <Button variant="outline" onClick={() => { void summaryQuery.refetch(); }}>
                        重试
                    </Button>
                </section>
            </div>
        );
    }

    const summary = summaryQuery.data;

    if (summary.onboarding && summary.offline) {
        return (
            <WorkspaceOnboarding
                summary={summary}
                canWriteDataSource={canWriteDataSource}
                canUseQuery={canUseQuery}
                canWriteOffline={canWriteOffline}
            />
        );
    }

    if (!summary.offline) {
        return (
            <WorkspaceQueryHome
                summary={summary}
                canUseQuery={canUseQuery}
                canExportQuery={canExportQuery}
            />
        );
    }

    return (
        <WorkspaceHome
            summary={summary}
            canUseQuery={canUseQuery}
            canWriteOffline={canWriteOffline}
            onBranchChange={(branch) => setBranchState({ groupId, branch })}
            onRefresh={() => { void summaryQuery.refetch(); }}
            isRefreshing={summaryQuery.isFetching}
        />
    );
}
