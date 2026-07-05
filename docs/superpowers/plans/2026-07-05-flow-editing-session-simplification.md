# Flow Editing Session Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Flow editing rules out of `OfflineWorkbench` into tested pure document operations and a deeper Flow editing session hook without changing user behavior.

**Architecture:** Extract in-process document mutations first, then move stateful editing workflow into `useFlowEditingSession` in small commits. `OfflineWorkbench` remains the page composition layer and keeps rendering decisions, while the new hook owns draft state, pending node editor drafts, recovery snapshots, save conflicts, and current Flow commit orchestration.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, React Testing Library, Spring Boot 3, Maven.

---

## File Structure

- Create `wb-data-frontend/src/views/offline/flowDocumentMutations.ts`
  - Pure Flow document operations: add node, rename node, apply canvas nodes, apply canvas edges, apply layout, validate graph constraints.

- Create `wb-data-frontend/src/views/offline/flowDocumentMutations.test.ts`
  - Pure unit tests for graph, layout, and selection rules.

- Create `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
  - Stateful hook for active Flow path, draft session, node editor draft lifecycle, recovery snapshots, save, conflict handling, and current Flow commit.

- Create `wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts`
  - Hook tests for open, leave, save, conflict, and commit workflows.

- Modify `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
  - Replace inline document mutation and editing session workflow with module calls.

- Modify `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`
  - Keep user-facing integration tests for schedule-save-commit-push, branch switch, current Flow commit, and repo commit.

- Read-only reference files:
  - `wb-data-frontend/src/views/offline/flowDraftController.ts`
  - `wb-data-frontend/src/views/offline/flowCanvasState.ts`
  - `wb-data-frontend/src/views/offline/pendingNodeEditorDraftState.ts`
  - `wb-data-frontend/src/views/offline/nodeEditorCloseDraftState.ts`
  - `wb-data-frontend/src/views/offline/nodeEditorDataSourceRules.ts`
  - `wb-data-frontend/src/views/offline/offlineNodeKinds.ts`
  - `wb-data-frontend/src/views/offline/recoverySnapshotStore.ts`

## Baseline Commands

Run before implementation:

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/flow-editing-session-simplification/wb-data-frontend
npm run test -- --run src/views/offline/flowDraftController.test.ts src/views/offline/OfflineWorkbench.test.tsx src/views/offline/useOfflineRepositoryWorkflow.test.ts src/views/offline/useOfflineTreeMutations.test.ts src/views/offline/useFlowExecutionAndSchedule.test.ts
```

Expected: 5 files, 36 tests pass.

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/flow-editing-session-simplification/wb-data-server
mvn -pl wb-data-backend -Dtest=OfflineFlowDocumentServiceTest,OfflineScheduleServiceTest,GitCommandServiceTest,GitCommandServiceBranchTest,OfflineExecutionServiceBranchTest test
```

Expected: 24 tests pass.

## Task 1: Extract Pure Flow Document Mutations

**Files:**
- Create: `wb-data-frontend/src/views/offline/flowDocumentMutations.test.ts`
- Create: `wb-data-frontend/src/views/offline/flowDocumentMutations.ts`

- [ ] **Step 1: Write the failing tests**

Create `wb-data-frontend/src/views/offline/flowDocumentMutations.test.ts` with this structure:

```ts
import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { OfflineFlowDocument } from '../../api/offline';
import {
    addFlowNode,
    applyFlowCanvasEdges,
    applyFlowCanvasLayout,
    applyFlowCanvasNodes,
    renameFlowNode,
    validateFlowDocumentGraph,
} from './flowDocumentMutations';

function makeDocument(overrides: Partial<OfflineFlowDocument> = {}): OfflineFlowDocument {
    return {
        groupId: 1,
        path: '_flows/jack/demo/flow.yaml',
        flowId: 'demo',
        namespace: 'pg-1',
        stages: [
            {
                stageId: 'main',
                parallel: false,
                nodes: [
                    {
                        taskId: 'shell_node_1',
                        kind: 'SHELL',
                        scriptPath: 'scripts/jack/demo/shell_node_1.sh',
                        scriptContent: 'echo one',
                    },
                    {
                        taskId: 'shell_node_2',
                        kind: 'SHELL',
                        scriptPath: 'scripts/jack/demo/shell_node_2.sh',
                        scriptContent: 'echo two',
                    },
                ],
            },
        ],
        edges: [{ source: 'shell_node_1', target: 'shell_node_2' }],
        layout: {
            shell_node_1: { x: 10, y: 20 },
            shell_node_2: { x: 120, y: 20 },
        },
        content: '',
        documentHash: 'hash',
        documentUpdatedAt: 1,
        schedule: {
            cron: '* * * * *',
            timezone: 'Asia/Singapore',
            enabled: true,
        },
        ...overrides,
    };
}

describe('flowDocumentMutations', () => {
    it('renames a node across node id, script path, edges, layout, and selection', () => {
        const result = renameFlowNode({
            document: makeDocument(),
            oldId: 'shell_node_1',
            newId: 'renamed_node',
            activeNodeId: 'shell_node_1',
            selectedTaskIds: ['shell_node_1', 'shell_node_2'],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.document.stages[0].nodes[0]).toMatchObject({
            taskId: 'renamed_node',
            scriptPath: 'scripts/jack/demo/renamed_node.sh',
        });
        expect(result.document.edges).toEqual([{ source: 'renamed_node', target: 'shell_node_2' }]);
        expect(result.document.layout).toEqual({
            renamed_node: { x: 10, y: 20 },
            shell_node_2: { x: 120, y: 20 },
        });
        expect(result.nextActiveNodeId).toBe('renamed_node');
        expect(result.nextSelectedTaskIds).toEqual(['renamed_node', 'shell_node_2']);
    });

    it('rejects duplicate and invalid rename targets', () => {
        expect(renameFlowNode({
            document: makeDocument(),
            oldId: 'shell_node_1',
            newId: 'shell_node_2',
            activeNodeId: 'shell_node_1',
            selectedTaskIds: [],
        })).toMatchObject({ ok: false, reason: 'duplicate' });

        expect(renameFlowNode({
            document: makeDocument(),
            oldId: 'shell_node_1',
            newId: 'bad-name',
            activeNodeId: 'shell_node_1',
            selectedTaskIds: [],
        })).toMatchObject({ ok: false, reason: 'invalid-format' });
    });

    it('adds a node with predictable id, script path, layout, and selection', () => {
        const result = addFlowNode({
            document: makeDocument(),
            kind: 'SHELL',
            position: { x: 300, y: 40 },
            selectedTaskIds: ['shell_node_1'],
            maxNodes: 20,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.newTaskId).toBe('shell_node_3');
        expect(result.document.stages[0].nodes[2]).toMatchObject({
            taskId: 'shell_node_3',
            kind: 'SHELL',
            scriptPath: 'scripts/jack/demo/shell_node_3.sh',
        });
        expect(result.document.layout.shell_node_3).toEqual({ x: 300, y: 40 });
        expect(result.nextActiveNodeId).toBe('shell_node_3');
        expect(result.nextSelectedTaskIds).toEqual(['shell_node_3']);
    });

    it('applies canvas node removals and reconciles selected ids', () => {
        const nodes: Node[] = [
            { id: 'shell_node_2', position: { x: 120, y: 20 }, data: {}, type: 'default' },
        ];
        const edges: Edge[] = [];
        const result = applyFlowCanvasNodes({
            document: makeDocument(),
            nodes,
            edges,
            activeNodeId: 'shell_node_1',
            selectedTaskIds: ['shell_node_1', 'shell_node_2'],
        });

        expect(result.document.stages[0].nodes.map((node) => node.taskId)).toEqual(['shell_node_2']);
        expect(result.nextActiveNodeId).toBeNull();
        expect(result.nextSelectedTaskIds).toEqual(['shell_node_2']);
    });

    it('applies sorted canvas edges and layout changes', () => {
        const document = makeDocument();
        const nextEdges = applyFlowCanvasEdges(document, [
            { id: 'b->a', source: 'shell_node_2', target: 'shell_node_1' },
        ] as Edge[]);
        expect(nextEdges.edges).toEqual([{ source: 'shell_node_2', target: 'shell_node_1' }]);

        const nextLayout = applyFlowCanvasLayout(document, [
            { id: 'shell_node_1', position: { x: 11, y: 22 }, data: {}, type: 'default' },
            { id: 'shell_node_2', position: { x: 33, y: 44 }, data: {}, type: 'default' },
        ]);
        expect(nextLayout.layout).toEqual({
            shell_node_1: { x: 11, y: 22 },
            shell_node_2: { x: 33, y: 44 },
        });
    });

    it('validates cycles and disconnected graphs before save', () => {
        expect(validateFlowDocumentGraph({
            ...makeDocument(),
            edges: [
                { source: 'shell_node_1', target: 'shell_node_2' },
                { source: 'shell_node_2', target: 'shell_node_1' },
            ],
        })).toEqual({ valid: false, reason: 'cycle' });

        expect(validateFlowDocumentGraph({
            ...makeDocument(),
            edges: [],
        })).toEqual({ valid: false, reason: 'disconnected' });

        expect(validateFlowDocumentGraph(makeDocument())).toEqual({ valid: true });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/flowDocumentMutations.test.ts
```

Expected: fail with import errors because `flowDocumentMutations.ts` does not exist.

- [ ] **Step 3: Add the minimal pure implementation**

Create `wb-data-frontend/src/views/offline/flowDocumentMutations.ts` with these exported functions and types. Reuse `buildEdgesFromCanvasEdges`, `buildLayoutFromCanvasNodes`, and `applyCanvasStateToDocument` from `flowCanvasState`; reuse `getOfflineNodeDefaultScript` and `getOfflineNodeScriptExtension` from `offlineNodeKinds`.

```ts
import type { Edge, Node } from '@xyflow/react';
import type { NodePosition, OfflineFlowDocument, OfflineFlowNode, OfflineFlowNodeKind } from '../../api/offline';
import { buildEdgesFromCanvasEdges, buildLayoutFromCanvasNodes, applyCanvasStateToDocument } from './flowCanvasState';
import { getOfflineNodeDefaultScript, getOfflineNodeScriptExtension } from './offlineNodeKinds';

type RenameFailureReason = 'empty' | 'same' | 'duplicate' | 'invalid-format' | 'missing-node';
type AddNodeFailureReason = 'max-nodes';
type GraphFailureReason = 'cycle' | 'disconnected';

export type RenameFlowNodeResult =
    | { ok: true; document: OfflineFlowDocument; nextActiveNodeId: string | null; nextSelectedTaskIds: string[] }
    | { ok: false; reason: RenameFailureReason };

export type AddFlowNodeResult =
    | { ok: true; document: OfflineFlowDocument; newTaskId: string; nextActiveNodeId: string; nextSelectedTaskIds: string[] }
    | { ok: false; reason: AddNodeFailureReason };

export function flattenFlowDocumentNodes(document: OfflineFlowDocument | null): OfflineFlowNode[] {
    return document?.stages.flatMap((stage) => stage.nodes) ?? [];
}

export function resolveFlowSelectedNodeId(document: OfflineFlowDocument | null, candidate: string | null) {
    if (!candidate) return null;
    return flattenFlowDocumentNodes(document).some((node) => node.taskId === candidate) ? candidate : null;
}

export function resolveFlowSelectedTaskIds(document: OfflineFlowDocument | null, candidates: string[]) {
    const validIds = new Set(flattenFlowDocumentNodes(document).map((node) => node.taskId));
    return candidates.filter((taskId) => validIds.has(taskId));
}

function cloneDocument(document: OfflineFlowDocument): OfflineFlowDocument {
    return {
        ...document,
        stages: document.stages.map((stage) => ({
            ...stage,
            nodes: stage.nodes.map((node) => ({ ...node })),
        })),
        edges: document.edges.map((edge) => ({ ...edge })),
        layout: Object.fromEntries(Object.entries(document.layout).map(([taskId, position]) => [taskId, { ...position }])),
        schedule: document.schedule ? { ...document.schedule } : undefined,
    };
}

export function renameFlowNode(input: {
    document: OfflineFlowDocument;
    oldId: string;
    newId: string;
    activeNodeId: string | null;
    selectedTaskIds: string[];
}): RenameFlowNodeResult {
    const cleanNewId = input.newId.trim();
    if (!input.oldId || !cleanNewId) return { ok: false, reason: 'empty' };
    if (input.oldId === cleanNewId) return { ok: false, reason: 'same' };
    if (!/^[a-zA-Z0-9_]+$/.test(cleanNewId)) return { ok: false, reason: 'invalid-format' };

    const allNodes = flattenFlowDocumentNodes(input.document);
    if (!allNodes.some((node) => node.taskId === input.oldId)) return { ok: false, reason: 'missing-node' };
    if (allNodes.some((node) => node.taskId === cleanNewId)) return { ok: false, reason: 'duplicate' };

    const nextDocument = cloneDocument(input.document);
    nextDocument.stages = nextDocument.stages.map((stage) => ({
        ...stage,
        nodes: stage.nodes.map((node) => {
            if (node.taskId !== input.oldId) return node;
            const oldFileName = `${input.oldId}.`;
            const newFileName = `${cleanNewId}.`;
            return {
                ...node,
                taskId: cleanNewId,
                scriptPath: node.scriptPath.includes(oldFileName)
                    ? node.scriptPath.replace(oldFileName, newFileName)
                    : node.scriptPath,
            };
        }),
    }));
    nextDocument.edges = nextDocument.edges.map((edge) => ({
        source: edge.source === input.oldId ? cleanNewId : edge.source,
        target: edge.target === input.oldId ? cleanNewId : edge.target,
    }));
    if (nextDocument.layout[input.oldId]) {
        nextDocument.layout[cleanNewId] = nextDocument.layout[input.oldId];
        delete nextDocument.layout[input.oldId];
    }

    return {
        ok: true,
        document: nextDocument,
        nextActiveNodeId: input.activeNodeId === input.oldId ? cleanNewId : input.activeNodeId,
        nextSelectedTaskIds: input.selectedTaskIds.map((taskId) => taskId === input.oldId ? cleanNewId : taskId),
    };
}

export function addFlowNode(input: {
    document: OfflineFlowDocument;
    kind: OfflineFlowNodeKind;
    position: NodePosition;
    selectedTaskIds: string[];
    maxNodes: number;
}): AddFlowNodeResult {
    const existingNodes = flattenFlowDocumentNodes(input.document);
    if (existingNodes.length >= input.maxNodes) return { ok: false, reason: 'max-nodes' };

    const existingIds = new Set(existingNodes.map((node) => node.taskId));
    let index = 1;
    let newTaskId = `${input.kind.toLowerCase()}_node_${index}`;
    while (existingIds.has(newTaskId)) {
        index += 1;
        newTaskId = `${input.kind.toLowerCase()}_node_${index}`;
    }

    const ext = getOfflineNodeScriptExtension(input.kind);
    const flowDir = input.document.path.replace('/flow.yaml', '');
    const newNode: OfflineFlowNode = {
        taskId: newTaskId,
        kind: input.kind,
        scriptPath: `${flowDir.replace(/^_flows\//, 'scripts/')}/${newTaskId}.${ext}`,
        scriptContent: getOfflineNodeDefaultScript(input.kind),
    };

    const nextDocument = cloneDocument(input.document);
    if (nextDocument.stages.length === 0) {
        nextDocument.stages = [{ stageId: 'main', parallel: false, nodes: [newNode] }];
    } else {
        nextDocument.stages[0] = {
            ...nextDocument.stages[0],
            nodes: [...nextDocument.stages[0].nodes, newNode],
        };
    }
    nextDocument.layout = {
        ...nextDocument.layout,
        [newTaskId]: input.position,
    };

    return {
        ok: true,
        document: nextDocument,
        newTaskId,
        nextActiveNodeId: newTaskId,
        nextSelectedTaskIds: [newTaskId],
    };
}

export function applyFlowCanvasNodes(input: {
    document: OfflineFlowDocument;
    nodes: Node[];
    edges: Edge[];
    activeNodeId: string | null;
    selectedTaskIds: string[];
}) {
    const document = applyCanvasStateToDocument(input.document, input.nodes, input.edges);
    return {
        document,
        nextActiveNodeId: resolveFlowSelectedNodeId(document, input.activeNodeId),
        nextSelectedTaskIds: resolveFlowSelectedTaskIds(document, input.selectedTaskIds),
    };
}

export function applyFlowCanvasEdges(document: OfflineFlowDocument, edges: Edge[]): OfflineFlowDocument {
    return {
        ...document,
        edges: buildEdgesFromCanvasEdges(edges),
    };
}

export function applyFlowCanvasLayout(document: OfflineFlowDocument, nodes: Node[]): OfflineFlowDocument {
    return {
        ...document,
        layout: buildLayoutFromCanvasNodes(nodes),
    };
}

export type FlowGraphValidation =
    | { valid: true }
    | { valid: false; reason: GraphFailureReason };

export function validateFlowDocumentGraph(document: OfflineFlowDocument): FlowGraphValidation {
    const allNodeIds = flattenFlowDocumentNodes(document).map((node) => node.taskId);
    const nodeSet = new Set(allNodeIds);
    const incoming = new Map<string, number>(allNodeIds.map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>(allNodeIds.map((id) => [id, []]));

    for (const edge of document.edges) {
        if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
        incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
        outgoing.get(edge.source)?.push(edge.target);
    }

    const queue = allNodeIds.filter((id) => (incoming.get(id) ?? 0) === 0);
    let visitedCount = 0;
    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        visitedCount += 1;
        for (const next of outgoing.get(current) ?? []) {
            incoming.set(next, (incoming.get(next) ?? 0) - 1);
            if ((incoming.get(next) ?? 0) === 0) queue.push(next);
        }
    }
    if (visitedCount !== allNodeIds.length) return { valid: false, reason: 'cycle' };

    if (allNodeIds.length > 1) {
        const adjacency = new Map<string, Set<string>>();
        for (const id of allNodeIds) adjacency.set(id, new Set());
        for (const edge of document.edges) {
            adjacency.get(edge.source)?.add(edge.target);
            adjacency.get(edge.target)?.add(edge.source);
        }
        const seen = new Set<string>([allNodeIds[0]]);
        const stack = [allNodeIds[0]];
        while (stack.length > 0) {
            const current = stack.pop()!;
            for (const next of adjacency.get(current) ?? []) {
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        if (seen.size !== allNodeIds.length) return { valid: false, reason: 'disconnected' };
    }

    return { valid: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/flowDocumentMutations.test.ts
```

Expected: `1 passed` test file.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/flowDocumentMutations.ts wb-data-frontend/src/views/offline/flowDocumentMutations.test.ts
git commit -m "test: characterize flow document mutations"
```

## Task 2: Route Canvas Document Changes Through Pure Mutations

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Test: `wb-data-frontend/src/views/offline/flowDocumentMutations.test.ts`
- Test: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`

- [ ] **Step 1: Replace local helper imports**

In `OfflineWorkbench.tsx`, remove imports that are now covered by `flowDocumentMutations`:

```ts
buildEdgesFromCanvasEdges,
buildLayoutFromCanvasNodes,
applyCanvasStateToDocument,
```

Add:

```ts
import {
    addFlowNode,
    applyFlowCanvasEdges,
    applyFlowCanvasLayout,
    applyFlowCanvasNodes,
    flattenFlowDocumentNodes,
    renameFlowNode,
    resolveFlowSelectedNodeId,
    resolveFlowSelectedTaskIds,
    validateFlowDocumentGraph,
} from './flowDocumentMutations';
```

Then remove the local `flattenDocumentNodes`, `resolveSelectedNodeId`, and `resolveSelectedTaskIds` helper functions. Replace usages:

```ts
flattenDocumentNodes(...)
```

with:

```ts
flattenFlowDocumentNodes(...)
```

Replace:

```ts
resolveSelectedNodeId(...)
resolveSelectedTaskIds(...)
```

with:

```ts
resolveFlowSelectedNodeId(...)
resolveFlowSelectedTaskIds(...)
```

- [ ] **Step 2: Replace `handleRenameNode`**

Replace the body of `handleRenameNode` with:

```ts
const handleRenameNode = useCallback((oldId: string, newId: string) => {
    if (!flowDocument) return;
    const result = renameFlowNode({
        document: flowDocument,
        oldId,
        newId,
        activeNodeId,
        selectedTaskIds,
    });

    if (!result.ok) {
        if (result.reason === 'duplicate') {
            showFeedback({ tone: 'error', title: '重命名失败', detail: '已存在相同名称的节点。' });
        } else if (result.reason === 'invalid-format') {
            showFeedback({ tone: 'error', title: '重命名失败', detail: '节点名称仅支持字母、数字和下划线。' });
        }
        return;
    }

    setDraftSession((current) =>
        current ? replaceFlowDraftWorkingDocument(current, result.document) : current,
    );
    setDraftSelectedNodeId(result.nextActiveNodeId);
    setDraftSelectedTaskIds(result.nextSelectedTaskIds);
}, [activeNodeId, flowDocument, selectedTaskIds, setDraftSelectedNodeId, setDraftSelectedTaskIds, showFeedback]);
```

- [ ] **Step 3: Replace `handleAddCanvasNode`**

Replace its draft mutation body with:

```ts
const result = addFlowNode({
    document: flowDocument,
    kind,
    position,
    selectedTaskIds,
    maxNodes: 20,
});
if (!result.ok) {
    showFeedback({ tone: 'info', title: '节点数量已达上限', detail: '离线 Flow 最多支持 20 个节点，请精简流程设计。' });
    return;
}
setDraftSession((current) =>
    current ? replaceFlowDraftWorkingDocument(current, result.document) : current,
);
setDraftSelectedNodeId(result.nextActiveNodeId);
setDraftSelectedTaskIds(result.nextSelectedTaskIds);
```

- [ ] **Step 4: Replace canvas sync logic**

In `handleCanvasNodesChange`, replace:

```ts
const nextDocument = applyCanvasStateToDocument(currentWithPending.workingDraft, nodes, canvasEdgesRef.current);
nextPendingDraft = resolvePendingNodeEditorDraftAfterDocumentChange(pendingDraft, nextDocument);
const nextSelectedNodeId = resolveSelectedNodeId(nextDocument, activeNodeId);
const nextSelectedTaskIds = resolveSelectedTaskIds(nextDocument, selectedTaskIds);
```

with:

```ts
const canvasResult = applyFlowCanvasNodes({
    document: currentWithPending.workingDraft,
    nodes,
    edges: canvasEdgesRef.current,
    activeNodeId,
    selectedTaskIds,
});
const nextDocument = canvasResult.document;
nextPendingDraft = resolvePendingNodeEditorDraftAfterDocumentChange(pendingDraft, nextDocument);
const nextSelectedNodeId = canvasResult.nextActiveNodeId;
const nextSelectedTaskIds = canvasResult.nextSelectedTaskIds;
```

In `handleCanvasEdgesChange`, replace direct edge building with:

```ts
const nextDocument = applyFlowCanvasEdges(current.workingDraft, edges);
if (JSON.stringify(current.workingDraft.edges) === JSON.stringify(nextDocument.edges)) {
    return current;
}
return replaceFlowDraftWorkingDocument(current, nextDocument);
```

In `handleCanvasNodeLayoutCommit`, replace direct layout building with:

```ts
const nextDocument = applyFlowCanvasLayout(current.workingDraft, nodes);
if (JSON.stringify(current.workingDraft.layout) === JSON.stringify(nextDocument.layout)) {
    return current;
}
return replaceFlowDraftWorkingDocument(current, nextDocument);
```

- [ ] **Step 5: Replace save graph validation**

Inside `handleSaveFlow`, replace the inline `isAcyclic` and disconnected graph blocks with:

```ts
const graphValidation = validateFlowDocumentGraph(draftDocument);
if (!graphValidation.valid) {
    showFeedback({
        tone: 'error',
        title: '保存失败',
        detail: graphValidation.reason === 'disconnected'
            ? '画布中存在未连接的节点，请将所有节点连入一张依赖图。'
            : '',
    });
    return false;
}
```

Remove the `isAcyclic` import from `dagUtils` if no remaining code uses it.

- [ ] **Step 6: Run targeted tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/flowDocumentMutations.test.ts src/views/offline/OfflineWorkbench.test.tsx
```

Expected: both files pass.

- [ ] **Step 7: Commit**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx wb-data-frontend/src/views/offline/flowDocumentMutations.ts wb-data-frontend/src/views/offline/flowDocumentMutations.test.ts
git commit -m "refactor: route flow canvas mutations through pure helpers"
```

## Task 3: Introduce `useFlowEditingSession` For Draft State And Open/Leave

**Files:**
- Create: `wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts`
- Create: `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write failing hook tests for open and leave**

Create `useFlowEditingSession.test.ts` with tests that mock `../../api/offline`, `recoverySnapshotStore`, and feedback. Test:

```ts
it('opens a Flow using a matching recovery snapshot before the server draft', async () => {
    // getOfflineFlowDocument resolves server document with hash "server-hash".
    // readRecoverySnapshot resolves a snapshot whose base hash matches.
    // result.current.openFlowDocument('_flows/jack/demo/flow.yaml')
    // expect result.current.flowDocument?.stages[0].nodes[0].scriptContent to be the recovered content.
});

it('leaves a dirty Flow by flushing the pending node editor draft into a recovery snapshot', async () => {
    // Open the Flow, open node editor, update editor content, call leaveCurrentFlow().
    // expect writeRecoverySnapshot to receive document containing edited content.
});
```

Use `renderHook` from `@testing-library/react`.

- [ ] **Step 2: Run the hook test to verify it fails**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts
```

Expected: fail with missing `useFlowEditingSession`.

- [ ] **Step 3: Create the hook with draft state, open, and leave**

Create `useFlowEditingSession.ts` with:

```ts
export interface UseFlowEditingSessionParams {
    groupId: number | null;
    defaultTimezone: string;
    loadScheduleSnapshot: (path: string) => Promise<void>;
    refreshRepoStatus: () => Promise<void>;
    showFeedback: (payload: FeedbackPayload) => void;
}
```

Initial hook responsibilities:

```ts
const [activeFlowPath, setActiveFlowPath] = useState<string | null>(null);
const [flowLoading, setFlowLoading] = useState(false);
const [draftSession, setDraftSession] = useState<FlowDraftSession | null>(null);
const [nodeEditorOpen, setNodeEditorOpenState] = useState(false);
const [nodeEditorContent, setNodeEditorContent] = useState('');
const pendingNodeEditorDraftRef = useRef<PendingNodeEditorDraft | null>(null);
const draftSessionRef = useRef<FlowDraftSession | null>(null);
```

Return derived values:

```ts
const flowDocument = draftSession?.workingDraft ?? null;
const activeNodeId = draftSession?.selectedNodeId ?? null;
const selectedTaskIds = draftSession?.selectedTaskIds ?? [];
const activeNode = useMemo(
    () => flattenFlowDocumentNodes(flowDocument).find((node) => node.taskId === activeNodeId) ?? null,
    [activeNodeId, flowDocument],
);
const nodeCount = useMemo(() => flattenFlowDocumentNodes(flowDocument).length, [flowDocument]);
const isDirty = draftSession !== null && hasFlowDraftChanges(draftSession);
```

Implement:

```ts
openFlowDocument(path, options)
leaveCurrentFlow(groupOverride)
setSelectedNodeId(taskId)
setSelectedTaskIds(next)
openNodeEditor(taskId)
setNodeEditorOpen(open)
updateNodeEditorContent(content)
stageNodeEditorDraft(content, dataSourceId, dataSourceType)
resetAfterBranchSwitch()
```

Keep implementation equivalent to the existing `OfflineWorkbench` code for `applyFlowDocumentPayload`, `leaveCurrentFlow`, `openFlowDocument`, and node editor draft scheduling.

- [ ] **Step 4: Run hook tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts
```

Expected: hook tests pass.

- [ ] **Step 5: Wire `OfflineWorkbench` to the hook for open/leave/state**

In `OfflineWorkbench.tsx`:

- remove local `activeFlowPath`, `flowLoading`, `draftSession`, `nodeEditorOpen`, `nodeEditorContent`, `pendingNodeEditorDraftRef`, `draftSessionRef` state and refs only after each replacement compiles
- consume the hook return values with the same local names
- keep `pendingNavigation` in the page because route blockers are page-level
- keep branch switch decisions in the page but call `flowEditing.leaveCurrentFlow()` and `flowEditing.resetAfterBranchSwitch()`

The hook call should look like:

```ts
const flowEditing = useFlowEditingSession({
    groupId,
    defaultTimezone,
    loadScheduleSnapshot,
    refreshRepoStatus,
    showFeedback,
});
```

Destructure only values used by the page. Keep aliases matching current handler names where possible:

```ts
const {
    activeFlowPath,
    flowDocument,
    activeNode,
    activeNodeId,
    selectedTaskIds,
    nodeCount,
    isDirty,
    flowLoading,
    draftSession,
    nodeEditorOpen,
    nodeEditorContent,
    openFlowDocument,
    leaveCurrentFlow,
    resetAfterBranchSwitch: resetActiveFlowAfterBranchSwitch,
    setSelectedNodeId: setDraftSelectedNodeId,
    setSelectedTaskIds: setDraftSelectedTaskIds,
    openNodeEditor: handleOpenNodeEditor,
    setNodeEditorOpen: handleNodeEditorOpenChange,
    updateNodeEditorContent: handleNodeEditorContentChange,
    stageNodeEditorDraft: handleNodeEditorDraftChange,
} = flowEditing;
```

- [ ] **Step 6: Run targeted tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts src/views/offline/OfflineWorkbench.test.tsx
```

Expected: both files pass.

- [ ] **Step 7: Commit**

```bash
git add wb-data-frontend/src/views/offline/useFlowEditingSession.ts wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: extract flow editing session state"
```

## Task 4: Move Node Editor Draft And Canvas Commands Into The Hook

**Files:**
- Modify: `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
- Modify: `wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Add failing hook tests for edit commands**

Add tests:

```ts
it('renames a node through the editing session and preserves selection', async () => {
    // Open a Flow with shell_node_1 selected.
    // call result.current.renameNode('shell_node_1', 'renamed_node')
    // expect flowDocument nodes, edges, layout, activeNodeId, selectedTaskIds updated.
});

it('adds a shell node through the editing session', async () => {
    // Open a Flow and call addNode('SHELL', { x: 100, y: 200 }).
    // expect new shell_node_N in document and selected.
});

it('removes a node through canvas node changes and clears stale pending editor draft', async () => {
    // Open a Flow, open editor for shell_node_1, update content, then updateCanvasNodes with shell_node_1 removed.
    // expect node editor closes and pending draft does not survive into save.
});
```

- [ ] **Step 2: Run hook tests to verify they fail**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts
```

Expected: fail with missing hook methods.

- [ ] **Step 3: Implement hook commands**

Move equivalent logic from `OfflineWorkbench` into the hook:

```ts
renameNode(oldId, newId)
addNode(kind, position)
updateCanvasNodes(nodes)
updateCanvasEdges(edges)
commitCanvasLayout(nodes)
saveNodeEditorDraft(content, dataSourceId, dataSourceType)
```

Use the pure functions from `flowDocumentMutations.ts`. The page should no longer own pending node editor draft refs or canvas mutation details.

- [ ] **Step 4: Replace page handlers with hook commands**

In `OfflineWorkbench.tsx`, replace callback props:

```tsx
onNodesChange={handleCanvasNodesChange}
onEdgesChange={handleCanvasEdgesChange}
onNodeLayoutCommit={handleCanvasNodeLayoutCommit}
onAddNode={handleAddCanvasNode}
onRenameNode={handleRenameNode}
```

with hook commands:

```tsx
onNodesChange={updateCanvasNodes}
onEdgesChange={updateCanvasEdges}
onNodeLayoutCommit={commitCanvasLayout}
onAddNode={addNode}
onRenameNode={renameNode}
```

Keep toolbar wrappers only where the page calculates center positions before calling `addNode`.

- [ ] **Step 5: Run targeted tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts src/views/offline/OfflineWorkbench.test.tsx src/views/offline/flowDocumentMutations.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 6: Commit**

```bash
git add wb-data-frontend/src/views/offline/useFlowEditingSession.ts wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: move flow edit commands into session hook"
```

## Task 5: Move Save, Conflict, And Current Flow Commit Into The Hook

**Files:**
- Modify: `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
- Modify: `wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Add failing hook tests for save and conflict**

Add tests:

```ts
it('saves by flushing a pending node editor draft and preserving schedule in the payload', async () => {
    // Open a Flow with schedule.
    // open editor, update content, saveFlow().
    // expect saveOfflineFlowDocument payload includes changed scriptContent and schedule.
});

it('stores conflict state when save returns 409 and overwrites from the latest server document', async () => {
    // saveOfflineFlowDocument rejects with AxiosError 409.
    // expect saveConflictState to be set.
    // mock latest document, then overwriteSaveConflict().
    // expect saveOfflineFlowDocument called again with rebased metadata.
});

it('commits current Flow and saves first when dirty', async () => {
    // Make draft dirty, call commitCurrentFlow(message, 'save-and-commit').
    // expect saveOfflineFlowDocument before commitOfflineCurrentFlow.
});
```

- [ ] **Step 2: Run hook tests to verify they fail**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts
```

Expected: fail with missing save/conflict/commit methods.

- [ ] **Step 3: Extend hook params**

Update `UseFlowEditingSessionParams`:

```ts
export interface UseFlowEditingSessionParams {
    groupId: number | null;
    defaultTimezone: string;
    loadScheduleSnapshot: (path: string) => Promise<void>;
    refreshRepoStatus: () => Promise<void>;
    refreshFlowCommitStatus: () => Promise<void>;
    showFeedback: (payload: FeedbackPayload) => void;
}
```

- [ ] **Step 4: Move save and conflict implementation**

Move from `OfflineWorkbench` into the hook:

```ts
persistFlowSession(sessionForSave)
validateDocumentForAction(nodeOverride)
saveFlow(nodeOverride, silent)
commitCurrentFlow(message, mode)
closeSaveConflict()
discardSaveConflict()
overwriteSaveConflict()
restoreStaleDraft()
discardStaleDraft()
```

Use `validateFlowDocumentGraph` instead of inline graph checks. Keep the exact user feedback strings from the current page implementation.

- [ ] **Step 5: Wire page dialogs and commit actions**

In `OfflineWorkbench.tsx`, remove local:

```ts
savingFlow
flowCommitDirty
saveConflictState
saveConflictPending
persistFlowSession
handleSaveFlow
handleFlowCommit
handleRestoreStaleDraft
handleDiscardStaleDraft
handleCloseSaveConflict
handleDiscardSaveConflict
handleOverwriteSaveConflict
```

Destructure replacements from the hook:

```ts
savingFlow,
flowCommitDirty,
staleDraft,
saveConflictState,
saveConflictPending,
saveFlow: handleSaveFlow,
commitCurrentFlow: handleFlowCommit,
restoreStaleDraft: handleRestoreStaleDraft,
discardStaleDraft: handleDiscardStaleDraft,
closeSaveConflict: handleCloseSaveConflict,
discardSaveConflict: handleDiscardSaveConflict,
overwriteSaveConflict: handleOverwriteSaveConflict,
```

- [ ] **Step 6: Run targeted tests**

```bash
cd wb-data-frontend
npm run test -- --run src/views/offline/useFlowEditingSession.test.ts src/views/offline/OfflineWorkbench.test.tsx src/views/offline/useFlowExecutionAndSchedule.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 7: Commit**

```bash
git add wb-data-frontend/src/views/offline/useFlowEditingSession.ts wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "refactor: move flow persistence into editing session"
```

## Task 6: Tighten Page Surface And Verify End To End

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/useFlowEditingSession.ts`
- Modify: `wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts`

- [ ] **Step 1: Remove obsolete imports and local state**

Run:

```bash
cd wb-data-frontend
npm run build
```

Expected before cleanup: TypeScript identifies unused imports or stale names if any remain.

Remove unused imports from `OfflineWorkbench.tsx`, especially direct imports from:

```ts
flowDraftController
recoverySnapshotStore
pendingNodeEditorDraftState
nodeEditorCloseDraftState
```

Keep imports that remain genuinely used by the page.

- [ ] **Step 2: Confirm `OfflineWorkbench` no longer owns forbidden internals**

Run:

```bash
rg -n "pendingNodeEditorDraftRef|writeRecoverySnapshot|removeRecoverySnapshot|saveConflictPending|persistFlowSession|forceOverwriteRebase|rebaseFlowDraftSession" wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
```

Expected: no matches for pending editor refs, recovery snapshot writes/removes, save conflict internals, or draft rebase helpers.

- [ ] **Step 3: Run full frontend tests**

```bash
cd wb-data-frontend
npm run test -- --run
```

Expected: 29 or more test files pass; no failures.

- [ ] **Step 4: Run frontend build**

```bash
cd wb-data-frontend
npm run build
```

Expected: build passes. Existing Vite chunk size warning is acceptable.

- [ ] **Step 5: Run backend related tests**

```bash
cd wb-data-server
mvn -pl wb-data-backend -Dtest=OfflineFlowDocumentServiceTest,OfflineScheduleServiceTest,GitCommandServiceTest,GitCommandServiceBranchTest,OfflineExecutionServiceBranchTest test
```

Expected: 24 tests pass.

- [ ] **Step 6: Commit final cleanup**

```bash
git add wb-data-frontend/src/views/offline/OfflineWorkbench.tsx wb-data-frontend/src/views/offline/useFlowEditingSession.ts wb-data-frontend/src/views/offline/useFlowEditingSession.test.ts
git commit -m "refactor: tighten offline workbench editing surface"
```

## Task 7: Manual Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Start backend from this worktree**

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/flow-editing-session-simplification/wb-data-server
mvn -pl wb-data-backend spring-boot:run
```

Expected: backend listens on port 8080.

- [ ] **Step 2: Start frontend from this worktree**

```bash
cd /Users/wenbin/Projects/wb-data/.worktrees/flow-editing-session-simplification/wb-data-frontend
npm run dev -- --host 127.0.0.1
```

Expected: Vite listens on `http://127.0.0.1:5173/`.

- [ ] **Step 3: Execute the real user flow**

Use the browser:

1. Login with user `admin`, password `admin123`.
2. Select project group `policy`.
3. Open offline development.
4. Use branch `feature/policy-review` unless the current policy branch has changed.
5. Under `jack`, create a Flow named `codex_flow_session_<HHMM>`.
6. Add one Shell node.
7. Edit the Shell node script:

```bash
#!/bin/bash
echo "flow editing session check $(date)"
```

8. Set schedule to every minute: `* * * * *`.
9. Enable schedule.
10. Save.
11. Commit current Flow with message `flow editing session check`.
12. Push.
13. Open operations center.
14. Filter by the new Flow name.
15. Confirm one successful record per planned minute.
16. Open detail.
17. Confirm only the Shell node is listed, no `flow_dag`, no opaque execution id under the title, and logs follow the selected node.

- [ ] **Step 4: Record evidence in final response**

Include:

- Flow name created
- planned execution time observed
- start time observed
- detail page node list result
- commands run
- any retry or external network issue encountered during push

## Completion Checklist

- [ ] `OfflineWorkbench.tsx` no longer owns pending node editor draft refs.
- [ ] `OfflineWorkbench.tsx` no longer directly writes/removes recovery snapshots.
- [ ] `OfflineWorkbench.tsx` no longer owns save conflict internals.
- [ ] `flowDocumentMutations.test.ts` covers graph, layout, and selection behavior.
- [ ] `useFlowEditingSession.test.ts` covers open, leave, save, conflict, and current Flow commit behavior.
- [ ] Full frontend test suite passes.
- [ ] Frontend build passes.
- [ ] Backend offline-related tests pass.
- [ ] Manual save, commit, push, schedule, and operations verification passes.
