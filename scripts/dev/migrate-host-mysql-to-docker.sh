#!/usr/bin/env bash
# Dump Homebrew/host MySQL user databases into the Docker MySQL from
# docker/docker-compose.mysql.yml, then stop the host mysqld so port 3306 is free.
#
# Usage:
#   DB_PASSWORD=<root-password> scripts/dev/migrate-host-mysql-to-docker.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mysql_compose="$repo_root/docker/docker-compose.mysql.yml"
dump_dir="${WB_DATA_MYSQL_DUMP_DIR:-$repo_root/output/mysql-migration}"
host="${WB_DATA_METADATA_MYSQL_HOST:-127.0.0.1}"
port="${WB_DATA_METADATA_MYSQL_PORT:-3306}"
user="${WB_DATA_METADATA_MYSQL_USER:-root}"
password="${DB_PASSWORD:-1111}"
root_password="${WB_DATA_MYSQL_ROOT_PASSWORD:-1111}"

mysql_host() {
  mysql --protocol=TCP -h "$host" -P "$port" -u "$user" -p"$password" "$@"
}

echo "Listing host databases on $host:$port ..."
databases=()
while IFS= read -r db; do
  [ -n "$db" ] || continue
  databases+=("$db")
done < <(mysql_host -Nse 'SHOW DATABASES;' | grep -Ev '^(information_schema|mysql|performance_schema|sys)$')
if [ "${#databases[@]}" -eq 0 ]; then
  echo "No user databases found on the host MySQL." >&2
  exit 1
fi
printf '  %s\n' "${databases[@]}"

mkdir -p "$dump_dir"
dump_file="$dump_dir/host-mysql-$(date +%Y%m%d%H%M%S).sql"
echo "Dumping to $dump_file ..."
mysqldump --protocol=TCP -h "$host" -P "$port" -u "$user" -p"$password" \
  --single-transaction --routines --triggers --events --databases "${databases[@]}" \
  > "$dump_file"

echo "Stopping Homebrew mysql so Docker can bind 3306 ..."
brew services stop mysql
for _ in $(seq 1 30); do
  if ! lsof -nP -iTCP:3306 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if lsof -nP -iTCP:3306 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3306 is still in use after brew services stop mysql." >&2
  lsof -nP -iTCP:3306 -sTCP:LISTEN >&2
  exit 1
fi

docker_mysql() {
  docker exec -i -e MYSQL_PWD="$root_password" wb-data-mysql mysql -h 127.0.0.1 -uroot "$@"
}

docker_mysqladmin() {
  docker exec -e MYSQL_PWD="$root_password" wb-data-mysql mysqladmin -h 127.0.0.1 -uroot "$@"
}
docker compose -f "$mysql_compose" up -d
for _ in $(seq 1 40); do
  if docker_mysqladmin ping --silent >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker_mysqladmin ping --silent

echo "Restoring dump ..."
docker_mysql < "$dump_file"

echo "Ensuring transfer_demo and wbdata user exist ..."
docker_mysql < "$repo_root/scripts/dev/init/mysql/000_bootstrap.sql"

echo "Applying transfer fixture tables ..."
docker_mysql transfer_demo < "$repo_root/scripts/dev/init/transfer/mysql/001_schema.sql"

echo "Rewriting leftover 13306 data source ports to 3306 ..."
docker_mysql wb_data -e \
  "UPDATE datasource SET port = 3306 WHERE port = 13306 AND host IN ('localhost', '127.0.0.1');"

if docker container inspect wb-data-transfer-mysql >/dev/null 2>&1; then
  echo "Stopping obsolete transfer MySQL container ..."
  docker compose -f "$repo_root/docker/docker-compose.transfer.yml" stop wb-data-transfer-mysql >/dev/null 2>&1 || true
  docker rm -f wb-data-transfer-mysql >/dev/null 2>&1 || true
fi

echo
echo "Migration finished."
echo "Dump kept at: $dump_file"
echo "Homebrew datadir was not deleted: /opt/homebrew/var/mysql"
echo "Do not run: brew services start mysql  (it would fight Docker for 3306)"
echo "Restart the WB-Data backend so it reconnects to Docker MySQL."
