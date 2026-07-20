# Transfer Node End-to-End Validation

Date: 2026-07-20 (Asia/Singapore)

## Result

Partial validation. The backend, bootstrap script, persisted Flow, commit/push path, schedule path, and Kestra debug execution creation all ran successfully. Full SeaTunnel transfer execution and post-transfer row counts still need to be rerun after regenerating the Flow with the reused `wb-data-kestra` runtime settings.

## Environment And Commands

The task brief used `WB_DATA_INTERNAL_TOKEN` for backend startup. The backend property is `wbdata.offline.transfer.internal-token`, which reads `WB_DATA_TRANSFER_INTERNAL_TOKEN`; the backend command used for this validation was therefore:

```bash
cd wb-data-server/wb-data-backend
SERVER_PORT=18080 DB_PASSWORD=1111 WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
  WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:18080 \
  WB_DATA_KESTRA_BASE_URL=http://localhost:8090 \
  mvn spring-boot:run -Dspring-boot.run.fork=false
```

Maven resolved the `spring-boot` plugin and the backend started successfully on port 18080. The non-default port is passed to generated transfer tasks through `WB_DATA_TRANSFER_INTERNAL_BASE_URL`.

The required compose configuration parses successfully:

```bash
docker compose -f docker-compose.transfer.yml config
```

## Transfer Bootstrap

The transfer smoke setup now starts only `wb-data-transfer-mysql`, reuses `wb-data-hiveserver2` on host port 10000, and reuses `wb-data-kestra` on host port 8090. Bootstrap succeeded with:

```bash
WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 scripts/dev/transfer-smoke.sh
```

The script confirmed MySQL health, ran `SELECT 1` through HiveServer2, reapplied the Hive fixtures, checked the existing Kestra API, and seeded the two transfer data sources into group 4 (`policy`).

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
docker exec wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' \
  --silent=true --outputformat=tsv2 -e \
  "SELECT 'source',COUNT(*) FROM transfer_orders_source UNION ALL SELECT 'target',COUNT(*) FROM transfer_orders_target UNION ALL SELECT 'partitioned',COUNT(*) FROM transfer_orders_partitioned_target"
```

## Product Flow And Runtime Blocker

An authenticated system-admin session saved a six-node Flow through `PUT /api/v1/groups/4/offline/flows/document` at `_flows/gogo/transfer-smoke/flow.yaml`. Its persisted document identity was:

```text
flowId=transfer-smoke
documentHash=b97aa379e7fb222734675562699ca87e8b418ab0ea7c19516989fc741634ec07
```

The Flow contains the six required source/target/write-mode configurations. After fixing Kestra capability detection, a selected-node debug attempt for `mysql_append` used `POST /api/v1/groups/4/offline/executions/debug/current` and created a Kestra execution:

```text
executionId=3xD9jKHrPUOyxucOGgx3Us
status=CREATED
```

The current `kestra/kestra:latest` container exposes Docker support as `plugin-docker` rather than as a task-runner class in the plugin list. `KestraHttpClient` now maps that plugin to `io.kestra.plugin.scripts.runner.docker.Docker`, so transfer nodes can pass the backend capability check.

The transfer seed now uses `host.docker.internal` with mapped ports so both the host-run backend and Docker task containers can reach the JDBC services. Generated transfer tasks now carry `WB_DATA_INTERNAL_BASE_URL` and `WB_DATA_INTERNAL_TOKEN` in task `env`, so they no longer require a dedicated Kestra container with global transfer environment variables.

## Scenario Evidence

| Scenario | Execution ID | Target row-count command/result | Status |
| --- | --- | --- | --- |
| MySQL -> MySQL `append` | `3xD9jKHrPUOyxucOGgx3Us` | Baseline target count: 1; execution created, final SeaTunnel result not yet recorded | Partial |
| MySQL -> MySQL `overwrite_table` | None | Baseline target count: 1; not rerun after environment simplification | Pending |
| MySQL -> Hive `overwrite_partition`, static `dayno` | None | Baseline partitioned target count: 1; not rerun after environment simplification | Pending |
| MySQL -> Hive `overwrite_partition`, source field `dayno` | None | Baseline partitioned target count: 1; not rerun after environment simplification | Pending |
| MySQL -> Hive `overwrite_partition`, expression `date_format(date_key, '%Y%m%d')` | None | Baseline partitioned target count: 1; not rerun after environment simplification | Pending |
| Hive -> MySQL `append` | None | Baseline target count: 1; not rerun after environment simplification | Pending |
| Save, commit, push, enable schedule, Operations Center | None | Save, two commits, two pushes, and schedule enable succeeded; Operations query needs rerun after execution completes | Partial |

No post-transfer row-count query is reported yet because the SeaTunnel execution result has not been rerun to terminal state.

## Commit, Push, Schedule, And Operations Evidence

The current Flow was committed with `POST /repo/commit/flow`, then pushed with `POST /repo/push`; both returned `success: true` and the remote URL `https://github.com/dododcdc/wb-data-4.git`. After enabling the schedule with `PATCH /schedules/status`, a second commit and push also returned success. Schedule readback confirms:

```text
triggerId=schedule
cron=0 */10 * * * ?
timezone=Asia/Singapore
enabled=true
```

The Operations Center backing endpoint should be rerun after a transfer execution reaches terminal state.

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

Regenerate the saved Flow with the reused `wb-data-kestra` runtime settings, rerun each selected-node debug scenario to terminal state, and record execution IDs plus post-transfer target counts.
