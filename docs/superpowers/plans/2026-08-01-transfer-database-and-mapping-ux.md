# Transfer Database Selection and Mapping UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source and target database selection to Transfer nodes, restore reliable field-mapping rendering, expose metadata failures, and make Transfer canvas nodes use the shared node style.

**Architecture:** Extend the group-scoped Transfer metadata controller with database discovery backed by the existing data-source plugin API. Keep endpoint selections in `TransferNodeDialog`, move asynchronous source/target metadata loading into a symmetric hook resource model, and isolate default-database selection in a pure helper. Preserve the shared canvas container and distinguish Transfer only through its type badge.

**Tech Stack:** Spring Boot 3, Java 21, JUnit 5, Mockito, React 18, TypeScript, Axios, Vitest, Testing Library, CSS design tokens.

## Global Constraints

- Work in the current checkout without staging or reverting unrelated dirty files.
- Every commit stages only the files listed by its task.
- Keep Transfer metadata behind group-scoped Transfer endpoints; do not depend on SQL Query metadata endpoints.
- Selecting a data source automatically selects its configured default database when available.
- A new endpoint may select its only available database when the configured default is unavailable.
- Preserve a saved database when available; an unavailable saved database remains invalid until the user chooses a replacement.
- Tables load only after a database is selected, and every table or metadata request includes `databaseName`.
- Changing data source, database, or table clears dependent metadata, field mappings, and partition mappings.
- Metadata loading, failure, retry, and empty-column states must be visible.
- Mapping remains target-driven and defaults same-name source fields.
- Hive partition fields remain separate and system-detected.
- Transfer canvas nodes use the shared node container; only the Transfer badge keeps its distinct color.
- Do not change SeaTunnel execution architecture, write-mode semantics, or SQL-expression dialect behavior.

---

### Task 1: Group-Scoped Transfer Database Metadata Endpoint

**Files:**

- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/transfer/service/TransferMetadataService.java:35`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/transfer/controller/TransferMetadataController.java:33`
- Test: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/transfer/service/TransferMetadataServiceTest.java`
- Test: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/transfer/controller/TransferMetadataControllerPermissionTest.java`

**Interfaces:**

- Consumes: `DataSourcePlugin#getDatabases(DataSourceConnectionInfo)` and existing `requireSupportedDataSource(Long)`.
- Produces: `TransferMetadataService#getDatabases(Long): List<String>` and `GET /api/v1/groups/{groupId}/offline/transfer/datasources/{dataSourceId}/databases`.

- [ ] **Step 1: Write failing service and controller tests**

Add a service test that verifies plugin delegation:

```java
@Test
void returnsDatabasesFromSupportedDatasourcePlugin() {
    DataSourceService dataSourceService = mock(DataSourceService.class);
    DataSourcePluginRegistry pluginRegistry = mock(DataSourcePluginRegistry.class);
    DataSourcePlugin plugin = mock(DataSourcePlugin.class);
    DataSource source = dataSource(11L, "MYSQL");
    when(dataSourceService.getById(11L)).thenReturn(source);
    when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
    when(plugin.getDatabases(org.mockito.ArgumentMatchers.any()))
            .thenReturn(List.of("transfer_demo", "archive"));

    TransferMetadataService service = new TransferMetadataService(dataSourceService, pluginRegistry);

    assertThat(service.getDatabases(11L)).containsExactly("transfer_demo", "archive");
}
```

Extend the controller permission test to reflect `getDatabases`, assert `OFFLINE_READ`, call the method with a group-owned data source, and verify `DATASOURCE_READ` plus `metadataService.getDatabases(11676L)`.

Add two boundary assertions:

```java
assertThatThrownBy(() -> controller.getDatabases(null, 5L, 11676L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("404 NOT_FOUND");

when(dataSourceService.getById(12L)).thenReturn(dataSource(12L, "ORACLE"));
assertThatThrownBy(() -> service.getDatabases(12L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("暂不支持的数据源类型: ORACLE");
```

- [ ] **Step 2: Run the focused backend tests and verify red**

Run:

```bash
cd wb-data-server
mvn -q -pl wb-data-backend -Dtest=TransferMetadataServiceTest,TransferMetadataControllerPermissionTest test
```

Expected: compilation fails because `getDatabases` does not exist on the service or controller.

- [ ] **Step 3: Add the minimal service and controller implementation**

Add to `TransferMetadataService`:

```java
public List<String> getDatabases(Long dataSourceId) {
    DataSource dataSource = requireSupportedDataSource(dataSourceId);
    return pluginRegistry.getPlugin(dataSource.getType())
            .map(plugin -> plugin.getDatabases(buildConnectionInfo(dataSource)))
            .orElseThrow(() -> unsupportedType(dataSource.getType()));
}
```

Add to `TransferMetadataController`:

```java
@Operation(summary = "获取 Transfer 数据源数据库列表")
@GetMapping("/databases")
public Result<List<String>> getDatabases(
        @RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
        @PathVariable Long groupId,
        @PathVariable Long dataSourceId) {
    requireDataSourceInGroup(dataSourceId, groupId);
    return Result.success(transferMetadataService.getDatabases(dataSourceId));
}
```

- [ ] **Step 4: Re-run focused backend tests and verify green**

Run the Step 2 command. Expected: both test classes pass.

- [ ] **Step 5: Commit the backend endpoint**

```bash
git add wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/transfer/service/TransferMetadataService.java \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/transfer/controller/TransferMetadataController.java \
  wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/transfer/service/TransferMetadataServiceTest.java \
  wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/transfer/controller/TransferMetadataControllerPermissionTest.java
git commit -m "feat(offline): expose transfer databases"
```

### Task 2: Transfer API and Default-Database Selection Contract

**Files:**

- Modify: `wb-data-frontend/src/api/transfer.ts`
- Test: `wb-data-frontend/src/api/transfer.test.ts`
- Create: `wb-data-frontend/src/views/offline/transfer/transferDatabaseSelection.ts`
- Create: `wb-data-frontend/src/views/offline/transfer/transferDatabaseSelection.test.ts`

**Interfaces:**

- Consumes: Task 1 `GET .../databases` endpoint and data-source `databaseName` values.
- Produces: `getTransferDatabases(groupId, dataSourceId): Promise<string[]>`, `resolveTransferDatabaseSelection(current, defaultDatabase, available): TransferDatabaseSelection`.

- [ ] **Step 1: Write failing API and pure selection tests**

Extend `transfer.test.ts`:

```ts
await getTransferDatabases(4, 11676);
expect(requestMock.get).toHaveBeenCalledWith(
    '/api/v1/groups/4/offline/transfer/datasources/11676/databases',
);
```

Create pure helper tests covering all selection rules:

```ts
expect(resolveTransferDatabaseSelection(undefined, 'transfer_demo', ['transfer_demo', 'archive']))
    .toEqual({ database: 'transfer_demo', unavailable: false });
expect(resolveTransferDatabaseSelection(undefined, 'missing', ['default']))
    .toEqual({ database: 'default', unavailable: false });
expect(resolveTransferDatabaseSelection(undefined, 'missing', ['a', 'b']))
    .toEqual({ database: undefined, unavailable: false });
expect(resolveTransferDatabaseSelection('archive', 'transfer_demo', ['transfer_demo', 'archive']))
    .toEqual({ database: 'archive', unavailable: false });
expect(resolveTransferDatabaseSelection('removed', 'transfer_demo', ['transfer_demo']))
    .toEqual({ database: 'removed', unavailable: true });
```

- [ ] **Step 2: Run tests and verify red**

```bash
cd wb-data-frontend
npx vitest run src/api/transfer.test.ts src/views/offline/transfer/transferDatabaseSelection.test.ts
```

Expected: tests fail because the API function and helper module do not exist.

- [ ] **Step 3: Implement the API and pure helper**

Add to `transfer.ts`:

```ts
export const getTransferDatabases = (groupId: number, dataSourceId: number) => {
    return request.get<unknown, string[]>(
        groupScopedPath(groupId, `/offline/transfer/datasources/${dataSourceId}/databases`),
    );
};
```

Create `transferDatabaseSelection.ts`:

```ts
export interface TransferDatabaseSelection {
    database: string | undefined;
    unavailable: boolean;
}

export function resolveTransferDatabaseSelection(
    current: string | undefined,
    defaultDatabase: string | undefined,
    available: string[],
): TransferDatabaseSelection {
    if (current) {
        return { database: current, unavailable: !available.includes(current) };
    }
    if (defaultDatabase && available.includes(defaultDatabase)) {
        return { database: defaultDatabase, unavailable: false };
    }
    return {
        database: available.length === 1 ? available[0] : undefined,
        unavailable: false,
    };
}
```

- [ ] **Step 4: Re-run tests and verify green**

Run the Step 2 command. Expected: both test files pass.

- [ ] **Step 5: Commit the frontend metadata contract**

```bash
git add wb-data-frontend/src/api/transfer.ts \
  wb-data-frontend/src/api/transfer.test.ts \
  wb-data-frontend/src/views/offline/transfer/transferDatabaseSelection.ts \
  wb-data-frontend/src/views/offline/transfer/transferDatabaseSelection.test.ts
git commit -m "feat(offline): add transfer database selection contract"
```

### Task 3: Symmetric Transfer Metadata Resource State

**Files:**

- Modify: `wb-data-frontend/src/views/offline/transfer/useTransferMetadata.ts`
- Test: `wb-data-frontend/src/views/offline/transfer/useTransferMetadata.test.tsx`

**Interfaces:**

- Consumes: `getTransferDatabases`, `getTransferTables`, `getTransferTableMetadata`.
- Produces:

```ts
export interface TransferAsyncResource<T> {
    data: T;
    loading: boolean;
    error: string | null;
    retry: () => void;
}

export interface TransferEndpointMetadataState {
    databases: TransferAsyncResource<string[]>;
    tables: TransferAsyncResource<string[]>;
    metadata: TransferAsyncResource<TransferTableMetadataResponse | null>;
}
```

`useTransferMetadata(...)` returns `{ dataSources, source, target }`, where `source` and `target` are `TransferEndpointMetadataState`.

- [ ] **Step 1: Update mocks and write failing hook tests**

Mock `getTransferDatabases`. Add tests proving:

```ts
expect(getTransferDatabases).toHaveBeenCalledWith(1, 11);
expect(getTransferTables).not.toHaveBeenCalled(); // no database selected yet
```

After rerender with `sourceDatabase: 'transfer_demo'`:

```ts
expect(getTransferTables).toHaveBeenCalledWith(1, 11, {
    databaseName: 'transfer_demo',
    page: 1,
    size: 200,
});
```

Reject the first table request, assert `result.current.source.tables.error` is visible, invoke `retry`, then resolve the second request and assert the table names replace the error. Retain the existing A-B-A stale-response tests and extend their selection key to include database.

- [ ] **Step 2: Run the hook tests and verify red**

```bash
cd wb-data-frontend
npx vitest run src/views/offline/transfer/useTransferMetadata.test.tsx
```

Expected: tests fail because the hook does not expose endpoint resources, does not load databases, and calls tables before a database is selected.

- [ ] **Step 3: Implement focused resource hooks and an endpoint composer**

Keep one public hook and remove duplicated source/target effects through three focused resource hooks and one endpoint composer:

```ts
function useTransferDatabasesResource(
    groupId: number | null,
    dataSourceId?: number,
): TransferAsyncResource<string[]>;

function useTransferTablesResource(
    groupId: number | null,
    dataSourceId?: number,
    database?: string,
): TransferAsyncResource<string[]>;

function useTransferTableMetadataResource(
    groupId: number | null,
    dataSourceId?: number,
    database?: string,
    table?: string,
): TransferAsyncResource<TransferTableMetadataResponse | null>;

function useTransferEndpointMetadata(
    groupId: number | null,
    dataSourceId?: number,
    database?: string,
    table?: string,
): TransferEndpointMetadataState {
    return {
        databases: useTransferDatabasesResource(groupId, dataSourceId),
        tables: useTransferTablesResource(groupId, dataSourceId, database),
        metadata: useTransferTableMetadataResource(groupId, dataSourceId, database, table),
    };
}

export function useTransferMetadata(
    groupId: number | null,
    sourceDataSourceId?: number,
    sourceDatabase?: string,
    sourceTable?: string,
    targetDataSourceId?: number,
    targetDatabase?: string,
    targetTable?: string,
) {
    const source = useTransferEndpointMetadata(
        groupId, sourceDataSourceId, sourceDatabase, sourceTable,
    );
    const target = useTransferEndpointMetadata(
        groupId, targetDataSourceId, targetDatabase, targetTable,
    );
    return { dataSources, source, target };
}
```

For each resource:

- Reset data synchronously when prerequisites change.
- Set `loading` only while a request is active.
- Preserve the current database or table selection in the caller; clear only loaded resource data.
- Convert rejection to a concise Chinese message: `数据库加载失败`、`表加载失败`、`字段元数据加载失败`.
- Use a retry counter in effect dependencies.
- Ignore responses after cleanup so stale selections cannot win.
- Require non-empty `database` before table or metadata requests.
- Always pass `{ databaseName: database, page: 1, size: 200 }` to table requests.

- [ ] **Step 4: Re-run hook tests and verify green**

Run the Step 2 command. Expected: all old and new hook tests pass.

- [ ] **Step 5: Commit the hook resource model**

```bash
git add wb-data-frontend/src/views/offline/transfer/useTransferMetadata.ts \
  wb-data-frontend/src/views/offline/transfer/useTransferMetadata.test.tsx
git commit -m "refactor(offline): model transfer metadata states"
```

### Task 4: Database Controls and Explicit Mapping States

**Files:**

- Modify: `wb-data-frontend/src/views/offline/transfer/TransferNodeDialog.tsx`
- Modify: `wb-data-frontend/src/views/offline/transfer/TransferNodeDialog.css`
- Modify: `wb-data-frontend/src/views/offline/transfer/transferValidation.ts`
- Test: `wb-data-frontend/src/views/offline/transfer/TransferNodeDialog.test.tsx`
- Test: `wb-data-frontend/src/views/offline/transfer/transferValidation.test.ts`

**Interfaces:**

- Consumes: Task 2 `resolveTransferDatabaseSelection` and Task 3 `{ dataSources, source, target }` metadata state.
- Produces: complete `TransferConfig` drafts with non-empty source and target databases, visible mapping status, and retryable errors.

- [ ] **Step 1: Rewrite the dialog mock shape and add failing behavior tests**

Represent source and target resources in the mock:

```ts
source: {
    databases: { data: ['transfer_demo'], loading: false, error: null, retry: vi.fn() },
    tables: { data: ['orders'], loading: false, error: null, retry: vi.fn() },
    metadata: { data: sourceMetadata, loading: false, error: null, retry: vi.fn() },
},
```

Add tests for:

- Source and target `数据库` selects appear between data source and table.
- Configured defaults `transfer_demo` and `default` are automatically emitted into the draft.
- An unavailable saved database stays selected as invalid and is not silently replaced.
- Changing a data source, database, or table clears its dependent selection plus `fieldMappings` and `partitions`.
- Table selectors stay disabled until a database is selected.
- A database-list failure renders `数据库加载失败`, disables the table select, and wires `重试` to the database retry action.
- A table-list failure renders `表加载失败`, preserves the selected database, and wires `重试` to the table retry action.
- Loading text appears while metadata loads.
- Source and target metadata rejections identify the failing side, render `字段元数据加载失败`, and wire `重试` to the corresponding retry action.
- Target columns render mapping rows after both metadata resources are ready.
- A missing same-name source field renders `目标字段 amount 尚未配置映射` beside its row.
- A zero-column target renders `目标表没有可传输字段`.

Extend validation tests:

```ts
expect(validateTransferConfig(configWithoutSourceDatabase, ['id'], []).errors)
    .toContain('请选择来源数据库');
expect(validateTransferConfig(configWithoutTargetDatabase, ['id'], []).errors)
    .toContain('请选择目标数据库');
```

- [ ] **Step 2: Run component and validation tests and verify red**

```bash
cd wb-data-frontend
npx vitest run src/views/offline/transfer/TransferNodeDialog.test.tsx \
  src/views/offline/transfer/transferValidation.test.ts
```

Expected: tests fail because database controls, resource states, row-level feedback, and database validation are missing.

- [ ] **Step 3: Implement dependency-reset handlers and default selection**

Use functional state updates so asynchronous effects never patch stale config:

```ts
const selectEndpoint = (side: 'source' | 'target', id: number) => {
    const selected = dataSources.find((item) => item.id === id);
    setConfig((current) => ({
        ...current,
        [side]: {
            ...current[side],
            dataSourceId: id,
            dataSourceType: (selected?.type ?? 'MYSQL') as TransferDataSourceType,
            database: undefined,
            table: '',
        },
        fieldMappings: [],
        partitions: [],
    }));
};
```

Create matching `selectDatabase` and `selectTable` handlers. Both clear mappings and partitions; database changes also clear the table. After database options load, call `resolveTransferDatabaseSelection` with the current database and the selected data source's `databaseName`. Patch only when the resolved value differs.

- [ ] **Step 4: Render database controls and mapping resource states**

Render endpoint controls in this order:

```tsx
<label className="transfer-node-field">
    数据库
    <select value={config.source.database ?? ''} disabled={!config.source.dataSourceId || source.databases.loading}>
        <option value="">选择数据库</option>
        {source.databases.data.map((database) => <option key={database}>{database}</option>)}
    </select>
</label>
```

If the saved value is unavailable, render a disabled option for that exact value and an inline error requiring replacement. Use one compact status component for prerequisite, loading, error with retry, and empty-target states. Render `MappingRows` only when both metadata resources are ready. Mark an empty mapping value with an inline row error rather than relying only on the summary.

Update `saveable` to require source database, target database, source metadata, target metadata, valid write mode, and `validateTransferConfig(...).valid`.

- [ ] **Step 5: Align Transfer editor CSS with existing tokens**

Replace hard-coded grays and white with existing variables:

```css
.transfer-node-dialog { color: var(--color-text-primary); }
.transfer-node-panel { border-color: var(--color-border); background: var(--color-bg-primary); }
.transfer-node-field input,
.transfer-node-field select {
    border-color: var(--color-input-border);
    background: var(--color-input-bg);
    color: var(--color-text-primary);
}
.transfer-node-status.is-error,
.transfer-node-mapping-error { color: var(--color-error); }
```

Keep the existing two-column-to-one-column responsive breakpoint and stable three-column mapping-row layout.

- [ ] **Step 6: Re-run Transfer frontend tests and verify green**

```bash
cd wb-data-frontend
npx vitest run src/views/offline/transfer
```

Expected: all Transfer API-independent frontend tests pass.

- [ ] **Step 7: Commit the Transfer editor behavior**

```bash
git add wb-data-frontend/src/views/offline/transfer/TransferNodeDialog.tsx \
  wb-data-frontend/src/views/offline/transfer/TransferNodeDialog.css \
  wb-data-frontend/src/views/offline/transfer/transferValidation.ts \
  wb-data-frontend/src/views/offline/transfer/TransferNodeDialog.test.tsx \
  wb-data-frontend/src/views/offline/transfer/transferValidation.test.ts
git commit -m "feat(offline): add transfer database controls"
```

### Task 5: Shared Canvas Style and End-to-End Regression

**Files:**

- Modify: `wb-data-frontend/src/views/offline/FlowCanvasNode.tsx:106`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css:436`
- Create: `wb-data-frontend/src/views/offline/FlowCanvasNode.test.tsx`
- Create after verification: `docs/validation/2026-08-01-transfer-database-selection.md`
- Create after verification: `docs/validation/assets/2026-08-01-transfer-database-selection.png`

**Interfaces:**

- Consumes: completed database and mapping editor behavior from Tasks 1-4.
- Produces: shared canvas-node container classes and recorded API/UI/runtime evidence.

- [ ] **Step 1: Write a failing canvas class test**

Mock `Handle`, `Position`, and tooltip primitives, render a Transfer node, and assert:

```ts
const node = container.querySelector('.flow-canvas-node');
expect(node?.classList.contains('is-transfer')).toBe(false);
expect(screen.getByText('Transfer').classList.contains('is-transfer')).toBe(true);
```

- [ ] **Step 2: Run the canvas test and verify red**

```bash
cd wb-data-frontend
npx vitest run src/views/offline/FlowCanvasNode.test.tsx
```

Expected: the container still has `is-transfer`.

- [ ] **Step 3: Remove only the Transfer container override**

Change the container class expression to omit the kind-specific class:

```tsx
<div className={`flow-canvas-node${rfSelected ? ' is-rf-selected' : ''}${data.selected ? ' is-checked' : ''}${data.status ? ` has-status is-${data.status.toLowerCase()}` : ''}`}>
```

Delete `.flow-canvas-node.is-transfer` from `OfflineWorkbench.css`. Keep `.flow-canvas-node-kind.is-transfer` unchanged.

- [ ] **Step 4: Run focused tests, lint, build, and backend tests**

```bash
cd wb-data-frontend
npx vitest run src/api/transfer.test.ts src/views/offline/transfer src/views/offline/FlowCanvasNode.test.tsx src/views/offline/NodeEditorDialog.test.tsx
npm run lint
npm run build

cd ../wb-data-server
mvn -q -pl wb-data-backend -Dtest=TransferMetadataServiceTest,TransferMetadataControllerPermissionTest,TransferExecutionRenderServiceTest,TransferSeatunnelConfigBuilderTest,TransferSqlBuilderTest test
```

Expected: every command exits 0.

- [ ] **Step 5: Restart backend and frontend from the current checkout**

Use the existing local environment variables documented in `docs/local-integration-testing.md`. Rebuild runtime plugins if backend plugin artifacts changed; Task 1 changes only backend code, so a backend restart is sufficient here. Start backend on `8080` and Vite on `5173`, using another free port only if either port is occupied by an unrelated process.

- [ ] **Step 6: Verify the live metadata chain through HTTP**

After login, verify:

```text
GET /api/v1/groups/4/offline/transfer/datasources/11678/databases
=> includes transfer_demo

GET /api/v1/groups/4/offline/transfer/datasources/11679/databases
=> includes default

GET /api/v1/groups/4/offline/transfer/datasources/11679/tables/transfer_orders_partitioned_target/metadata?databaseName=default
=> normal columns plus partition column dayno
```

Do not print the bearer token in logs or the final report.

- [ ] **Step 7: Verify the live editor and canvas**

Open a Transfer node in the running frontend and verify:

1. MySQL automatically selects `transfer_demo`.
2. Hive automatically selects `default`.
3. Switching MySQL to another available database replaces its table options and clears mappings.
4. Returning to `transfer_demo` and choosing `transfer_orders_source` loads source columns.
5. Choosing Hive `transfer_orders_partitioned_target` renders normal fields and the `dayno` partition mapping.
6. A missing target source field is visible and blocks a valid draft.
7. The Transfer canvas node matches SQL/Shell dimensions and surface while retaining its Transfer badge.

Capture the desktop comparison as `docs/validation/assets/2026-08-01-transfer-database-selection.png` and inspect browser console/network failures.

- [ ] **Step 8: Run one transfer regression and record evidence**

Save a MySQL-to-Hive Transfer node with a valid partition mapping, run it through the existing debug/Kestra path, and verify the target partition rows. Create `docs/validation/2026-08-01-transfer-database-selection.md` containing the selected databases, execution id, target-row result, focused test commands, and screenshot path. Do not modify or stage the already-dirty `docs/validation/2026-07-19-transfer-node.md` in this task.

- [ ] **Step 9: Commit canvas consistency and validation evidence**

```bash
git add wb-data-frontend/src/views/offline/FlowCanvasNode.tsx \
  wb-data-frontend/src/views/offline/OfflineWorkbench.css \
  wb-data-frontend/src/views/offline/FlowCanvasNode.test.tsx \
  docs/validation/2026-08-01-transfer-database-selection.md \
  docs/validation/assets/2026-08-01-transfer-database-selection.png
git commit -m "fix(offline): complete transfer metadata editor"
```

- [ ] **Step 10: Final repository hygiene check**

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors; any remaining dirty files are the pre-existing unrelated changes or explicitly reported runtime changes.
