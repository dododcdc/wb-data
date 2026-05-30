# Offline Flow Draft Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current time-based multi-layer draft behavior in offline Flow editing with a single `workingDraft` model, automatic browser-local recovery snapshots, and explicit user-triggered repository saves.

**Architecture:** Introduce a small, testable draft domain in `src/views/offline/` built around three units: a signature/snapshot foundation, a pure `flowDraftController`, and `OfflineWorkbench` integration that treats node-editor input as part of the active Flow draft. Remove the 5-second product-level autosave behavior, flush editor input at leave boundaries, and keep repository writes behind the existing save action only.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, jsdom, localStorage

---

## File Structure

### Create

- `wb-data-frontend/src/views/offline/recoverySnapshotStore.ts` — browser-local snapshot read/write/move/remove helpers and snapshot types
- `wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts` — unit tests for snapshot persistence and path migration
- `wb-data-frontend/src/views/offline/flowDraftController.ts` — pure draft-session helpers for open/patch/flush/conflict/save transitions
- `wb-data-frontend/src/views/offline/flowDraftController.test.ts` — unit tests for session creation, conflict detection, editor flush, and save/reset flows
- `docs/superpowers/plans/2026-04-20-offline-flow-draft-strategy.md` — this plan

### Modify

- `wb-data-frontend/src/views/offline/flowCanvasState.ts` — expand draft signature comparison to include `dataSourceId` and `dataSourceType`
- `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx` — replace timer-based draft persistence with controller-driven `workingDraft` orchestration, leave-boundary flush, recovery banner updates, and snapshot lifecycle hooks

### Test

- `wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts`
- `wb-data-frontend/src/views/offline/flowDraftController.test.ts`

---

### Task 1: Build the draft signature and recovery snapshot foundation

**Files:**
- Create: `wb-data-frontend/src/views/offline/recoverySnapshotStore.ts`
- Create: `wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts`
- Modify: `wb-data-frontend/src/views/offline/flowCanvasState.ts`

- [ ] **Step 1: Write the failing tests for snapshot CRUD and signature coverage**

```ts
// wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest'

import { buildFlowDocumentSignature } from './flowCanvasState'
import {
  moveRecoverySnapshot,
  readRecoverySnapshot,
  removeRecoverySnapshot,
  type RecoverySnapshot,
  writeRecoverySnapshot,
} from './recoverySnapshotStore'

const groupId = 7
const oldPath = '_flows/totot/flow.yaml'
const newPath = '_flows/tyy/flow.yaml'

const snapshot: RecoverySnapshot = {
  document: {
    path: oldPath,
    documentHash: 'hash-1',
    documentUpdatedAt: 100,
    stages: [
      {
        stageId: 'main',
        parallel: false,
        nodes: [
          {
            taskId: 'a',
            kind: 'SQL',
            scriptPath: 'scripts/totot/a.sql',
            scriptContent: 'select 1',
            dataSourceId: 11,
            dataSourceType: 'HIVE',
          },
        ],
      },
    ],
    edges: [],
    layout: { a: { x: 10, y: 20 } },
  },
  baseDocumentHash: 'hash-1',
  baseDocumentUpdatedAt: 100,
  selectedNodeId: 'a',
  selectedTaskIds: ['a'],
  updatedAt: 123,
}

describe('recoverySnapshotStore', () => {
  beforeEach(() => window.localStorage.clear())

  it('writes, reads, moves, and removes snapshots by group and flow path', () => {
    writeRecoverySnapshot(groupId, oldPath, snapshot)
    expect(readRecoverySnapshot(groupId, oldPath)?.document.path).toBe(oldPath)

    moveRecoverySnapshot(groupId, oldPath, newPath)
    expect(readRecoverySnapshot(groupId, oldPath)).toBeNull()
    expect(readRecoverySnapshot(groupId, newPath)?.document.path).toBe(newPath)

    removeRecoverySnapshot(groupId, newPath)
    expect(readRecoverySnapshot(groupId, newPath)).toBeNull()
  })

  it('treats data source changes as draft changes', () => {
    const original = buildFlowDocumentSignature(snapshot.document)
    const changed = buildFlowDocumentSignature({
      ...snapshot.document,
      stages: [
        {
          ...snapshot.document.stages[0],
          nodes: [
            {
              ...snapshot.document.stages[0].nodes[0],
              dataSourceId: 22,
              dataSourceType: 'STARROCKS',
            },
          ],
        },
      ],
    })

    expect(changed).not.toBe(original)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/recoverySnapshotStore.test.ts
```

Expected: FAIL with module-not-found for `./recoverySnapshotStore` and/or signature assertion failure because `buildFlowDocumentSignature` does not include data-source fields.

- [ ] **Step 3: Implement the minimal snapshot store and signature update**

```ts
// wb-data-frontend/src/views/offline/recoverySnapshotStore.ts
import type { OfflineFlowDocument } from '@/api/offline'

const STORAGE_PREFIX = 'wb-data:offline-recovery'

export interface RecoverySnapshot {
  document: OfflineFlowDocument
  baseDocumentHash: string
  baseDocumentUpdatedAt: number
  selectedNodeId: string | null
  selectedTaskIds: string[]
  updatedAt: number
}

function snapshotKey(groupId: number, path: string) {
  return `${STORAGE_PREFIX}:${groupId}:${path}`
}

export function readRecoverySnapshot(groupId: number, path: string): RecoverySnapshot | null {
  const raw = window.localStorage.getItem(snapshotKey(groupId, path))
  if (!raw) return null

  try {
    return JSON.parse(raw) as RecoverySnapshot
  } catch {
    return null
  }
}

export function writeRecoverySnapshot(groupId: number, path: string, snapshot: RecoverySnapshot) {
  window.localStorage.setItem(snapshotKey(groupId, path), JSON.stringify(snapshot))
}

export function removeRecoverySnapshot(groupId: number, path: string) {
  window.localStorage.removeItem(snapshotKey(groupId, path))
}

export function moveRecoverySnapshot(groupId: number, oldPath: string, newPath: string) {
  const snapshot = readRecoverySnapshot(groupId, oldPath)
  if (!snapshot) return

  writeRecoverySnapshot(groupId, newPath, {
    ...snapshot,
    document: { ...snapshot.document, path: newPath },
  })
  removeRecoverySnapshot(groupId, oldPath)
}
```

```ts
// wb-data-frontend/src/views/offline/flowCanvasState.ts
export function buildFlowDocumentSignature(document: OfflineFlowDocument | null) {
  if (!document) return ''

  return JSON.stringify({
    stages: document.stages.map((stage) => ({
      stageId: stage.stageId,
      parallel: stage.parallel,
      nodes: stage.nodes.map((node) => ({
        taskId: node.taskId,
        kind: node.kind,
        scriptPath: node.scriptPath,
        scriptContent: node.scriptContent,
        dataSourceId: node.dataSourceId ?? null,
        dataSourceType: node.dataSourceType ?? null,
      })),
    })),
    edges: buildEdgesFromCanvasEdges(
      document.edges.map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        position: { x: 0, y: 0 },
        data: {},
      })),
    ),
    layout: sortObjectEntries(document.layout).map(([taskId, position]) => ({
      taskId,
      x: position.x,
      y: position.y,
    })),
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/recoverySnapshotStore.test.ts
```

Expected: PASS with 2 tests passing.

- [ ] **Step 5: Commit the foundation changes**

```bash
cd wb-data-frontend
git add src/views/offline/recoverySnapshotStore.ts \
  src/views/offline/recoverySnapshotStore.test.ts \
  src/views/offline/flowCanvasState.ts
git commit -m "test: cover offline recovery snapshot foundation"
```

---

### Task 2: Create a pure flow draft controller

**Files:**
- Create: `wb-data-frontend/src/views/offline/flowDraftController.ts`
- Create: `wb-data-frontend/src/views/offline/flowDraftController.test.ts`
- Modify: `wb-data-frontend/src/views/offline/recoverySnapshotStore.ts`

- [ ] **Step 1: Write the failing tests for open/patch/flush/conflict behavior**

```ts
// wb-data-frontend/src/views/offline/flowDraftController.test.ts
import { describe, expect, it } from 'vitest'

import type { RecoverySnapshot } from './recoverySnapshotStore'
import {
  buildRecoverySnapshotFromSession,
  createFlowDraftSession,
  flushNodeEditorDraft,
  hasFlowDraftChanges,
  resolveDraftConflict,
  updateFlowDraftDocument,
} from './flowDraftController'

const path = '_flows/totot/flow.yaml'
const serverDocument = {
  path,
  documentHash: 'server-hash',
  documentUpdatedAt: 200,
  stages: [
    {
      stageId: 'main',
      parallel: false,
      nodes: [
        {
          taskId: 'a',
          kind: 'SQL',
          scriptPath: 'scripts/totot/a.sql',
          scriptContent: 'select 1',
          dataSourceId: 11,
          dataSourceType: 'HIVE',
        },
      ],
    },
  ],
  edges: [],
  layout: { a: { x: 10, y: 20 } },
}

describe('flowDraftController', () => {
  it('creates a working draft from a matching recovery snapshot', () => {
    const snapshot: RecoverySnapshot = {
      document: {
        ...serverDocument,
        stages: [
          {
            ...serverDocument.stages[0],
            nodes: [{ ...serverDocument.stages[0].nodes[0], scriptContent: 'select 2' }],
          },
        ],
      },
      baseDocumentHash: 'server-hash',
      baseDocumentUpdatedAt: 200,
      selectedNodeId: 'a',
      selectedTaskIds: ['a'],
      updatedAt: 999,
    }

    const session = createFlowDraftSession({ path, serverDocument, snapshot })
    expect(session.workingDraft.stages[0].nodes[0].scriptContent).toBe('select 2')
    expect(session.conflict).toBeNull()
  })

  it('marks stale recovery snapshots as a conflict instead of auto-restoring them', () => {
    const staleSnapshot: RecoverySnapshot = {
      document: {
        ...serverDocument,
        stages: [
          {
            ...serverDocument.stages[0],
            nodes: [{ ...serverDocument.stages[0].nodes[0], scriptContent: 'select stale' }],
          },
        ],
      },
      baseDocumentHash: 'older-hash',
      baseDocumentUpdatedAt: 100,
      selectedNodeId: 'a',
      selectedTaskIds: ['a'],
      updatedAt: 555,
    }

    const session = createFlowDraftSession({ path, serverDocument, snapshot: staleSnapshot })
    expect(session.workingDraft.stages[0].nodes[0].scriptContent).toBe('select 1')
    expect(session.conflict?.kind).toBe('stale-recovery')

    const restored = resolveDraftConflict(session, 'restore-local')
    expect(restored.workingDraft.stages[0].nodes[0].scriptContent).toBe('select stale')
  })

  it('flushes pending node-editor content into the working draft and emits a recovery snapshot', () => {
    const session = createFlowDraftSession({ path, serverDocument, snapshot: null })
    const patched = flushNodeEditorDraft(session, {
      taskId: 'a',
      scriptContent: 'select 42',
      dataSourceId: 99,
      dataSourceType: 'STARROCKS',
    })

    expect(hasFlowDraftChanges(patched)).toBe(true)
    expect(patched.workingDraft.stages[0].nodes[0].dataSourceId).toBe(99)

    const recovery = buildRecoverySnapshotFromSession(patched)
    expect(recovery.document.stages[0].nodes[0].scriptContent).toBe('select 42')
  })

  it('resets dirty state when the saved server document becomes the new base document', () => {
    const session = createFlowDraftSession({ path, serverDocument, snapshot: null })
    const dirty = updateFlowDraftDocument(session, (draft) => {
      draft.stages[0].nodes[0].scriptContent = 'select 7'
    })

    const reset = createFlowDraftSession({
      path,
      serverDocument: dirty.workingDraft,
      snapshot: null,
    })

    expect(hasFlowDraftChanges(reset)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/flowDraftController.test.ts
```

Expected: FAIL with module-not-found for `./flowDraftController`.

- [ ] **Step 3: Implement the pure controller**

```ts
// wb-data-frontend/src/views/offline/flowDraftController.ts
import type { OfflineFlowDocument } from '@/api/offline'

import { buildFlowDocumentSignature } from './flowCanvasState'
import type { RecoverySnapshot } from './recoverySnapshotStore'

export interface DraftConflict {
  kind: 'stale-recovery'
  snapshot: RecoverySnapshot
}

export interface FlowDraftSession {
  path: string
  baseDocument: OfflineFlowDocument
  workingDraft: OfflineFlowDocument
  selectedNodeId: string | null
  selectedTaskIds: string[]
  conflict: DraftConflict | null
}

export interface PendingNodeEditorDraft {
  taskId: string
  scriptContent: string
  dataSourceId?: number
  dataSourceType?: string
}

function cloneDocument(document: OfflineFlowDocument): OfflineFlowDocument {
  return {
    ...document,
    stages: document.stages.map((stage) => ({
      ...stage,
      nodes: stage.nodes.map((node) => ({ ...node })),
    })),
    edges: document.edges.map((edge) => ({ ...edge })),
    layout: Object.fromEntries(
      Object.entries(document.layout).map(([taskId, position]) => [taskId, { ...position }]),
    ),
  }
}

export function createFlowDraftSession(args: {
  path: string
  serverDocument: OfflineFlowDocument
  snapshot: RecoverySnapshot | null
}): FlowDraftSession {
  const { path, serverDocument, snapshot } = args
  const matchingSnapshot =
    snapshot &&
    snapshot.baseDocumentHash === serverDocument.documentHash &&
    snapshot.baseDocumentUpdatedAt === serverDocument.documentUpdatedAt

  return {
    path,
    baseDocument: cloneDocument(serverDocument),
    workingDraft: cloneDocument(matchingSnapshot ? snapshot.document : serverDocument),
    selectedNodeId: snapshot?.selectedNodeId ?? null,
    selectedTaskIds: snapshot?.selectedTaskIds ?? [],
    conflict:
      snapshot && !matchingSnapshot
        ? {
            kind: 'stale-recovery',
            snapshot,
          }
        : null,
  }
}

export function updateFlowDraftDocument(
  session: FlowDraftSession,
  updater: (draft: OfflineFlowDocument) => void,
): FlowDraftSession {
  const nextDraft = cloneDocument(session.workingDraft)
  updater(nextDraft)
  return { ...session, workingDraft: nextDraft }
}

export function flushNodeEditorDraft(
  session: FlowDraftSession,
  input: { taskId: string; scriptContent: string; dataSourceId?: number; dataSourceType?: string },
): FlowDraftSession {
  return updateFlowDraftDocument(session, (draft) => {
    draft.stages.forEach((stage) => {
      stage.nodes = stage.nodes.map((node) =>
        node.taskId === input.taskId
          ? {
              ...node,
              scriptContent: input.scriptContent,
              dataSourceId: input.dataSourceId,
              dataSourceType: input.dataSourceType,
            }
          : node,
      )
    })
  })
}

export function hasFlowDraftChanges(session: FlowDraftSession) {
  return (
    buildFlowDocumentSignature(session.workingDraft) !==
    buildFlowDocumentSignature(session.baseDocument)
  )
}

export function buildRecoverySnapshotFromSession(session: FlowDraftSession): RecoverySnapshot {
  return {
    document: cloneDocument(session.workingDraft),
    baseDocumentHash: session.baseDocument.documentHash,
    baseDocumentUpdatedAt: session.baseDocument.documentUpdatedAt,
    selectedNodeId: session.selectedNodeId,
    selectedTaskIds: session.selectedTaskIds,
    updatedAt: Date.now(),
  }
}

export function prepareSessionForLeave(
  session: FlowDraftSession,
  pendingEditor: PendingNodeEditorDraft | null,
) {
  const nextSession = pendingEditor ? flushNodeEditorDraft(session, pendingEditor) : session

  return {
    nextSession,
    snapshot: hasFlowDraftChanges(nextSession) ? buildRecoverySnapshotFromSession(nextSession) : null,
  }
}

export function resolveDraftConflict(
  session: FlowDraftSession,
  strategy: 'restore-local' | 'load-server',
): FlowDraftSession {
  if (!session.conflict) return session

  return strategy === 'restore-local'
    ? {
        ...session,
        workingDraft: cloneDocument(session.conflict.snapshot.document),
        selectedNodeId: session.conflict.snapshot.selectedNodeId,
        selectedTaskIds: session.conflict.snapshot.selectedTaskIds,
        conflict: null,
      }
    : {
        ...session,
        workingDraft: cloneDocument(session.baseDocument),
        conflict: null,
      }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/flowDraftController.test.ts
```

Expected: PASS with 4 tests passing.

- [ ] **Step 5: Commit the controller**

```bash
cd wb-data-frontend
git add src/views/offline/flowDraftController.ts \
  src/views/offline/flowDraftController.test.ts
git commit -m "feat: add offline flow draft controller"
```

---

### Task 3: Integrate the controller into Flow loading, leaving, and saving

**Files:**
- Modify: `wb-data-frontend/src/views/offline/flowDraftController.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Test: `wb-data-frontend/src/views/offline/flowDraftController.test.ts`

- [ ] **Step 1: Add a failing controller test for leave-boundary flushing**

```ts
// Append to wb-data-frontend/src/views/offline/flowDraftController.test.ts
import { prepareSessionForLeave } from './flowDraftController'

it('flushes pending editor input and emits a recovery snapshot before leaving the active flow', () => {
  const session = createFlowDraftSession({ path, serverDocument, snapshot: null })
  const result = prepareSessionForLeave(session, {
    taskId: 'a',
    scriptContent: 'select switched',
    dataSourceId: 22,
    dataSourceType: 'STARROCKS',
  })

  expect(result.snapshot?.document.stages[0].nodes[0].scriptContent).toBe('select switched')
  expect(result.snapshot?.document.stages[0].nodes[0].dataSourceType).toBe('STARROCKS')
  expect(result.nextSession.workingDraft.stages[0].nodes[0].scriptContent).toBe('select switched')
})
```

- [ ] **Step 2: Run the test bundle to verify it still fails until integration is wired**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/flowDraftController.test.ts src/views/offline/recoverySnapshotStore.test.ts
```

Expected: FAIL with `prepareSessionForLeave` not exported from `./flowDraftController`.

- [ ] **Step 3: Replace timer-based draft logic in `OfflineWorkbench.tsx` with a session-driven flow**

```tsx
// wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
import {
  buildRecoverySnapshotFromSession,
  createFlowDraftSession,
  flushNodeEditorDraft,
  hasFlowDraftChanges,
  prepareSessionForLeave,
  resolveDraftConflict,
  updateFlowDraftDocument,
  type FlowDraftSession,
  type PendingNodeEditorDraft,
} from './flowDraftController'
import {
  moveRecoverySnapshot,
  readRecoverySnapshot,
  removeRecoverySnapshot,
  writeRecoverySnapshot,
} from './recoverySnapshotStore'

const [draftSession, setDraftSession] = useState<FlowDraftSession | null>(null)
const editorDraftRef = useRef<PendingNodeEditorDraft | null>(null)

const flushActiveEditorToDraft = useCallback(() => {
  if (!editorDraftRef.current) return

  setDraftSession((current) =>
    current ? flushNodeEditorDraft(current, editorDraftRef.current!) : current,
  )
}, [])

const persistActiveRecoverySnapshot = useCallback((session: FlowDraftSession | null) => {
  if (!groupId || !session || !hasFlowDraftChanges(session)) return
  writeRecoverySnapshot(groupId, session.path, buildRecoverySnapshotFromSession(session))
}, [groupId])

const leaveCurrentFlow = useCallback((session: FlowDraftSession | null) => {
  if (!groupId || !session) return null

  const result = prepareSessionForLeave(session, editorDraftRef.current)
  setDraftSession(result.nextSession)

  if (result.snapshot) {
    writeRecoverySnapshot(groupId, session.path, result.snapshot)
  }

  editorDraftRef.current = null
  return result
}, [groupId])

const openFlowDocument = useCallback(async (pathValue: string) => {
  if (!groupId) return

  leaveCurrentFlow(draftSession)

  const payload = await getOfflineFlowDocument(groupId, pathValue.trim())
  const snapshot = readRecoverySnapshot(groupId, pathValue.trim())
  const session = createFlowDraftSession({
    path: pathValue.trim(),
    serverDocument: payload,
    snapshot,
  })

  setDraftSession(session)
  setActiveFlowPath(session.path)
  setActiveNodeId(session.selectedNodeId)
  setSelectedTaskIds(session.selectedTaskIds)
}, [draftSession, groupId, leaveCurrentFlow])
```

- [ ] **Step 4: Wire manual save to repository and clear recovery snapshots on success**

```tsx
// Inside handleSaveFlow in wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
flushActiveEditorToDraft()

if (!groupId || !draftSession) return

const response = await saveOfflineFlowDocument({
  groupId,
  path: draftSession.path,
  documentHash: draftSession.baseDocument.documentHash,
  documentUpdatedAt: draftSession.baseDocument.documentUpdatedAt,
  stages: draftSession.workingDraft.stages.map((stage) => ({
    stageId: stage.stageId,
    nodes: stage.nodes.map((node) => ({
      taskId: node.taskId,
      scriptContent: node.scriptContent,
      kind: node.kind,
      scriptPath: node.scriptPath,
      dataSourceId: node.dataSourceId,
      dataSourceType: node.dataSourceType,
    })),
  })),
  edges: draftSession.workingDraft.edges,
  layout: draftSession.workingDraft.layout,
})

const nextSession = createFlowDraftSession({
  path: draftSession.path,
  serverDocument: response,
  snapshot: null,
})

setDraftSession(nextSession)
removeRecoverySnapshot(groupId, draftSession.path)
showFeedback({
  tone: 'success',
  title: '已保存到本地仓库',
  detail: '当前 Flow 草稿已写回本地仓库文件。',
})
```

- [ ] **Step 5: Run focused tests and commit the integration**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/flowDraftController.test.ts src/views/offline/recoverySnapshotStore.test.ts
```

Expected: PASS with all controller and store tests green.

Then commit:

```bash
cd wb-data-frontend
git add src/views/offline/OfflineWorkbench.tsx \
  src/views/offline/flowDraftController.ts \
  src/views/offline/flowDraftController.test.ts \
  src/views/offline/recoverySnapshotStore.ts \
  src/views/offline/recoverySnapshotStore.test.ts
git commit -m "feat: persist offline flow drafts on leave boundaries"
```

---

### Task 4: Make node-editor input part of the draft and remove the old temp-save semantics

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Test: `wb-data-frontend/src/views/offline/flowDraftController.test.ts`

- [ ] **Step 1: Add a failing test for node-editor data-source-only changes**

```ts
// Append to wb-data-frontend/src/views/offline/flowDraftController.test.ts
it('treats data-source-only edits as draft changes', () => {
  const session = createFlowDraftSession({ path, serverDocument, snapshot: null })
  const patched = flushNodeEditorDraft(session, {
    taskId: 'a',
    scriptContent: 'select 1',
    dataSourceId: 22,
    dataSourceType: 'STARROCKS',
  })

  expect(hasFlowDraftChanges(patched)).toBe(true)
  expect(patched.workingDraft.stages[0].nodes[0].dataSourceType).toBe('STARROCKS')
})
```

- [ ] **Step 2: Run the regression test before changing `OfflineWorkbench.tsx`**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/flowDraftController.test.ts
```

Expected: PASS. This test guards the controller contract while `OfflineWorkbench.tsx` is updated to feed editor-buffer changes into the draft session.

- [ ] **Step 3: Track active editor input as draft data and flush it on close/execute/schedule actions**

```tsx
// wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
const [nodeEditorContent, setNodeEditorContent] = useState('')
const [nodeEditorDataSourceId, setNodeEditorDataSourceId] = useState<number | undefined>(undefined)
const [nodeEditorDataSourceType, setNodeEditorDataSourceType] = useState<string | undefined>(undefined)

const updateEditorBuffer = useCallback((content: string, dataSourceId?: number, dataSourceType?: string) => {
  editorDraftRef.current =
    activeNodeId == null
      ? null
      : {
          taskId: activeNodeId,
          scriptContent: content,
          dataSourceId,
          dataSourceType,
        }

  setNodeEditorContent(content)
  setNodeEditorDataSourceId(dataSourceId)
  setNodeEditorDataSourceType(dataSourceType)
}, [activeNodeId])

const closeNodeEditor = useCallback(() => {
  flushActiveEditorToDraft()
  setNodeEditorOpen(false)
  showFeedback({
    tone: 'success',
    title: '已更新当前草稿',
    detail: '节点编辑内容已并入当前 Flow 草稿，尚未保存到本地仓库。',
  })
}, [flushActiveEditorToDraft, showFeedback])

const handleExecute = useCallback(async () => {
  const leaveResult = draftSession ? prepareSessionForLeave(draftSession, editorDraftRef.current) : null
  const executionDocument = leaveResult?.nextSession.workingDraft ?? draftSession?.workingDraft

  if (!groupId || !activeFlowPath || !executionDocument) return

  const response = await createOfflineDocumentDebugExecution(buildDraftExecutionRequest({
    groupId,
    flowPath: activeFlowPath,
    flowDocument: executionDocument,
    canvasNodes: canvasNodesRef.current,
    canvasEdges: canvasEdgesRef.current,
    selectedTaskIds,
  }))

  showFeedback({
    tone: 'success',
    title: '调试执行已提交',
    detail: `执行 ID：${response.executionId}`,
  })
}, [activeFlowPath, draftSession, groupId, selectedTaskIds, showFeedback])

const handleScheduleSave = useCallback(async () => {
  const leaveResult = draftSession ? prepareSessionForLeave(draftSession, editorDraftRef.current) : null

  if (leaveResult?.snapshot && groupId) {
    writeRecoverySnapshot(groupId, draftSession.path, leaveResult.snapshot)
  }

  await updateOfflineSchedule({
    groupId: groupId!,
    path: activeFlowPath!,
    cron: scheduleCron,
    timezone: scheduleTimezone,
    contentHash: schedule?.contentHash ?? leaveResult?.nextSession.baseDocument.documentHash ?? '',
    fileUpdatedAt: schedule?.fileUpdatedAt ?? leaveResult?.nextSession.baseDocument.documentUpdatedAt ?? 0,
  })

  await openFlowDocument(activeFlowPath!)
}, [activeFlowPath, draftSession, groupId, openFlowDocument, schedule, scheduleCron, scheduleTimezone])
```

- [ ] **Step 4: Remove the old 5-second effect and old “暂存成功” feedback**

```tsx
// Remove from wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
useEffect(() => {
  if (!groupId || !activeFlowPath || !flowDocument || !isDirty) return
  const timer = window.setTimeout(() => {
    persistDraft(activeFlowPath, flowDocument, originalDocumentSignature, activeNodeId, selectedTaskIds)
  }, 5000)
  return () => window.clearTimeout(timer)
}, [activeFlowPath, activeNodeId, flowDocument, groupId, isDirty, originalDocumentSignature, persistDraft, selectedTaskIds])

// Replace old feedback
showFeedback({
  tone: 'success',
  title: '已更新当前草稿',
  detail: '当前修改仅保留在本机恢复稿中，点击“保存 Flow”后才会写入本地仓库。',
})
```

- [ ] **Step 5: Run tests and commit the node-editor semantics change**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/flowDraftController.test.ts
```

Expected: PASS with the new data-source draft coverage green.

Then commit:

```bash
cd wb-data-frontend
git add src/views/offline/OfflineWorkbench.tsx \
  src/views/offline/flowDraftController.test.ts
git commit -m "feat: treat offline node editor input as working draft"
```

---

### Task 5: Finish conflict UX, snapshot lifecycle cleanup, and full verification

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/recoverySnapshotStore.ts`
- Test: `wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts`
- Test: `wb-data-frontend/src/views/offline/flowDraftController.test.ts`

- [ ] **Step 1: Add a failing snapshot-migration test for folder rename/delete cleanup**

```ts
// Append to wb-data-frontend/src/views/offline/recoverySnapshotStore.test.ts
import {
  moveFolderRecoverySnapshots,
  removeFolderRecoverySnapshots,
} from './recoverySnapshotStore'

it('moves and removes snapshots for every flow under a folder prefix', () => {
  writeRecoverySnapshot(groupId, '_flows/folder-a/one/flow.yaml', {
    ...snapshot,
    document: { ...snapshot.document, path: '_flows/folder-a/one/flow.yaml' },
  })
  writeRecoverySnapshot(groupId, '_flows/folder-a/two/flow.yaml', {
    ...snapshot,
    document: { ...snapshot.document, path: '_flows/folder-a/two/flow.yaml' },
  })

  moveFolderRecoverySnapshots(groupId, '_flows/folder-a', '_flows/folder-b')
  expect(readRecoverySnapshot(groupId, '_flows/folder-a/one/flow.yaml')).toBeNull()
  expect(readRecoverySnapshot(groupId, '_flows/folder-b/one/flow.yaml')).not.toBeNull()
  expect(readRecoverySnapshot(groupId, '_flows/folder-b/two/flow.yaml')).not.toBeNull()

  removeFolderRecoverySnapshots(groupId, '_flows/folder-b')
  expect(readRecoverySnapshot(groupId, '_flows/folder-b/one/flow.yaml')).toBeNull()
  expect(readRecoverySnapshot(groupId, '_flows/folder-b/two/flow.yaml')).toBeNull()
})
```

- [ ] **Step 2: Run the focused tests to keep the cleanup work red-first**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/recoverySnapshotStore.test.ts src/views/offline/flowDraftController.test.ts
```

Expected: FAIL with `moveFolderRecoverySnapshots` / `removeFolderRecoverySnapshots` missing from `./recoverySnapshotStore`.

- [ ] **Step 3: Update conflict UX and call snapshot move/remove during rename and delete flows**

```tsx
// wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
{draftSession?.conflict ? (
  <section className="offline-conflict-banner">
    <div className="offline-conflict-copy">
      <AlertTriangle size={16} />
      <div>
        <strong>发现未保存的本地恢复稿</strong>
        <p>当前文件也有更新。你可以继续恢复稿，或加载仓库最新内容。</p>
      </div>
    </div>
    <div className="offline-conflict-actions">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setDraftSession((current) => current ? resolveDraftConflict(current, 'load-server') : current)}
      >
        加载最新内容
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => setDraftSession((current) => current ? resolveDraftConflict(current, 'restore-local') : current)}
      >
        继续恢复稿
      </Button>
    </div>
  </section>
) : null}

// Flow rename success path
moveRecoverySnapshot(groupId, oldPath, newPath)

// Flow delete success path
removeRecoverySnapshot(groupId, deleteFlowPath)

// Folder rename/delete success paths
export function moveFolderRecoverySnapshots(groupId: number, oldPrefix: string, newPrefix: string) {
  const prefix = `wb-data:offline-recovery:${groupId}:`

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key || !key.startsWith(prefix)) continue

    const path = key.slice(prefix.length)
    if (!path.startsWith(`${oldPrefix}/`)) continue

    const snapshot = readRecoverySnapshot(groupId, path)
    if (!snapshot) continue

    const nextPath = path.replace(oldPrefix, newPrefix)
    writeRecoverySnapshot(groupId, nextPath, {
      ...snapshot,
      document: { ...snapshot.document, path: nextPath },
    })
    removeRecoverySnapshot(groupId, path)
  }
}

export function removeFolderRecoverySnapshots(groupId: number, folderPrefix: string) {
  const prefix = `wb-data:offline-recovery:${groupId}:`
  const keysToDelete: string[] = []

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key || !key.startsWith(prefix)) continue

    const path = key.slice(prefix.length)
    if (path.startsWith(`${folderPrefix}/`)) {
      keysToDelete.push(path)
    }
  }

  keysToDelete.forEach((path) => removeRecoverySnapshot(groupId, path))
}

// Folder rename success path in OfflineWorkbench.tsx
moveFolderRecoverySnapshots(groupId, oldPath, newPath)

// Folder delete success path in OfflineWorkbench.tsx
removeFolderRecoverySnapshots(groupId, deleteFolderPath)
```

- [ ] **Step 4: Run the full relevant checks**

Run:

```bash
cd wb-data-frontend && npm run test -- src/views/offline/recoverySnapshotStore.test.ts src/views/offline/flowDraftController.test.ts && npm run build && npm run lint
```

Expected:

- Vitest: PASS
- Build: PASS
- ESLint: PASS

- [ ] **Step 5: Commit the cleanup and final verification**

```bash
cd wb-data-frontend
git add src/views/offline/OfflineWorkbench.tsx \
  src/views/offline/recoverySnapshotStore.ts \
  src/views/offline/recoverySnapshotStore.test.ts \
  src/views/offline/flowDraftController.test.ts
git commit -m "feat: finalize offline draft recovery flow"
```

---

## Spec Coverage Check

- **Single `workingDraft` model** — covered by Task 2 and Task 3
- **Remove 5-second product autosave** — covered by Task 3 Step 3 and Task 4 Step 4
- **Automatic browser-local recovery snapshots** — covered by Task 1, Task 2, Task 3
- **Manual repository save only** — covered by Task 3 Step 4
- **Node-editor input becomes part of draft** — covered by Task 4
- **Flow/group/route leave boundaries flush and persist draft** — covered by Task 3
- **Conflict UX changed to “本地恢复稿 vs 仓库最新内容”** — covered by Task 5
- **Rename/delete snapshot cleanup** — covered by Task 5
- **Data-source-only edits count as dirty** — covered by Task 1 and Task 4

## Placeholder Scan

- No `TODO`, `TBD`, or “implement later” markers remain.
- Each code-changing step includes concrete file paths and code blocks.
- Each verification step includes concrete commands and expected results.

## Type Consistency Check

- Snapshot type is consistently named `RecoverySnapshot`
- Session type is consistently named `FlowDraftSession`
- Dirty helper is consistently named `hasFlowDraftChanges`
- Conflict resolver is consistently named `resolveDraftConflict`
- Editor flush helper is consistently named `flushNodeEditorDraft`
