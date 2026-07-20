# Hive Metastore Data Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class Hive Metastore URI support to Hive data sources so SeaTunnel can write Hive targets while HiveSQL and metadata reads continue to use HiveServer2.

**Architecture:** Keep a single `HIVE` data source type. HiveServer2 remains stored in `host`, `port`, `databaseName`, `username`, and `password`; the metastore endpoint is stored as `connectionParams.metastoreUri`. Transfer rendering validates and consumes that value only when the transfer target is Hive.

**Tech Stack:** Spring Boot 3, Java 21, MyBatis-Plus JSON `connection_params`, React 18, TypeScript, Vite/Vitest, Apache Hive Docker image, SeaTunnel Docker runner.

## Global Constraints

- Do not add a separate Hive Metastore data source type.
- Do not require metastore configuration for HiveSQL-only usage.
- Do not ask users to fill metastore settings inside each transfer node.
- Do not store generated SeaTunnel configs or passwords in Git-managed flow files.
- Use existing `connectionParams` storage instead of adding a migration.
- Keep data source list connection display focused on HiveServer2.
- Commit after each task.

---

## File Structure

- `wb-data-server/wb-data-plugin-hive/src/main/java/com/wbdata/plugin/hive/HiveDataSourcePlugin.java`
  - Owns the Hive plugin descriptor exposed to data source management.
- `wb-data-server/wb-data-plugin-hive/src/test/java/com/wbdata/plugin/hive/HiveDataSourcePluginTest.java`
  - Verifies Hive plugin fields and partition parsing.
- `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/transfer/service/TransferExecutionRenderService.java`
  - Validates transfer runtime requirements before SeaTunnel config rendering.
- `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/transfer/service/TransferExecutionRenderServiceTest.java`
  - Verifies Hive target render requirements.
- `wb-data-frontend/src/views/datasources/DataSourceForm.tsx`
  - Renders plugin fields, including non-core connection params.
- `wb-data-frontend/src/views/datasources/DataSourceForm.test.tsx`
  - Covers saving and testing Hive `metastoreUri`.
- `docker-compose.hive.yml`
  - Adds a reusable Hive metastore service.
- `scripts/dev/seed-transfer-datasources.sql`
  - Seeds `it_transfer_hive.connection_params.metastoreUri`.
- `scripts/dev/transfer-smoke.sh`
  - Starts/verifies metastore alongside HiveServer2.
- `docs/local-integration-testing.md`
  - Documents the final local Hive transfer topology.

---

### Task 1: Backend Hive Metastore Field And Transfer Validation

**Files:**
- Modify: `wb-data-server/wb-data-plugin-hive/src/main/java/com/wbdata/plugin/hive/HiveDataSourcePlugin.java`
- Modify: `wb-data-server/wb-data-plugin-hive/src/test/java/com/wbdata/plugin/hive/HiveDataSourcePluginTest.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/transfer/service/TransferExecutionRenderService.java`
- Modify: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/transfer/service/TransferExecutionRenderServiceTest.java`

**Interfaces:**
- Consumes: `DataSource.connectionParams` as `Map<String, Object>`.
- Produces: Hive plugin descriptor field with key `metastoreUri`, section `connectionParams`, label `Hive Metastore URI`, placeholder `thrift://host.docker.internal:9083`.
- Produces: transfer render rejection message `Hive target data source requires connectionParams.metastoreUri`.

- [ ] **Step 1: Write failing Hive plugin descriptor test**

Add this test to `HiveDataSourcePluginTest`:

```java
@Test
void descriptorExposesHiveMetastoreUriConnectionParam() {
    HiveDataSourcePlugin plugin = new HiveDataSourcePlugin();

    assertThat(plugin.descriptor().fields())
            .anySatisfy(field -> {
                assertThat(field.key()).isEqualTo("metastoreUri");
                assertThat(field.section()).isEqualTo("connectionParams");
                assertThat(field.label()).isEqualTo("Hive Metastore URI");
                assertThat(field.placeholder()).isEqualTo("thrift://host.docker.internal:9083");
                assertThat(field.required()).isFalse();
            });
}
```

- [ ] **Step 2: Run plugin test to verify it fails**

Run:

```bash
cd wb-data-server
mvn -q -pl wb-data-plugin-hive -Dtest=HiveDataSourcePluginTest#descriptorExposesHiveMetastoreUriConnectionParam test
```

Expected: fail because `metastoreUri` is not in the descriptor.

- [ ] **Step 3: Add the Hive plugin field**

In `HiveDataSourcePlugin.DESCRIPTOR`, append this field after `databaseName`:

```java
new PluginFieldDescriptor(
        "metastoreUri",
        "connectionParams",
        "Hive Metastore URI",
        "thrift://host.docker.internal:9083",
        "text",
        false,
        null
),
```

- [ ] **Step 4: Run plugin test to verify it passes**

Run:

```bash
cd wb-data-server
mvn -q -pl wb-data-plugin-hive -Dtest=HiveDataSourcePluginTest test
```

Expected: pass.

- [ ] **Step 5: Write failing transfer render validation tests**

Add these tests to `TransferExecutionRenderServiceTest`:

```java
@Test
void hiveTargetWithoutMetastoreUriIsRejectedBeforeRendering() {
    TransferMetadataService metadataService = mock(TransferMetadataService.class);
    DataSource source = dataSource(1L, 4L, "source-password");
    DataSource target = dataSource(2L, 4L, "target-password");
    target.setType("HIVE");
    target.setConnectionParams(Map.of());
    when(metadataService.requireSupportedDataSource(1L)).thenReturn(source);
    when(metadataService.requireSupportedDataSource(2L)).thenReturn(target);
    when(metadataService.getTableDetail(eq(source), eq("sales"), eq("orders"))).thenReturn(table("order_id"));
    when(metadataService.getTableDetail(eq(target), eq("warehouse"), eq("dwd_orders"))).thenReturn(table("order_id"));
    TransferExecutionRenderService service = service(metadataService);

    assertThatThrownBy(() -> service.render("internal-token", hiveTargetRequest()))
            .isInstanceOf(ResponseStatusException.class)
            .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST);
}

@Test
void hiveTargetWithMetastoreUriRendersConfig() {
    TransferMetadataService metadataService = mock(TransferMetadataService.class);
    DataSource source = dataSource(1L, 4L, "source-password");
    DataSource target = dataSource(2L, 4L, "target-password");
    target.setType("HIVE");
    target.setConnectionParams(Map.of("metastoreUri", "thrift://host.docker.internal:9083"));
    when(metadataService.requireSupportedDataSource(1L)).thenReturn(source);
    when(metadataService.requireSupportedDataSource(2L)).thenReturn(target);
    when(metadataService.getTableDetail(eq(source), eq("sales"), eq("orders"))).thenReturn(table("order_id"));
    when(metadataService.getTableDetail(eq(target), eq("warehouse"), eq("dwd_orders"))).thenReturn(table("order_id"));
    TransferExecutionRenderService service = service(metadataService);

    assertThat(service.render("internal-token", hiveTargetRequest()))
            .contains("metastore_uri = \"thrift://host.docker.internal:9083\"");
}

private TransferRenderRequest hiveTargetRequest() {
    TransferConfig config = new TransferConfig(
            new TransferEndpointConfig(1L, "MYSQL", "sales", "orders", null, null),
            new TransferEndpointConfig(2L, "HIVE", "warehouse", "dwd_orders", null, TransferWriteMode.APPEND),
            List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "order_id", null)),
            List.of());
    return new TransferRenderRequest(4L, config.source(), config.target(), config.fieldMappings(), config.partitions());
}
```

Add `java.util.Map` import if missing.

- [ ] **Step 6: Run transfer tests to verify the missing-metastore test fails**

Run:

```bash
cd wb-data-server/wb-data-backend
mvn -q -Dtest=TransferExecutionRenderServiceTest test
```

Expected: fail because render currently falls back to `thrift://host:port`.

- [ ] **Step 7: Implement target Hive metastore validation**

In `TransferExecutionRenderService.render`, after `requireConfiguredType(target, config.target().dataSourceType())`, add:

```java
requireHiveTargetMetastore(target);
```

Add this method:

```java
private void requireHiveTargetMetastore(DataSource target) {
    if (!"HIVE".equals(target.getType())) {
        return;
    }
    Object metastoreUri = target.getConnectionParams() == null
            ? null : target.getConnectionParams().get("metastoreUri");
    if (!(metastoreUri instanceof String uri) || uri.isBlank()) {
        throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Hive target data source requires connectionParams.metastoreUri"
        );
    }
}
```

- [ ] **Step 8: Run focused backend tests**

Run:

```bash
cd wb-data-server/wb-data-backend
mvn -q -Dtest='TransferExecutionRenderServiceTest,TransferSeatunnelConfigBuilderTest,TransferSqlBuilderTest' test
cd ..
mvn -q -pl wb-data-plugin-hive -Dtest=HiveDataSourcePluginTest test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add wb-data-server/wb-data-plugin-hive/src/main/java/com/wbdata/plugin/hive/HiveDataSourcePlugin.java \
  wb-data-server/wb-data-plugin-hive/src/test/java/com/wbdata/plugin/hive/HiveDataSourcePluginTest.java \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/transfer/service/TransferExecutionRenderService.java \
  wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/transfer/service/TransferExecutionRenderServiceTest.java
git commit -m "feat(datasource): expose hive metastore uri"
```

---

### Task 2: Frontend Data Source Form Connection Params

**Files:**
- Inspect: `wb-data-frontend/src/api/datasource.ts`
- Modify: `wb-data-frontend/src/views/datasources/DataSourceForm.tsx`
- Create: `wb-data-frontend/src/views/datasources/DataSourceForm.test.tsx`

**Interfaces:**
- Consumes: plugin fields where `section === "connectionParams"`.
- Produces: form state writes non-core plugin fields to `formData.connectionParams[field.key]`.
- Produces: save/test payload includes `connectionParams.metastoreUri`.

- [ ] **Step 1: Confirm frontend field typing**

Inspect `wb-data-frontend/src/api/datasource.ts` and confirm `PluginField.section` accepts plugin-defined string values such as `connectionParams`. Do not edit the file unless the type is narrower than `string`.

- [ ] **Step 2: Write failing form test**

Create `DataSourceForm.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataSourceForm from './DataSourceForm';
import {
    createDataSource,
    getDataSourceById,
    getDataSourcePlugins,
    testNewConnection,
    updateDataSource,
} from '../../api/datasource';

vi.mock('../../api/datasource', () => ({
    createDataSource: vi.fn(),
    getDataSourceById: vi.fn(),
    getDataSourcePlugins: vi.fn(),
    testNewConnection: vi.fn(),
    updateDataSource: vi.fn(),
}));

const hivePlugin = {
    type: 'HIVE',
    label: 'Hive',
    order: 20,
    helperText: '当前版本通过 HiveServer2 Binary 直连，默认端口 10000。',
    supportsConnectionTest: true,
    fields: [
        { key: 'host', section: 'connection', label: 'HiveServer2 地址', placeholder: 'hive-server.example.com', inputType: 'text', required: true, defaultValue: null },
        { key: 'port', section: 'connection', label: '端口', placeholder: '10000', inputType: 'text', required: true, defaultValue: '10000' },
        { key: 'databaseName', section: 'connection', label: '默认数据库', placeholder: '如：default', inputType: 'text', required: true, defaultValue: 'default' },
        { key: 'metastoreUri', section: 'connectionParams', label: 'Hive Metastore URI', placeholder: 'thrift://host.docker.internal:9083', inputType: 'text', required: false, defaultValue: null },
        { key: 'username', section: 'authentication', label: '用户名', placeholder: 'hive_user', inputType: 'text', required: true, defaultValue: null },
        { key: 'password', section: 'authentication', label: '密码', placeholder: '未配置密码可留空', inputType: 'password', required: false, defaultValue: null },
    ],
};

describe('DataSourceForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getDataSourcePlugins).mockResolvedValue([hivePlugin]);
        vi.mocked(createDataSource).mockResolvedValue(true);
        vi.mocked(updateDataSource).mockResolvedValue(true);
        vi.mocked(testNewConnection).mockResolvedValue({ success: true, message: '连接测试通过' });
        vi.mocked(getDataSourceById).mockResolvedValue(null as never);
    });

    it('saves Hive metastoreUri under connectionParams', async () => {
        render(<DataSourceForm open onOpenChange={vi.fn()} dataSourceId={null} groupId={4} onSuccess={vi.fn()} />);

        fireEvent.change(await screen.findByLabelText(/数据源名称/), { target: { value: 'it_transfer_hive' } });
        fireEvent.change(screen.getByLabelText(/HiveServer2 地址/), { target: { value: 'localhost' } });
        fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'hive' } });
        fireEvent.change(screen.getByLabelText(/Hive Metastore URI/), {
            target: { value: 'thrift://host.docker.internal:9083' },
        });

        fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

        await waitFor(() => {
            expect(createDataSource).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'HIVE',
                    host: 'localhost',
                    port: 10000,
                    databaseName: 'default',
                    username: 'hive',
                    connectionParams: {
                        metastoreUri: 'thrift://host.docker.internal:9083',
                    },
                }),
                4,
            );
        });
    });

    it('includes Hive metastoreUri when testing a new connection', async () => {
        render(<DataSourceForm open onOpenChange={vi.fn()} dataSourceId={null} groupId={4} onSuccess={vi.fn()} />);

        fireEvent.change(await screen.findByLabelText(/HiveServer2 地址/), { target: { value: 'localhost' } });
        fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'hive' } });
        fireEvent.change(screen.getByLabelText(/Hive Metastore URI/), {
            target: { value: 'thrift://host.docker.internal:9083' },
        });

        fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

        await waitFor(() => {
            expect(testNewConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    connectionParams: {
                        metastoreUri: 'thrift://host.docker.internal:9083',
                    },
                }),
                4,
            );
        });
    });
});
```

- [ ] **Step 3: Run form test to verify it fails**

Run:

```bash
cd wb-data-frontend
npm run test -- --run src/views/datasources/DataSourceForm.test.tsx
```

Expected: fail because `metastoreUri` is not rendered.

- [ ] **Step 4: Implement generic connection param field handling**

In `DataSourceForm.tsx`, add:

```ts
type ConnectionParamField = string;
type FieldErrorKey = FormField | ConnectionParamField;
```

Change `fieldErrors` state to:

```ts
const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string | true>>>({});
```

Add helpers:

```ts
function isConnectionParamField(field: PluginFieldDescriptor) {
    return field.section === 'connectionParams';
}

function getConnectionParamValue(state: FormState, key: string) {
    const value = state.connectionParams[key];
    return typeof value === 'string' ? value : '';
}
```

Add handler:

```ts
const handleConnectionParamChange = (key: string, value: string) => {
    setTestResult('none');
    setTestMessage('');
    setSaveError('');
    setFieldErrors((previousErrors) => {
        if (!previousErrors[key]) {
            return previousErrors;
        }
        const nextErrors = { ...previousErrors };
        delete nextErrors[key];
        return nextErrors;
    });
    setFormData((prev) => ({
        ...prev,
        connectionParams: {
            ...prev.connectionParams,
            [key]: value,
        },
    }));
};
```

In `validateForm`, for each selected plugin field:

```ts
if (isConnectionParamField(field)) {
    const value = getConnectionParamValue(formData, field.key).trim();
    if (field.required && !value) {
        nextErrors[field.key] = true;
    }
    continue;
}
```

Add rendering after the normal connection field grid in the connection section:

```tsx
{selectedPlugin?.fields.filter(isConnectionParamField).length ? (
    <div className="field-grid datasource-advanced-grid">
        {selectedPlugin.fields.filter(isConnectionParamField).map((field) => (
            <div key={field.key} className={`${getFieldLayoutClass(field)} ${fieldErrors[field.key] ? 'has-error' : ''}`}>
                <label htmlFor={`ds-param-${field.key}`}>
                    {field.label}
                    {field.required ? <span className="required">*</span> : null}
                </label>
                <input
                    id={`ds-param-${field.key}`}
                    type={field.inputType === 'password' ? 'password' : 'text'}
                    value={getConnectionParamValue(formData, field.key)}
                    onChange={(event) => handleConnectionParamChange(field.key, event.target.value)}
                    placeholder={field.placeholder}
                />
                {typeof fieldErrors[field.key] === 'string' ? <span className="form-input-error">{fieldErrors[field.key]}</span> : null}
            </div>
        ))}
    </div>
) : null}
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd wb-data-frontend
npm run test -- --run src/views/datasources/DataSourceForm.test.tsx src/api/datasource.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add wb-data-frontend/src/views/datasources/DataSourceForm.tsx \
  wb-data-frontend/src/views/datasources/DataSourceForm.test.tsx \
  wb-data-frontend/src/api/datasource.ts
git commit -m "feat(datasource): edit hive metastore params"
```

---

### Task 3: Local Hive Metastore Service And Seed Data

**Files:**
- Modify: `docker-compose.hive.yml`
- Modify: `scripts/dev/transfer-smoke.sh`
- Modify: `scripts/dev/seed-transfer-datasources.sql`
- Modify: `docs/local-integration-testing.md`

**Interfaces:**
- Produces: Docker service `metastore` with container name `wb-data-hive-metastore`.
- Produces: host port `9083`.
- Produces: `it_transfer_hive.connection_params = {"metastoreUri":"thrift://host.docker.internal:9083"}`.

- [ ] **Step 1: Write compose config expectation**

Before editing, run:

```bash
docker compose -f docker-compose.hive.yml config | rg 'wb-data-hive-metastore|9083'
```

Expected: no output.

- [ ] **Step 2: Add metastore service to compose**

Change `docker-compose.hive.yml` to:

```yaml
services:
  metastore:
    image: apache/hive:4.0.0
    container_name: wb-data-hive-metastore
    restart: unless-stopped
    environment:
      SERVICE_NAME: metastore
    ports:
      - "9083:9083"
    volumes:
      - hive-warehouse:/opt/hive/data/warehouse

  hiveserver2:
    image: apache/hive:4.0.0
    container_name: wb-data-hiveserver2
    restart: unless-stopped
    environment:
      SERVICE_NAME: hiveserver2
      SERVICE_OPTS: "-Dhive.metastore.uris=thrift://metastore:9083"
    depends_on:
      - metastore
    ports:
      - "10000:10000"
      - "10002:10002"
    volumes:
      - hive-warehouse:/opt/hive/data/warehouse

volumes:
  hive-warehouse:
```

- [ ] **Step 3: Update smoke script to start and wait for metastore**

In `scripts/dev/transfer-smoke.sh`, after `hive_container="wb-data-hiveserver2"` introduce:

```bash
hive_metastore_container="wb-data-hive-metastore"
```

When checking containers, start compose if either Hive container is missing:

```bash
if docker container inspect "$hive_container" >/dev/null 2>&1 \
  && docker container inspect "$hive_metastore_container" >/dev/null 2>&1; then
  docker start "$hive_metastore_container" "$hive_container" >/dev/null
else
  docker compose -f "$hive_compose_file" up -d
fi
```

Add a wait loop:

```bash
echo "Waiting for Hive metastore..."
for attempt in {1..60}; do
  if docker exec "$hive_metastore_container" bash -lc 'cat < /dev/null > /dev/tcp/localhost/9083' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec "$hive_metastore_container" bash -lc 'cat < /dev/null > /dev/tcp/localhost/9083' >/dev/null
```

- [ ] **Step 4: Update transfer seed connection params**

In `scripts/dev/seed-transfer-datasources.sql`, change the Hive insert/update to include `connection_params`.

Use:

```sql
INSERT INTO datasource (
    group_id, name, type, description, host, port, database_name,
    username, password, connection_params, status, owner, created_by, updated_by
)
SELECT
    project_group.id,
    'it_transfer_hive',
    'HIVE',
    'Local JDBC transfer Hive source and target tables',
    'localhost',
    10000,
    'default',
    'hive',
    '',
    JSON_OBJECT('metastoreUri', 'thrift://host.docker.internal:9083'),
    'ENABLED',
    'admin',
    admin_user.id,
    admin_user.id
FROM wb_project_group AS project_group
JOIN wb_user AS admin_user ON admin_user.username = 'admin'
WHERE project_group.name = 'policy'
ON DUPLICATE KEY UPDATE
    type = VALUES(type),
    description = VALUES(description),
    host = VALUES(host),
    port = VALUES(port),
    database_name = VALUES(database_name),
    username = VALUES(username),
    password = VALUES(password),
    connection_params = VALUES(connection_params),
    status = VALUES(status),
    updated_by = VALUES(updated_by);
```

- [ ] **Step 5: Update docs**

In `docs/local-integration-testing.md`, change the Hive topology section to mention:

```text
Hive Metastore: wb-data-hive-metastore, host port 9083, URI thrift://host.docker.internal:9083.
```

- [ ] **Step 6: Validate compose and scripts**

Run:

```bash
docker compose -f docker-compose.hive.yml config -q
bash -n scripts/dev/transfer-smoke.sh
```

Expected: both pass.

- [ ] **Step 7: Rebuild local services without deleting user data unless necessary**

Run:

```bash
docker compose -f docker-compose.hive.yml up -d
docker ps --format '{{.Names}} {{.Ports}}' | rg 'wb-data-hive-metastore|wb-data-hiveserver2'
```

Expected: `wb-data-hive-metastore` exposes `9083`, `wb-data-hiveserver2` exposes `10000`.

- [ ] **Step 8: Run smoke seed**

Run:

```bash
WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 scripts/dev/transfer-smoke.sh
mysql -uroot -p1111 -Nse "select name, json_extract(connection_params, '$.metastoreUri') from datasource where name = 'it_transfer_hive'" wb_data
```

Expected: `it_transfer_hive` contains `"thrift://host.docker.internal:9083"`.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.hive.yml scripts/dev/transfer-smoke.sh scripts/dev/seed-transfer-datasources.sql docs/local-integration-testing.md
git commit -m "feat(dev): add hive metastore for transfer tests"
```

---

### Task 4: End-To-End Hive Transfer Validation And Documentation

**Files:**
- Modify: `docs/validation/2026-07-19-transfer-node.md`
- Modify: `docs/local-integration-testing.md`

**Interfaces:**
- Consumes: backend on `SERVER_PORT=18080` with `WB_DATA_PLUGIN_DIR` pointing at freshly built worktree plugins.
- Consumes: `it_transfer_hive.connectionParams.metastoreUri`.
- Produces: validation evidence for Hive static partition, source-field partition, expression partition, and Hive-to-MySQL where supported by runtime.

- [ ] **Step 1: Prepare backend and plugins**

Run:

```bash
bash scripts/prepare-plugins.sh
cd wb-data-server/wb-data-backend
SERVER_PORT=18080 DB_PASSWORD=1111 \
  WB_DATA_PLUGIN_DIR=/Users/wenbin/Projects/wb-data/.worktrees/codex-transfer-node/plugins \
  WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
  WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:18080 \
  WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
  mvn spring-boot:run -Dspring-boot.run.fork=false
```

Expected: backend starts and logs plugin loading from the worktree `plugins/` directory.

- [ ] **Step 2: Regenerate transfer smoke flow**

Use the existing authenticated save flow:

```bash
curl -sS -H 'Content-Type: application/json' \
  --data '{"username":"admin","password":"Dev123456!"}' \
  http://localhost:18080/api/v1/auth/login > /tmp/wb-login-transfer.json
TOKEN=$(python3 - <<'PY'
import json
print(json.load(open('/tmp/wb-login-transfer.json'))['data']['accessToken'])
PY
)
curl -sS -H "Authorization: Bearer $TOKEN" \
  "http://localhost:18080/api/v1/groups/4/offline/flows/document?path=_flows/gogo/transfer-smoke/flow.yaml" \
  > /tmp/transfer-doc.json
python3 - <<'PY' > /tmp/transfer-save-payload.json
import json
root=json.load(open('/tmp/transfer-doc.json'))['data']
payload={
  'path':root['path'],
  'documentHash':root['documentHash'],
  'documentUpdatedAt':root['documentUpdatedAt'],
  'stages':root['stages'],
  'edges':root['edges'],
  'layout':root.get('layout') or {},
  'schedule':root.get('schedule')
}
print(json.dumps(payload, ensure_ascii=False))
PY
curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data @/tmp/transfer-save-payload.json \
  -X PUT http://localhost:18080/api/v1/groups/4/offline/flows/document \
  > /tmp/transfer-save-response.json
```

Expected: save returns `code=200`.

- [ ] **Step 3: Validate rendered Hive config directly**

Run:

```bash
curl -sS -H 'X-WB-Data-Internal-Token: dev-transfer-token' \
  -H 'Content-Type: application/json' \
  --data-binary @/Users/wenbin/Projects/wb-data/output/offline-live/repos/wb-data-4/transfers/transfer-smoke/hive_static.transfer.json \
  http://localhost:18080/api/v1/internal/offline/transfer/render \
  | rg 'metastore_uri|partition_by|table_name'
```

Expected:

```text
partition_by = ["dayno"]
metastore_uri = "thrift://host.docker.internal:9083"
```

- [ ] **Step 4: Run selected Hive scenarios**

For each task id `hive_static`, `hive_field`, and `hive_expression`, run:

```bash
TASK_ID=hive_static
curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data "{\"flowPath\":\"_flows/gogo/transfer-smoke/flow.yaml\",\"selectedTaskIds\":[\"$TASK_ID\"],\"mode\":\"SELECTED\"}" \
  http://localhost:18080/api/v1/groups/4/offline/executions/debug/current \
  > "/tmp/transfer-debug-$TASK_ID.json"
python3 - <<PY
import json
print(json.load(open('/tmp/transfer-debug-$TASK_ID.json'))['data']['executionId'])
PY
```

Poll with:

```bash
EXECUTION_ID=$(python3 - <<PY
import json
print(json.load(open('/tmp/transfer-debug-' + '$TASK_ID' + '.json'))['data']['executionId'])
PY
)
curl -sS -H "Authorization: Bearer $TOKEN" \
  "http://localhost:18080/api/v1/groups/4/offline/executions/$EXECUTION_ID" \
  | python3 -m json.tool
```

Expected: each reaches `SUCCESS`. If a scenario fails because the Apache image lacks a Hive runtime dependency, record the exact missing class or connector message in validation docs before changing code.

- [ ] **Step 5: Record Hive counts**

Run:

```bash
docker exec wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' \
  --silent=true --outputformat=tsv2 -e \
  "SELECT dayno, COUNT(*) FROM transfer_orders_partitioned_target GROUP BY dayno ORDER BY dayno"
```

Expected: row counts reflect the latest overwrite partition scenario.

- [ ] **Step 6: Run verification commands**

Run:

```bash
cd wb-data-server/wb-data-backend
mvn -q -Dtest='TransferExecutionRenderServiceTest,TransferSeatunnelConfigBuilderTest,TransferSqlBuilderTest,OfflineFlowYamlSupportTest,AuthFilterTest' test
cd ../..
mvn -q -pl wb-data-plugin-hive -Dtest=HiveDataSourcePluginTest test
cd wb-data-frontend
npm run test -- --run src/views/datasources/DataSourceForm.test.tsx src/api/datasource.test.ts
cd ..
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Update validation docs**

In `docs/validation/2026-07-19-transfer-node.md`, replace the Hive blocked rows with the final execution IDs, row counts, and any residual limitation.

- [ ] **Step 8: Commit**

```bash
git add docs/validation/2026-07-19-transfer-node.md docs/local-integration-testing.md
git commit -m "docs: record hive transfer metastore validation"
```

---

## Self-Review

- Spec coverage: the plan covers single Hive data source type, optional metastore at creation, required metastore for Hive transfer target, frontend storage in `connectionParams`, local metastore setup, and validation.
- Placeholder scan: no unfinished placeholder markers. Runtime failure recording for external image dependencies has explicit required evidence.
- Type consistency: `connectionParams.metastoreUri`, `PluginFieldDescriptor.section = "connectionParams"`, and `TransferExecutionRenderService.requireHiveTargetMetastore` are used consistently across tasks.
