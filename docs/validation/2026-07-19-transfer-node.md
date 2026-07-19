# Transfer Node End-to-End Validation

Date: 2026-07-20 (Asia/Singapore)

## Result

Partial validation only. The focused backend and frontend transfer tests pass, but the Docker transfer stack could not be started, so no product Flow, debug execution, row-count query, commit/push/schedule, or Operations Center record was created. This document intentionally does not invent execution IDs or data results.

## Environment And Commands

The task brief used `WB_DATA_INTERNAL_TOKEN` for backend startup. The backend property is `wbdata.offline.transfer.internal-token`, which reads `WB_DATA_TRANSFER_INTERNAL_TOKEN`; the backend command used for this validation was therefore:

```bash
cd wb-data-server/wb-data-backend
DB_PASSWORD=1111 WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
  mvn spring-boot:run -Dspring-boot.run.fork=false
```

Maven resolved the `spring-boot` plugin and compiled successfully, but startup stopped because the pre-existing process `java` (PID 24284, launched from the main checkout) already owned port 8080:

```text
Web server failed to start. Port 8080 was already in use.
```

An alternate `SERVER_PORT=8081` startup was also attempted, but Docker Desktop owned that port. Neither existing listener was terminated because it was not created for this validation.

Frontend startup succeeded:

```text
VITE v5.4.21 ready
Local: http://127.0.0.1:5174/
```

The required compose configuration parses successfully:

```bash
docker compose -f docker-compose.transfer.yml config
```

## Docker Blocker

The required command was attempted:

```bash
docker compose -f docker-compose.transfer.yml up -d
```

It could not pull the pinned images from Docker Hub. First, the source image reference did not resolve:

```text
failed to resolve reference "docker.io/alpine/socat:1.8.0.3-r0": docker.io/alpine/socat:1.8.0.3-r0: not found
```

The compose file was later corrected to use the available `alpine/socat:latest` image and to allow `WB_DATA_TRANSFER_BACKEND_HOST_PORT` for host backend port conflicts. After pulling `alpine/socat:latest` and adding a local compatibility tag during the first attempt, the stack next failed while fetching Kestra:

```text
failed to resolve reference "docker.io/kestra/kestra:v1.3.28":
failed to do request: Head "https://registry-1.docker.io/v2/kestra/kestra/manifests/v1.3.28": EOF
```

Three retries did not leave either `mysql:8.4` or `kestra/kestra:v1.3.28` locally available. The required MySQL, Hive, Kestra, and backend-alias services were therefore never started. `scripts/dev/transfer-smoke.sh` was not run because its first operation is the same blocked compose startup.

After the compose correction, `WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 docker compose -f docker-compose.transfer.yml up -d` passed the `alpine/socat` step and began pulling MySQL and Kestra. It was stopped after several minutes because the Kestra layer `ed31fb0e67b1` had reached only about `49.28MB/2.926GB`; no transfer containers had been created at that point.

## Scenario Evidence

| Scenario | Execution ID | Target row-count command/result | Status |
| --- | --- | --- | --- |
| MySQL -> MySQL `append` | None | Not run: transfer MySQL service unavailable | Pending |
| MySQL -> MySQL `overwrite_table` | None | Not run: transfer MySQL service unavailable | Pending |
| MySQL -> Hive `overwrite_partition`, static `dayno` | None | Not run: transfer Hive service unavailable | Pending |
| MySQL -> Hive `overwrite_partition`, source field `dayno` | None | Not run: transfer Hive service unavailable | Pending |
| MySQL -> Hive `overwrite_partition`, expression `date_format(date_key, '%Y%m%d')` | None | Not run: transfer Hive service unavailable | Pending |
| Hive -> MySQL `append` | None | Not run: transfer Hive and MySQL services unavailable | Pending |
| Save, commit, push, enable schedule, Operations Center | None | Not run: no authenticated product session or Kestra stack | Pending |

No row-count query can be reported because the seeded target tables are created by the unavailable Docker services.

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

Restore Docker Hub access or provide the pinned `mysql:8.4` and `kestra/kestra:v1.3.28` images locally, then rerun `scripts/dev/transfer-smoke.sh`, create `gogo/transfer-smoke/` through the authenticated product APIs/UI, and fill the scenario table with real execution IDs and target-table counts. If host port `8080` is still occupied, start the backend with `SERVER_PORT=18080` and run the smoke script with `WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080`.
