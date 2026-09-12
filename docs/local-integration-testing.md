# 数据传输集成验证

本文档描述仓库当前实际提供的数据传输 smoke 环境。它验证 MySQL 与 Hive 之间的数据传输、SeaTunnel 运行时以及 Kestra Docker task runner 的连接关系。

仓库目前没有完整应用栈的 `docker-compose.integration.yml`；前端、后端、元数据库和 Kestra 仍需按本地环境分别启动。

## 环境组成

| 组件 | 来源 | 默认地址 |
| --- | --- | --- |
| WB-Data 后端 | 宿主机进程 | `http://127.0.0.1:8080` |
| 元数据 MySQL | 宿主机已有实例 | `127.0.0.1:3306/wb_data` |
| Kestra | 已有容器 `wb-data-kestra` | `http://127.0.0.1:8090` |
| 传输源/目标 MySQL | `docker/docker-compose.transfer.yml` | `127.0.0.1:13306/transfer_demo` |
| Hive Metastore | `docker/docker-compose.hive.yml` | `127.0.0.1:9083` |
| HiveServer2 | `docker/docker-compose.hive.yml` | `127.0.0.1:10000` |
| SeaTunnel 运行时 | `docker/seatunnel/Dockerfile` | 镜像 `wb-data-seatunnel:2.3.13` |

## 前置条件

- Docker Desktop 可用。
- 元数据 MySQL 已有 `wb_data` 数据库。
- 元数据中存在用户名为 `admin` 的用户和名为 `policy` 的项目组；当前 seed SQL 依赖这两个记录。
- `wb-data-kestra` 容器已经存在，并可通过默认地址和配置的凭据访问。
- Kestra 容器可使用 Docker socket 启动任务容器。
- Kestra Docker runner 允许挂载 Hive warehouse volume：

```yaml
kestra:
  plugins:
    configurations:
      - type: io.kestra.plugin.scripts.runner.docker.Docker
        values:
          volume-enabled: true
```

## 1. 准备插件

从仓库根目录执行：

```bash
bash scripts/prepare-plugins.sh
```

## 2. 启动后端

先在 `wb-data-server` 完成 `mvn clean install`，然后启动后端：

```bash
cd wb-data-server/wb-data-backend
DB_PASSWORD=<metadata-mysql-password> \
WB_DATA_PLUGIN_DIR=/absolute/path/to/wb-data/plugins \
WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:8080 \
WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse \
WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

如果后端使用其他端口，要同时调整 `SERVER_PORT`、`WB_DATA_TRANSFER_INTERNAL_BASE_URL`，并在下一步设置 `WB_DATA_TRANSFER_BACKEND_HOST_PORT`。

`WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE` 只用于本地开发：数据源 host 配成 `localhost`/`127.0.0.1`/`::1` 时（例如指向宿主机端口映射出来的 MySQL），在容器内执行的 SQL 节点与 SeaTunnel 传输任务会把 host 改写为该值。生产环境各服务网络互通，保持默认空值即可，此时数据源 host 按字面使用。

传输任务默认仍由 Kestra 的 Docker runner 拉起 SeaTunnel 镜像。生产若不使用 Docker，设置 `WB_DATA_TRANSFER_RUNNER=process`，并保证 Kestra worker 上有 SeaTunnel（`WB_DATA_TRANSFER_SEATUNNEL_HOME`，默认 `/opt/seatunnel`）。改 runner 后需要重新保存 Flow，YAML 才会去掉 Docker `taskRunner`。

## 3. 准备 smoke 环境

从仓库根目录执行：

```bash
DB_PASSWORD=<metadata-mysql-password> \
scripts/dev/transfer-smoke.sh
```

脚本会：

1. 构建本地 SeaTunnel 镜像。
2. 启动并重置传输测试用 MySQL 表。
3. 启动 Hive Metastore 和 HiveServer2，并重置 Hive 测试表。
4. 检查已有 Kestra 容器和 API。
5. 在 `policy` 项目组中写入或更新 `it_transfer_mysql`、`it_transfer_hive` 两个数据源。

元数据库不是默认地址时，可覆盖：

```bash
WB_DATA_METADATA_MYSQL_HOST=<host> \
WB_DATA_METADATA_MYSQL_PORT=<port> \
WB_DATA_METADATA_MYSQL_DATABASE=<database> \
WB_DATA_METADATA_MYSQL_USER=<user> \
DB_PASSWORD=<password> \
scripts/dev/transfer-smoke.sh
```

后端运行在 `18080` 等非默认端口时，再增加：

```bash
WB_DATA_TRANSFER_BACKEND_HOST_PORT=18080 scripts/dev/transfer-smoke.sh
```

## 4. 产品内验证

在 `policy` 项目组中确认两个测试数据源存在（`it_transfer_mysql`、`it_transfer_hive`），然后运行自动化验证：

```bash
WB_DATA_PASSWORD=<admin-密码> scripts/dev/smoke-verify.sh
```

脚本通过后端 API 自动建数据源、建 flow、触发执行并断言目标库数据，覆盖：

- 数据源管理：API 创建数据源 + 测试连接
- MySQL 到 MySQL：`append`、`overwrite_table`
- MySQL 到 Hive 分区表：`overwrite_partition`
- Hive 到 MySQL：`append`
- 选中单个传输节点执行时，只运行该节点
- 运维中心执行列表接口可用性

脚本走 debug 执行接口（`wb-debug-*` 命名空间），按设计不进运维中心列表；git push 到 Kestra 的同步链路和调度触发仍需在界面手动验证。测试分层和决策理由见 [测试策略](testing-strategy.md)。

测试表由以下文件定义：

- `scripts/dev/init/transfer/mysql/001_schema.sql`
- `scripts/dev/init/transfer/hive/001_schema.sql`

## 清理

传输 MySQL 容器和数据卷：

```bash
docker compose -f docker/docker-compose.transfer.yml down -v
```

Hive 容器和 warehouse 数据卷：

```bash
docker compose -f docker/docker-compose.hive.yml down -v
```

这些命令会删除对应的本地测试数据卷，不要用于保存了非测试数据的环境。
