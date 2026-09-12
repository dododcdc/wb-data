#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mysql_compose_file="$repo_root/docker/docker-compose.mysql.yml"
transfer_compose_file="$repo_root/docker/docker-compose.transfer.yml"
hive_compose_file="$repo_root/docker/docker-compose.hive.yml"
metadata_mysql_database="${WB_DATA_METADATA_MYSQL_DATABASE:-wb_data}"
mysql_root_password="${WB_DATA_MYSQL_ROOT_PASSWORD:-1111}"
backend_host_port="${WB_DATA_TRANSFER_BACKEND_HOST_PORT:-8080}"
backend_internal_base_url="${WB_DATA_TRANSFER_INTERNAL_BASE_URL:-http://host.docker.internal:$backend_host_port}"
kestra_url="${WB_DATA_KESTRA_BASE_URL:-http://localhost:8090}"
kestra_username="${WB_DATA_KESTRA_USERNAME:-admin@kestra.io}"
kestra_password="${WB_DATA_KESTRA_PASSWORD:-Admin1234!}"

mysql_compose() {
  docker compose -f "$mysql_compose_file" "$@"
}

mysql_in() {
  mysql_compose exec -T -e MYSQL_PWD="$mysql_root_password" mysql mysql -h 127.0.0.1 -uroot "$@"
}

echo "Building WB-Data SeaTunnel image..."
docker compose -f "$transfer_compose_file" build wb-data-seatunnel

echo "Starting Docker MySQL..."
mysql_compose up -d

echo "Starting existing Hive stack..."
docker compose -f "$hive_compose_file" up -d

echo "Starting existing Kestra..."
if docker container inspect wb-data-kestra >/dev/null 2>&1; then
  docker start wb-data-kestra-postgres >/dev/null 2>&1 || true
  docker start wb-data-kestra >/dev/null
else
  echo "Container wb-data-kestra does not exist. Start the existing WB-Data Kestra stack before running transfer validation." >&2
  exit 1
fi

echo "Waiting for MySQL..."
for _ in $(seq 1 40); do
  if mysql_compose exec -T -e MYSQL_PWD="$mysql_root_password" mysql mysqladmin -h 127.0.0.1 -uroot ping --silent; then
    break
  fi
  sleep 2
done
mysql_compose exec -T -e MYSQL_PWD="$mysql_root_password" mysql mysqladmin -h 127.0.0.1 -uroot ping --silent

echo "Ensuring transfer_demo exists..."
mysql_in < "$repo_root/scripts/dev/init/mysql/000_bootstrap.sql"

echo "Applying MySQL transfer schema..."
mysql_in transfer_demo < "$repo_root/scripts/dev/init/transfer/mysql/001_schema.sql"

echo "Waiting for Hive Metastore..."
for _ in $(seq 1 45); do
  if docker exec wb-data-hive-metastore bash -lc 'echo >/dev/tcp/localhost/9083' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec wb-data-hive-metastore bash -lc 'echo >/dev/tcp/localhost/9083'

echo "Waiting for HiveServer2..."
for _ in $(seq 1 45); do
  if docker exec wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' -e 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' -e 'SELECT 1' >/dev/null

echo "Normalizing Hive transfer warehouse ownership..."
docker exec --user root wb-data-hiveserver2 bash -lc '
  for table_dir in \
    /opt/hive/data/warehouse/transfer_orders_source \
    /opt/hive/data/warehouse/transfer_orders_target \
    /opt/hive/data/warehouse/transfer_orders_partitioned_target
  do
    if [ -e "$table_dir" ]; then
      chown -R hive:hive "$table_dir"
    fi
  done
'

echo "Applying Hive transfer schema..."
docker exec -i wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' -f /dev/stdin \
  < "$repo_root/scripts/dev/init/transfer/hive/001_schema.sql"

echo "Waiting for Kestra..."
for _ in $(seq 1 45); do
  if curl -sS -o /dev/null -u "$kestra_username:$kestra_password" "$kestra_url/api/v1/plugins"; then
    break
  fi
  sleep 2
done
curl -sS -o /dev/null -u "$kestra_username:$kestra_password" "$kestra_url/api/v1/plugins"
echo "Transfer tasks will call backend at $backend_internal_base_url"

if ! mysql_in -Nse "SELECT 1 FROM wb_project_group WHERE name = 'policy' LIMIT 1" "$metadata_mysql_database" | grep -qx '1'; then
  echo "Project group 'policy' is required before seeding transfer data sources." >&2
  exit 1
fi

echo "Seeding WB-Data transfer data sources..."
mysql_in "$metadata_mysql_database" < "$repo_root/scripts/dev/seed-transfer-datasources.sql"

cat <<'EOF'

Transfer environment is ready.

Data source fields and host rewrite: docs/local-development.md
Smoke steps: docs/local-integration-testing.md

Start the backend with:
   SPRING_PROFILES_ACTIVE=dev
   WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token
   WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:<backend-port>
   WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default
   WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse
   WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal

Then confirm it_transfer_mysql / it_transfer_hive in project group policy,
or run: WB_DATA_PASSWORD=<admin-password> scripts/dev/smoke-verify.sh

Reset Hive volumes with:
  docker compose -f docker/docker-compose.hive.yml down -v

Do not down -v docker/docker-compose.mysql.yml; that volume holds wb_data.
EOF
