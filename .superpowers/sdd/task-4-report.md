# Task 4 Report: Kestra YAML Generation For Transfer Tasks

## Delivered

- Added transfer runtime configuration for the SeaTunnel image, Docker network, and internal service environment-variable names.
- Transfer nodes now generate Kestra Docker-runner shell tasks that upload their JSON sidecar to the planned render endpoint and execute SeaTunnel with the rendered config.
- SQL, HiveSQL, and Shell task fields retain their existing YAML shapes.

## Validation

- `cd wb-data-server && mvn -pl wb-data-backend -Dtest=OfflineFlowYamlSupportTest,OfflineKestraPropertiesTest test` passed: 6 tests, 0 failures.
- `git diff --check` passed.

## Security

- Generated YAML contains only configurable environment-variable references for the internal URL and token. It does not contain secret values or generated SeaTunnel runtime configuration.

## Review Fixes

- Corrected the generated render URL to `${BASE}/api/v1/internal/offline/transfer/render`.
- Added `pullPolicy: IF_NOT_PRESENT` to the generated Docker `taskRunner`.
- Added `set -euo pipefail` before the generated `mkdir`, `curl`, and SeaTunnel commands.
- Updated `OfflineFlowYamlSupportTest` to assert the exact task runner and command values.

## Review Fix Validation

- `cd wb-data-server && mvn -pl wb-data-backend -Dtest=OfflineFlowYamlSupportTest,OfflineKestraPropertiesTest test` passed: 6 tests, 0 failures.
- `git diff --check` passed.
