# Local Development

This document describes the day-to-day development setup for WB Data. It is optimized for fast frontend/backend iteration, not for production-like container networking.

## When To Use This Setup

Use this mode when changing React UI, Spring Boot APIs, offline editor behavior, query behavior, or ordinary backend code.

For full end-to-end validation of SQL, HiveSQL, scheduling, and operations records from the same network perspective, use `docs/local-integration-testing.md` instead.

## Services

| Service | Default mode | URL / port |
| --- | --- | --- |
| Frontend | Host Vite dev server | `http://127.0.0.1:5173` |
| Backend | Host Spring Boot | `http://127.0.0.1:8080` |
| App metadata MySQL | Host MySQL | `127.0.0.1:3306`, database `wb_data` |
| Kestra | Docker container | `http://127.0.0.1:8090` |
| HiveServer2 | Docker container, optional | `127.0.0.1:10000` from host |

Default app login:

| Field | Value |
| --- | --- |
| User | `admin` |
| Password | `admin123` |
| Project group | `policy` |

## Start Frontend

```bash
cd wb-data-frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

## Start Backend

```bash
cd wb-data-server/wb-data-backend
DB_PASSWORD=1111 mvn spring-boot:run -Dspring-boot.run.fork=false
```

The backend uses these defaults from `wb-data-server/wb-data-backend/src/main/resources/application.yml`:

| Setting | Default |
| --- | --- |
| App database | `jdbc:mysql://localhost:3306/wb_data` |
| Kestra URL | `http://localhost:8090` |
| Offline repo base | `output/offline-live/repos` |
| Plugin dir | `plugins` |

## Start Hive For Local Checks

```bash
docker compose -f docker-compose.hive.yml up -d
```

Hive is optional in daily development. Treat the local Hive container as disposable test infrastructure.

## Data Source Address Rules

The most common local failure is using `127.0.0.1` in a data source without considering who executes the query.

| Caller | Meaning of `127.0.0.1` |
| --- | --- |
| Host backend | The Mac / host machine |
| Kestra container | The Kestra container itself |
| Hive container | The Hive container itself |

This matters because:

- Self-service query APIs run through the backend.
- Offline SQL nodes run through Kestra.
- HiveSQL nodes are compiled into a command that Kestra executes.

If a data source is configured as `127.0.0.1:3306`, the backend may connect successfully, but a Kestra SQL task will try to connect to MySQL inside the Kestra container and fail with `Connection refused`.

## Recommended Daily Workflow

Use host-based frontend/backend for coding speed. Use containerized dependencies only where needed.

For SQL or HiveSQL node testing, prefer the full integration environment once it exists. If you must test from this daily setup, use data source hosts that are reachable from both the host backend and the Kestra container.

Examples:

| Data source host | Backend on host | Kestra container | Notes |
| --- | --- | --- | --- |
| `127.0.0.1` | Usually works | Usually fails | Do not use for offline SQL execution |
| `host.docker.internal` | May vary by OS / MySQL bind settings | Usually works on Docker Desktop | Useful for local debugging, not a clean contract |
| Docker service name | Usually fails from host backend | Works inside Docker network | Better when backend also runs in Docker |

## Quick Checks

Check local service ports:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8090 -sTCP:LISTEN
lsof -nP -iTCP:3306 -sTCP:LISTEN
```

Check host MySQL:

```bash
mysql -uroot -p1111 -h127.0.0.1 -P3306 -e 'select 1' wb_data
```

Check whether Kestra can reach a host MySQL on Docker Desktop:

```bash
docker exec wb-data-kestra bash -lc 'echo > /dev/tcp/host.docker.internal/3306'
```

If this fails, the issue is network reachability from the Kestra container, not the SQL text in the node.

## Troubleshooting

### Offline SQL Node Reports `Communications link failure`

Check the generated Flow YAML or execution log for the JDBC URL. If it contains `jdbc:mysql://127.0.0.1:3306/...`, the SQL task is trying to connect to the Kestra container itself.

Fix by using a data source address reachable from Kestra, or use the full integration environment where the backend and Kestra share Docker network service names.

### Backend Can Query But Offline SQL Node Fails

This means the data source is reachable from the backend process but not from the Kestra execution environment. Validate from the Kestra container before changing SQL node code.

### HiveSQL Node Fails To Connect

Confirm HiveServer2 is running:

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep wb-data-hiveserver2
```

In daily host-based development, a Hive data source using `127.0.0.1:10000` may be reachable from backend metadata APIs but not from Kestra tasks. Prefer integration mode for reliable HiveSQL tests.
