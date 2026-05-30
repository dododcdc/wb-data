# Dirty Flow Tree Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small dot on offline repo-tree Flow nodes whenever that path has a persisted recovery snapshot for the current group.

**Architecture:** Keep `localStorage` recovery snapshots as the source of truth and add an in-memory `Set<string>` cache in `OfflineWorkbench` for fast tree lookups. Export the existing snapshot-path listing helper from `recoverySnapshotStore.ts`, render the dot in `RepoTreeBranch`, and synchronize the set anywhere snapshots are created, removed, or moved.

**Tech Stack:** React 18, TypeScript, Vitest, `@testing-library/react`, existing offline workbench state and recovery snapshot helpers

---

## File map

- Modify: `wb-data-frontend/src/views/offline/recoverySnapshotStore.ts:121-139`
- Modify: `wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts:1-120`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:367-448`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:792-808`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1054-1067`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1256-1365`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1908-1925`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:2138-2188`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:2335-2344`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css:282-288`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx:1-620`

## Notes before coding

- Only persisted recovery snapshots count. Do not add tree dots for in-memory-only unsaved edits.
- `OfflineWorkbench.tsx` is already large. Prefer a few small pure helper functions for `Set<string>` path updates instead of scattering ad-hoc `new Set(...)` logic throughout the file.
- The existing `OfflineWorkbench.test.tsx` already mocks auth, repo tree, and flow loading. Reuse that harness instead of creating a second integration test file.
- Verification target for this feature is `npx vitest run ...`, `npm test`, and `npm run build`. Repo-wide lint is still not a clean gate.

### Task 1: Export recovery snapshot path listing

**Files:**
- Modify: `wb-data-frontend/src/views/offline/recoverySnapshotStore.ts:121-139`
- Modify: `wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts:1-120`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listRecoverySnapshotPaths, writeRecoverySnapshot } from './recoverySnapshotStore';
import type { RecoverySnapshot } from './recoverySnapshotStore';

function makeSnapshot(path = 'test/flow.yml', groupId = 1): RecoverySnapshot {
    return {
        document: {
            groupId,
            path,
            flowId: 'flow-id',
            namespace: 'ns',
            documentHash: 'abc',
            documentUpdatedAt: 1000,
            stages: [],
            edges: [],
            layout: {},
        } as never,
        baseDocumentHash: 'abc',
        baseDocumentUpdatedAt: 1000,
        selectedNodeId: null,
        selectedTaskIds: [],
        updatedAt: 1000,
    };
}

it('lists only recovery snapshot paths for the requested group', () => {
    writeRecoverySnapshot(1, '_flows/a/flow.yaml', makeSnapshot('_flows/a/flow.yaml', 1));
    writeRecoverySnapshot(2, '_flows/b/flow.yaml', makeSnapshot('_flows/b/flow.yaml', 2));

    expect(listRecoverySnapshotPaths(1)).toEqual(['_flows/a/flow.yaml']);
    expect(listRecoverySnapshotPaths(2)).toEqual(['_flows/b/flow.yaml']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wb-data-frontend && npx vitest run src/views/offline/recoverySnapshotStore.test.ts -t "lists only recovery snapshot paths for the requested group"`

Expected: FAIL with an import/export error because `listRecoverySnapshotPaths` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function listRecoverySnapshotPaths(groupId: number) {
    const prefix = buildRecoverySnapshotPrefix(groupId);
    const storage = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;

    if (storage && typeof storage.key === 'function' && typeof storage.length === 'number') {
        const paths: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(prefix)) {
                paths.push(key.slice(prefix.length));
            }
        }
        return paths;
    }

    return Array.from(memoryStorage.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd wb-data-frontend && npx vitest run src/views/offline/recoverySnapshotStore.test.ts -t "lists only recovery snapshot paths for the requested group"`

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/recoverySnapshotStore.ts \
        wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts
git commit -m "test: export recovery snapshot path listing"
```

### Task 2: Render tree dots from persisted recovery snapshots

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:367-448`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:792-808`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:2335-2344`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css:282-288`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx:1-320`

- [ ] **Step 1: Write the failing test**

```tsx
it('shows a tree dirty dot for flows with persisted recovery snapshots', async () => {
    writeRecoverySnapshot(1, '_flows/example/flow.yaml', makeRecoverySnapshot());

    const { container } = render(
        <MemoryRouter>
            <OfflineWorkbench />
        </MemoryRouter>,
    );

    const flowButton = await screen.findByRole('button', { name: 'Example Flow' });
    expect(flowButton).toBeTruthy();
    expect(container.querySelector('.offline-tree-dirty-dot')).not.toBeNull();
});

it('rebuilds tree dirty dots when the active group changes', async () => {
    writeRecoverySnapshot(1, '_flows/example/flow.yaml', makeRecoverySnapshot());

    const { container } = render(
        <MemoryRouter>
            <OfflineWorkbench />
        </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Example Flow' });
    expect(container.querySelector('.offline-tree-dirty-dot')).not.toBeNull();

    setCurrentGroup({ id: 2, name: 'Ops' });

    await waitFor(() => {
        expect(container.querySelector('.offline-tree-dirty-dot')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wb-data-frontend && npx vitest run src/views/offline/OfflineWorkbench.test.tsx -t "shows a tree dirty dot for flows with persisted recovery snapshots"`

Expected: FAIL because no tree dirty-dot is rendered yet and `dirtyFlowPaths` is not rebuilt from recovery snapshots.

- [ ] **Step 3: Write minimal implementation**

```ts
interface RepoTreeBranchProps {
    node: OfflineRepoTreeNode;
    depth: number;
    activeFlowPath: string | null;
    dirtyFlowPaths: Set<string>;
    expandedIds: string[];
    onToggle: (nodeId: string) => void;
    onOpenFlow: (path: string) => void;
    onContextMenu: (event: React.MouseEvent, node: OfflineRepoTreeNode) => void;
}

const [dirtyFlowPaths, setDirtyFlowPaths] = useState<Set<string>>(new Set());

useEffect(() => {
    setDirtyFlowPaths(groupId ? new Set(listRecoverySnapshotPaths(groupId)) : new Set());
}, [groupId]);

if (node.kind === 'FLOW') {
    const hasDirtyDraft = dirtyFlowPaths.has(node.path);
    return (
        <button
            type="button"
            className={`offline-tree-row is-flow${node.path === activeFlowPath ? ' is-active' : ''}`}
            style={indentStyle}
            onClick={() => onOpenFlow(node.path)}
            onContextMenu={(e) => onContextMenu(e, node)}
        >
            <span className="offline-tree-row-icon">
                <FileCode2 size={14} />
            </span>
            <span className="offline-tree-row-label">{node.name}</span>
            {hasDirtyDraft ? <span className="offline-tree-dirty-dot" aria-hidden="true" /> : null}
        </button>
    );
}
```

```tsx
<RepoTreeBranch
    key={child.id}
    node={child}
    depth={1}
    activeFlowPath={activeFlowPath}
    dirtyFlowPaths={dirtyFlowPaths}
    expandedIds={expandedTreeIds}
    onToggle={handleToggleTreeNode}
    onOpenFlow={(path) => void openFlowDocument(path)}
    onContextMenu={handleContextMenu}
/>
```

```css
.offline-tree-row-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.84rem;
}

.offline-tree-dirty-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--color-accent);
    opacity: 0.92;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd wb-data-frontend && npx vitest run src/views/offline/OfflineWorkbench.test.tsx -t "shows a tree dirty dot for flows with persisted recovery snapshots"`

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.css \
        wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "feat: render dirty flow tree markers"
```

### Task 3: Keep the dirty-dot cache synchronized with snapshot lifecycle

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1054-1067`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1256-1365`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1908-1925`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:2138-2188`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx:235-620`

- [ ] **Step 1: Write the failing tests**

```tsx
it('clears the tree dirty dot after a successful save removes the recovery snapshot', async () => {
    const offlineApi = await import('../../api/offline');
    vi.mocked(offlineApi.saveOfflineFlowDocument).mockResolvedValue(makeFlowDocument({
        documentHash: 'saved-hash',
        documentUpdatedAt: 200,
    }));
    writeRecoverySnapshot(1, '_flows/example/flow.yaml', makeRecoverySnapshot());

    const { container } = render(
        <MemoryRouter>
            <OfflineWorkbench />
        </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
    await screen.findByTestId('flow-canvas');
    fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
        expect(container.querySelector('.offline-tree-dirty-dot')).toBeNull();
    });
});

it('adds the tree dirty dot when a save conflict writes a recovery snapshot', async () => {
    const offlineApi = await import('../../api/offline');
    const conflictError = new AxiosError('Conflict');
    conflictError.response = {
        status: 409,
        statusText: 'Conflict',
        data: {},
        headers: {},
        config: { headers: {} as never },
    };
    vi.mocked(offlineApi.saveOfflineFlowDocument).mockRejectedValue(conflictError);

    const { container } = render(
        <MemoryRouter>
            <OfflineWorkbench />
        </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
    await screen.findByTestId('flow-canvas');
    fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
    fireEvent.click(screen.getByRole('button', { name: '提交' }));

    await waitFor(() => {
        expect(container.querySelector('.offline-tree-dirty-dot')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wb-data-frontend && npx vitest run src/views/offline/OfflineWorkbench.test.tsx -t "clears the tree dirty dot after a successful save removes the recovery snapshot|adds the tree dirty dot when a save conflict writes a recovery snapshot"`

Expected: FAIL because `dirtyFlowPaths` is not yet updated during save success or 409-driven snapshot writes.

- [ ] **Step 3: Write minimal implementation**

```ts
function addDirtyFlowPath(current: Set<string>, path: string) {
    const next = new Set(current);
    next.add(path);
    return next;
}

function removeDirtyFlowPath(current: Set<string>, path: string) {
    if (!current.has(path)) return current;
    const next = new Set(current);
    next.delete(path);
    return next;
}

function moveDirtyFlowPath(current: Set<string>, oldPath: string, newPath: string) {
    if (!current.has(oldPath)) return current;
    const next = new Set(current);
    next.delete(oldPath);
    next.add(newPath);
    return next;
}

function moveDirtyFolderPaths(current: Set<string>, oldPrefix: string, newPrefix: string) {
    let changed = false;
    const next = new Set<string>();
    current.forEach((path) => {
        if (path.startsWith(`${oldPrefix}/`)) {
            next.add(path.replace(oldPrefix, newPrefix));
            changed = true;
        } else {
            next.add(path);
        }
    });
    return changed ? next : current;
}
```

```ts
if (result.snapshot) {
    writeRecoverySnapshot(groupIdValue, session.path, result.snapshot);
    setDirtyFlowPaths((current) => addDirtyFlowPath(current, session.path));
} else if (session.conflict) {
    writeRecoverySnapshot(groupIdValue, session.path, session.conflict.snapshot);
    setDirtyFlowPaths((current) => addDirtyFlowPath(current, session.path));
} else {
    removeRecoverySnapshot(groupIdValue, session.path);
    setDirtyFlowPaths((current) => removeDirtyFlowPath(current, session.path));
}
```

```ts
removeRecoverySnapshot(groupId, sessionForSave.path);
setDirtyFlowPaths((current) => removeDirtyFlowPath(current, sessionForSave.path));
```

```ts
writeRecoverySnapshot(groupId, sessionForSave.path, buildRecoverySnapshotFromSession(sessionForSave, Date.now()));
setDirtyFlowPaths((current) => addDirtyFlowPath(current, sessionForSave.path));
```

```ts
removeRecoverySnapshot(groupId, deleteFlowPath);
setDirtyFlowPaths((current) => removeDirtyFlowPath(current, deleteFlowPath));
```

```ts
moveRecoverySnapshot(groupId, oldPath, newPath);
setDirtyFlowPaths((current) => moveDirtyFlowPath(current, oldPath, newPath));
```

```ts
removeFolderRecoverySnapshots(groupId, deleteFolderPath);
setDirtyFlowPaths((current) => {
    const next = new Set(current);
    Array.from(next).forEach((path) => {
        if (path.startsWith(`${deleteFolderPath}/`)) {
            next.delete(path);
        }
    });
    return next;
});
```

```ts
moveFolderRecoverySnapshots(groupId, oldPath, newPath);
setDirtyFlowPaths((current) => moveDirtyFolderPaths(current, oldPath, newPath));
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
cd wb-data-frontend
npx vitest run src/views/offline/recoverySnapshotStore.test.ts
npx vitest run src/views/offline/OfflineWorkbench.test.tsx
npm test
npm run build
```

Expected:

- targeted snapshot-store test: PASS
- targeted OfflineWorkbench test: PASS
- `npm test`: PASS
- `npm run build`: PASS

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "feat: sync dirty flow tree markers"
```

### Task 4: Final regression sweep

**Files:**
- Modify if needed: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify if needed: `wb-data-frontend/src/views/offline/OfflineWorkbench.css`
- Modify if needed: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`

- [ ] **Step 1: Manually verify the marker lifecycle**

Run:

1. Open the offline workbench.
2. Open one Flow, make a change, switch to another Flow so the first Flow writes a recovery snapshot.
3. Confirm the first Flow now shows a tree dirty dot.
4. Re-open the first Flow and click **保存**.
5. Confirm the tree dirty dot disappears immediately after save success.

Expected: the tree marker follows persisted snapshot existence, not current in-memory edit state.

- [ ] **Step 2: Manually verify rename/delete behavior**

Run:

1. Create or reuse a Flow that already has a recovery snapshot.
2. Rename that Flow and confirm the dot moves to the renamed path.
3. Repeat for a folder containing a dirty Flow and confirm the nested marker follows the moved path.
4. Delete a dirty Flow or dirty folder and confirm the dot disappears with the deleted node.

Expected: tree markers stay synchronized with snapshot move/remove operations.

- [ ] **Step 3: Commit any regression fixes**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.css \
        wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx \
        wb-data-frontend/src/views/offline/recoverySnapshotStore.ts \
        wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts
git commit -m "fix: polish dirty flow tree indicator"
```
