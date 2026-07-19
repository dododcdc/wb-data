# Transfer Node Design

## Goal

Add a first-class offline `TRANSFER` node for JDBC-to-JDBC data movement. The first version should let users move table data between supported JDBC data sources through SeaTunnel, while preserving the existing offline flow workflow: configure node, save Flow, commit, push, sync to Kestra, and observe executions in Operations Center.

## Scope

V1 supports:

- Source and target data sources backed by JDBC-like engines: MySQL, Hive, PostgreSQL, and StarRocks.
- Source table selection.
- Optional source filter condition entered as a predicate fragment, such as `id = '12323'`.
- Target table selection.
- Field mapping based on target table columns.
- Hive target partition detection by the system.
- Static partition values, source-field partition values, and source SQL expression partition values.
- SeaTunnel execution launched by Kestra.

V1 does not support:

- Elasticsearch, MongoDB, Kafka, file transfers, or CDC.
- User-authored full SELECT statements for transfer nodes.
- Automatic SQL expression translation between database dialects.
- Complex transformation pipelines beyond target-field mapping and partition expressions.
- Full-table overwrite for Hive partitioned targets.

## User Model

A transfer node is configured through a form, not a code editor. Double-clicking a `TRANSFER` node opens the transfer configuration dialog.

The user selects:

- Source data source.
- Source database/schema when the engine exposes one.
- Source table.
- Optional filter predicate. The user enters only the predicate body; the system adds `WHERE`.
- Target data source.
- Target database/schema when the engine exposes one.
- Target table.
- Write mode.
- Field mappings for target columns without a same-name source column.
- Partition mappings when the target is a Hive partitioned table.

## Write Modes

The allowed write modes depend on target table metadata.

For non-partitioned target tables:

- `append`
- `overwrite_table`

For Hive partitioned target tables:

- `append`
- `overwrite_partition`

V1 does not expose `overwrite_table` for Hive partitioned targets because accidental whole-table replacement is too risky for scheduled jobs.

## Table Metadata

The system must identify Hive partitioned targets automatically. The user should not choose whether a table is partitioned.

When a target table is selected, the backend returns:

- Target columns.
- Hive partition columns.
- Non-partition columns.
- Target table partitioned status.
- Supported write modes.

For field mapping, the full target field set is the non-partition columns plus partition columns. The UI displays these separately as normal field mappings and partition mappings.

## Field Mapping

Field mapping is target-driven.

Rules:

- Source tables may have extra fields.
- Every target non-partition field must have a source.
- Same-name source fields are mapped by default.
- If a target field has no same-name source field, the user must configure a mapping.
- A mapping can use a source field, a constant value, or a source SQL expression.
- User-entered expressions are source-database SQL fragments. The system does not translate syntax.
- The system owns aliases. Users enter the expression only; the generated source query adds `AS target_column`.

Example:

```sql
SELECT
  id AS id,
  name AS name,
  date_format(date_key, '%Y%m%d') AS dayno
FROM source_table
WHERE id = '12323'
```

## Hive Partition Mapping

For each Hive target partition column, V1 supports three source modes:

- Static value: `dayno = '20260101'`
- Source field: `dayno <- source.dayno`
- Source expression: `dayno <- date_format(date_key, '%Y%m%d')`

Source expression syntax belongs to the source data source. For example, MySQL and StarRocks may use different date formatting functions or format strings. The UI labels this clearly as a source SQL expression.

## Validation

The transfer configuration must be validated before save and before commit/push-triggered execution.

Required validations:

- Source data source exists and is a supported JDBC-like type.
- Target data source exists and is a supported JDBC-like type.
- Source table exists.
- Target table exists.
- Target Hive partition metadata is loaded from the system, not user input.
- Write mode is allowed for the target table.
- Every target non-partition field has a mapping.
- Every Hive partition field has a mapping when using `overwrite_partition`.
- Filter predicate is a predicate fragment, not a full SQL statement.
- Mapping expressions are fragments, not full SQL statements.
- Generated SeaTunnel config can be built from the node configuration.

V1 validation rejects semicolons and full-query keywords such as top-level `select`, `from`, `insert`, `update`, `delete`, and `drop` in predicate and expression fragments. This is a guardrail, not a full SQL security model.

## Storage Model

The offline node model gains `TRANSFER` as a node kind and a structured transfer config.

Conceptually:

```json
{
  "taskId": "transfer_node_01",
  "kind": "TRANSFER",
  "transfer": {
    "source": {
      "dataSourceId": 1,
      "database": "demo",
      "table": "orders",
      "where": "id = '12323'"
    },
    "target": {
      "dataSourceId": 2,
      "database": "dw",
      "table": "dwd_orders",
      "writeMode": "overwrite_partition"
    },
    "fieldMappings": [
      {
        "target": "order_id",
        "kind": "source_field",
        "source": "id"
      },
      {
        "target": "dayno",
        "kind": "source_expression",
        "expression": "date_format(date_key, '%Y%m%d')"
      }
    ],
    "partitions": [
      {
        "target": "dayno",
        "kind": "source_expression",
        "expression": "date_format(date_key, '%Y%m%d')"
      }
    ]
  }
}
```

Secrets are not written to Flow YAML or Git. The saved node config stores data source ids and non-secret transfer settings. At execution time, WB-Data or the runtime resolves connection details from the configured data sources.

## Execution Architecture

Kestra remains the scheduler and execution recorder. SeaTunnel performs the data movement.

Execution flow:

1. User configures a `TRANSFER` node.
2. WB-Data validates metadata and saves structured config in the offline Flow document.
3. Commit and push sync the Flow to Kestra as today.
4. Kestra executes the Flow.
5. For each `TRANSFER` task, Kestra launches an isolated SeaTunnel container.
6. SeaTunnel receives a generated job config and runtime connection details.
7. Operations Center reads the Kestra execution record as it does for existing offline tasks.

SeaTunnel should run as a separate container launched by Kestra, not baked into the Kestra image. This keeps connector upgrades and runtime resources isolated.

## Docker Test Environment

Add a dedicated transfer integration environment, separate from the WB-Data metadata database.

Recommended compose services:

- `kestra`
- `mysql`
- `hive-metastore`
- `hive-server`
- `seatunnel`

All services run on the same Docker Compose network. SeaTunnel and Kestra access test sources by service name:

- MySQL JDBC host: `mysql:3306`
- Hive JDBC host: `hive-server:10000`

The local WB-Data backend can continue using the existing metadata database, for example `localhost:3306/wb_data`.

The compose environment should initialize:

- MySQL source tables.
- MySQL target tables.
- Hive source tables.
- Hive non-partitioned target tables.
- Hive partitioned target tables, including a `dayno` partition scenario.

## Test Plan

Unit tests:

- Transfer config validation rules.
- Field mapping defaulting and missing-target-field detection.
- Hive partition metadata interpretation.
- SeaTunnel config generation.
- YAML round trip for `TRANSFER` nodes.

Frontend tests:

- Add `TRANSFER` node.
- Open transfer configuration dialog.
- Select source and target tables.
- Show supported write modes based on target metadata.
- Require unmapped target fields.
- Require partition mapping for Hive partition overwrite.

Integration tests:

- MySQL to MySQL append.
- MySQL to Hive overwrite partition with static partition value.
- MySQL to Hive overwrite partition with source field partition value.
- MySQL to Hive overwrite partition with source expression partition value.
- Hive to MySQL append.
- Save, commit, push, Kestra execution, and target-table row verification.

## Implementation Notes

The implementation should use feature-driven simplification:

- Add a node-kind registry or mapping only where `TRANSFER` forces real variation.
- Keep script nodes and transfer nodes separate in the editor surface.
- Put SeaTunnel config generation in a backend pure module with a narrow interface.
- Keep credential resolution outside Git-managed Flow files.
- Preserve the existing save, commit, push, and Operations Center execution chain.

