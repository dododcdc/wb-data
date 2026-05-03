import { Edit3, KeyRound, Power, Users } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { UserRecord } from '../../api/user';
import { formatTimestamp, getStatusLabel, getSystemRoleLabel } from './config';
import { Button } from '../../components/ui/button';
import { DataTableShell } from '../../components/ui/data-table-shell';

interface UserTableProps {
    data: UserRecord[];
    isRefreshing: boolean;
    errorMessage: string;
    onEdit: (user: UserRecord) => void;
    onToggleStatus: (user: UserRecord) => void;
    onResetPassword: (user: UserRecord) => void;
    statusPendingId: number | null;
}

export function UserTable(props: UserTableProps) {
    const {
        data,
        isRefreshing,
        errorMessage,
        onEdit,
        onToggleStatus,
        onResetPassword,
        statusPendingId,
    } = props;

    return (
        <DataTableShell
            dataLength={data.length}
            isRefreshing={isRefreshing}
            errorMessage={errorMessage}
            emptyIcon={<Users size={36} />}
            emptyTitle="还没有匹配的用户"
            emptyDescription="试着清空筛选条件，或者新建一个用户。"
        >
            <table className="user-table">
                <thead>
                    <tr>
                        <th>用户名</th>
                        <th>展示名</th>
                        <th>系统角色</th>
                        <th>状态</th>
                        <th>最近登录</th>
                        <th>创建时间</th>
                        <th className="user-actions-column">操作</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((item) => (
                        <tr key={item.id}>
                            <td>
                                <strong className="user-name-main">{item.username}</strong>
                            </td>
                            <td className="user-display-name">{item.displayName || '--'}</td>
                            <td>
                                <span className={`user-role-pill ${item.systemRole === 'SYSTEM_ADMIN' ? 'is-admin' : 'is-user'}`}>
                                    {getSystemRoleLabel(item.systemRole)}
                                </span>
                            </td>
                            <td className="user-status-cell">
                                <span className={`user-status-pill ${item.status === 'ACTIVE' ? 'enabled' : 'disabled'}`}>
                                    <span className="user-status-dot" />
                                    {getStatusLabel(item.status)}
                                </span>
                            </td>
                            <td className="user-time-cell">{formatTimestamp(item.lastLoginAt)}</td>
                            <td className="user-time-cell">{formatTimestamp(item.createdAt)}</td>
                            <td className="user-actions-column">
                                <div className="user-actions">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline" size="icon"
                                                onClick={() => onEdit(item)}
                                                aria-label="编辑用户"
                                                type="button"
                                            >
                                                <Edit3 size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">编辑用户</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline" size="icon"
                                                disabled={statusPendingId === item.id}
                                                onClick={() => onToggleStatus(item)}
                                                aria-label={item.status === 'ACTIVE' ? '禁用用户' : '启用用户'}
                                                type="button"
                                            >
                                                <Power size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">
                                            {item.status === 'ACTIVE' ? '禁用用户' : '启用用户'}
                                        </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline" size="icon"
                                                onClick={() => onResetPassword(item)}
                                                aria-label="重置密码"
                                                type="button"
                                            >
                                                <KeyRound size={16} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent className="tooltip-content" side="bottom">重置密码</TooltipContent>
                                    </Tooltip>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </DataTableShell>
    );
}
