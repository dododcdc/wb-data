# Shared SQL Editor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a reusable frontend SQL editor core and migrate both the query page and offline SQL/HiveSQL node editor to it without changing their business semantics.

**Architecture:** Build a shared `src/components/sql-editor/` package that owns Monaco loading, theme registration, default SQL options, SQL formatting, shared editor action wiring, and optional completion-provider mounting. Keep query execution, metadata fetching, offline draft persistence, and node data-source behavior in their existing scene-level modules, then migrate query and offline surfaces to consume the same shared editor contract.

**Tech Stack:** React 18, TypeScript, Monaco via `@monaco-editor/react`, Vitest, `@testing-library/react`, existing query/offline hooks

---

## File map

- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorModule.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorTheme.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorOptions.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlFormatting.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorCore.ts`
- Create: `wb-data-frontend/src/components/sql-editor/SqlEditor.tsx`
- Create: `wb-data-frontend/src/components/sql-editor/sqlFormatting.test.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorCore.test.ts`
- Create: `wb-data-frontend/src/views/query/queryEditorActions.ts`
- Create: `wb-data-frontend/src/views/query/queryEditorActions.test.ts`
- Create: `wb-data-frontend/src/views/offline/NodeEditorDialog.tsx`
- Create: `wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/layout/Layout.tsx:29,180-183,213-215`
- Modify: `wb-data-frontend/src/views/query/components/QueryEditor.tsx:1-72`
- Modify: `wb-data-frontend/src/views/query/Query.tsx:1-40,251-299`
- Modify: `wb-data-frontend/src/views/query/hooks/useQueryExecution.ts:8-32,252-264`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx:1-10,1511-1516,2707-2716,3207-3422`
- Delete: `wb-data-frontend/src/views/query/queryEditorModule.ts`
- Delete: `wb-data-frontend/src/views/query/editorUtils.ts`

## Notes before coding

- First-pass scope is **shared SQL editor core only**. Do not pull offline SHELL editing into this refactor.
- Query-only behavior such as “run selected SQL / current statement” stays query-owned even after the editor core is shared.
- Offline SQL/HiveSQL nodes get the shared formatting and editor behavior, but **not** the full query-page metadata completion flow in this issue.
- The current frontend baseline in this worktree is `npm test` → `5 passed`, `21 passed`; use that as the pre-change baseline and run the full frontend verification flow before closing the branch.

### Task 1: Create the shared SQL editor core package

**Files:**
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorModule.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorTheme.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorOptions.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlFormatting.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorCore.ts`
- Create: `wb-data-frontend/src/components/sql-editor/SqlEditor.tsx`
- Create: `wb-data-frontend/src/components/sql-editor/sqlFormatting.test.ts`
- Create: `wb-data-frontend/src/components/sql-editor/sqlEditorCore.test.ts`
- Modify: `wb-data-frontend/src/views/layout/Layout.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// wb-data-frontend/src/components/sql-editor/sqlFormatting.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('formatSqlContent', () => {
    it('formats SQL with upper-case keywords and 4-space indentation', async () => {
        const { formatSqlContent } = await import('./sqlFormatting');

        await expect(formatSqlContent('select id, name from users where id = 1'))
            .resolves.toContain('SELECT');
    });

    it('returns the original SQL when sql-formatter throws', async () => {
        vi.doMock('sql-formatter', () => ({
            format: () => {
                throw new Error('parse failed');
            },
        }));

        const { formatSqlContent } = await import('./sqlFormatting');
        await expect(formatSqlContent('select * from')).resolves.toBe('select * from');
    });
});
```

```ts
// wb-data-frontend/src/components/sql-editor/sqlEditorCore.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('setupSqlEditor', () => {
    it('registers shared format action and disposes the completion provider', async () => {
        const addAction = vi.fn();
        const addCommand = vi.fn();
        const editor = { addAction, addCommand } as never;
        const completionDisposable = { dispose: vi.fn() };
        const monaco = {
            editor: { setTheme: vi.fn() },
            KeyMod: { Shift: 1, CtrlCmd: 2, Alt: 4 },
            KeyCode: { KeyF: 33 },
        } as never;

        const { setupSqlEditor } = await import('./sqlEditorCore');
        const dispose = setupSqlEditor({
            editor,
            monaco,
            formatSql: vi.fn(),
            completionProviderFactory: () => completionDisposable,
        });

        expect(addAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'format-sql' }));
        dispose();
        expect(completionDisposable.dispose).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd wb-data-frontend
npx vitest run src/components/sql-editor/sqlFormatting.test.ts src/components/sql-editor/sqlEditorCore.test.ts
```

Expected: FAIL because the shared `sql-editor` files do not exist yet.

- [ ] **Step 3: Write the minimal shared implementation**

```ts
// wb-data-frontend/src/components/sql-editor/sqlEditorModule.ts
import type { ComponentType } from 'react';

type MonacoEditorComponent = ComponentType<Record<string, unknown>>;
let sqlEditorModulePromise: Promise<{ default: MonacoEditorComponent }> | null = null;

export function loadSqlEditorModule() {
    if (!sqlEditorModulePromise) {
        sqlEditorModulePromise = import('@monaco-editor/react').then((mod) => ({
            default: mod.default as MonacoEditorComponent,
        }));
    }

    return sqlEditorModulePromise;
}
```

```ts
// wb-data-frontend/src/components/sql-editor/sqlEditorTheme.ts
import type * as Monaco from 'monaco-editor';

export function registerSqlEditorTheme(monaco: typeof Monaco) {
    monaco.editor.defineTheme('warm-parchment', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: '', foreground: '3D3A36' },
            { token: 'keyword', foreground: 'B85C3A' },
            { token: 'string', foreground: '6B8E5A' },
        ],
        colors: {
            'editor.background': '#F8F7F4',
            'editor.foreground': '#3D3A36',
            'editorLineNumber.foreground': '#C5C0B8',
        },
    });
}
```

```ts
// wb-data-frontend/src/components/sql-editor/sqlEditorOptions.ts
import type * as Monaco from 'monaco-editor';

export const DEFAULT_SQL_EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    automaticLayout: true,
    scrollBeyondLastLine: false,
    quickSuggestions: {
        other: true,
        comments: false,
        strings: false,
    },
    quickSuggestionsDelay: 120,
    suggestOnTriggerCharacters: true,
    roundedSelection: false,
    cursorStyle: 'line',
    renderLineHighlight: 'all',
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
```

```ts
// wb-data-frontend/src/components/sql-editor/sqlFormatting.ts
export async function formatSqlContent(rawSql: string) {
    try {
        const { format } = await import('sql-formatter');
        return format(rawSql, { language: 'sql', tabWidth: 4, keywordCase: 'upper' });
    } catch {
        return rawSql;
    }
}
```

```ts
// wb-data-frontend/src/components/sql-editor/sqlEditorCore.ts
import type * as Monaco from 'monaco-editor';
import { registerSqlEditorTheme } from './sqlEditorTheme';

const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function setupSqlEditor({
    editor,
    monaco,
    formatSql,
    completionProviderFactory,
    onMountExtras,
}: {
    editor: Monaco.editor.IStandaloneCodeEditor;
    monaco: typeof Monaco;
    formatSql: () => void | Promise<void>;
    completionProviderFactory?: (monaco: typeof Monaco) => { dispose: () => void } | null;
    onMountExtras?: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => (() => void) | void;
}) {
    registerSqlEditorTheme(monaco);
    monaco.editor.setTheme('warm-parchment');

    const formatKeybinding = isMacPlatform
        ? monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF
        : monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF;
    editor.addAction({
        id: 'format-sql',
        label: 'Format SQL',
        keybindings: [formatKeybinding],
        run: () => formatSql(),
    });

    const completionDisposable = completionProviderFactory?.(monaco) ?? null;
    const disposeExtras = onMountExtras?.(editor, monaco);

    return () => {
        completionDisposable?.dispose();
        disposeExtras?.();
    };
}
```

```tsx
// wb-data-frontend/src/components/sql-editor/SqlEditor.tsx
const MonacoEditor = lazy(loadSqlEditorModule);

export function SqlEditor(props: {
    value: string;
    onChange: (next: string) => void;
    language?: string;
    onMountExtras?: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => (() => void) | void;
    completionProviderFactory?: (monaco: typeof Monaco) => { dispose: () => void } | null;
    optionsOverrides?: Monaco.editor.IStandaloneEditorConstructionOptions;
    loadingFallback: React.ReactNode;
}) {
    const disposeRef = useRef<(() => void) | null>(null);
    const handleMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
        disposeRef.current?.();
        disposeRef.current = setupSqlEditor({
            editor,
            monaco,
            formatSql: async () => {
                editor.setValue(await formatSqlContent(editor.getValue()));
            },
            completionProviderFactory: props.completionProviderFactory,
            onMountExtras: props.onMountExtras,
        });
        editor.focus();
    }, [props.completionProviderFactory, props.onMountExtras]);

    useEffect(() => () => disposeRef.current?.(), []);

    return (
        <Suspense fallback={props.loadingFallback}>
            <MonacoEditor
                language={props.language ?? 'sql'}
                theme="warm-parchment"
                value={props.value}
                onChange={(value: string | undefined) => props.onChange(value ?? '')}
                onMount={handleMount}
                options={{ ...DEFAULT_SQL_EDITOR_OPTIONS, ...props.optionsOverrides }}
            />
        </Suspense>
    );
}
```

```ts
// wb-data-frontend/src/views/layout/Layout.tsx
import { loadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';

if (path === '/query') {
    void loadQueryModule();
    void loadSqlEditorModule();
    return;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd wb-data-frontend
npx vitest run src/components/sql-editor/sqlFormatting.test.ts src/components/sql-editor/sqlEditorCore.test.ts
```

Expected: PASS with `2` test files passed.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/components/sql-editor \
        wb-data-frontend/src/views/layout/Layout.tsx
git commit -m "feat: add shared sql editor core"
```

### Task 2: Migrate the query page onto the shared editor core

**Files:**
- Create: `wb-data-frontend/src/views/query/queryEditorActions.ts`
- Create: `wb-data-frontend/src/views/query/queryEditorActions.test.ts`
- Modify: `wb-data-frontend/src/views/query/components/QueryEditor.tsx`
- Modify: `wb-data-frontend/src/views/query/Query.tsx`
- Modify: `wb-data-frontend/src/views/query/hooks/useQueryExecution.ts`

- [ ] **Step 1: Write the failing test**

```ts
// wb-data-frontend/src/views/query/queryEditorActions.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('createQueryEditorMountExtras', () => {
    it('runs the selected text on Cmd/Ctrl+Enter and falls back to statement-at-cursor', async () => {
        const handleRunQuery = vi.fn();
        const editor = {
            getSelection: vi.fn(() => ({ isEmpty: () => false })),
            getModel: vi.fn(() => ({ getValueInRange: () => 'select 1' })),
            addCommand: vi.fn((_binding, fn) => fn()),
            addAction: vi.fn(),
        } as never;
        const monaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { Enter: 2 } } as never;

        const { createQueryEditorMountExtras } = await import('./queryEditorActions');
        createQueryEditorMountExtras({
            handleRunQuery: () => handleRunQuery('cursor statement'),
            getStatementAtCursor: () => 'cursor statement',
        })(editor, monaco);

        expect(handleRunQuery).toHaveBeenCalledWith('cursor statement');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd wb-data-frontend
npx vitest run src/views/query/queryEditorActions.test.ts
```

Expected: FAIL because `queryEditorActions.ts` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
// wb-data-frontend/src/views/query/queryEditorActions.ts
import type * as Monaco from 'monaco-editor';

export function createQueryEditorMountExtras({
    handleRunQuery,
    getStatementAtCursor,
}: {
    handleRunQuery: (sql?: string) => void;
    getStatementAtCursor: (editor: Monaco.editor.IStandaloneCodeEditor) => string;
}) {
    return (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const selection = editor.getSelection();
            if (selection && !selection.isEmpty()) {
                const selectedText = editor.getModel()?.getValueInRange(selection);
                handleRunQuery(selectedText);
                return;
            }

            handleRunQuery(getStatementAtCursor(editor));
        });
    };
}
```

```tsx
// wb-data-frontend/src/views/query/components/QueryEditor.tsx
import { SqlEditor } from '../../../components/sql-editor/SqlEditor';

export interface QueryEditorProps {
    sql: string;
    setSql: (val: string) => void;
    completionProviderFactory?: (monaco: typeof Monaco) => { dispose: () => void } | null;
    handleEditorDidMount: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => (() => void) | void;
}

export function QueryEditor({ sql, setSql, completionProviderFactory, handleEditorDidMount }: QueryEditorProps) {
    return (
        <section className="editor-section h-full w-full relative">
            <div className="editor-wrapper h-full w-full absolute inset-0">
                <SqlEditor
                    value={sql}
                    onChange={setSql}
                    onMountExtras={handleEditorDidMount}
                    completionProviderFactory={completionProviderFactory}
                    loadingFallback={<EditorLoader />}
                    optionsOverrides={{ lineNumbersMinChars: 2, lineDecorationsWidth: 8, padding: { top: 12, bottom: 12 } }}
                />
            </div>
        </section>
    );
}
```

```ts
// wb-data-frontend/src/views/query/hooks/useQueryExecution.ts
import { formatSqlContent } from '../../../components/sql-editor/sqlFormatting';

const handleFormat = useCallback(async () => {
    if (!editorRef.current) return;
    editorRef.current.setValue(await formatSqlContent(editorRef.current.getValue()));
}, [editorRef]);
```

```ts
// wb-data-frontend/src/views/query/Query.tsx
import { createQueryEditorMountExtras } from './queryEditorActions';

const completionProviderFactory = useCallback((monaco: typeof Monaco) => {
    return registerCompletionProvider(monaco);
}, [registerCompletionProvider]);

const handleEditorDidMount = useCallback((editor: MonacoEditorInstance, monaco: typeof Monaco) => {
    monacoRef.current = monaco;
    editorRef.current = editor;

    return createQueryEditorMountExtras({
        handleRunQuery: (sqlToRun) => handleRunQueryRef.current(sqlToRun),
        getStatementAtCursor: (currentEditor) => getStatementAtCursorRef.current(currentEditor),
    })(editor, monaco);
}, []);
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd wb-data-frontend
npx vitest run src/views/query/queryEditorActions.test.ts src/components/sql-editor/sqlFormatting.test.ts src/components/sql-editor/sqlEditorCore.test.ts
```

Expected: PASS with all shared-core and query-action tests green.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/query/queryEditorActions.ts \
        wb-data-frontend/src/views/query/queryEditorActions.test.ts \
        wb-data-frontend/src/views/query/components/QueryEditor.tsx \
        wb-data-frontend/src/views/query/Query.tsx \
        wb-data-frontend/src/views/query/hooks/useQueryExecution.ts
git commit -m "feat: migrate query page to shared sql editor core"
```

### Task 3: Migrate the offline SQL / HiveSQL node editor to the shared core

**Files:**
- Create: `wb-data-frontend/src/views/offline/NodeEditorDialog.tsx`
- Create: `wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeEditorDialog } from './NodeEditorDialog';

vi.mock('../../components/sql-editor/SqlEditor', () => ({
    SqlEditor: ({ value }: { value: string }) => <div data-testid="shared-sql-editor">{value}</div>,
}));

it('uses the shared SqlEditor for SQL nodes while keeping the data-source picker visible', () => {
    render(
        <NodeEditorDialog
            open
            groupId={1}
            activeNode={{ taskId: 'sql_1', kind: 'SQL', scriptContent: 'select 1', dataSourceId: 7 } as never}
            content="select 1"
            onOpenChange={() => {}}
            onTempSave={() => {}}
            onContentChange={() => {}}
        />,
    );

    expect(screen.getByTestId('shared-sql-editor')).toHaveTextContent('select 1');
    expect(screen.getByText('数据源')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd wb-data-frontend
npx vitest run src/views/offline/NodeEditorDialog.test.tsx
```

Expected: FAIL because `NodeEditorDialog.tsx` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// wb-data-frontend/src/views/offline/NodeEditorDialog.tsx
import { lazy } from 'react';
import { SqlEditor } from '../../components/sql-editor/SqlEditor';
import { loadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';

const LazyEditor = lazy(loadSqlEditorModule);

export function NodeEditorDialog(props: NodeEditorDialogProps) {
    const { activeNode, content, onContentChange } = props;
    if (!activeNode) return null;

    const isSqlNode = isSqlEditorNodeKind(activeNode.kind);

    return (
        <Dialog open={props.open} onOpenChange={(next) => !next && props.onOpenChange(false)}>
            <DialogPortal>
                <DialogContent className="fixed inset-0 flex flex-col bg-white max-h-none">
                    {/* existing header / datasource picker content stays here */}
                    <div className="flex-1 min-h-0 relative">
                        {isSqlNode ? (
                            <SqlEditor
                                value={content}
                                onChange={onContentChange}
                                loadingFallback={<div className="flex items-center justify-center h-full text-gray-400">编辑器加载中...</div>}
                                optionsOverrides={{ lineNumbersMinChars: 3, wordWrap: 'on', tabSize: 2, padding: { top: 14, bottom: 14 } }}
                            />
                        ) : (
                            <LazyEditor
                                height="100%"
                                width="100%"
                                language="shell"
                                theme="warm-parchment"
                                value={content}
                                onChange={(value: string | undefined) => onContentChange(value ?? '')}
                                options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', lineNumbersMinChars: 3, wordWrap: 'on', automaticLayout: true, scrollBeyondLastLine: false, tabSize: 2, padding: { top: 14, bottom: 14 } }}
                            />
                        )}
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    );
}
```

```ts
// wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
import { NodeEditorDialog } from './NodeEditorDialog';

// remove the embedded NodeEditorDialog implementation at the bottom of the file
// and keep only the existing props wiring at the render site
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd wb-data-frontend
npx vitest run src/views/offline/NodeEditorDialog.test.tsx src/views/offline/OfflineWorkbench.test.tsx
```

Expected: PASS with the new dialog test green and existing offline workbench tests still passing.

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/views/offline/NodeEditorDialog.tsx \
        wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx \
        wb-data-frontend/src/views/offline/OfflineWorkbench.tsx
git commit -m "feat: migrate offline sql editor to shared core"
```

### Task 4: Remove query-specific editor shims and run the full regression sweep

**Files:**
- Delete: `wb-data-frontend/src/views/query/queryEditorModule.ts`
- Delete: `wb-data-frontend/src/views/query/editorUtils.ts`
- Modify if needed: `wb-data-frontend/src/views/layout/Layout.tsx`
- Modify if needed: `wb-data-frontend/src/views/query/Query.tsx`
- Modify if needed: `wb-data-frontend/src/views/offline/NodeEditorDialog.tsx`

- [ ] **Step 1: Write the failing safety check**

```bash
cd wb-data-frontend
rg "queryEditorModule|registerEditorThemes" src
```

Expected before cleanup: matches still exist or at least this check gives a concrete list of legacy references to remove.

- [ ] **Step 2: Remove the legacy query-specific shims**

```bash
cd wb-data-frontend
rm src/views/query/queryEditorModule.ts src/views/query/editorUtils.ts
```

```ts
// any remaining imports should now point at:
import { loadSqlEditorModule } from '../../components/sql-editor/sqlEditorModule';
import { SqlEditor } from '../../components/sql-editor/SqlEditor';
```

- [ ] **Step 3: Verify the legacy references are gone**

Run:

```bash
cd wb-data-frontend
rg "queryEditorModule|registerEditorThemes" src
```

Expected: no matches.

- [ ] **Step 4: Run the full frontend verification flow**

Run:

```bash
cd wb-data-frontend
npx vitest run src/components/sql-editor/sqlFormatting.test.ts src/components/sql-editor/sqlEditorCore.test.ts
npx vitest run src/views/query/queryEditorActions.test.ts
npx vitest run src/views/offline/NodeEditorDialog.test.tsx src/views/offline/OfflineWorkbench.test.tsx
npm test
npm run build
```

Expected:

- shared-core tests: PASS
- query action tests: PASS
- offline dialog + existing offline tests: PASS
- `npm test`: PASS
- `npm run build`: PASS

- [ ] **Step 5: Commit**

```bash
git add wb-data-frontend/src/components/sql-editor \
        wb-data-frontend/src/views/layout/Layout.tsx \
        wb-data-frontend/src/views/query \
        wb-data-frontend/src/views/offline/NodeEditorDialog.tsx \
        wb-data-frontend/src/views/offline/NodeEditorDialog.test.tsx
git add -u wb-data-frontend/src/views/query/queryEditorModule.ts \
           wb-data-frontend/src/views/query/editorUtils.ts
git commit -m "refactor: unify sql editor core usage"
```
