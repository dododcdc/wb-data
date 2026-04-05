import { Users, UserCog, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import type { MemberRecord } from '../../api/groupSettings';
import { formatTimestamp, getRoleLabel } from './config';

interface MemberTableProps {
    data: MemberRecord[];
    isRefreshing: boolean;
    errorMessage: string;
    canManage: boolean;
    currentUserId: number | null;
    onChangeRole: (member: MemberRecord) => void;
    onRemove: (member: MemberRecord) => void;
}

export default function MemberTable(props: MemberTableProps) {
    const {
        data,
        isRefreshing,
        errorMessage,
        canManage,
        currentUserId,
        onChangeRole,
        onRemove,
    } = props;

    const adminCount = data.filter((m) => m.role === 'GROUP_ADMIN').length;

    if (errorMessage && data.length === 0) {
        return (
            <div className="gs-error">
                <strong>成员列表加载失败</strong>
                <p>{errorMessage}</p>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="gs-empty">
                <Users size={36} />
                <h3>暂无成员</h3>
                <p>当前项目组还没有成员，请添加成员。</p>
            </div>
        );
    }

    return (
        <div className={`gs-table-shell ${isRefreshing ? 'is-refreshing' : ''}`}>
            {errorMessage ? (
                <div className="gs-inline-error" role="alert">
                    <strong>最新一次刷新失败</strong>
                    <p>{errorMessage}</p>
                </div>
            ) : null}
            <div className="gs-table-progress" aria-hidden="true" />
            <div className="gs-table-scroll">
                <table className="gs-table">
                    <thead>
                        <tr>
                            <th>用户名</th>
                            <th>展示名</th>
                            <th>项目组角色</th>
                            <th>加入时间</th>
                            {canManage ? <th className="gs-actions-column">操作</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((member) => {
                            const isSelf = currentUserId === member.userId;
                            const isOnlyAdmin = member.role === 'GROUP_ADMIN' && adminCount <= 1;
                            const showActions = canManage && !isSelf;
                            const rolePillClass = member.role === 'GROUP_ADMIN' ? 'is-admin' : 'is-developer';

                            return (
                                <tr key={member.id}>
                                    <td>
                                        <span className="gs-name-main">{member.username}</span>
                                    </td>
                                    <td>{member.displayName}</td>
                                    <td>
                                        <span className={`gs-role-pill ${rolePillClass}`}>
                                            {getRoleLabel(member.role)}
                                        </span>
                                    </td>
                                    <td className="gs-time-cell">{formatTimestamp(member.createdAt)}</td>
                                    {canManage ? (
                                        <td className="gs-actions-column">
                                            <TooltipProvider delayDuration={400}>
                                                <div className="gs-actions">
                                                    {showActions && !isOnlyAdmin ? (
                                                        <>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <button
                                                                        className="gs-icon-btn"
                                                                        type="button"
                                                                        aria-label="修改角色"
                                                                        onClick={() => onChangeRole(member)}
                                                                    >
                                                                        <UserCog size={16} />
                                                                    </button>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="tooltip-content" side="bottom">
                                                                    修改角色
                                                                </TooltipContent>
                                                            </Tooltip>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <button
                                                                        className="gs-icon-btn"
                                                                        type="button"
                                                                        aria-label="移除成员"
                                                                        onClick={() => onRemove(member)}
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="tooltip-content" side="bottom">
                                                                    移除
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </>
                                                    ) : null}
                                                </div>
                                            </TooltipProvider>
                                        </td>
                                    ) : null}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="gs-refresh-overlay" aria-hidden={!isRefreshing}>
                <div className="gs-refresh-pill">
                    <span className="gs-refresh-dot" />
                    正在更新列表
                </div>
            </div>
        </div>
    );
}
