# 本地开发

日常开发：前端和后端跑在宿主机。MySQL、Kestra、Hive、ClickHouse 用仓库里的 Compose 起。数据传输冒烟步骤见 [数据传输集成验证](local-integration-testing.md)。

## 前置依赖

- JDK 21
- Node.js 18+
- Maven
- Docker（MySQL、Kestra、Hive、ClickHouse 都走 Compose）
- 离线执行 / 调度：仓库内的 Kestra Compose
- 传输 / Hive 样例：再加 Hive Compose

## 构建后端与插件

从仓库根目录：

```bash
cd wb-data-server
mvn clean install
```

完整构建会安装后端依赖并生成各数据源插件。需要把插件集中到根目录 `plugins/` 时：

```bash
cd ..
bash scripts/prepare-plugins.sh
```

## 启动 MySQL

本地只跑一个 MySQL 容器，映射宿主机 `3306`，里面同时放元数据库和传输测试库：

| 库 | 用途 | 账号 |
| --- | --- | --- |
| `wb_data` | 后端元数据（Flyway） | `root` / `1111` |
| `transfer_demo` | 传输测试表 | `wbdata` / `wbdata123`，root 也可 |

```bash
docker compose -f docker/docker-compose.mysql.yml up -d
```

镜像用已有的 `mysql:8.0`，不要再拉其他 MySQL 版本。不要在宿主机再装 mysqld。

不要对这个 Compose 使用 `down -v`，那会清掉 `wb_data`。重置传输测试表只重跑 `scripts/dev/init/transfer/mysql/001_schema.sql`，或再跑一次 `scripts/dev/transfer-smoke.sh`。

若还有旧的本机 MySQL 数据要迁进来，用 `scripts/dev/migrate-host-mysql-to-docker.sh`，迁完后卸掉本机 MySQL。

## 启动后端

配置分两层：`application.yml` 不放敏感默认值；`application-dev.yml` 承接本地默认值，用 `SPRING_PROFILES_ACTIVE=dev` 启用。

dev profile 提供的本地默认值：

| 配置 | dev 默认值 |
| --- | --- |
| 服务端口 | `8080` |
| 元数据库 | `jdbc:mysql://localhost:3306/wb_data`，密码 `1111` |
| Kestra | `http://localhost:8090`，账号 `admin@kestra.io` |
| 离线仓库目录 | `<启动目录>/../../output/offline-live/repos` |
| 插件目录 | `<启动目录>/../../plugins`（必须是绝对路径，默认值按 `user.dir` 拼） |
| CORS 允许来源 | `http://localhost:5173`、`http://127.0.0.1:5173` |
| `WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE` | `host.docker.internal`（仅 dev profile；生产主配置默认为空） |

首次启动空库时创建第一个系统管理员：

```bash
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
INIT_ADMIN_USERNAME=admin \
INIT_ADMIN_PASSWORD=<admin-password> \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

`wb_user` 已有数据时，`INIT_ADMIN_*` 不会新增或覆盖账号。不要把真实密码写入仓库文件。

需要从其他来源（内网域名、Tailscale）访问前端时，用 `WB_DATA_CORS_ORIGINS` 整体替换允许来源，并连同本地地址一起提供：

```bash
WB_DATA_CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://your-domain.example.com"
```

个人域名不要提交到仓库。

需要权限测试数据时：

```bash
SPRING_PROFILES_ACTIVE=dev \
WB_DATA_SEED_DEV_DATA=true \
WB_DATA_DEV_DEFAULT_PASSWORD=<dev-password> \
DB_PASSWORD=<mysql-password> \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

会创建 `sys_admin`、`ga_alpha`、`dev_alpha` 等测试账号，以及 `alpha`、`beta` 项目组。

只做管理端、查询、数据源「测试连接」时，上面即可。要跑画布执行或传输，按 [离线任务怎么连库](#离线任务怎么连库) 补环境变量。

## 启动前端

```bash
cd wb-data-frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Vite 把 `/api` 代理到本地后端。访问地址 `http://127.0.0.1:5173`。

## 可选：启动 Kestra

只有离线执行、调度和 Git 同步需要。Compose 钉死已经过参数能力验证的 Kestra `v1.3.7`，不会随 `latest` 自动升级。

先构建 SQL 感知 JDBC 插件：

```bash
cd wb-data-server
mvn clean install
cd ..
```

再构建并启动带该插件的 Kestra 镜像：

```bash
WB_DATA_KESTRA_DB_PASSWORD=<postgres-password> \
WB_DATA_KESTRA_USERNAME=<kestra-username> \
WB_DATA_KESTRA_PASSWORD=<kestra-password> \
docker compose -f docker/docker-compose.kestra.yml up -d --build
```

启动后地址 `http://localhost:8090`。后端使用相同的 `WB_DATA_KESTRA_USERNAME` 和 `WB_DATA_KESTRA_PASSWORD`。真实密码只通过环境变量提供，不要写入 Compose 或提交到 Git。

升级时必须改 Compose 里的精确 `vX.Y.Z`，并重跑 [Kestra 参数能力研究](research/kestra-parameter-capabilities.md) 的阶段 0 矩阵。

## 可选：Hive

```bash
docker compose -f docker/docker-compose.hive.yml up -d
```

| 容器 | 宿主机端口 | 容器内端口 |
| --- | --- | --- |
| Hive Metastore | `9083` | `9083` |
| HiveServer2 | `10000`（UI `10002`） | `10000` |

这是可丢弃的本地测试设施。SeaTunnel 镜像仍由 `docker/docker-compose.transfer.yml` 的 build profile 构建，不再单独起 MySQL。

## 可选：ClickHouse

```bash
docker compose -f docker/docker-compose.clickhouse.yml up -d
```

| 容器 | 宿主机端口 | 容器内端口 |
| --- | --- | --- |
| ClickHouse HTTP / JDBC | `8123` | `8123` |
| ClickHouse native | `9000` | `9000` |

Kestra 自己还有一个 `wb-data-kestra-postgres`（宿主机 `5433`），那是 Kestra 元数据库，不是 WB-Data 的 PostgreSQL 数据源。

## 本地数据源怎么填

界面 **host 填 `localhost` 或 `127.0.0.1`**，端口填宿主机映射端口。不要填 Docker 服务名，也不要在 host 里填 `host.docker.internal`：后端在宿主机上做「测试连接」，这个名字在部分机器上会被代理或 VPN 劫持。

| 用途 | 类型 | host | 端口 | 默认数据库 | 用户名 | 密码 |
| --- | --- | --- | --- | --- | --- | --- |
| 元数据 / 传输测试 MySQL | MySQL | `localhost` | `3306` | `wb_data` 或 `transfer_demo` | `root` 或 `wbdata` | `1111` 或 `wbdata123` |
| Hive | Hive | `localhost` | `10000` | `default` | `hive` | 留空 |
| ClickHouse | ClickHouse | `localhost` | `8123` | `default` | `wbdata` | `wbdata123` |

Hive 还有一项 **Hive Metastore URI**，传输写 Hive 时必填：

```text
thrift://host.docker.internal:9083
```

不要填 `thrift://localhost:9083`。这项不走下面的 host 改写。

`scripts/dev/transfer-smoke.sh` 会在 `policy` 组写入或更新 `it_transfer_mysql`、`it_transfer_hive`，字段与上表一致。`smoke_it_mysql_api` 由 `scripts/dev/smoke-verify.sh` 按同一套传输 MySQL 连接创建。

画布「执行」用当前草稿里的 `dataSourceId` 当场编译，不自动写 Git。仓库里的 YAML 仍是上次「保存 Flow」的结果。

## 离线任务怎么连库

前端、后端在宿主机；Kestra 默认在 Docker 里。SQL 节点在 Kestra 进程内连库；传输节点默认再起一个 SeaTunnel 容器。容器里的 `localhost` 是该容器自己，不是宿主机。

因此本地约定是：

1. 数据源 host 继续填 `localhost`，保证「测试连接」走宿主机端口映射。
2. 本地用 `SPRING_PROFILES_ACTIVE=dev` 时，改写默认已是 `host.docker.internal`，不必再手写环境变量。未开 dev 时必须显式加上：

```bash
WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal
```

3. 编译 JDBC URL 时，host 为 `localhost` / `127.0.0.1` / `::1` 会换成该值，端口不变。`localhost:3306` 在任务里变成 `host.docker.internal:3306`，从容器打到宿主机映射，再进 MySQL 容器。
4. 画布调试执行按**当前后端配置**编译草稿，加上改写并重启后端即可生效。写入 Git、同步到 Kestra 正式 Flow 的 YAML 是保存时生成的；改过改写或传输 runner 之后要重新保存。
5. 生产不要设这个变量，数据源填各方都能解析的真实地址。

带 Kestra 的后端启动示例（SQL 节点够用）：

```bash
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

还要跑传输节点时，SeaTunnel 容器需要回连后端渲染配置，并加入 Compose 网络、挂上 Hive warehouse：

```bash
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:8080 \
WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse \
WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

传输默认 `WB_DATA_TRANSFER_RUNNER=docker`。生产若 Kestra worker 本机执行 SeaTunnel，设 `WB_DATA_TRANSFER_RUNNER=process`，并保证机器上有 SeaTunnel（`WB_DATA_TRANSFER_SEATUNNEL_HOME`，默认 `/opt/seatunnel`）。改 runner 后重新保存 Flow，YAML 才会去掉 Docker `taskRunner`。

## 常用验证

```bash
cd wb-data-frontend
npm run lint
npm run test
npm run build
```

```bash
cd wb-data-server
mvn clean install
```

端口检查：

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8090 -sTCP:LISTEN
lsof -nP -iTCP:3306 -sTCP:LISTEN
lsof -nP -iTCP:10000 -sTCP:LISTEN
```

如果 Maven 在模块目录中无法解析 `spring-boot:run`，从 `wb-data-server` 执行一次 `mvn clean install`，再按本文用构建后的 JAR 启动。
