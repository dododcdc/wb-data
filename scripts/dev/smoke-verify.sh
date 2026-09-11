#!/usr/bin/env bash
# Automated transfer smoke verification (L3).
# Prerequisite: scripts/dev/transfer-smoke.sh has prepared the environment
# (SeaTunnel image, transfer MySQL, Hive, Kestra, seeded data sources) and the
# backend is running with the WB_DATA_TRANSFER_* variables described in
# docs/local-integration-testing.md.
#
# Usage:
#   WB_DATA_PASSWORD=<admin-password> scripts/dev/smoke-verify.sh
#
# Optional overrides:
#   WB_DATA_BACKEND_BASE_URL   default http://127.0.0.1:8080
#   WB_DATA_USERNAME           default admin
#   WB_DATA_GROUP_NAME         default policy
#   WB_DATA_VERIFY_TIMEOUT     per-execution timeout seconds, default 300
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repo_root/docker/docker-compose.transfer.yml"
backend="${WB_DATA_BACKEND_BASE_URL:-http://127.0.0.1:8080}"
username="${WB_DATA_USERNAME:-admin}"
password="${WB_DATA_PASSWORD:?请先提供后端登录密码，例如 WB_DATA_PASSWORD=xxx scripts/dev/smoke-verify.sh}"
group_name="${WB_DATA_GROUP_NAME:-policy}"
timeout_seconds="${WB_DATA_VERIFY_TIMEOUT:-300}"

for cmd in curl jq docker; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "缺少依赖: $cmd" >&2; exit 1; }
done

for container in wb-data-transfer-mysql wb-data-hiveserver2 wb-data-kestra; do
  status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo missing)"
  if [ "$status" != "running" ]; then
    echo "容器 $container 未运行（当前: $status）。先执行 scripts/dev/transfer-smoke.sh 准备环境。" >&2
    exit 1
  fi
done

TOKEN=""
GROUP_ID=""
MYSQL_DS_ID=""
HIVE_DS_ID=""

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

mysql_query() {
  docker compose -f "$compose_file" exec -T wb-data-transfer-mysql \
    mysql -uroot -pwbdata-root-dev -Nse "$1" transfer_demo 2>/dev/null | tr -d '[:space:]'
}

hive_query() {
  docker exec wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' \
    --silent=true --showHeader=false --outputformat=csv2 -e "$1" 2>/dev/null \
    | tr -d '\r"' | grep -E '^-?[0-9]+$' | head -1
}

reset_mysql_fixture() {
  docker compose -f "$compose_file" exec -T wb-data-transfer-mysql \
    mysql -uroot -pwbdata-root-dev transfer_demo \
    < "$repo_root/scripts/dev/init/transfer/mysql/001_schema.sql" 2>/dev/null
}

reset_hive_fixture() {
  docker exec -i wb-data-hiveserver2 beeline -u 'jdbc:hive2://localhost:10000/default' \
    -f /dev/stdin < "$repo_root/scripts/dev/init/transfer/hive/001_schema.sql" >/dev/null 2>&1
}

assert_eq() {
  local actual="$1" expected="$2" ctx="$3"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $ctx（期望 $expected，实际 ${actual:-<empty>}）" >&2
    exit 1
  fi
  echo "  ✓ $ctx = $actual"
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

await_execution() {
  local execution_id="$1" ctx="$2"
  local deadline=$(( $(date +%s) + timeout_seconds ))
  local resp status
  while true; do
    resp="$(api GET "/api/v1/groups/$GROUP_ID/offline/executions/$execution_id")"
    status="$(jq -r '.data.status // "UNKNOWN"' <<<"$resp" 2>/dev/null || echo UNKNOWN)"
    case "$status" in
      SUCCESS)
        echo "  ✓ $ctx 执行成功（$execution_id）"
        return 0
        ;;
      FAILED|CANCELLED|KILLED)
        echo "FAIL: $ctx 执行终态 $status（$execution_id）" >&2
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
  await_execution "$execution_id" "$ctx"
}

echo "==> 登录 $backend（用户 $username）"
resp="$(api POST /api/v1/auth/login "$(jq -nc --arg u "$username" --arg p "$password" '{username: $u, password: $p}')")"
expect_ok "$resp" "登录"
TOKEN="$(jq -r '.data.accessToken' <<<"$resp")"

echo "==> 定位项目组 $group_name"
resp="$(api GET /api/v1/auth/context)"
expect_ok "$resp" "获取用户上下文"
GROUP_ID="$(jq -r --arg name "$group_name" '.data.accessibleGroups[] | select(.name == $name) | .id' <<<"$resp" | head -1)"
[ -n "$GROUP_ID" ] || { echo "FAIL: 当前用户看不到项目组 $group_name" >&2; exit 1; }
echo "  ✓ groupId = $GROUP_ID"

echo "==> 定位数据源 it_transfer_mysql / it_transfer_hive"
resp="$(api GET "/api/v1/groups/$GROUP_ID/datasources?page=1&size=100")"
expect_ok "$resp" "获取数据源列表"
MYSQL_DS_ID="$(jq -r '.data.records[] | select(.name == "it_transfer_mysql") | .id' <<<"$resp" | head -1)"
HIVE_DS_ID="$(jq -r '.data.records[] | select(.name == "it_transfer_hive") | .id' <<<"$resp" | head -1)"
[ -n "$MYSQL_DS_ID" ] && [ -n "$HIVE_DS_ID" ] || { echo "FAIL: 缺少 it_transfer_mysql 或 it_transfer_hive，先执行 transfer-smoke.sh" >&2; exit 1; }
echo "  ✓ mysql=$MYSQL_DS_ID hive=$HIVE_DS_ID"

echo "==> 场景 0：数据源创建与连接测试（API）"
api_ds_name="smoke_it_mysql_api"
API_MYSQL_DS_ID="$(jq -r --arg name "$api_ds_name" '.data.records[] | select(.name == $name) | .id' <<<"$resp" | head -1)"
if [ -z "$API_MYSQL_DS_ID" ]; then
  resp="$(api POST "/api/v1/groups/$GROUP_ID/datasources" "$(jq -nc '{
      name: "smoke_it_mysql_api", type: "MYSQL", description: "smoke-verify 通过 API 创建",
      host: "localhost", port: 13306, databaseName: "transfer_demo",
      username: "wbdata", password: "wbdata123"
    }')")"
  expect_ok "$resp" "创建数据源 $api_ds_name"
  resp="$(api GET "/api/v1/groups/$GROUP_ID/datasources?page=1&size=100")"
  expect_ok "$resp" "重新获取数据源列表"
  API_MYSQL_DS_ID="$(jq -r --arg name "$api_ds_name" '.data.records[] | select(.name == $name) | .id' <<<"$resp" | head -1)"
  [ -n "$API_MYSQL_DS_ID" ] || { echo "FAIL: 创建后仍找不到数据源 $api_ds_name" >&2; exit 1; }
  echo "  ✓ 数据源创建成功（id=$API_MYSQL_DS_ID）"
else
  echo "  ✓ 数据源已存在，复用（id=$API_MYSQL_DS_ID）"
fi

api_ds_status="$(jq -r --arg name "$api_ds_name" '.data.records[] | select(.name == $name) | .status // "ENABLED"' <<<"$resp" | head -1)"
if [ "$api_ds_status" != "ENABLED" ]; then
  resp="$(api PATCH "/api/v1/groups/$GROUP_ID/datasources/$API_MYSQL_DS_ID/status" '{"status":"ENABLED"}')"
  expect_ok "$resp" "启用数据源 $api_ds_name"
fi
echo "  ✓ 数据源状态 ENABLED"

resp="$(api POST "/api/v1/groups/$GROUP_ID/datasources/test-connection" "$(jq -nc '{
    type: "MYSQL", host: "localhost", port: 13306, databaseName: "transfer_demo",
    username: "wbdata", password: "wbdata123"
  }')")"
expect_ok "$resp" "测试连接 $api_ds_name"
assert_eq "$(jq -r '.data.success' <<<"$resp")" "true" "新建数据源连接测试"

echo "==> 重置 MySQL / Hive 测试数据"
reset_mysql_fixture
reset_hive_fixture
assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "1" "MySQL target 初始行数"

echo "==> 场景 A：MySQL → MySQL append（使用场景 0 创建的数据源）"
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
before="$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')"
save_flow "_flows/smoke_it/hive_to_mysql_append/flow.yaml" \
  "[$(transfer_node transfer_hive_to_mysql "$HIVE_DS_ID" HIVE default transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)]"
run_flow "_flows/smoke_it/hive_to_mysql_append/flow.yaml" ALL '[]' "场景 D"
after="$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')"
assert_eq "$((after - before))" "2" "append 新增行数（Hive source 2 行）"

echo "==> 场景 E：单节点选中执行"
reset_mysql_fixture
node_a="$(transfer_node sel_node_a "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)"
node_b="$(transfer_node sel_node_b "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_source "$MYSQL_DS_ID" MYSQL transfer_demo transfer_orders_target append)"
save_flow "_flows/smoke_it/selected_single_node/flow.yaml" "[$node_a,$node_b]"
run_flow "_flows/smoke_it/selected_single_node/flow.yaml" SELECTED '["sel_node_a"]' "场景 E"
assert_eq "$(mysql_query 'SELECT COUNT(*) FROM transfer_orders_target')" "4" "只跑选中节点行数（1+3，而非 1+6）"

echo "==> 场景 F：运维中心执行记录接口"
# 运维中心只扫描 git sync 配置的业务命名空间，debug 执行（wb-debug-*）按设计不出现在这里；
# 本场景验证接口可用与响应结构，记录可见性由 push 链路场景覆盖（待补）。
resp="$(api GET "/api/v1/groups/$GROUP_ID/operations/executions?page=1&pageSize=10")"
expect_ok "$resp" "运维中心执行列表"
assert_eq "$(jq -r '.data.executions | type' <<<"$resp")" "array" "执行列表 executions 结构"
echo "  ✓ 当前业务执行记录数：$(jq -r '.data.executions | length' <<<"$resp")"

cat <<EOF

全部场景通过。
冒烟 flow 保存在项目组 $group_name 的 _flows/smoke_it/ 下（未提交，可重复执行本脚本，或在界面中删除）。
EOF
