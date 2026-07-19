# Transfer Node End-to-End Validation

Date: 2026-07-20 (Asia/Singapore)

## Result

Partial validation. The transfer stack, backend, bootstrap script, persisted Flow, commit/push path, and schedule path all ran successfully. Runtime execution remains blocked before Kestra creates an execution, so this document intentionally does not invent execution IDs or transfer result counts.

## Environment And Commands

The task brief used `WB_DATA_INTERNAL_TOKEN` for backend startup. The backend property is `wbdata.offline.transfer.internal-token`, which reads `WB_DATA_TRANSFER_INTERNAL_TOKEN`; the backend command used for this validation was therefore:

```bash
cd wb-data-server/wb-data-backend
SERVER_PORT=18080 DB_PASSWORD=1111 WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
  WB_DATA_KESTRA_BASE_URL=http://localhost:18090 \
  mvn spring-boot:run -Dspring-boot.run.fork=false
```

Maven resolved the `spring-boot` plugin and the backend started successfully on port 18080. The non-default port is passed to the Docker alias by the bootstrap command below.

The required compose configuration parses successfully:

```bash
docker compose -f docker-compose.transfer.yml config
```

## Transfer Bootstrap

The repaired compose stack was running with MySQL on host port 13306, HiveServer2 on 11000, Kestra on 18090, and the backend alias proxying to host port 18080. Bootstrap succeeded with:

```bash
WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 scripts/dev/transfer-smoke.sh
```

The script confirmed MySQL health, ran `SELECT 1` through HiveServer2, reapplied the Hive fixtures, checked Kestra and the backend alias, and seeded the two transfer data sources into group 4 (`policy`).

Seed baseline row counts were:

```text
MySQL transfer_demo: transfer_orders_source=3, transfer_orders_target=1
Hive default: transfer_orders_source=2, transfer_orders_target=1,
              transfer_orders_partitioned_target=1
```

Commands:

```bash
docker exec wb-data-transfer-mysql mysql -uwbdata -pwbdata123 -D transfer_demo -Nse \
  "SELECT 'source',COUNT(*) FROM transfer_orders_source UNION ALL SELECT 'target',COUNT(*) FROM transfer_orders_target"
docker exec wb-data-transfer-hive beeline -u 'jdbc:hive2://localhost:10000/default' \
  --silent=true --outputformat=tsv2 -e \
  "SELECT 'source',COUNT(*) FROM transfer_orders_source UNION ALL SELECT 'target',COUNT(*) FROM transfer_orders_target UNION ALL SELECT 'partitioned',COUNT(*) FROM transfer_orders_partitioned_target"
```

## Product Flow And Runtime Blocker

An authenticated system-admin session saved a six-node Flow through `PUT /api/v1/groups/4/offline/flows/document` at `_flows/gogo/transfer-smoke/flow.yaml`. Its persisted document identity was:

```text
flowId=transfer-smoke
documentHash=b97aa379e7fb222734675562699ca87e8b418ab0ea7c19516989fc741634ec07
```

The Flow contains the six required source/target/write-mode configurations. A selected-node debug attempt for `mysql_append` used `POST /api/v1/groups/4/offline/executions/debug/current`, but Kestra capability validation failed before flow upload or execution creation:

```text
HTTP 401
{ "code": 401, "message": "查询 Kestra 插件列表失败" }
```

The current `kestra/kestra:latest` container reports Kestra 1.3.7. Its API returned HTTP 401 for `/api/v1/plugins`, `/api/v1/main/plugins`, `/api/v1/main/flows`, and `/api/v1/main/executions`, including requests with the backend's configured basic-auth values. `docker/kestra-transfer/application.yml` now configures the same username and password as the backend's local defaults; rerun validation after recreating the Kestra container.

There is a second environment concern after authentication is fixed: metadata requests from the host-run backend to the seeded service-name datasource hosts failed (`获取表列表失败` / `获取 Hive 表列表失败`). The transfer seed now uses `host.docker.internal` with mapped ports so both the host-run backend and Docker task containers can reach the JDBC services.

## Scenario Evidence

| Scenario | Execution ID | Target row-count command/result | Status |
| --- | --- | --- | --- |
| MySQL -> MySQL `append` | None | Baseline target count: 1; debug blocked by Kestra HTTP 401 | Pending |
| MySQL -> MySQL `overwrite_table` | None | Baseline target count: 1; debug blocked by Kestra HTTP 401 | Pending |
| MySQL -> Hive `overwrite_partition`, static `dayno` | None | Baseline partitioned target count: 1; debug blocked by Kestra HTTP 401 | Pending |
| MySQL -> Hive `overwrite_partition`, source field `dayno` | None | Baseline partitioned target count: 1; debug blocked by Kestra HTTP 401 | Pending |
| MySQL -> Hive `overwrite_partition`, expression `date_format(date_key, '%Y%m%d')` | None | Baseline partitioned target count: 1; debug blocked by Kestra HTTP 401 | Pending |
| Hive -> MySQL `append` | None | Baseline target count: 1; debug blocked by Kestra HTTP 401 | Pending |
| Save, commit, push, enable schedule, Operations Center | None | Save, two commits, two pushes, and schedule enable succeeded; Operations query blocked by Kestra HTTP 401 | Partial |

No post-transfer row-count query can be reported because Kestra did not create a transfer execution.

## Commit, Push, Schedule, And Operations Evidence

The current Flow was committed with `POST /repo/commit/flow`, then pushed with `POST /repo/push`; both returned `success: true` and the remote URL `https://github.com/dododcdc/wb-data-4.git`. After enabling the schedule with `PATCH /schedules/status`, a second commit and push also returned success. Schedule readback confirms:

```text
triggerId=schedule
cron=0 */10 * * * ?
timezone=Asia/Singapore
enabled=true
```

The Operations Center backing endpoint `GET /api/v1/groups/4/offline/executions?flowPath=_flows/gogo/transfer-smoke/flow.yaml` returned HTTP 401 (`查询执行列表失败`) from Kestra, so it cannot provide execution records until the Kestra API authentication issue is fixed.

## Automated Evidence

Backend focused transfer tests completed successfully:

```bash
cd wb-data-server/wb-data-backend
mvn -q -Dtest='TransferSeatunnelConfigBuilderTest,TransferSqlBuilderTest,TransferExecutionRenderServiceTest,OfflineFlowDocumentServiceTest,OfflineFlowYamlSupportTest' test
```

Frontend focused transfer tests completed successfully:

```text
Test Files  3 passed (3)
Tests       7 passed (7)
```

Command:

```bash
cd wb-data-frontend
npm run test -- --run \
  src/views/offline/transfer/TransferNodeDialog.test.tsx \
  src/views/offline/transfer/transferTypes.test.ts \
  src/api/transfer.test.ts
```

## Required Follow-up

Configure Kestra 1.3.7 API authentication so the backend can query plugins, upsert debug flows, create executions, and list Operations records. Then resolve host-to-Docker datasource reachability for the host-run backend and rerun each selected-node debug scenario, recording execution IDs and post-transfer target counts.
