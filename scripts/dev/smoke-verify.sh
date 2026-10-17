#!/usr/bin/env bash
# WB-Data 统一冒烟验证脚本（合并原 transfer-smoke.sh + smoke-verify.sh + 全模块快检）
#
# 模式说明：
#   --quick       (默认) 秒级全模块 API 冒烟（覆盖认证/项目组/组设置/数据源/自助查询/参数组与引用/离线仓库与文档/调度/依赖/运维中心）
#   --transfer    完整数据传输与 SQL 执行冒烟（自动准备 MySQL/Hive 测试表、通过 API 确保数据源存在，并执行 SeaTunnel 场景 A～K）
#   --all         依次执行 --quick 与 --transfer
#   --prep-only   仅准备 Docker 传输测试环境与 MySQL/Hive 测试表（原 transfer-smoke.sh）
#
# 用法示例：
#   WB_DATA_PASSWORD=<admin-password> scripts/dev/smoke-verify.sh
#   WB_DATA_PASSWORD=<admin-password> scripts/dev/smoke-verify.sh --all
#
# 可选环境变量：
#   WB_DATA_BACKEND_BASE_URL   默认 http://127.0.0.1:8080
#   WB_DATA_INFRA_HOST         Docker 基础设施主机，默认 omarchy.local（本机 Docker 可设 localhost）
#   WB_DATA_USERNAME           默认 admin
#   WB_DATA_GROUP_NAME         默认 policy
#   DB_PASSWORD                MySQL root 密码，默认 1111
#   WB_DATA_VERIFY_TIMEOUT     单次执行超时秒数，默认 300
set -euo pipefail

mode="${1:---quick}"
case "$mode" in
  --quick|--transfer|--all|--prep-only) ;;
  *)
    echo "用法: WB_DATA_PASSWORD=<密码> $0 [--quick | --transfer | --all | --prep-only]" >&2
    exit 1
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mysql_compose_file="$repo_root/docker/docker-compose.mysql.yml"
transfer_compose_file="$repo_root/docker/docker-compose.transfer.yml"
hive_compose_file="$repo_root/docker/docker-compose.hive.yml"

backend="${WB_DATA_BACKEND_BASE_URL:-http://127.0.0.1:8080}"
infra_host="${WB_DATA_INFRA_HOST:-omarchy.local}"
username="${WB_DATA_USERNAME:-admin}"
group_name="${WB_DATA_GROUP_NAME:-policy}"
mysql_root_password="${DB_PASSWORD:-${WB_DATA_MYSQL_ROOT_PASSWORD:-1111}}"
timeout_seconds="${WB_DATA_VERIFY_TIMEOUT:-300}"

for cmd in curl jq docker; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "缺少依赖: $cmd" >&2; exit 1; }
done

TOKEN=""
GROUP_ID=""
MYSQL_DS_ID=""
HIVE_DS_ID=""
API_MYSQL_DS_ID=""

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" "$backend$path")
  if [ -n "$TOKEN" ]; then
    args+=(-H "Authorization: Bearer $TOKEN")
  fi
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  curl "${args[@]}"
}

expect_ok() {
  local resp="$1" ctx="$2"
  local code
  code="$(jq -r '.code // "null"' <<<"$resp" 2>/dev/null || echo null)"
  if [ "$code" != "200" ]; then
    echo "FAIL: $ctx" >&2
    echo "$resp" | jq . >&2 2>/dev/null || echo "$resp" >&2
    exit 1
  fi
}

assert_eq() {
  local actual="$1" expected="$2" ctx="$3"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: ${ctx}（期望 $expected，实际 ${actual:-<empty>}）" >&2
    exit 1
  fi
  echo "  ✓ $ctx = $actual"
}

mysql_query() {
  docker compose -f "$mysql_compose_file" exec -T -e MYSQL_PWD="$mysql_root_password" mysql \
    mysql -h 127.0.0.1 -uroot -Nse "$1" transfer_demo 2>/dev/null | tr -d '[:space:]'
}

hive_query() {
  docker exec wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' \
    --silent=true --showHeader=false --outputformat=csv2 -e "$1" 2>/dev/null \
    | tr -d '\r"' | grep -E '^-?[0-9]+$' | head -1
}

reset_mysql_fixture() {
  docker compose -f "$mysql_compose_file" exec -T -e MYSQL_PWD="$mysql_root_password" mysql \
    mysql -h 127.0.0.1 -uroot < "$repo_root/scripts/dev/init/mysql/000_bootstrap.sql" 2>/dev/null
  docker compose -f "$mysql_compose_file" exec -T -e MYSQL_PWD="$mysql_root_password" mysql \
    mysql -h 127.0.0.1 -uroot transfer_demo \
    < "$repo_root/scripts/dev/init/transfer/mysql/001_schema.sql" 2>/dev/null
}

reset_hive_fixture() {
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
  docker exec -i wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' \
    -f /dev/stdin < "$repo_root/scripts/dev/init/transfer/hive/001_schema.sql" >/dev/null 2>&1
}

prepare_transfer_containers() {
  echo "==> 检查并准备 Docker 容器与测试库夹具 (infra_host=$infra_host)"
  if ! docker image inspect wb-data/seatunnel:2.3.13 >/dev/null 2>&1; then
    echo "  构建 SeaTunnel 镜像..."
    docker compose -f "$transfer_compose_file" build wb-data-seatunnel
  fi
  for container in wb-data-mysql wb-data-hiveserver2 wb-data-kestra; do
    local status
    status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo missing)"
    if [ "$status" != "running" ]; then
      echo "FAIL: 容器 $container 未运行（当前: $status）" >&2
      exit 1
    fi
  done
  reset_mysql_fixture
  reset_hive_fixture
  echo "  ✓ MySQL transfer_demo 与 Hive default 测试表已就绪"
}

if [ "$mode" = "--prep-only" ]; then
  prepare_transfer_containers
  exit 0
fi

password="${WB_DATA_PASSWORD:?请提供登录密码，例如 WB_DATA_PASSWORD=xxx $0 $mode}"

login_and_locate_group() {
  echo "==> [1] 认证与用户上下文 ($backend, 用户=$username)"
  local resp
  resp="$(api POST /api/v1/auth/login "$(jq -nc --arg u "$username" --arg p "$password" '{username: $u, password: $p}')")"
  expect_ok "$resp" "登录 /api/v1/auth/login"
  TOKEN="$(jq -r '.data.accessToken' <<<"$resp")"

  resp="$(api GET /api/v1/auth/context)"
  expect_ok "$resp" "获取用户上下文 /api/v1/auth/context"
  GROUP_ID="$(jq -r --arg name "$group_name" '.data.accessibleGroups[] | select(.name == $name) | .id' <<<"$resp" | head -1)"
  [ -n "$GROUP_ID" ] || { echo "FAIL: 当前用户看不到项目组 $group_name" >&2; exit 1; }
  echo "  ✓ 登录成功，目标项目组 $group_name (groupId=$GROUP_ID)"
}

ensure_datasource() {
  local name="$1" type="$2" port="$3" db="$4" user="$5" pass="$6" params_json="${7:-"{}"}"
  local resp ds_id payload
  resp="$(api GET "/api/v1/groups/$GROUP_ID/datasources?page=1&size=50&keyword=$name")"
  expect_ok "$resp" "查询数据源 $name"
  ds_id="$(jq -r --arg name "$name" '.data.records[] | select(.name == $name) | .id' <<<"$resp" | head -1)"

  payload="$(jq -nc \
    --arg name "$name" --arg type "$type" --arg host "$infra_host" --argjson port "$port" \
    --arg db "$db" --arg user "$user" --arg pass "$pass" --argjson params "$params_json" \
    '{
      name: $name, type: $type, description: "smoke-verify 自动维护",
      host: $host, port: $port, databaseName: $db,
      username: $user, password: $pass, connectionParams: $params
    }')"

  if [ -z "$ds_id" ]; then
    resp="$(api POST "/api/v1/groups/$GROUP_ID/datasources" "$payload")"
    expect_ok "$resp" "创建数据源 $name"
    resp="$(api GET "/api/v1/groups/$GROUP_ID/datasources?page=1&size=50&keyword=$name")"
    ds_id="$(jq -r --arg name "$name" '.data.records[] | select(.name == $name) | .id' <<<"$resp" | head -1)"
  else
    resp="$(api PUT "/api/v1/groups/$GROUP_ID/datasources/$ds_id" "$payload")"
    expect_ok "$resp" "更新数据源 $name (id=$ds_id)"
  fi

  resp="$(api PATCH "/api/v1/groups/$GROUP_ID/datasources/$ds_id/status" '{"status":"ENABLED"}')"
  expect_ok "$resp" "启用数据源 $name"
  echo "$ds_id"
}

ensure_all_smoke_datasources() {
  echo "==> [2] 准备并验证数据源 (host=$infra_host)"
  local resp
  resp="$(api GET "/api/v1/groups/$GROUP_ID/datasources/plugins")"
  expect_ok "$resp" "获取数据源插件列表"
  local plugin_count
  plugin_count="$(jq -r '.data | length' <<<"$resp")"
  echo "  ✓ 已加载数据源插件数 = $plugin_count"

  docker compose -f "$mysql_compose_file" exec -T -e MYSQL_PWD="$mysql_root_password" mysql \
    mysql -h 127.0.0.1 -uroot < "$repo_root/scripts/dev/init/mysql/000_bootstrap.sql" 2>/dev/null || true

  MYSQL_DS_ID="$(ensure_datasource "it_transfer_mysql" "MYSQL" 3306 "transfer_demo" "wbdata" "wbdata123" '{}')"
  HIVE_DS_ID="$(ensure_datasource "it_transfer_hive" "HIVE" 10000 "default" "hive" "" '{"metastoreUri":"thrift://host.docker.internal:9083"}')"
  API_MYSQL_DS_ID="$(ensure_datasource "smoke_it_mysql_api" "MYSQL" 3306 "transfer_demo" "wbdata" "wbdata123" '{}')"
  echo "  ✓ 数据源就绪: it_transfer_mysql=$MYSQL_DS_ID, it_transfer_hive=$HIVE_DS_ID, smoke_it_mysql_api=$API_MYSQL_DS_ID"

  resp="$(api POST "/api/v1/groups/$GROUP_ID/datasources/test-connection" "$(jq -nc --arg host "$infra_host" '{
    type: "MYSQL", host: $host, port: 3306, databaseName: "transfer_demo",
    username: "wbdata", password: "wbdata123"
  }')")"
  expect_ok "$resp" "测试数据源连接 ($infra_host:3306)"
  assert_eq "$(jq -r '.data.success' <<<"$resp")" "true" "数据源连接测试"
}

save_flow() {
  local path="$1" nodes_json="$2"
  local existing hash updated_at
  existing="$(api GET "/api/v1/groups/$GROUP_ID/offline/flows/document?path=$path")"
  hash="$(jq -r '.data.documentHash // empty' <<<"$existing" 2>/dev/null || true)"
  updated_at="$(jq -r '.data.documentUpdatedAt // 0' <<<"$existing" 2>/dev/null || echo 0)"
  if [ -z "$hash" ]; then
    hash=""
    updated_at=0
  fi
  local body resp
  body="$(jq -nc \
    --arg path "$path" --arg hash "$hash" --argjson updatedAt "$updated_at" --argjson nodes "$nodes_json" \
    '{
       path: $path,
       documentHash: $hash,
       documentUpdatedAt: $updatedAt,
       stages: [{stageId: "s1", nodes: $nodes}],
       edges: [],
       layout: {},
       runtimeTimezone: "Asia/Shanghai"
     }')"
  resp="$(api PUT "/api/v1/groups/$GROUP_ID/offline/flows/document" "$body")"
  expect_ok "$resp" "保存 flow $path"
}

run_quick_smoke() {
  echo "==> [3] 项目组管理与组设置 (group / git 模块)"
  local resp
  resp="$(api GET "/api/v1/groups?page=1&size=10")"
  expect_ok "$resp" "项目组分页列表 /api/v1/groups"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/settings")"
  expect_ok "$resp" "项目组设置 /api/v1/groups/$GROUP_ID/settings"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/git/sync-config")"
  expect_ok "$resp" "Git 分支同步配置 /api/v1/groups/$GROUP_ID/git/sync-config"
  echo "  ✓ 项目组与 Git 同步配置接口正常"

  echo "==> [4] 自助查询与元数据浏览 (query 模块)"
  resp="$(api GET "/api/v1/query/metadata/$API_MYSQL_DS_ID/databases")"
  expect_ok "$resp" "查询数据库列表 /api/v1/query/metadata/$API_MYSQL_DS_ID/databases"
  resp="$(api POST "/api/v1/query/execute/$API_MYSQL_DS_ID" '{"sql":"SELECT 1 AS smoke_ok"}')"
  expect_ok "$resp" "执行即席 SQL (SELECT 1)"
  assert_eq "$(jq -r '.data.rows[0] | if type == "object" then .smoke_ok else .[0] end' <<<"$resp")" "1" "即席查询返回结果"

  echo "==> [5] 参数组与离线任务引用统计 (parameter ↔ offline.parameter 端口)"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/parameter-groups?page=1&size=10")"
  expect_ok "$resp" "参数组列表"
  local pg_id
  pg_id="$(jq -r '.data.records[0].id // empty' <<<"$resp")"
  if [ -n "$pg_id" ]; then
    resp="$(api GET "/api/v1/groups/$GROUP_ID/parameter-groups/$pg_id/references")"
    expect_ok "$resp" "参数组引用统计 /parameter-groups/$pg_id/references"
    echo "  ✓ 参数组 (id=$pg_id) 引用统计接口正常，引用数=$(jq -r '.data.totalCount' <<<"$resp")"
  else
    echo "  ✓ 参数组列表接口正常（当前组暂无参数组）"
  fi

  echo "==> [6] 离线开发各子域 (repo / flow / schedule / transfer.metadata)"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/offline/repo/branches")"
  expect_ok "$resp" "分支列表 /offline/repo/branches"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/offline/repo/status")"
  expect_ok "$resp" "工作树状态 /offline/repo/status"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/offline/repo/tree")"
  expect_ok "$resp" "仓库目录树 /offline/repo/tree"

  local quick_flow_path="_flows/smoke_it/quick_check/flow.yaml"
  local sql_node
  sql_node="$(jq -nc --argjson ds "$API_MYSQL_DS_ID" '{
    taskId: "quick_sql",
    kind: "SQL",
    scriptPath: "scripts/quick_check/quick_sql.sql",
    scriptContent: "SELECT 1",
    dataSourceId: $ds,
    dataSourceType: "MYSQL"
  }')"
  save_flow "$quick_flow_path" "[$sql_node]"

  local flow_cur sched_hash sched_updated
  flow_cur="$(api GET "/api/v1/groups/$GROUP_ID/offline/flows/content?path=$quick_flow_path")"
  expect_ok "$flow_cur" "读取任务内容 /offline/flows/content"
  sched_hash="$(jq -r '.data.contentHash' <<<"$flow_cur")"
  sched_updated="$(jq -r '.data.fileUpdatedAt' <<<"$flow_cur")"

  resp="$(api PUT "/api/v1/groups/$GROUP_ID/offline/schedules" "$(jq -nc \
    --arg p "$quick_flow_path" \
    --arg h "$sched_hash" \
    --argjson u "$sched_updated" \
    '{path: $p, cron: "0 2 * * *", period: "DAILY", contentHash: $h, fileUpdatedAt: $u}')")"
  expect_ok "$resp" "更新任务调度 /offline/schedules"
  assert_eq "$(jq -r '.data.period' <<<"$resp")" "DAILY" "调度周期保存与解析 (wb-data-common-core)"

  resp="$(api GET "/api/v1/groups/$GROUP_ID/offline/schedules?path=$quick_flow_path")"
  expect_ok "$resp" "读取已配置的任务调度 /offline/schedules"

  resp="$(api GET "/api/v1/groups/$GROUP_ID/offline/transfer/datasources/$API_MYSQL_DS_ID/databases")"
  expect_ok "$resp" "Transfer 元数据数据库列表 /offline/transfer/datasources/$API_MYSQL_DS_ID/databases"
  echo "  ✓ 离线仓库、任务文档、调度与 Transfer 元数据子域全部正常"

  echo "==> [7] 运维中心 (operations 模块)"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/operations/executions?page=1&pageSize=10")"
  expect_ok "$resp" "运维中心执行列表 /operations/executions"
  assert_eq "$(jq -r '.data.executions | type' <<<"$resp")" "array" "运维执行列表结构"

  echo ""
  echo "✓ 全模块快速冒烟 (--quick) 全部通过！"
}

transfer_node() {
  local task_id="$1" src_ds="$2" src_type="$3" src_db="$4" src_table="$5" \
        tgt_ds="$6" tgt_type="$7" tgt_db="$8" tgt_table="$9" write_mode="${10}" partitions="${11:-null}"
  jq -nc \
    --arg taskId "$task_id" \
    --argjson srcDs "$src_ds" --arg srcType "$src_type" --arg srcDb "$src_db" --arg srcTable "$src_table" \
    --argjson tgtDs "$tgt_ds" --arg tgtType "$tgt_type" --arg tgtDb "$tgt_db" --arg tgtTable "$tgt_table" \
    --arg writeMode "$write_mode" --argjson partitions "$partitions" \
    '{
       taskId: $taskId,
       kind: "TRANSFER",
       transfer: ({
         source: {dataSourceId: $srcDs, dataSourceType: $srcType, database: $srcDb, table: $srcTable},
         target: {dataSourceId: $tgtDs, dataSourceType: $tgtType, database: $tgtDb, table: $tgtTable, writeMode: $writeMode}
       } + (if $partitions == null then {} else {partitions: $partitions} end))
     }'
}

await_execution() {
  local execution_id="$1" ctx="$2" expected_status="${3:-SUCCESS}"
  local deadline=$(( $(date +%s) + timeout_seconds ))
  local resp status
  while true; do
    resp="$(api GET "/api/v1/groups/$GROUP_ID/offline/executions/$execution_id")"
    status="$(jq -r '.data.status // "UNKNOWN"' <<<"$resp" 2>/dev/null || echo UNKNOWN)"
    if [ "$status" = "$expected_status" ]; then
      echo "  ✓ $ctx 执行终态符合预期 ${status}（$execution_id）"
      return 0
    fi
    case "$status" in
      SUCCESS|FAILED|CANCELLED|KILLED)
        echo "FAIL: $ctx 执行终态 ${status}（$execution_id）" >&2
        api GET "/api/v1/groups/$GROUP_ID/offline/executions/$execution_id/logs" \
          | jq -r '.data | if type == "string" then . else tojson end' 2>/dev/null | tail -30 >&2 || true
        exit 1
        ;;
    esac
    if [ "$(date +%s)" -gt "$deadline" ]; then
      echo "FAIL: $ctx 执行超时（>${timeout_seconds}s，当前状态 $status，$execution_id）" >&2
      exit 1
    fi
    sleep 5
  done
}

run_flow() {
  local path="$1" mode="$2" selected_json="$3" ctx="$4"
  local body resp execution_id
  body="$(jq -nc --arg flowPath "$path" --arg mode "$mode" --argjson sel "$selected_json" \
    '{flowPath: $flowPath, mode: $mode, selectedTaskIds: $sel}')"
  resp="$(api POST "/api/v1/groups/$GROUP_ID/offline/executions/debug/current" "$body")"
  expect_ok "$resp" "触发执行 $ctx"
  execution_id="$(jq -r '.data.executionId' <<<"$resp")"
  await_execution "$execution_id" "$ctx" "${5:-SUCCESS}"
}

run_transfer_smoke() {
  prepare_transfer_containers
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "1" "MySQL target 初始行数"

  echo "==> 场景 A：MySQL → MySQL append"
  save_flow "_flows/smoke_it/mysql_to_mysql_append/flow.yaml" \
    "[$(transfer_node transfer_append "$API_MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$API_MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)]"
  run_flow "_flows/smoke_it/mysql_to_mysql_append/flow.yaml" ALL '[]' "场景 A"
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "4" "append 后行数（1+3）"

  echo "==> 场景 B：MySQL → MySQL overwrite_table"
  save_flow "_flows/smoke_it/mysql_to_mysql_overwrite/flow.yaml" \
    "[$(transfer_node transfer_overwrite "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target overwrite_table)]"
  run_flow "_flows/smoke_it/mysql_to_mysql_overwrite/flow.yaml" ALL '[]' "场景 B"
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "3" "overwrite_table 后行数"
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target WHERE order_id = 9999')" "0" "旧数据已被覆盖清除"

  echo "==> 场景 C：MySQL → Hive overwrite_partition"
  save_flow "_flows/smoke_it/mysql_to_hive_overwrite_partition/flow.yaml" \
    "[$(transfer_node transfer_hive_partition "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$HIVE_DS_ID" HIVE default transfer_orders_partitioned_target overwrite_partition '[{"target":"dayno","kind":"source_field","source":"dayno"}]')]"
  run_flow "_flows/smoke_it/mysql_to_hive_overwrite_partition/flow.yaml" ALL '[]' "场景 C"
  assert_eq "$(hive_query "SELECT COUNT(*) FROM transfer_orders_partitioned_target WHERE dayno = '20260701'")" "2" "分区 20260701 行数（覆盖后）"
  assert_eq "$(hive_query "SELECT COUNT(*) FROM transfer_orders_partitioned_target WHERE dayno = '20260702'")" "1" "分区 20260702 行数"
  assert_eq "$(hive_query "SELECT COUNT(*) FROM transfer_orders_partitioned_target WHERE order_id = 2998")" "0" "旧分区数据已被覆盖清除"

  echo "==> 场景 D：Hive → MySQL append"
  local before after
  before="$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')"
  save_flow "_flows/smoke_it/hive_to_mysql_append/flow.yaml" \
    "[$(transfer_node transfer_hive_to_mysql "$HIVE_DS_ID" HIVE default transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)]"
  run_flow "_flows/smoke_it/hive_to_mysql_append/flow.yaml" ALL '[]' "场景 D"
  after="$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')"
  assert_eq "$((after - before))" "2" "append 新增行数（Hive source 2 行）"

  echo "==> 场景 E：单节点选中执行"
  reset_mysql_fixture
  local node_a node_b
  node_a="$(transfer_node sel_node_a "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)"
  node_b="$(transfer_node sel_node_b "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)"
  save_flow "_flows/smoke_it/selected_single_node/flow.yaml" "[$node_a,$node_b]"
  run_flow "_flows/smoke_it/selected_single_node/flow.yaml" SELECTED '["sel_node_a"]' "场景 E"
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "4" "只跑选中节点行数（1+3，而非 1+6）"

  echo "==> 场景 G：SQL 节点执行"
  local sql_node
  sql_node="$(jq -nc --argjson ds "$API_MYSQL_DS_ID" '{
    taskId: "sql_loopback",
    kind: "SQL",
    scriptPath: "scripts/sql_loopback/sql_loopback.sql",
    scriptContent: "REPLACE INTO transfer_orders_target (order_id, customer_name, amount, date_key, dayno) VALUES (7777, '"'"'sql-loopback'"'"', 7.77, '"'"'2026-07-07'"'"', '"'"'20260707'"'"')",
    dataSourceId: $ds,
    dataSourceType: "MYSQL"
  }')"
  save_flow "_flows/smoke_it/sql_loopback/flow.yaml" "[$sql_node]"
  run_flow "_flows/smoke_it/sql_loopback/flow.yaml" ALL '[]' "场景 G"
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target WHERE order_id = 7777')" "1" "SQL 节点写入行数"

  echo "==> 场景 H：选中传输节点执行前后 SQL（各 5 条）"
  mysql_query 'CREATE TABLE IF NOT EXISTS transfer_sql_audit (id BIGINT AUTO_INCREMENT PRIMARY KEY, step VARCHAR(32), row_count BIGINT)'
  mysql_query 'TRUNCATE TABLE transfer_sql_audit'
  local hook_node
  hook_node="$(transfer_node transfer_hooks "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)"
  hook_node="$(jq -c '.transfer.target.preSql = [
      "TRUNCATE TABLE transfer_orders_target",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''pre_2'\'', COUNT(*) FROM transfer_orders_target",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''pre_3'\'', COUNT(*) FROM transfer_sql_audit",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''pre_4'\'', COUNT(*) FROM transfer_sql_audit",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''pre_5'\'', COUNT(*) FROM transfer_sql_audit"
    ] | .transfer.target.postSql = [
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''post_1'\'', COUNT(*) FROM transfer_orders_target",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''post_2'\'', COUNT(*) FROM transfer_sql_audit",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''post_3'\'', COUNT(*) FROM transfer_sql_audit",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''post_4'\'', COUNT(*) FROM transfer_sql_audit",
      "INSERT INTO transfer_sql_audit(step, row_count) SELECT '\''post_5'\'', COUNT(*) FROM transfer_sql_audit"
    ]' <<<"$hook_node")"
  save_flow "_flows/smoke_it/transfer_sql_hooks/flow.yaml" "[$hook_node]"
  run_flow "_flows/smoke_it/transfer_sql_hooks/flow.yaml" SELECTED '["transfer_hooks"]' "场景 H"
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "3" "前置清表后写入行数"
  assert_eq "$(mysql_query 'SELECT GROUP_CONCAT(step ORDER BY id) FROM transfer_sql_audit')" "pre_2,pre_3,pre_4,pre_5,post_1,post_2,post_3,post_4,post_5" "前后 SQL 顺序"
  assert_eq "$(mysql_query 'SELECT GROUP_CONCAT(row_count ORDER BY id) FROM transfer_sql_audit')" "0,1,2,3,3,5,6,7,8" "前置在写入前、后置在写入后执行"

  echo "==> 场景 I：前置 SQL 失败时不传输、不执行后置"
  local pre_failure
  pre_failure="$(jq -c '.transfer.target.preSql = [
      "INSERT INTO transfer_sql_audit(step, row_count) VALUES ('\''pre_before_failure'\'', 0)",
      "SELECT wb_data_smoke_missing_column FROM transfer_sql_audit"
    ] | .transfer.target.postSql = ["INSERT INTO transfer_sql_audit(step, row_count) VALUES ('\''must_not_run'\'', 0)"]' <<<"$hook_node")"
  save_flow "_flows/smoke_it/transfer_pre_sql_failure/flow.yaml" "[$pre_failure]"
  run_flow "_flows/smoke_it/transfer_pre_sql_failure/flow.yaml" ALL '[]' "场景 I" FAILED
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "3" "前置失败没有新增传输数据"
  assert_eq "$(mysql_query "SELECT COUNT(*) FROM transfer_sql_audit WHERE step = 'pre_before_failure'")" "1" "已执行前置 SQL 不回滚"
  assert_eq "$(mysql_query "SELECT COUNT(*) FROM transfer_sql_audit WHERE step = 'must_not_run'")" "0" "前置失败不执行后置"

  echo "==> 场景 J：后置 SQL 失败保留已写入数据"
  local post_failure
  post_failure="$(jq -c '.transfer.target.preSql = [] | .transfer.target.postSql = [
      "INSERT INTO transfer_sql_audit(step, row_count) VALUES ('\''post_before_failure'\'', 0)",
      "SELECT wb_data_smoke_missing_column FROM transfer_sql_audit",
      "INSERT INTO transfer_sql_audit(step, row_count) VALUES ('\''must_not_run'\'', 0)"
    ]' <<<"$hook_node")"
  save_flow "_flows/smoke_it/transfer_post_sql_failure/flow.yaml" "[$post_failure]"
  run_flow "_flows/smoke_it/transfer_post_sql_failure/flow.yaml" ALL '[]' "场景 J" FAILED
  assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "6" "后置失败仍保留传输新增的 3 行"
  assert_eq "$(mysql_query "SELECT COUNT(*) FROM transfer_sql_audit WHERE step = 'post_before_failure'")" "1" "已执行后置 SQL 不回滚"
  assert_eq "$(mysql_query "SELECT COUNT(*) FROM transfer_sql_audit WHERE step = 'must_not_run'")" "0" "后置首错后停止"

  echo "==> 场景 K：传输失败跳过后置 SQL"
  local transfer_failure
  transfer_failure="$(jq -c '.transfer.source.where = "wb_data_smoke_missing_column = 1"
    | .transfer.target.preSql = ["INSERT INTO transfer_sql_audit(step, row_count) VALUES ('\''before_transfer_failure'\'', 0)"]
    | .transfer.target.postSql = ["INSERT INTO transfer_sql_audit(step, row_count) VALUES ('\''must_not_run'\'', 0)"]' <<<"$hook_node")"
  save_flow "_flows/smoke_it/transfer_sql_transfer_failure/flow.yaml" "[$transfer_failure]"
  run_flow "_flows/smoke_it/transfer_sql_transfer_failure/flow.yaml" ALL '[]' "场景 K" FAILED
  assert_eq "$(mysql_query "SELECT COUNT(*) FROM transfer_sql_audit WHERE step = 'before_transfer_failure'")" "1" "传输失败前已运行前置 SQL"
  assert_eq "$(mysql_query "SELECT COUNT(*) FROM transfer_sql_audit WHERE step = 'must_not_run'")" "0" "传输失败不执行后置 SQL"

  echo ""
  echo "✓ 完整传输集成冒烟 (--transfer) 全部场景通过！"
}

login_and_locate_group
ensure_all_smoke_datasources

case "$mode" in
  --quick)
    run_quick_smoke
    ;;
  --transfer)
    run_transfer_smoke
    ;;
  --all)
    run_quick_smoke
    echo ""
    run_transfer_smoke
    ;;
esac
