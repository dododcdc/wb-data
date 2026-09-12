# 数据传输集成验证

仓库提供的 MySQL ↔ Hive 传输冒烟：真实 SeaTunnel、Kestra Docker task runner、以及 `policy` 组里的测试数据源。前端、后端、元数据库、Kestra 仍按 [本地开发](local-development.md) 分别启动。

数据源怎么填、host 改写、调试执行与保存的区别，只以本地开发文档为准。本文不再重复。

仓库没有完整应用栈的 `docker-compose.integration.yml`。

## 环境组成

| 组件 | 来源 | 默认地址 |
| --- | --- | --- |
| WB-Data 后端 | 宿主机进程 | `http://127.0.0.1:8080` |
| 元数据 / 传输测试 MySQL | `docker/docker-compose.mysql.yml` | `127.0.0.1:3306`，库 `wb_data` 与 `transfer_demo` |
| Kestra | 容器 `wb-data-kestra` | `http://127.0.0.1:8090` |
| Hive Metastore | `docker/docker-compose.hive.yml` | `127.0.0.1:9083` |
| HiveServer2 | `docker/docker-compose.hive.yml` | `127.0.0.1:10000` |
| SeaTunnel 运行时 | `docker/seatunnel/Dockerfile` | 镜像 `wb-data-seatunnel:2.3.13` |

## 前置条件

- Docker Desktop 可用。
- `wb-data-mysql` 已启动，且 `wb_data` 中有用户 `admin` 和项目组 `policy`（seed SQL 依赖这两条记录）。
- `wb-data-kestra` 已启动，凭据与后端一致。
- Kestra 容器能用 Docker socket 起任务容器。
- Kestra Docker runner 允许挂载 Hive warehouse（仓库 Compose 已打开）：

```yaml
kestra:
  plugins:
    configurations:
      - type: io.kestra.plugin.scripts.runner.docker.Docker
        values:
          volume-enabled: true
```

## 1. 准备插件

从仓库根目录：

```bash
bash scripts/prepare-plugins.sh
```

## 2. 启动后端

先在 `wb-data-server` 完成 `mvn clean install`。传输冒烟需要本地开发文档里「跑传输节点」那组变量：

```bash
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<metadata-mysql-password> \
WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:8080 \
WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse \
WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

插件目录在 dev profile 下有默认值。若不用 `dev`，再显式设置 `WB_DATA_PLUGIN_DIR`。

后端不在 `8080` 时，同时改 `SERVER_PORT`、`WB_DATA_TRANSFER_INTERNAL_BASE_URL`，下一步设 `WB_DATA_TRANSFER_BACKEND_HOST_PORT`。

没有 `WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE` 时，SQL 节点和传输任务在容器里连 `localhost` 会 Connection refused。`scripts/dev/smoke-verify.sh` 的 SQL loopback 场景依赖这个变量。

## 3. 准备 smoke 环境

从仓库根目录：

```bash
DB_PASSWORD=<metadata-mysql-password> \
scripts/dev/transfer-smoke.sh
```

脚本会：

1. 构建本地 SeaTunnel 镜像。
2. 启动 Docker MySQL（若尚未运行），并重置 `transfer_demo` 测试表。
3. 启动 Hive Metastore / HiveServer2，并重置 Hive 测试表。
4. 检查已有 Kestra 容器和 API。
5. 在 `policy` 组写入或更新 `it_transfer_mysql`、`it_transfer_hive`。

后端在 `18080` 等非默认端口时：

```bash
WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 scripts/dev/transfer-smoke.sh
```

## 4. 产品内验证

确认 `policy` 组里有 `it_transfer_mysql`、`it_transfer_hive`，然后：

```bash
WB_DATA_PASSWORD=<admin-密码> scripts/dev/smoke-verify.sh
```

脚本通过后端 API 建数据源、建 flow、触发执行并断言目标库数据。覆盖范围见 [测试策略](testing-strategy.md)。走 debug 执行接口（`wb-debug-*` 命名空间），按设计不进运维中心列表；git push 到 Kestra 的同步链路和调度触发仍需在界面手动验证。

测试表：

- `scripts/dev/init/transfer/mysql/001_schema.sql`
- `scripts/dev/init/transfer/hive/001_schema.sql`

## 清理

```bash
docker compose -f docker/docker-compose.hive.yml down -v
```

会删掉 Hive warehouse 测试数据卷。不要对 `docker/docker-compose.mysql.yml` 使用 `down -v`，那会清掉 `wb_data`。
