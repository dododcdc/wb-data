# Task 9 Report: Save, Commit, Push, Debug, And Schedule Integration

## Status

Completed on branch `codex/transfer-node`.

## Implemented

- Draft debug payload construction now includes the persisted `transfer` configuration for each node. It deliberately does not include Task 8 local-only `transferDraft` or `transferDraftValid` fields.
- Debug execution now checks the Kestra Docker task runner type (`io.kestra.plugin.scripts.runner.docker.Docker`) for each selected `TRANSFER` node before any namespace-file upload or flow creation. An unsupported runner produces HTTP 400 with the affected task ID.
- Selected transfer-node debug execution remains enabled when the runner is supported. The existing `OfflineFlowDocumentService.compileFlowDraft` path serializes transfer sidecars into namespace-file overrides, and `OfflineExecutionService` uploads those overrides to the debug namespace.

## Existing Chain Verified

- Save payloads already include only `transfer`; `flowSaveTransaction` continues to omit local editor draft fields and preserve conflict handling.
- `OfflineFlowDocumentService.resolveManagedFiles` includes transfer sidecars from the document snapshot. `GitCommandService.commitCurrentFlow` stages exactly that managed-file list, so `transfers/.../*.transfer.json` is included in a current-flow commit.
- Push emits `GitRepoPushedEvent`, which triggers the existing Git sync flow. Its `SyncNamespaceFiles` task uses `gitDirectory: .`, so committed transfer sidecars are included in Kestra namespace-file synchronization.
- Operations Center uses generic task-run status and log APIs. No transfer-specific frontend condition exists or is needed for the execution status/log path.

## Tests Added

- Frontend: selected transfer debug requests retain the saved `transfer` configuration.
- Backend: an unsupported Docker task runner rejects selected transfer debug execution before flow upload.
- Backend: a supported selected transfer uploads its transfer sidecar override and produces an enabled debug flow.

## Verification

- `cd wb-data-frontend && npx vitest run src/views/offline/flowSaveTransaction.test.ts src/views/offline/useFlowExecutionAndSchedule.test.ts`
  - Passed: 2 files, 12 tests.
- `cd wb-data-server && mvn -pl wb-data-backend -Dtest=OfflineExecutionServiceBranchTest,OfflineFlowDocumentServiceTest test`
  - Passed: 10 tests.

## Concerns

- The targeted Maven run emits pre-existing unchecked-operation compiler warnings from `OfflineFlowYamlSupportTest` and runtime Mockito/JDK dynamic-agent warnings. The build and selected tests pass.
