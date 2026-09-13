# WB-Data 数据处理中心

WB-Data 是一个面向数据团队的一站式协作平台，把数据源管理、自助查询、离线任务编排和运行监控放在同一个工作区中。

## 当前能力

- 数据源管理：通过插件加载 MySQL、PostgreSQL、Hive 和 ClickHouse 驱动。
- 自助查询：SQL 编辑、执行、结果查看与导出。
- 离线开发：基于 React Flow 编排 Shell、SQL、HiveSQL 和数据传输节点。
- 调度与版本：Kestra 执行和调度、Flow 保存、Git 提交与推送、多分支切换。
- 运维中心：查看执行记录、节点状态和日志，并停止运行中的任务。
- 权限管理：系统用户、项目组、项目组成员和按权限显示的工作区入口。

## 技术栈

| 层 | 主要技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Vite、Tailwind CSS v4、shadcn/ui、Zustand、React Flow |
| 后端 | Java 21、Spring Boot 3、MyBatis-Plus、Flyway |
| 执行与版本 | Kestra、Git |
| 数据源插件 | MySQL、PostgreSQL、Hive、ClickHouse |

## 项目结构

```text
wb-data/
├── wb-data-frontend/          # React 前端
├── wb-data-server/            # Maven 多模块后端和数据源插件
│   ├── wb-data-backend/       # Spring Boot 应用
│   ├── wb-data-plugin-api/    # 数据源插件 SPI
│   └── wb-data-plugin-*/      # 各数据源插件实现
├── docker/                    # 本地 Kestra、Hive、MySQL 和 SeaTunnel 容器配置
├── plugins/                   # prepare-plugins.sh 准备的运行时插件 JAR
├── scripts/                   # 开发辅助脚本
└── docs/                      # 当前有效的开发与测试说明
```

## 部署

本地默认拓扑：前端和后端跑在宿主机，MySQL / Kestra / Hive / ClickHouse 用仓库里的 Compose。数据源 host 填 `localhost`，不要填 `host.docker.internal`（界面「测试连接」会失败）。

临时给人看（无 VPS / 无自购域名）：本机 Nginx 托管前端 `dist`、反代 `/api` 到 Jar，再用 Tailscale Funnel 暴露 `*.ts.net`。步骤与开关 Funnel、更新约定见 [演示部署（Grok Bot + Funnel）](docs/demo-deploy-grokbot.md)。GitHub Actions 自动部署暂不做。

前置依赖：JDK 21、Node.js 18+、Maven、Docker。配置细节、数据源怎么填、host 改写原理见 [本地开发](docs/local-development.md)。

### 场景对照

| 场景 | 要起什么 | 后端 | host 改写 | 数据源 host |
| --- | --- | --- | --- | --- |
| 管理端 / 查询 / 测试连接 | MySQL + 前后端 | `dev` | 用不到 | `localhost` |
| 画布执行 / SQL 节点 | 上面 + Kestra | `dev` | 要（`dev` 已默认） | `localhost` |
| 数据传输 | 上面 + Hive + SeaTunnel 变量 | `dev` | 要（`dev` 已默认） | `localhost` |
| 生产 | 待补充 | 不要开 `dev` | 不要设 | 真实地址 |
| 临时公网演示（本机 Nginx + Jar + Funnel） | 见 [演示部署](docs/demo-deploy-grokbot.md) | 演示可用 `dev` | 按本地开发 | 演示库 / localhost |

`SPRING_PROFILES_ACTIVE=dev` 时，`WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE` 默认已是 `host.docker.internal`。下面离线 / 传输的命令仍写出该变量，方便对照；未开 `dev` 时必须显式加上，否则 SQL / 传输节点会 Connection refused。

### 本地开发

先构建后端和插件（各场景共用）：

```bash
cd wb-data-server
mvn clean install
cd ..
bash scripts/prepare-plugins.sh
```

#### 管理端与查询

```bash
docker compose -f docker/docker-compose.mysql.yml up -d
```

```bash
# 首次启动空库时必须提供管理员账号
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
INIT_ADMIN_USERNAME=admin \
INIT_ADMIN_PASSWORD=<admin-password> \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

```bash
cd wb-data-frontend
npm install
npm run dev
```

默认地址：前端 `http://127.0.0.1:5173`，后端 `http://127.0.0.1:8080`，Swagger UI `http://127.0.0.1:8080/swagger-ui.html`。

这组命令只覆盖管理端、自助查询、数据源「测试连接」。`wb_user` 已有数据时，`INIT_ADMIN_*` 不会新增或覆盖账号。

#### 离线执行（SQL / 画布）

在上一节基础上再起 Kestra：

```bash
WB_DATA_KESTRA_DB_PASSWORD=<postgres-password> \
WB_DATA_KESTRA_USERNAME=<kestra-username> \
WB_DATA_KESTRA_PASSWORD=<kestra-password> \
docker compose -f docker/docker-compose.kestra.yml up -d --build
```

后端与 Kestra 使用同一组账号。启动后端时带上改写（`dev` 已有默认值）：

```bash
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

Kestra 在 Docker 里执行 SQL。数据源仍填 `localhost`，由改写在编译 JDBC URL 时换成 `host.docker.internal`，端口不变。

#### 数据传输

再起 Hive，并补上 SeaTunnel 回连后端的变量：

```bash
docker compose -f docker/docker-compose.hive.yml up -d
```

```bash
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
WB_DATA_TRANSFER_INTERNAL_TOKEN=dev-transfer-token \
WB_DATA_TRANSFER_INTERNAL_BASE_URL=http://host.docker.internal:8080 \
WB_DATA_TRANSFER_DOCKER_NETWORK=wb-data_default \
WB_DATA_TRANSFER_DOCKER_VOLUMES=wb-data_hive-warehouse:/opt/hive/data/warehouse \
WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE=host.docker.internal \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

冒烟步骤见 [数据传输集成验证](docs/local-integration-testing.md)。

### 生产环境

待补充。

## 验证

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

## 更多文档

- [本地开发](docs/local-development.md)
- [数据传输集成验证](docs/local-integration-testing.md)
- [测试策略](docs/testing-strategy.md)
