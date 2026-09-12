# 本地开发

本文档只描述仓库当前支持的日常开发方式：前端和后端运行在宿主机，MySQL、Kestra 和 Hive 按需单独提供。数据传输节点的 Docker 验证见 [数据传输集成验证](local-integration-testing.md)。

## 前置依赖

- JDK 21
- Node.js 18+
- Maven
- MySQL，默认数据库名为 `wb_data`
- Kestra（仅离线执行和调度需要），默认地址为 `http://localhost:8090`
- Docker（本地运行 Kestra、Hive 或数据传输验证时需要）

## 构建后端与插件

从仓库根目录执行：

```bash
cd wb-data-server
mvn clean install
```

完整构建会安装后端依赖并生成各数据源插件。需要把插件集中到根目录 `plugins/` 时，执行：

```bash
cd ..
bash scripts/prepare-plugins.sh
```

## 启动后端

配置分两层：主配置 `application.yml` 保持生产安全，敏感项（数据库密码、Kestra 凭据、插件目录、离线仓库目录）无默认值、必须通过环境变量注入；`application-dev.yml` 承接本地开发默认值，通过 `SPRING_PROFILES_ACTIVE=dev` 启用。

dev profile 提供的本地默认值：

| 配置 | dev 默认值 |
| --- | --- |
| 服务端口 | `8080` |
| 元数据库 | `jdbc:mysql://localhost:3306/wb_data`，密码 `1111` |
| Kestra | `http://localhost:8090`，账号 `admin@kestra.io` |
| 离线仓库目录 | `output/offline-live/repos`（相对 `wb-data-backend` 启动目录） |
| 插件目录 | `plugins/`（相对 `wb-data-backend` 启动目录，即仓库根 `plugins/`） |
| CORS 允许来源 | `http://localhost:5173`、`http://127.0.0.1:5173` |

首次启动空数据库时，必须通过环境变量创建第一个系统管理员：

```bash
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
INIT_ADMIN_USERNAME=admin \
INIT_ADMIN_PASSWORD=<admin-password> \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

如果 `wb_user` 已有数据，`INIT_ADMIN_*` 不会新增或覆盖账号。不要把真实密码写入仓库文件。

需要从其他来源（如内网域名、Tailscale）访问前端时，通过 `WB_DATA_CORS_ORIGINS` 追加允许来源。该变量会整体替换默认值，需连同本地地址一起提供，例如：

```bash
WB_DATA_CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://your-domain.example.com"
```

个人域名属于开发者本机配置，不要提交到仓库。

需要权限测试数据时，可显式启用 `dev` profile。该模式会创建 `sys_admin`、`ga_alpha`、`dev_alpha` 等测试账号，以及 `alpha`、`beta` 项目组：

```bash
SPRING_PROFILES_ACTIVE=dev \
WB_DATA_SEED_DEV_DATA=true \
WB_DATA_DEV_DEFAULT_PASSWORD=<dev-password> \
DB_PASSWORD=<mysql-password> \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

## 启动前端

```bash
cd wb-data-frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Vite 会把 `/api` 请求代理到本地后端。默认访问地址为 `http://127.0.0.1:5173`。

## 可选：启动 Kestra

只有离线执行、调度和 Git 同步需要 Kestra。仓库内的 Compose 固定使用已经过参数能力验证的 Kestra `v1.3.7`，不会因容器重建而跟随 `latest` 自动升级：

先构建 WB-Data 的 SQL 感知 JDBC 插件：

```bash
cd wb-data-server
mvn clean install
cd ..
```

然后构建并启动包含该插件的 Kestra 镜像：

```bash
WB_DATA_KESTRA_DB_PASSWORD=<postgres-password> \
WB_DATA_KESTRA_USERNAME=<kestra-username> \
WB_DATA_KESTRA_PASSWORD=<kestra-password> \
docker compose -f docker/docker-compose.kestra.yml up -d --build
```

启动后地址为 `http://localhost:8090`。启动后端时使用相同的 `WB_DATA_KESTRA_USERNAME` 和 `WB_DATA_KESTRA_PASSWORD`。真实密码只能通过环境变量提供，不要写入 Compose 或提交到 Git。

升级 Kestra 时必须显式修改 Compose 中的精确 `vX.Y.Z`，并重新执行 [`Kestra 参数能力研究`](research/kestra-parameter-capabilities.md) 中的阶段 0 矩阵。

## 可选：启动 Hive

```bash
docker compose -f docker/docker-compose.hive.yml up -d
```

该 compose 提供 Hive Metastore（宿主机端口 `9083`）和 HiveServer2（宿主机端口 `10000`）。它是可丢弃的本地测试设施。

## 容器网络注意事项

`127.0.0.1` 指向发起连接的进程自身：

| 发起方 | `127.0.0.1` 的含义 |
| --- | --- |
| 宿主机上的后端 | 宿主机 |
| Kestra 容器 | Kestra 容器 |
| SeaTunnel 任务容器 | 该临时任务容器 |

因此，数据源连通性测试可能在后端成功，但同一个地址在 Kestra 离线任务中失败。离线 SQL 或传输任务需要使用容器可访问的主机名；Docker Desktop 下通常是 `host.docker.internal`，同一 compose 网络内则应使用服务名。

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
```

如果 Maven 在模块目录中无法解析 `spring-boot:run`，从 `wb-data-server` 执行一次 `mvn clean install`，再按本文使用构建后的 JAR 启动。
