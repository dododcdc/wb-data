import type { OfflineRepoTreeNode } from '../../api/offline';

const FLOWS_PREFIX = '_flows/';
const FLOW_FILE_SUFFIX = '/flow.yaml';

function stripFlowsPrefix(path: string): string {
    return path.startsWith(FLOWS_PREFIX) ? path.slice(FLOWS_PREFIX.length) : path;
}

export function toTreePath(node: OfflineRepoTreeNode): string {
    if (node.kind === 'FLOW') {
        return stripFlowsPrefix(node.path.endsWith(FLOW_FILE_SUFFIX)
            ? node.path.slice(0, -FLOW_FILE_SUFFIX.length)
            : node.path);
    }
    return `${stripFlowsPrefix(node.path)}/`;
}

export function isDirectoryTreePath(treePath: string): boolean {
    return treePath.endsWith('/');
}

export function treePathToFlowApiPath(treePath: string): string {
    return `${FLOWS_PREFIX}${treePath}${FLOW_FILE_SUFFIX}`;
}

export function treePathToFolderApiPath(treePath: string): string {
    return `${FLOWS_PREFIX}${treePath.replace(/\/+$/, '')}`;
}

export function flowApiPathToTreePath(apiPath: string): string {
    const stripped = apiPath.endsWith(FLOW_FILE_SUFFIX)
        ? apiPath.slice(0, -FLOW_FILE_SUFFIX.length)
        : apiPath;
    return stripFlowsPrefix(stripped);
}

export function moveTreePath(sourcePath: string, targetDirPath: string | null): string {
    const directory = isDirectoryTreePath(sourcePath);
    const trimmed = sourcePath.replace(/\/+$/, '');
    const basename = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    const targetPrefix = targetDirPath ?? '';
    return `${targetPrefix}${basename}${directory ? '/' : ''}`;
}

export function flattenRepoTreePaths(root: OfflineRepoTreeNode): string[] {
    const paths: string[] = [];
    const walk = (node: OfflineRepoTreeNode) => {
        node.children.forEach((child) => {
            paths.push(toTreePath(child));
            walk(child);
        });
    };
    walk(root);
    return paths;
}

export function indexNodesByTreePath(root: OfflineRepoTreeNode): Map<string, OfflineRepoTreeNode> {
    const index = new Map<string, OfflineRepoTreeNode>();
    const walk = (node: OfflineRepoTreeNode) => {
        node.children.forEach((child) => {
            index.set(toTreePath(child), child);
            walk(child);
        });
    };
    walk(root);
    return index;
}
