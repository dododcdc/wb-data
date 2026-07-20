# Hive Metastore Data Source Design

Date: 2026-07-20

## Context

WB-Data currently treats a Hive data source as a HiveServer2 JDBC endpoint. That is enough for HiveSQL execution, table listing, and metadata reads through JDBC. Data transfer to Hive through SeaTunnel has a second runtime requirement: SeaTunnel's Hive sink needs a Hive Metastore Thrift URI so it can resolve table location, storage format, and partition metadata while writing files.

The current transfer runtime already reads `connectionParams.metastoreUri` when rendering a SeaTunnel Hive sink. The missing product surface is making that value explicit and validated in data source management.

## Decision

Keep a single `HIVE` data source type, but let it carry two endpoints:

- HiveServer2 endpoint: `host`, `port`, `databaseName`, `username`, `password`.
- Hive Metastore endpoint: `connectionParams.metastoreUri`.

Do not create a separate "Hive Metastore" data source type. Metastore belongs to the Hive cluster connection information, and users should not have to choose or duplicate it on every transfer node.

## User Experience

When users create or edit a Hive data source, the form shows a Hive-specific advanced field:

```text
Hive Metastore URI
Example: thrift://host.docker.internal:9083
```

The field is optional at general data source creation time because HiveSQL usage only needs HiveServer2. It becomes required when the same Hive data source is used as a transfer target with SeaTunnel Hive sink.

Connection testing remains centered on HiveServer2. If `metastoreUri` is present, the backend should validate at least the URI format. Full metastore connectivity can be added later when a lightweight Thrift check is available.

## Backend Scope

- Extend the Hive plugin descriptor to expose `metastoreUri` as a connection parameter field.
- Keep saving and returning `connectionParams` through existing `DataSourceSaveDTO` and `DataSource` paths.
- In transfer render validation, require `connectionParams.metastoreUri` when the target data source type is `HIVE`.
- Preserve current behavior for HiveSQL nodes and metadata reads, which continue using HiveServer2.

## Frontend Scope

- Render plugin-provided connection fields for Hive in the existing data source form.
- Store `metastoreUri` under `connectionParams.metastoreUri`.
- Show the value only as a Hive advanced setting, not as a normal host/port replacement.
- Keep existing data source list columns unchanged; the main connection display remains HiveServer2.

## Local Integration Scope

- Update transfer seed data so `it_transfer_hive` includes `connectionParams.metastoreUri` once the local Hive stack exposes a metastore service.
- Extend `docker-compose.hive.yml` with a reusable Hive metastore service on `9083`.
- Use `thrift://host.docker.internal:9083` for host-run backend plus Docker-run SeaTunnel validation, unless the full stack later moves backend into Docker.

## Validation

- Unit test that Hive plugin metadata includes `metastoreUri`.
- Backend transfer render test rejects Hive target without `metastoreUri`.
- Backend transfer render test accepts Hive target with `metastoreUri`.
- Frontend data source form test saves Hive `metastoreUri` into `connectionParams`.
- Local smoke: MySQL to Hive static partition transfer reaches SeaTunnel execution after the metastore service is available.

## Non-Goals

- Do not add a separate metastore data source type.
- Do not require metastore for HiveSQL-only usage.
- Do not ask users to fill metastore settings inside each transfer node.
- Do not solve production Kerberos, HDFS HA, or remote object storage configuration in this pass.
