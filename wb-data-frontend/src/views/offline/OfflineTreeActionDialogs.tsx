import { useMemo, useState } from 'react';
import {
    ChevronRight,
    FileCode2,
    FolderOpen,
    FolderPlus,
    LoaderCircle,
    Pencil,
    Trash2,
} from 'lucide-react';

import type { OfflineRepoTreeNode, OfflineRepoTreeResponse } from '../../api/offline';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import './OfflineContextMenu.css';

interface CreateAction {
    open: boolean;
    name: string;
    parentPath: string;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onNameChange: (name: string) => void;
    onParentPathChange: (path: string) => void;
    onSubmit: () => void;
}

interface DeleteAction {
    open: boolean;
    name: string;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: () => void;
}

interface RenameAction {
    open: boolean;
    name: string;
    originalName: string;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onNameChange: (name: string) => void;
    onSubmit: () => void;
}

interface ContextMenuAction {
    open: boolean;
    position: { x: number; y: number } | null;
    node: OfflineRepoTreeNode | null;
    onOpenChange: (open: boolean) => void;
    onOpenNewFlow: (node: OfflineRepoTreeNode) => void;
    onOpenNewFolder: (node: OfflineRepoTreeNode) => void;
    onOpenRenameFlow: (node: OfflineRepoTreeNode) => void;
    onOpenRenameFolder: (node: OfflineRepoTreeNode) => void;
    onOpenDeleteFlow: (node: OfflineRepoTreeNode) => void;
    onOpenDeleteFolder: (node: OfflineRepoTreeNode) => void;
}

interface OfflineTreeActionDialogsProps {
    repoTree: OfflineRepoTreeResponse | null;
    canWrite: boolean;
    createFlow: CreateAction;
    createFolder: CreateAction;
    deleteFlow: DeleteAction;
    deleteFolder: DeleteAction;
    renameFlow: RenameAction;
    renameFolder: RenameAction;
    contextMenu: ContextMenuAction;
}

interface PathPickerNode {
    id: string;
    name: string;
    path: string;
    children: PathPickerNode[];
}

function pickerFromRepoNode(node: OfflineRepoTreeNode): PathPickerNode {
    return {
        id: node.id,
        name: node.name,
        path: node.path,
        children: node.children
            .filter((child) => child.kind === 'DIRECTORY')
            .map(pickerFromRepoNode),
    };
}

function normalizeToPickerNodes(root: OfflineRepoTreeNode): PathPickerNode[] {
    return root.children
        .filter((child) => child.kind === 'DIRECTORY' && child.name !== 'scripts')
        .map(pickerFromRepoNode);
}

function PathPicker({
    rootNode,
    selectedPath,
    onSelect,
}: {
    rootNode: OfflineRepoTreeNode;
    selectedPath: string;
    onSelect: (path: string) => void;
}) {
    const [search, setSearch] = useState('');
    const [rootExpanded, setRootExpanded] = useState(true);
    const filteredNodes = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return normalizeToPickerNodes(rootNode);

        const flatPaths: Array<{ label: string; path: string }> = [];
        const extract = (nodes: PathPickerNode[]) => {
            nodes.forEach((node) => {
                const relative = node.path.replace(/^_flows\/?/, '');
                if (relative.toLowerCase().includes(query)) {
                    flatPaths.push({ label: relative, path: relative });
                }
                extract(node.children);
            });
        };
        extract(normalizeToPickerNodes(rootNode));
        return flatPaths;
    }, [rootNode, search]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
                placeholder="搜索目录..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{ height: 32, fontSize: '0.84rem' }}
            />
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, maxHeight: 200, overflowY: 'auto', background: 'var(--color-surface)', padding: '8px 0' }}>
                {search ? (
                    filteredNodes.length > 0 ? (
                        (filteredNodes as Array<{ label: string; path: string }>).map((item) => (
                            <button
                                key={item.path}
                                type="button"
                                className={`offline-tree-row${selectedPath === item.path ? ' is-active' : ''}`}
                                style={{ paddingLeft: 12 }}
                                onClick={() => onSelect(item.path)}
                            >
                                <span className="offline-tree-row-icon"><FolderOpen size={13} /></span>
                                <span className="offline-tree-row-label">{item.label}</span>
                            </button>
                        ))
                    ) : (
                        <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                            无匹配的目录
                        </div>
                    )
                ) : (
                    <div className="offline-tree-root">
                        <button
                            type="button"
                            className={`offline-tree-row${!selectedPath ? ' is-active' : ''}`}
                            style={{ paddingLeft: 6 }}
                            onClick={() => {
                                onSelect('');
                                setRootExpanded((expanded) => !expanded);
                            }}
                        >
                            <span className={`offline-tree-row-caret${rootExpanded ? ' is-expanded' : ''}`}><ChevronRight size={14} /></span>
                            <span className="offline-tree-row-icon"><FolderOpen size={13} /></span>
                            <span className="offline-tree-row-label">{rootNode.name}</span>
                        </button>
                        {rootExpanded ? (
                            <div className="offline-tree-children">
                                {(filteredNodes as PathPickerNode[]).map((child) => (
                                    <PathPickerBranch key={child.id} node={child} depth={1} selectedPath={selectedPath} onSelect={onSelect} />
                                ))}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}

function PathPickerBranch({
    node,
    depth,
    selectedPath,
    onSelect,
}: {
    node: PathPickerNode;
    depth: number;
    selectedPath: string;
    onSelect: (path: string) => void;
}) {
    const relativePath = node.path.replace(/^_flows\/?/, '');
    const selected = selectedPath === relativePath || (selectedPath === '' && relativePath === '');
    const hasChildren = node.children.length > 0;
    const [expanded, setExpanded] = useState(selectedPath !== '' && selectedPath.startsWith(relativePath));

    return (
        <div className="offline-tree-branch">
            <button
                type="button"
                className={`offline-tree-row is-directory${selected ? ' is-active' : ''}`}
                style={{ paddingLeft: `${depth * 14 + 6}px` }}
                onClick={() => {
                    onSelect(relativePath);
                    if (hasChildren) setExpanded((current) => !current);
                }}
            >
                {hasChildren ? (
                    <span className={`offline-tree-row-caret${expanded ? ' is-expanded' : ''}`}><ChevronRight size={14} /></span>
                ) : (
                    <span className="offline-tree-row-spacer" />
                )}
                <span className="offline-tree-row-icon"><FolderOpen size={13} /></span>
                <span className="offline-tree-row-label">{node.name}</span>
            </button>
            {hasChildren && expanded ? (
                <div className="offline-tree-children">
                    {node.children.map((child) => (
                        <PathPickerBranch key={child.id} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function CreateDialog({
    kind,
    action,
    repoTree,
}: {
    kind: 'Flow' | '文件夹';
    action: CreateAction;
    repoTree: OfflineRepoTreeResponse | null;
}) {
    const close = () => {
        action.onOpenChange(false);
        action.onNameChange('');
        action.onParentPathChange('');
    };
    const isFlow = kind === 'Flow';

    return (
        <Dialog open={action.open} onOpenChange={(open) => {
            action.onOpenChange(open);
            if (!open) {
                action.onNameChange('');
                action.onParentPathChange('');
            }
        }}>
            <DialogContent style={{ maxWidth: isFlow ? '520px' : '460px' }}>
                <DialogHeader>
                    <DialogTitle>新建 {kind}</DialogTitle>
                    <DialogDescription>
                        {isFlow ? '输入 Flow 名称，将自动创建空白的 Flow 文件' : '输入文件夹名称，将在指定路径下创建文件夹'}
                    </DialogDescription>
                </DialogHeader>
                <div className="dialog-body">
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                            {isFlow ? 'Flow 名称' : '文件夹名称'}
                        </label>
                        <Input
                            value={action.name}
                            onChange={(event) => action.onNameChange(event.target.value)}
                            placeholder="例如：data_pipeline"
                            autoFocus
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: 6, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                            存储路径 {action.parentPath ? `（已选：${action.parentPath.replace('_flows/', '')}）` : `（默认：${repoTree?.root.name ?? '根目录'}）`}
                        </label>
                        {repoTree ? (
                            <PathPicker rootNode={repoTree.root} selectedPath={action.parentPath} onSelect={action.onParentPathChange} />
                        ) : (
                            <div style={{ padding: '12px', color: 'var(--color-text-secondary)', fontSize: '0.84rem' }}>加载目录树中...</div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" size="sm" onClick={close} disabled={action.pending}>取消</Button>
                    <Button type="button" variant="default" size="sm" onClick={action.onSubmit} disabled={!action.name.trim() || action.pending}>
                        {action.pending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                        {action.pending ? '创建中…' : '创建'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RenameDialog({ kind, action }: { kind: 'Flow' | '文件夹'; action: RenameAction }) {
    return (
        <Dialog open={action.open} onOpenChange={action.onOpenChange}>
            <DialogContent style={{ maxWidth: '420px' }}>
                <DialogHeader>
                    <DialogTitle>重命名 {kind}</DialogTitle>
                    <DialogDescription>将{kind === 'Flow' ? '' : '文件夹'}「{action.originalName}」重命名为：</DialogDescription>
                </DialogHeader>
                <div className="dialog-body" style={{ marginTop: 12 }}>
                    <Input
                        value={action.name}
                        onChange={(event) => action.onNameChange(event.target.value)}
                        placeholder="输入新名称"
                        autoFocus
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && action.name.trim()) action.onSubmit();
                        }}
                    />
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" size="sm" onClick={() => action.onOpenChange(false)} disabled={action.pending}>取消</Button>
                    <Button type="button" variant="default" size="sm" onClick={action.onSubmit} disabled={!action.name.trim() || action.pending}>
                        {action.pending ? <LoaderCircle size={14} className="offline-spin" /> : null}
                        {action.pending ? '重命名中…' : '重命名'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function OfflineTreeActionDialogs({
    repoTree,
    canWrite,
    createFlow,
    createFolder,
    deleteFlow,
    deleteFolder,
    renameFlow,
    renameFolder,
    contextMenu,
}: OfflineTreeActionDialogsProps) {
    const node = contextMenu.node;

    return (
        <>
            <CreateDialog kind="Flow" action={createFlow} repoTree={repoTree} />
            <CreateDialog kind="文件夹" action={createFolder} repoTree={repoTree} />

            <ConfirmDialog
                open={deleteFlow.open}
                onOpenChange={(open) => { if (!deleteFlow.pending) deleteFlow.onOpenChange(open); }}
                title="确认删除 Flow"
                description={`确定要删除 Flow「${deleteFlow.name}」吗？此操作不可恢复。`}
                confirmText="删除"
                cancelText="取消"
                variant="destructive"
                icon="warning"
                isLoading={deleteFlow.pending}
                onConfirm={deleteFlow.onSubmit}
            />
            <ConfirmDialog
                open={deleteFolder.open}
                onOpenChange={(open) => { if (!deleteFolder.pending) deleteFolder.onOpenChange(open); }}
                title="确认删除文件夹"
                description={`确定要删除文件夹「${deleteFolder.name}」吗？其下所有内容都将被物理删除，此操作不可恢复。`}
                confirmText="删除"
                cancelText="取消"
                variant="destructive"
                icon="warning"
                isLoading={deleteFolder.pending}
                onConfirm={deleteFolder.onSubmit}
            />

            <RenameDialog kind="文件夹" action={renameFolder} />
            <RenameDialog kind="Flow" action={renameFlow} />

            {contextMenu.open && contextMenu.position ? (
                <div
                    className="offline-context-menu"
                    style={{ position: 'fixed', left: contextMenu.position.x, top: contextMenu.position.y }}
                    onClick={(event) => event.stopPropagation()}
                >
                    {(node?.kind === 'DIRECTORY' || node?.kind === 'ROOT') && canWrite ? (
                        <>
                            <button type="button" className="offline-context-menu-item" onClick={() => contextMenu.onOpenNewFlow(node)}>
                                <FileCode2 size={13} />新建 Flow
                            </button>
                            <button type="button" className="offline-context-menu-item" onClick={() => contextMenu.onOpenNewFolder(node)}>
                                <FolderPlus size={13} />新建文件夹
                            </button>
                            {node.kind === 'DIRECTORY' ? (
                                <>
                                    <div className="offline-context-menu-separator" />
                                    <button type="button" className="offline-context-menu-item" onClick={() => contextMenu.onOpenRenameFolder(node)}>
                                        <Pencil size={13} />重命名
                                    </button>
                                    <button type="button" className="offline-context-menu-item danger" onClick={() => contextMenu.onOpenDeleteFolder(node)}>
                                        <Trash2 size={13} />删除
                                    </button>
                                </>
                            ) : null}
                        </>
                    ) : null}
                    {node?.kind === 'FLOW' && canWrite ? (
                        <>
                            <button type="button" className="offline-context-menu-item" onClick={() => contextMenu.onOpenRenameFlow(node)}>
                                <Pencil size={13} />重命名
                            </button>
                            <button type="button" className="offline-context-menu-item danger" onClick={() => contextMenu.onOpenDeleteFlow(node)}>
                                <Trash2 size={13} />删除
                            </button>
                        </>
                    ) : null}
                </div>
            ) : null}

            {contextMenu.open ? (
                <div
                    className="offline-context-menu-backdrop"
                    onClick={() => contextMenu.onOpenChange(false)}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        contextMenu.onOpenChange(false);
                    }}
                />
            ) : null}
        </>
    );
}
