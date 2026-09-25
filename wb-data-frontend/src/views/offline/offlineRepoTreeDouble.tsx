import { forwardRef, useImperativeHandle } from 'react';

import type { OfflineRepoTreeNode } from '../../api/offline';
import { toTreePath } from './repoTreePaths';

interface OfflineRepoTreeDoubleProps {
    root: OfflineRepoTreeNode;
    onOpenFlow: (apiPath: string) => void;
    onContextMenu: (treePath: string, position: { x: number; y: number }) => void;
}

function Branch({ node, props }: { node: OfflineRepoTreeNode; props: OfflineRepoTreeDoubleProps }) {
    return (
        <div>
            <button
                type="button"
                onClick={() => {
                    if (node.kind === 'FLOW') {
                        props.onOpenFlow(node.path);
                    }
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    props.onContextMenu(toTreePath(node), { x: event.clientX, y: event.clientY });
                }}
            >
                {node.name}
            </button>
            {node.children.map((child) => <Branch key={child.id} node={child} props={props} />)}
        </div>
    );
}

export const OfflineRepoTree = forwardRef<unknown, OfflineRepoTreeDoubleProps>(
    function OfflineRepoTreeDouble(props, ref) {
        useImperativeHandle(ref, () => ({ expandAll: () => undefined }));
        return (
            <div>
                {props.root.children.map((child) => <Branch key={child.id} node={child} props={props} />)}
            </div>
        );
    },
);
