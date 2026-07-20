# Transfer Node End-to-End Validation

Date: 2026-07-20 (Asia/Singapore)

## Result

Partial validation. The backend, bootstrap script, persisted Flow, commit/push path, schedule path, Kestra debug execution creation, MySQL SeaTunnel transfer execution, and MySQL-to-Hive partition transfer execution all ran successfully. Hive-to-MySQL still needs a SeaTunnel runtime image that contains the Hive JDBC driver.

## Environment And Commands

The task brief used `WB_DATA_INTERNAL_TOKEN` for backend startup. The backend property is `wbdata.offline.transfer.internal-token`, which reads `WB_DATA_TRANSFER_INTERNAL_TOKEN`; the backend command used for this validation was therefore:

```bash
cd wb-data-server/wb-data-backend
SERVER_PORT=18080 DB_PASSWORD=1111 \
  WB_DATA_PLUGIN_DIR=/Users/wenbin/Projects/wb-data/.worktrees/codex-transfer-node/plugins \
  WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
  WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:18080 \
  WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
  WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse \
  WB_DATA_KESTRA_BASE_URL=http://localhost:8090 \
  mvn spring-boot:run -Dspring-boot.run.fork=false
```

Maven resolved the `spring-boot` plugin and the backend started successfully on port 18080. The non-default port is passed to generated transfer tasks through `WB_DATA_TRANSFER_INTERNAL_BASE_URL`.

The required compose configuration parses successfully:

```bash
docker compose -f docker-compose.transfer.yml config
```

## Transfer Bootstrap

The transfer smoke setup now starts only `wb-data-transfer-mysql`, reuses `wb-data-hiveserver2` on host port 10000, reuses `wb-data-hive-metastore` on host port 9083, and reuses `wb-data-kestra` on host port 8090. Bootstrap succeeded with:

```bash
WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 scripts/dev/transfer-smoke.sh
```

The script confirmed MySQL health, confirmed Hive Metastore thrift connectivity, ran `SELECT 1` through HiveServer2, reapplied the Hive fixtures, checked the existing Kestra API, and seeded the two transfer data sources into group 4 (`policy`). The Hive data source now stores:

```text
connection_params.metastoreUri=thrift://host.docker.internal:9083
```

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

The transfer seed now uses `localhost` for backend-side metadata reads. Rendered SeaTunnel JDBC URLs rewrite loopback hosts to `host.docker.internal` so Docker task containers can reach the same mapped ports. Generated transfer tasks carry `WB_DATA_INTERNAL_BASE_URL` and `WB_DATA_INTERNAL_TOKEN` in task `env`, so they no longer require a dedicated Kestra container with global transfer environment variables.

The backend was restarted with `WB_DATA_PLUGIN_DIR` pointing at freshly rebuilt worktree plugin JARs. Without this, the backend loaded stale Hive plugin JARs from the main checkout and failed to detect Hive partition metadata.

Kestra was reconfigured to allow Docker runner volume mounts. Generated transfer tasks now mount `wb-data_hive-warehouse:/opt/hive/data/warehouse`. Without this, SeaTunnel Hive sink can report success but write files into the short-lived task container filesystem instead of the HiveServer2 warehouse volume.

## Scenario Evidence

| Scenario | Execution ID | Target row-count command/result | Status |
| --- | --- | --- | --- |
| MySQL -> MySQL `append` | `1pRO6494HeEhHvKkfzhiq` | `transfer_orders_source=3`, `transfer_orders_target=4` after append | Success |
| MySQL -> MySQL `overwrite_table` | `3FMl85lsTZWu1aslIDCASo` | `transfer_orders_source=3`, `transfer_orders_target=3` after overwrite | Success |
| MySQL -> Hive `overwrite_partition`, static `dayno` | `5hQWT0n9Cu4UTKsIHjVXNL` | Execution `SUCCESS`; direct render includes `partition_by = ["dayno"]` and `metastore_uri = "thrift://host.docker.internal:9083"` | Success |
| MySQL -> Hive `overwrite_partition`, source field `dayno` | `4YR276oIt7atBTaP7tfar6` | Execution `SUCCESS`; Hive query after subsequent expression scenario: `20260701=2`, `20260702=1` | Success |
| MySQL -> Hive `overwrite_partition`, expression `date_format(date_key, '%Y%m%d')` | `pkboVpDXYgK2my60yQ7Pk` | Execution `SUCCESS`; Hive query: `20260701=2`, `20260702=1` | Success |
| Hive -> MySQL `append` | `34VsiOTTyHWFP8hwNop00g` | Execution `FAILED`; SeaTunnel image lacks `org.apache.hive.jdbc.HiveDriver` for JDBC Hive source | Runtime image limitation |
| Save, commit, push, enable schedule, Operations Center | None | Save, two commits, two pushes, and schedule enable succeeded; Operations query needs rerun after execution completes | Partial |

The successful MySQL and MySQL-to-Hive executions prove the current reused Kestra container can run the SeaTunnel image through the Docker task runner, render runtime credentials from WB-Data, mount the shared Hive warehouse volume, and reach the transfer MySQL/Hive services from inside Docker.

Final Hive partition count after the expression scenario:

```text
dayno     count
20260701  2
20260702  1
```

The remaining Hive-to-MySQL failure is:

```text
Failed to load JDBC driver org.apache.hive.jdbc.HiveDriver
java.lang.ClassNotFoundException: org.apache.hive.jdbc.HiveDriver
```

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

Build or select a SeaTunnel runtime image that includes the Hive JDBC driver before treating Hive as a JDBC source for Hive-to-MySQL transfers.
