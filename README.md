# WB-Data 数据处理中心

WB-Data 是一个面向数据团队的一站式协作平台，把数据源管理、自助查询、离线任务编排和运行监控放在同一个工作区中。

## 当前能力

- 数据源管理：通过插件加载 MySQL、PostgreSQL、Hive 和 StarRocks 驱动。
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
| 数据源插件 | MySQL、PostgreSQL、Hive、StarRocks |

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

## 本地启动

前置依赖：JDK 21、Node.js 18+、Maven、MySQL。离线执行还需要一个可访问的 Kestra 实例。

```bash
# 构建后端和插件
cd wb-data-server
mvn clean install
cd ..
bash scripts/prepare-plugins.sh

# 启动后端；本地开发使用 dev profile 提供本地默认值
# 首次启动空库时必须提供管理员账号
cd wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
INIT_ADMIN_USERNAME=admin \
INIT_ADMIN_PASSWORD=<admin-password> \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

```bash
# 启动前端
cd wb-data-frontend
npm install
npm run dev
```

默认地址：前端 `http://127.0.0.1:5173`，后端 `http://127.0.0.1:8080`，Swagger UI `http://127.0.0.1:8080/swagger-ui.html`。

更完整的配置和排障说明见：

- [日常本地开发](docs/local-development.md)
- [数据传输集成验证](docs/local-integration-testing.md)

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
