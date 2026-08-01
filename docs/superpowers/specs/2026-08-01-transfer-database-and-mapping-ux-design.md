# Transfer Database Selection and Mapping UX Design

Date: 2026-08-01

## Context

The Transfer V1 data model already stores an optional `database` on both source and target endpoints, and the backend table and table-metadata services already accept `databaseName`. The current editor does not expose database selection and does not pass a database to table-list requests. It also requests table metadata with an empty database name.

This creates two visible failures:

- A data source that exposes multiple databases cannot be configured correctly.
- Target metadata can fail or return no columns, leaving the field-mapping section as an unexplained empty panel.

The canvas also gives `TRANSFER` nodes a special width, spacing, border, and background. Other node kinds share one container style and differ through their type badges, so the Transfer node looks unrelated to the rest of the workflow.

## Decision

Add explicit source and target database selection to the Transfer editor. Selecting a data source automatically selects its configured default database when that database is available, while still allowing the user to choose another database.

Keep Transfer metadata behind group-scoped Transfer endpoints. Do not make the Transfer editor depend on the SQL Query module's metadata endpoint.

Generate field-mapping rows from successfully loaded source and target table metadata. Metadata loading and failure states must be visible instead of being converted to empty arrays.

Use the shared canvas-node container style for `TRANSFER`. Preserve only the Transfer type-badge color as its visual distinction.

## Database Metadata API

Add a group-scoped endpoint:

```text
GET /api/v1/groups/{groupId}/offline/transfer/datasources/{dataSourceId}/databases
```

The endpoint:

- Requires `OFFLINE_READ` and data-source read permission.
- Verifies that the data source belongs to `groupId`.
- Rejects unsupported Transfer data-source types.
- Returns the logical database or schema names provided by the data-source plugin's existing `getDatabases` capability.

Table-list and table-metadata requests continue to use the Transfer endpoints and must include the selected `databaseName`.

## Selection Flow

Each endpoint follows the same dependency chain:

```text
Data source -> Database -> Table -> Table metadata
```

After a data source is selected:

1. Clear the previous database, table, metadata, and mappings for that side.
2. Load the available databases.
3. Select the data source's configured `databaseName` when it is present in the returned list.
4. For a new endpoint with no saved database, if the configured default is absent and the returned list contains exactly one database, select that database.
5. Otherwise leave the database unselected and require the user to choose one.
6. Load tables only after a database has been selected.

Changing a database clears that side's table and metadata. Changing either source data source, source database, source table, target data source, target database, or target table also clears generated field and partition mappings, because identical table names in different databases do not guarantee identical schemas.

Existing saved Transfer configurations remain compatible:

- When a saved endpoint has a `database`, preserve it if it remains available.
- When a saved endpoint has no `database`, apply the default-selection rules above.
- Do not silently replace a saved database that is no longer available. Show an error and require a new selection.

## Editor Layout

The source and target sections use the same field order:

```text
Data source
Database
Table
```

The source section then shows the optional filter predicate. The target section shows the write mode after target metadata is available.

Use the project's existing form-control tokens, spacing, focus states, and typography. Database controls use normal selects in this pass, matching the current Transfer editor and keeping the change scoped. Large searchable metadata selectors are a later enhancement.

## Field Mapping

Field mapping remains target-driven:

- Every non-partition target column produces one mapping row.
- A same-name source column defaults to `source_field` mapping.
- A target column without a same-name source column remains visibly unconfigured.
- The user can map from a source field, static value, or source SQL expression.
- Source SQL expressions continue to use source-database syntax and are not translated.
- Hive partition columns remain in a separate section and use the same three mapping kinds.

The mapping area has explicit states:

- Prerequisite: explain that source and target tables must be selected.
- Loading: show a compact skeleton while either table's metadata is loading.
- Error: show which side failed to load metadata and provide a retry action.
- Ready: show all target mapping rows, including unmapped required rows.
- Empty metadata: report that the selected target table exposes no transferable columns instead of showing a blank panel.

Mapping validation errors stay next to the affected rows where possible. A summary remains available for save blocking, but it must not be the only indication of an unmapped field.

## Canvas Node Consistency

Remove the Transfer-only container sizing and surface treatment. A `TRANSFER` node uses the same:

- Width and padding.
- Border and background.
- Selection and checked states.
- Label layout and connector placement.

The `TRANSFER` badge keeps its existing color so users can distinguish the node kind in the same way they distinguish SQL, Hive SQL, and Shell nodes.

## Error Handling

Metadata failures must not be swallowed into empty lists.

- Database-list failure disables the table selector and shows a database-loading error with retry.
- Table-list failure keeps the selected database and shows a table-loading error with retry.
- Table-metadata failure keeps the selected table and shows a metadata error with retry.
- A stale response from a previous data source, database, or table selection must never replace the current state.

No partially loaded configuration is emitted as valid. Save, commit, and execution validation continue to require a complete, current Transfer configuration.

## Backend Scope

- Add the group-scoped Transfer database-list endpoint.
- Reuse `DataSourcePlugin#getDatabases` through `TransferMetadataService`.
- Keep existing data-source ownership and supported-type checks.
- Keep table and table-metadata endpoint contracts, while testing non-empty `databaseName` behavior.

## Frontend Scope

- Extend the Transfer metadata API with database listing.
- Track source and target database options, loading states, errors, and retry actions.
- Pass selected databases into table-list and table-metadata requests.
- Apply default-database selection and dependency-reset rules.
- Render explicit field-mapping states and row-level missing-mapping feedback.
- Remove the Transfer-only canvas-node container class and CSS.
- Align Transfer form styling with existing application tokens.

## Validation

Backend tests:

- Database listing enforces group ownership and supported Transfer types.
- Database listing delegates to the selected plugin.
- Table and metadata reads use the requested database.

Frontend hook tests:

- Selecting a data source loads databases and selects its configured default.
- A saved database remains selected when available.
- A new endpoint selects its single available database when the configured default is unavailable.
- A saved database that is no longer available remains invalid until the user chooses a replacement.
- Multiple databases without an available default require explicit selection.
- Changing data source, database, or table clears dependent state.
- Table and metadata requests include the selected database.
- Stale database, table, and metadata responses are ignored.
- Loading failures are exposed and retryable.

Frontend component tests:

- Source and target database controls are rendered in dependency order.
- Field mappings appear after both metadata responses succeed.
- Missing same-name source fields remain visible and invalid.
- Loading, failure, retry, and empty-metadata states are rendered.
- Hive partition mappings remain separate from normal fields.
- Transfer canvas nodes use the shared node container style.

Runtime verification:

- Configure MySQL source and Hive target using their automatically selected default databases.
- Confirm ordinary and partition mappings render.
- Save, commit, push, and run the transfer through Kestra.
- Verify a second database can be selected on a multi-database test source and that its tables and columns replace the previous options.

## Non-Goals

- Do not add cross-database transfer discovery beyond plugin-provided database names.
- Do not introduce free-text database entry.
- Do not add field transformation builders or SQL-dialect translation.
- Do not redesign the complete node editor shell.
- Do not change SeaTunnel execution architecture or existing write-mode semantics.
