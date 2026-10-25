import type { OfflineFlowDocument, OfflineRepoTreeNode } from '../../api/offline';

const FLOWS_PREFIX = '_flows/';
const FLOW_FILE_SUFFIX = '/flow.yaml';

export const RECENT_FLOWS_DIR_NAME = '最近操作';
export const RECENT_FLOWS_DIR_PATH = `${RECENT_FLOWS_DIR_NAME}/`;
export const MAX_RECENT_FLOWS = 5;

function stripFlowsPrefix(path: string): string {
    return path.startsWith(FLOWS_PREFIX) ? path.slice(FLOWS_PREFIX.length) : path;
}

export function isRecentFlowsTreePath(treePath: string): boolean {
    return treePath === RECENT_FLOWS_DIR_PATH || treePath.startsWith(RECENT_FLOWS_DIR_PATH);
}

export function getAncestorDirectoryTreePaths(treePath: string): string[] {
    const segments = treePath.replace(/\/+$/, '').split('/').filter(Boolean);
    const ancestors: string[] = [];
    for (let index = 0; index < segments.length - 1; index += 1) {
        ancestors.push(`${segments.slice(0, index + 1).join('/')}/`);
    }
    return ancestors;
}

export function prependRecentFlowPath(
    recentFlowPaths: readonly string[] | undefined,
    flowPath: string,
): string[] {
    const current = recentFlowPaths ?? [];
    if (
        current[0] === flowPath
        && current.length <= MAX_RECENT_FLOWS
        && current.indexOf(flowPath, 1) === -1
    ) {
        return current as string[];
    }
    return [flowPath, ...current.filter((item) => item !== flowPath)].slice(0, MAX_RECENT_FLOWS);
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

export function indexNodesByTreePath(
    root: OfflineRepoTreeNode,
    recentFlowPaths?: readonly string[],
): Map<string, OfflineRepoTreeNode> {
    const index = new Map<string, OfflineRepoTreeNode>();
    const walk = (node: OfflineRepoTreeNode) => {
        node.children.forEach((child) => {
            index.set(toTreePath(child), child);
            walk(child);
        });
    };
    walk(root);
    if (recentFlowPaths && recentFlowPaths.length > 0) {
        recentFlowPaths.slice(0, MAX_RECENT_FLOWS).forEach((apiPath) => {
            const node = index.get(flowApiPathToTreePath(apiPath));
            if (node?.kind === 'FLOW') {
                const recentTreePath = `${RECENT_FLOWS_DIR_PATH}${node.name}`;
                if (!index.has(recentTreePath)) {
                    index.set(recentTreePath, node);
                }
            }
        });
    }
    return index;
}

export function buildRepoTreeEntries(
    root: OfflineRepoTreeNode,
    options?: {
        directoriesOnly?: boolean;
        recentFlowPaths?: readonly string[];
    },
): { paths: string[]; nodeIndex: Map<string, OfflineRepoTreeNode> } {
    const directoriesOnly = options?.directoriesOnly ?? false;
    const allPaths = flattenRepoTreePaths(root);
    if (directoriesOnly) {
        return {
            paths: allPaths.filter(isDirectoryTreePath),
            nodeIndex: indexNodesByTreePath(root),
        };
    }
    const nodeIndex = indexNodesByTreePath(root);
    const recentItemPaths: string[] = [];
    (options?.recentFlowPaths ?? []).slice(0, MAX_RECENT_FLOWS).forEach((apiPath) => {
        const node = nodeIndex.get(flowApiPathToTreePath(apiPath));
        if (node?.kind === 'FLOW') {
            const recentTreePath = `${RECENT_FLOWS_DIR_PATH}${node.name}`;
            if (!nodeIndex.has(recentTreePath)) {
                nodeIndex.set(recentTreePath, node);
                recentItemPaths.push(recentTreePath);
            }
        }
    });
    return {
        paths: [RECENT_FLOWS_DIR_PATH, ...recentItemPaths, ...allPaths],
        nodeIndex,
    };
}

export function updateRepoTreeFlowStatus(root: OfflineRepoTreeNode, document: OfflineFlowDocument): OfflineRepoTreeNode {
    if (root.kind === 'FLOW' && root.path === document.path) {
        const scheduleState = document.schedule ? document.schedule.enabled ? 'ENABLED' : 'DISABLED' : 'NONE';
        const schedulePeriod = document.schedule?.period ?? null;
        const dependencyCount = document.dependencyConfig?.dependencies.length ?? 0;
        if (root.scheduleState === scheduleState && root.schedulePeriod === schedulePeriod && root.dependencyCount === dependencyCount) return root;
        return { ...root, scheduleState, schedulePeriod, dependencyCount };
    }
    const children = root.children.map((child) => updateRepoTreeFlowStatus(child, document));
    return children.some((child, index) => child !== root.children[index]) ? { ...root, children } : root;
}
