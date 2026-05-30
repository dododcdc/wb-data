# WB-Data 数据处理中心

一站式大数据处理协作平台。数据源管理、SQL 自助查询、离线任务编排、运维监控。

## Build & Test

### Frontend（wb-data-frontend/）

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器 (Vite HMR)
npm run build      # 类型检查 + 生产构建 (tsc -b && vite build)
npm run lint       # ESLint 检查
npm run test       # Vitest 单元测试
npm run preview    # 预览生产构建
```

### Backend（wb-data-server/）

```bash
mvn clean install  # 全量构建（含所有插件模块）
cd wb-data-backend
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

### 前置依赖

- **JDK 21**
- **Node.js 18+**
- **MySQL**（本地库 `wb_data`，root 密码通过 `DB_PASSWORD` 环境变量配置）
- **Kestra** 实例（默认 `http://localhost:8090`）
- **Hive**（可选）：`docker compose -f docker-compose.hive.yml up -d`

## Architecture Overview

```
wb-data/
├── wb-data-frontend/           # React 18 + TypeScript + Vite
│   └── src/
│       ├── api/                # API 请求封装 (axios)
│       ├── components/         # 通用组件 + shadcn/ui
│       ├── pages/              # 页面级组件
│       ├── views/              # 业务视图 (SQL Lab, 离线开发等)
│       ├── router/             # React Router v7 路由配置
│       ├── hooks/              # 自定义 Hooks
│       ├── lib/                # 工具函数
│       ├── types/              # TypeScript 类型定义
│       └── index.css           # 全局样式 + Tailwind
├── wb-data-server/             # Maven 多模块后端
│   ├── wb-data-backend/        # Spring Boot 3 主应用 (port 8080)
│   │   └── com.wbdata/
│   │       ├── auth/           # 认证鉴权
│   │       ├── datasource/     # 数据源管理 + 插件加载
│   │       ├── query/          # SQL 自助查询
│   │       ├── offline/        # 离线任务编排 (集成 Kestra)
│   │       ├── git/            # Git 仓库集成
│   │       ├── group/          # 项目组管理
│   │       ├── user/           # 用户管理
│   │       └── common/         # 通用配置、拦截器、工具类
│   ├── wb-data-plugin-api/     # 数据源插件 SPI 接口
│   └── wb-data-plugin-*/      # 各数据源驱动实现
├── plugins/                    # 运行时插件 JAR 目录
└── docs/                       # 设计文档
```

## Code Style & Conventions

### 前端

- TypeScript strict mode，路径别名 `@/` → `./src/`
- **Tailwind CSS v4** + **shadcn/ui**（基于 Radix UI），图标使用 **Lucide Icons**
- 状态管理：全局状态用 **Zustand**，组件本地状态用 `useState`
- API 请求统一走 `src/api/` 下的模块，使用共享 axios 实例
- **页面组件**放 `src/pages/`（路由对应的一级页面）
- **业务视图**放 `src/views/`（页面内的功能模块，按业务域分子目录）
- **通用组件**放 `src/components/ui/`（基础 UI）和 `src/components/`（业务组件）
- 测试文件与源文件同目录，命名 `*.test.ts(x)`

### 后端

- Java 21，Spring Boot 3，Lombok
- **MyBatis-Plus** 作为 ORM，Mapper XML 在 `resources/mapper/**/*.xml`
- 包结构按业务领域划分：`com.wbdata.{domain}.{controller|service|mapper|entity|dto}`
- 数据库迁移使用 **Flyway**，迁移文件放在 `resources/db/migration/`
- 自定义配置使用前缀 `wbdata.*`（见 `application.yml`）
- 虚拟线程已启用，尽量避免阻塞调用

### 通用

- 数据库：表名和字段用下划线命名，Java 实体自动映射为驼峰
- 前端路由在 `src/router/` 中集中管理，支持嵌套布局
- 插件系统：数据源驱动通过自定义 ClassLoader 从 `plugins/` 目录动态加载

## Design Principles

设计原则详见 `.impeccable.md`，核心方向：

1. **Calm clarity over spectacle** — 复杂数据工作应井然有序、有呼吸感
2. **Warm precision** — 暖色调（羊皮纸 + 陶土色），柔和但严谨
3. **One workspace, multiple jobs** — 查询、工作流、管理界面统一不割裂
4. **Quietly polished interaction** — 流畅自信的动效，避免装饰性花活
5. **Operational readability first** — 信息层级、文案、状态一目了然

## Git Workflow

- 从 `main` 分支，功能命名：`feature/<描述>` 或 `fix/<描述>`
- 提交前运行前端 lint 和后端编译检查
- 提交保持原子化，每次提交一个逻辑变更

## Evidence Required for PR

- [ ] 前端：`npm run lint` 通过
- [ ] 后端：`mvn clean install` 通过
- [ ] 逻辑变更：补充或更新对应测试
- [ ] PR 描述说明变更意图、影响范围和验证方式


<claude-mem-context>
# Memory Context

# [wb-data] recent context, 2026-05-27 2:04am GMT+8

No previous sessions found.
</claude-mem-context>