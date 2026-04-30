import { FolderKanban, Pencil, Ban, CheckCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { GroupDetail } from '../../api/group';
import { formatTimestamp } from './config';
import { Button } from '../../components/ui/button';

interface GroupTableProps {
    data: GroupDetail[];
    isRefreshing: boolean;
    errorMessage: string;
    onEdit: (group: GroupDetail) => void;
    onDisable: (group: GroupDetail) => void;
    onEnable: (group: GroupDetail) => void;
    pendingId: number | null;
}

export function GroupTable(props: GroupTableProps) {
    const {
        data,
        isRefreshing,
        errorMessage,
        onEdit,
        onDisable,
        onEnable,
        pendingId,
    } = props;

    if (errorMessage && data.length === 0) {
        return (
            <div className="group-error">
                <strong>列表加载失败</strong>
                <p>{errorMessage}</p>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="group-empty">
                <FolderKanban size={36} />
                <h3>还没有匹配的项目组</h3>
                <p>试着清空筛选条件，或者新建一个项目组。</p>
            </div>
        );
    }

    return (
        <div className={`group-table-shell ${isRefreshing ? 'is-refreshing' : ''}`}>
            {errorMessage ? (
                <div className="group-inline-error" role="alert">
                    <strong>最新一次刷新失败</strong>
                    <p>{errorMessage}</p>
                </div>
            ) : null}
            <div className="group-table-progress" aria-hidden="true" />
            <div className="group-table-scroll">
                <table className="group-table">
                    <thead>
                        <tr>
                            <th>项目组名称</th>
                            <th>描述</th>
                            <th>状态</th>
                            <th>成员数</th>
                            <th>创建时间</th>
                            <th className="group-actions-column">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((item) => (
                            <tr key={item.id}>
                                <td>
                                    <strong className="group-name-main">{item.name}</strong>
                                </td>
                                <td>{item.description || '--'}</td>
                                <td>
                                    <span className={`group-status-badge status-${item.status}`}>
                                        {item.status === 'active' ? '正常' : '已禁用'}
                                    </span>
                                </td>
                                <td>{item.memberCount}</td>
                                <td className="group-time-cell">{formatTimestamp(item.createdAt)}</td>
                                <td className="group-actions-column">
                                    <TooltipProvider delayDuration={400}>
                                    <div className="group-actions">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="outline" size="icon"
                                                    onClick={() => onEdit(item)}
                                                    aria-label="编辑项目组"
                                                    type="button"
                                                >
                                                    <Pencil size={16} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="tooltip-content" side="bottom">
                                                编辑
                                            </TooltipContent>
                                        </Tooltip>
                                        {item.status === 'active' ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline" size="icon"
                                                        disabled={pendingId === item.id}
                                                        onClick={() => onDisable(item)}
                                                        aria-label="禁用项目组"
                                                        type="button"
                                                    >
                                                        <Ban size={16} />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent className="tooltip-content" side="bottom">
                                                    禁用
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline" size="icon"
                                                        disabled={pendingId === item.id}
                                                        onClick={() => onEnable(item)}
                                                        aria-label="启用项目组"
                                                        type="button"
                                                    >
                                                        <CheckCircle size={16} />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent className="tooltip-content" side="bottom">
                                                    启用
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>
                                    </TooltipProvider>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="group-refresh-overlay" aria-hidden={!isRefreshing}>
                <div className="group-refresh-pill">
                    <span className="group-refresh-dot" />
                    正在更新列表
                </div>
            </div>
        </div>
    );
}
