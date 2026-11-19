# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要用户是中小团队里的数据工程师、数据分析工程师和后端 / 数据开发，与项目组管理员（`GROUP_ADMIN`）和系统管理员（`SYSTEM_ADMIN`）协作。

他们在以项目组为单位的工作区里完成登记数据源、执行探索性 SQL、编排和调试多节点离线任务、发布基于 Git 版本的调度、排查任务执行失败等工作，不必在数据库客户端、调度控制台、数据传输脚本和 Git 终端之间来回切换。

## Product Purpose

WB Data（`WB-Data 数据处理中心`）是一个自托管的一站式数据协作工作台，把数据源管理、自助 SQL 查询、基于 DAG 的离线任务开发、Git 版本发布管控和运行监控放在同一个工作区里。

成功的标准是：中小规模的研发 / 数据团队能在一个连贯的环境里走完「探索数据 → 编写草稿 → 调试执行 → Git 提交与推送 → 定时调度 → 失败排查」的完整流程，同时保证正式生产状态安全、可追溯。

## Positioning

WB Data 不是把重型企业数据套件或零散的单一工具（数据库客户端 + 调度界面 + SeaTunnel / DataX 脚本 + 裸 Git 仓库）拼在一起，而是把低成本的交互式编写（画布和节点草稿自动保存、可立即调试执行）与严格的「Git 即发布真相」流程结合起来：正式的任务定义和调度只有经过「草稿自动保存 → 提交 → 推送远端 → 同步 Kestra」才会生效；切换分支、合并、提交和推送整个仓库由项目组管理员把关。

## Operating Context

- **自托管运行栈**：React 18 + TypeScript 单页应用（`wb-data-frontend/`），Spring Boot 3 / Java 21 后端（`wb-data-server/`），MySQL + Flyway 存储元数据，Kestra 负责工作流执行和 cron 调度，SeaTunnel 负责批量数据传输，每个项目组有独立的 Git 仓库（`_flows/`、`scripts/`、`transfers/`）。
- **项目组工作区模型**：日常工作都在当前**项目组**下进行，涉及数据源管理（`/datasources`）、自助查询（`/query`）、离线开发（`/offline`）、运维中心（`/operations`）、参数组（`/parameters`）和项目组设置（`/group-settings`）。系统级的用户和项目组管理（`/users`、`/groups`）只对 `SYSTEM_ADMIN` 开放。
- **核心工作流**：
  - 登记并测试数据库连接，驱动通过隔离的插件加载。
  - 针对项目组数据源编写、格式化、执行和导出临时 SQL 查询。
  - 编排 DAG 任务（SQL、MySQL、PostgreSQL、ClickHouse、HiveSQL、Shell 和数据传输节点），绑定带版本的参数组，声明上游任务依赖，并可指定计划时间或临时覆盖参数进行调试执行。
  - 开发者提交并推送单个任务的改动；项目组管理员负责切换 / 合并分支、整仓提交与推送以及配置 Kestra 同步。
  - 在运维中心查看定时和手动执行记录，查看节点日志，停止运行中的任务，触发重跑。

## Capabilities and Constraints

- **已确认的长期底线：基于 Git 的发布管控**
  - 画布和节点的修改自动保存为工作草稿（仓库状态前进时保留本地恢复稿），编写过程不受打扰，也不会改动正式的调度状态。
  - 调度和正式运行配置必须经过 Git 提交、推送远端、同步 Kestra 才会生效。
  - 开发者（`offline.write`）可以编写任务、调试执行、提交并推送单个任务；切换 / 合并分支、提交和推送整个仓库、配置远端与同步规则由项目组管理员（`GROUP_ADMIN` / `group.settings`）或 `SYSTEM_ADMIN` 负责（后续可在项目组设置中按需开启单任务推送审批）。
- **当前已实现的能力**
  - 数据源驱动通过插件隔离加载（`wb-data-plugin-api`，从 `plugins/` 目录加载），支持 MySQL、PostgreSQL、Hive 和 ClickHouse。
  - DAG 任务编辑器（单任务最多 20 个节点），支持可视化配置 SeaTunnel 数据传输、绑定带版本的参数组（`parameter.read`）、检查上下游依赖，以及按任务运行时区计算的标准周期调度（`HOURLY`、`DAILY`、`WEEKLY`、`MONTHLY`、`YEARLY`，存量 `CUSTOM` 表达式有迁移处理）。
  - 按权限显示的工作区导航（`datasource.read`、`query.use`、`offline.read`、`offline.write`、`parameter.read`、`member.read`、`group.settings`、`SYSTEM_ADMIN`）。
- **领域术语**：项目组、数据源、自助查询、离线开发、任务（Flow）、节点、数据传输（Transfer）、参数组、前置依赖 / 下游任务、调度配置、运行时区、提交当前任务、提交仓库改动、推送、运维中心。
- **尚未确定的部分**
  - 生产环境的部署打包和参考拓扑（`README.md` 目前只记录了宿主机 + Docker Compose 的本地开发方式和 Nginx + Tailscale Funnel 的临时演示方式，生产部署待补充）。
  - 只允许标准调度周期、任务创建后运行时区不可修改、只做桌面端简体中文界面、数据源只能通过插件加载，这几条以后是否保持不变或放开，尚未决定。

## Brand Commitments

- **名称**：产品界面里用 **WB Data**；仓库文档里用 **WB-Data 数据处理中心**；登录页副标题为 **一站式数据研发、自助查询与离线调度中心**。
- **文案风格**：面向技术用户，使用直接、克制、聚焦任务的简体中文。操作名称要说清楚作用范围（如「提交当前任务」与「提交仓库改动」、「暂存配置」与推送远端要区分开）；阻断和报错信息要同时说明具体原因和恢复办法。

## Evidence on Hand

- 可运行的前后端源码（`wb-data-frontend/`、`wb-data-server/`）、数据源插件（MySQL、PostgreSQL、Hive、ClickHouse）、Kestra 扩展插件（`wb-data-kestra-plugin/`）、Docker Compose 环境（`docker/`），以及工程和验证文档（`docs/local-development.md`、`docs/local-integration-testing.md`、`docs/parameter-groups.md`、`docs/testing-strategy.md`）。
- **不存在、不得虚构的内容**：没有外部客户 logo、用户评价、商业定价或 SLA 承诺、第三方性能对比数据，也没有合规认证。

## Product Principles

1. **草稿随便改，发布要慎重**：日常编写、自动保存和调试执行要即时、少打扰；但进入「已提交、已推送、已同步 Kestra」的正式状态之前，边界必须清晰可见。
2. **讲清影响范围**：凡是跨越任务、分支、依赖、参数版本或远端同步边界的操作，执行前都要说明具体范围和后果。
3. **在一个工作区里闭环**：连接数据源、验证 SQL、搭建 DAG、Git 版本管理、排查失败执行，应该在当前项目组内像一条连续的流程。
4. **权限与共享状态的风险匹配**：让开发者能快速迭代、调试并推送单个任务，把切换 / 合并分支、远端配置和整仓推送留给项目组管理员和系统管理员。
