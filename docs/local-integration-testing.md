# Local Integration Testing

This document defines the production-like local test environment for WB Data. It is the preferred mode for validating SQL nodes, HiveSQL nodes, scheduling, save / commit / push behavior, and operations records.

Status: this is the environment contract. The compose file and seed scripts should follow this document. StarRocks is intentionally deferred for now because it is heavier than the first integration target needs.

## Transfer Node Environment

Use the transfer smoke setup for JDBC transfer-node validation. It reuses the existing WB-Data Kestra and HiveServer2 containers, and starts only a small transfer-specific MySQL container so source/target MySQL data stays separate from the WB-Data metadata database.

```bash
DB_PASSWORD=1111 \
  WB_DATA_PLUGIN_DIR=/absolute/path/to/wb-data/plugins \
  WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
  WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:8080 \
  WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
  WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse \
  mvn spring-boot:run -Dspring-boot.run.fork=false

scripts/dev/transfer-smoke.sh
```

Run the backend command from `wb-data-server/wb-data-backend`. The smoke script starts `wb-data-transfer-mysql`, starts or verifies the existing `wb-data-hiveserver2` and `wb-data-kestra` containers, applies the Hive schema, checks the Kestra API, and seeds the local WB-Data metadata database. Override its metadata connection with `WB_DATA_METADATA_MYSQL_HOST`, `WB_DATA_METADATA_MYSQL_PORT`, `WB_DATA_METADATA_MYSQL_DATABASE`, `WB_DATA_METADATA_MYSQL_USER`, and `DB_PASSWORD` when necessary.

The transfer compose starts only `mysql:8.0` by default. Override it with `WB_DATA_TRANSFER_MYSQL_IMAGE` if your machine uses a pinned local image. The existing Kestra container must expose `http://localhost:8090`, use the local basic-auth credentials, and have Docker socket access for Docker task runner execution.

Hive transfer validation reuses `docker-compose.hive.yml`. That stack contains `wb-data-hiveserver2` on `10000` for HiveServer2/JDBC metadata reads and `wb-data-hive-metastore` on `9083` for SeaTunnel Hive sink metadata. The smoke seed stores the HiveServer2 endpoint in the normal data source fields and stores the metastore endpoint in `connection_params.metastoreUri`.

SeaTunnel Hive sink writes files under the Hive warehouse path. The Kestra Docker runner must allow volume mounts and each transfer task mounts `wb-data_hive-warehouse:/opt/hive/data/warehouse`; otherwise a SeaTunnel execution can report success while writing to the task container's private filesystem. In local Kestra, enable:

```yaml
kestra:
  plugins:
    configurations:
      - type: io.kestra.plugin.scripts.runner.docker.Docker
        values:
          volume-enabled: true
```

If host port `8080` is already occupied, start the backend on another port and set the internal URL to that port:

```bash
DB_PASSWORD=1111 \
  WB_DATA_PLUGIN_DIR=/absolute/path/to/wb-data/plugins \
  WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
  WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:18080 \
  WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
  WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse \
  SERVER_PORT=18080 \
  mvn spring-boot:run -Dspring-boot.run.fork=false

WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 scripts/dev/transfer-smoke.sh
```

| Data source | Type | Host | Port | Database | Tables |
| --- | --- | --- | --- | --- | --- |
| `it_transfer_mysql` | `MYSQL` | `localhost` | `13306` | `transfer_demo` | `transfer_orders_source`, `transfer_orders_target` |
| `it_transfer_hive` | `HIVE` | `localhost` | `10000` | `default` | `transfer_orders_source`, `transfer_orders_target`, `transfer_orders_partitioned_target`; `connection_params.metastoreUri=thrift://host.docker.internal:9083` |

WB-Data writes `WB_DATA_INTERNAL_BASE_URL` and `WB_DATA_INTERNAL_TOKEN` into each generated transfer task. This lets the existing Kestra container run SeaTunnel on the `wb-data_default` network without relying on Kestra container-wide environment variables.

The transfer seed uses `localhost` because the WB-Data backend runs on the macOS host and must read source/target metadata before rendering the SeaTunnel config. When WB-Data renders a SeaTunnel JDBC URL for Docker execution, it rewrites loopback hosts (`localhost`, `127.0.0.1`, `::1`) to `host.docker.internal` so the SeaTunnel container can reach the same mapped ports.

Run `bash scripts/prepare-plugins.sh` before backend startup and point `WB_DATA_PLUGIN_DIR` at the generated `plugins/` directory when validating from a worktree. Otherwise the backend may load stale plugin JARs from the main checkout.

Hive transfer writes need the metastore thrift endpoint because SeaTunnel's Hive sink resolves table, partition, and storage metadata through Hive Metastore rather than HiveServer2. Keep `metastoreUri` on the Hive data source instead of entering it on each transfer node.

Reset the transfer MySQL data with:

```bash
docker compose -f docker-compose.transfer.yml down -v
```

## Goals

- Run frontend, backend, Kestra, MySQL, PostgreSQL, and Hive in one Docker network.
- Use the same data source hostnames from backend APIs and Kestra task execution.
- Seed every supported first-phase data source with small, predictable demo tables.
- Give humans and AI agents one stable reference for local credentials, ports, and validation flows.

## Non-Goals

- Do not model production security.
- Do not include StarRocks in the default environment yet.
- Do not optimize for frontend hot reload. Use `docs/local-development.md` for daily UI work.

## Target Topology

```text
browser
  -> wb-data-frontend     static files served by Nginx
  -> wb-data-backend      Spring Boot API
  -> wb-data-kestra       flow execution
  -> wb-data-mysql        MySQL test data + app metadata if configured
  -> wb-data-postgresql   PostgreSQL test data
  -> wb-data-hiveserver2  HiveSQL test data
```

All containers must share the same Docker network. Data sources used by offline nodes must use container service names, not `127.0.0.1`.

## Planned Files

| File | Purpose |
| --- | --- |
| `docker-compose.integration.yml` | Starts the full integration stack |
| `docker/frontend.Dockerfile` | Builds frontend assets and serves them with Nginx |
| `docker/backend.Dockerfile` | Builds or runs the Spring Boot backend in the Docker network |
| `scripts/dev/init/mysql/` | Initializes MySQL demo schema and data |
| `scripts/dev/init/postgresql/` | Initializes PostgreSQL demo schema and data |
| `scripts/dev/init/hive/` | Initializes Hive demo schema and data |
| `scripts/dev/seed-integration-datasources.sql` | Inserts WB Data data source records for the seeded services |

## Service Contract

| Service | Container name | Internal port | Host port | Notes |
| --- | --- | --- | --- | --- |
| Frontend | `wb-data-frontend` | `80` | `5173` or `8088` | Static build, Nginx |
| Backend | `wb-data-backend` | `8080` | `8080` | Talks to other services by container name |
| Kestra | `wb-data-kestra` | `8080` | `8090` | Executes offline debug and scheduled flows |
| Kestra internal port | `wb-data-kestra` | `8081` | `8081` | Keep if current local setup needs it |
| MySQL | `wb-data-mysql` | `3306` | `3307` | Demo data and optionally app metadata |
| PostgreSQL | `wb-data-postgresql` | `5432` | `5434` | Demo data |
| HiveServer2 | `wb-data-hiveserver2` | `10000` | `10000` | Demo HiveSQL data |

Host ports may change if they conflict locally. Container names and internal ports should stay stable because those are the values stored in test data sources.

## Data Source Records

Create these data sources in WB Data for project group `policy`.

| Name | Type | Host | Port | Database | Username | Password | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `it_mysql_retail` | `MYSQL` | `wb-data-mysql` | `3306` | `retail_demo` | `wbdata` | `wbdata123` | SQL node, self-service query |
| `it_postgres_retail` | `POSTGRESQL` | `wb-data-postgresql` | `5432` | `retail_demo` | `wbdata` | `wbdata123` | SQL node, self-service query |
| `it_hive_retail` | `HIVE` | `wb-data-hiveserver2` | `10000` | `default` | `hive` | empty | HiveSQL node |

Do not use `127.0.0.1` in these records. In integration mode, both backend and Kestra are containers and must use Docker service names.

## Demo Data Model

Use the same conceptual tables across MySQL, PostgreSQL, and Hive where practical.

| Table | Purpose |
| --- | --- |
| `customers` | Small customer dimension |
| `products` | Small product dimension |
| `orders` | Order headers with timestamps and status |
| `order_items` | Order line items |

Minimum useful row counts:

| Table | Rows |
| --- | --- |
| `customers` | 5 |
| `products` | 5 |
| `orders` | 8 |
| `order_items` | 12 |

Keep values deterministic. Avoid random data so screenshots, logs, and assertions stay stable.

## Smoke Queries

MySQL and PostgreSQL SQL node:

```sql
select count(*) as order_count from orders;
```

```sql
select c.customer_name, count(*) as order_count
from customers c
join orders o on o.customer_id = c.customer_id
group by c.customer_name
order by order_count desc, c.customer_name;
```

HiveSQL node:

```sql
select count(*) as order_count from orders;
```

Keep Hive smoke queries simple. They validate connectivity and execution routing, not advanced SQL dialect behavior.

## Manual Validation Flow

Use this flow when validating offline SQL/HiveSQL changes:

1. Start the integration stack.
2. Log in as `admin / admin123`.
3. Select project group `policy`.
4. Open Data Source Management and verify these records exist:
   - `it_mysql_retail`
   - `it_postgres_retail`
   - `it_hive_retail`
5. Open Self-Service Query and run the MySQL smoke query.
6. Open Offline Development.
7. Create a flow under `jack/integration-smoke/`.
8. Add a SQL node bound to `it_mysql_retail`.
9. Put `select count(*) as order_count from orders;` in the node.
10. Add a Shell node after the SQL node with `echo "sql complete"`.
11. Execute the flow from the canvas toolbar.
12. Confirm the SQL node succeeds.
13. Add a HiveSQL node bound to `it_hive_retail`.
14. Execute again and confirm HiveSQL succeeds.
15. Save, commit, push, enable a one-minute schedule, and check Operations Center for records.

## Expected Operations Center Behavior

For a one-minute schedule:

- No backfill should run when scheduling is first enabled.
- A scheduled execution should appear once per minute after the next planned minute boundary.
- The operations list should show planned execution time separately from actual start time.

If the first minute shows duplicate executions, inspect whether both a manual debug execution and a scheduled execution are visible, or whether the schedule was registered twice.

## Common Failures

### `Communications link failure` / `Connection refused`

The data source host is not reachable from the Kestra container. Check the generated JDBC URL in the execution log.

Bad:

```text
jdbc:mysql://127.0.0.1:3306/retail_demo
```

Good:

```text
jdbc:mysql://wb-data-mysql:3306/retail_demo
```

### Backend Data Source Test Passes But Offline Node Fails

The backend and Kestra are seeing different networks. In integration mode this should not happen if the data source uses service names. If it happens, confirm the backend container is using the same Docker network as Kestra.

### HiveSQL Cannot Find Tables

Verify the Hive init script ran and created tables in the database configured on the data source. For first-phase tests, use `default` unless the compose file explicitly creates a separate Hive database.

## Reset Strategy

The integration stack should support a clean reset by removing its named volumes and recreating containers.

Target command shape:

```bash
docker compose -f docker-compose.integration.yml down -v
docker compose -f docker-compose.integration.yml up -d --build
```

After reset, rerun or verify the data source seed step before testing offline nodes.

## Agent Notes

When an AI agent investigates SQL or HiveSQL execution failures:

1. Identify who executes the query: backend API or Kestra task.
2. Read the generated Flow YAML or execution log to get the actual JDBC URL.
3. Test network reachability from the executing container.
4. Do not change SQL text until connectivity is ruled out.
5. Do not replace service names with `127.0.0.1` in integration data sources.
