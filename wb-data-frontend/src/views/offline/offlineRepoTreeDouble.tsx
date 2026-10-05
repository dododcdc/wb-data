import { forwardRef, useImperativeHandle, useState, type ComponentPropsWithoutRef } from 'react';

import type { OfflineRepoTree as RepoTree, OfflineRepoTreeHandle } from './OfflineRepoTree';
import { indexNodesByTreePath } from './repoTreePaths';

type OfflineRepoTreeDoubleProps = ComponentPropsWithoutRef<typeof RepoTree>;

export const OfflineRepoTree = forwardRef<OfflineRepoTreeHandle, OfflineRepoTreeDoubleProps>(
    function OfflineRepoTreeDouble(props, ref) {
        const [search, setSearch] = useState<string | null>(null);
        useImperativeHandle(ref, () => ({ expandAll: () => undefined, setSearch }));
        const nodes = [...indexNodesByTreePath(props.root)].filter(([path, node]) => (
            (!props.directoriesOnly || node.kind === 'DIRECTORY')
            && (!search || path.toLowerCase().includes(search.toLowerCase()))
        ));
        return (
            <div>
                {search && nodes.length === 0 ? <p role="status">没有匹配的目录</p> : null}
                {nodes.map(([path, node]) => (
                    <button
                        key={path}
                        type="button"
                        onClick={() => {
                            if (node.kind === 'FLOW') props.onOpenFlow?.(node.path);
                            else props.onSelectDirectory?.(path);
                        }}
                        onContextMenu={(event) => {
                            event.preventDefault();
                            if (!props.readonly) props.onContextMenu?.(path, { x: event.clientX, y: event.clientY });
                        }}
                    >
                        {node.name}
                    </button>
                ))}
            </div>
        );
    },
);
