#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repo_root/docker-compose.transfer.yml"
metadata_mysql_host="${WB_DATA_METADATA_MYSQL_HOST:-127.0.0.1}"
metadata_mysql_port="${WB_DATA_METADATA_MYSQL_PORT:-3306}"
metadata_mysql_database="${WB_DATA_METADATA_MYSQL_DATABASE:-wb_data}"
metadata_mysql_user="${WB_DATA_METADATA_MYSQL_USER:-root}"
metadata_mysql_password="${DB_PASSWORD:-1111}"

compose() {
  docker compose -f "$compose_file" "$@"
}

echo "Starting transfer integration services..."
compose up -d

echo "Waiting for MySQL..."
for _ in $(seq 1 30); do
  if compose exec -T wb-data-transfer-mysql mysqladmin ping -h localhost -uroot -pwbdata-root-dev --silent; then
    break
  fi
  sleep 2
done
compose exec -T wb-data-transfer-mysql mysqladmin ping -h localhost -uroot -pwbdata-root-dev --silent

echo "Waiting for HiveServer2..."
for _ in $(seq 1 45); do
  if compose exec -T wb-data-transfer-hive beeline -u 'jdbc:hive2://localhost:10000/default' -e 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
compose exec -T wb-data-transfer-hive beeline -u 'jdbc:hive2://localhost:10000/default' -e 'SELECT 1' >/dev/null

echo "Applying Hive transfer schema..."
compose exec -T wb-data-transfer-hive beeline -u 'jdbc:hive2://localhost:10000/default' -f /opt/hive/scripts/001_schema.sql

echo "Checking Kestra and backend proxy containers..."
for service in wb-data-transfer-kestra wb-data-transfer-backend-network-alias; do
  if [ "$(compose ps --status running --services "$service")" != "$service" ]; then
    echo "Service is not running: $service" >&2
    compose ps >&2
    exit 1
  fi
done

if ! mysql --protocol=TCP -h "$metadata_mysql_host" -P "$metadata_mysql_port" \
  -u "$metadata_mysql_user" -p"$metadata_mysql_password" -Nse \
  "SELECT 1 FROM wb_project_group WHERE name = 'policy' LIMIT 1" "$metadata_mysql_database" | grep -qx '1'; then
  echo "Project group 'policy' is required before seeding transfer data sources." >&2
  exit 1
fi

echo "Seeding WB-Data transfer data sources..."
mysql --protocol=TCP -h "$metadata_mysql_host" -P "$metadata_mysql_port" \
  -u "$metadata_mysql_user" -p"$metadata_mysql_password" "$metadata_mysql_database" \
  < "$repo_root/scripts/dev/seed-transfer-datasources.sql"

cat <<'EOF'

Transfer environment is ready.

Manual validation:
1. Start WB-Data with WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token.
2. Open project group policy and confirm it_transfer_mysql and it_transfer_hive.
3. Create a transfer node using transfer_orders_source and transfer_orders_target.
4. Verify append and overwrite_table for MySQL, then overwrite_partition for Hive.
5. Run a Hive-to-MySQL append transfer and check target row counts.

Reset with:
  docker compose -f docker-compose.transfer.yml down -v
EOF
