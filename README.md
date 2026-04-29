# WB-Data 数据处理中心

WB-Data 是一个正在积极开发中的一站式大数据处理协作平台。它旨在通过统一的界面，将数据源管理、交互式查询、离线任务编排与运维监控集成在一起，构建企业级的数据中台。

> **当前状态**：Alpha 阶段（核心架构已搭建，离线开发模块正在全力推进中 🚀）

---

## 🛠️ 功能路线图 (Roadmap)

### 1. 数据源管理 (DataSource)
- [x] 多数据源插件化架构 (支持启动时动态加载 JAR 包)
- [x] MySQL / PostgreSQL / StarRocks / Hive 驱动支持
- [ ] 运行时插件热插拔 (Hot-swapping without restart) `(待开发)`
- [ ] 更多驱动扩展 (Clickhouse, Presto, etc.) `(按需集成)`
- [ ] 数据源联通性自动化检测 `(待启动)`

### 2. 自助查询 (SQL Lab)
- [x] 基于编辑器的 SQL 编写环境
- [x] 多数据源切换查询
- [ ] 查询结果集分页预览与下载 `(待优化)`
- [ ] 常用 SQL 片段保存功能 `(待启动)`

### 3. 离线开发 (Offline Development)
- [x] 基于 **ReactFlow** 的图形化 DAG 画布
- [x] 任务依赖关系编排 (Dependency Management)
- [x] 集成 **Kestra** 任务调度执行
- [x] 节点类型：Shell 脚本、SQL 节点
- [ ] 节点类型：数据集成 (SeaTunnel)、Python 脚本 `(待启动)`
- [ ] 任务版本管理与回滚 `(待启动)`

### 4. 运行结果 (Execution Results)
- [x] 执行实例进度实时追踪（Gantt 风格进度条）
- [x] 任务日志在线查看
- [x] 运行中任务的停止 (Kill) 功能

### 5. 任务运维 (Ops)
- [ ] 全量任务运行状态监控大盘 `(待启动)`
- [ ] 任务调度配置与调度策略 `(待启动)`

---

## 🏗️ 技术架构

### 后端 (wb-data-server)
- **核心**：Java 21 / Spring Boot 3
- **执行器**：Kestra (分布式编排引擎)
- **插件**：自定义 Maven 类加载机制，支持热插拔数据源插件

### 前端 (wb-data-frontend)
- **核心**：React 18 / TypeScript / Vite
- **交互**：ReactFlow (DAG 画布) / Zustand (状态管理)
- **样式**：Tailwind CSS v4 / Shadcn UI (Radix UI)
- **定制**：Vanilla CSS (用于复杂布局与精细动画)
- **图标**：Lucide Icons

---

## 📁 项目结构

```text
wb-data/
├── wb-data-frontend/     # 前端代码 (React + Vite)
├── wb-data-server/       # 后端代码 (Maven 多模块)
│   ├── wb-data-backend/  # 业务逻辑与 API 接口
│   ├── wb-data-plugin-api/ # 插件标准接口
│   └── wb-data-plugin-*/ # 各类数据源实现插件
└── docs/                 # 项目设计文档与草案
```

---

## 🚥 环境搭建

### 1. 准备工作
- **JDK 21**
- **Node.js 18+**
- **Kestra** 实例 (需配置好 API 访问地址)

### 2. 启动后端
在 `wb-data-server` 目录下：
```bash
mvn clean install
java -jar wb-data-backend/target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

### 3. 启动前端
在 `wb-data-frontend` 目录下：
```bash
npm install
npm run dev
```

---

## 📄 愿景与目标
打造一个最轻量、最现代、对开发者最友好的开源大数据工作站。
