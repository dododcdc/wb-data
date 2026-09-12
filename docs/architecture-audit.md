# WB-Data 架构审计（2026-09-12）

> 审计基线：`main` 分支，提交 `3a313e2`。由三路并行盘点（后端、前端、横切）汇总而成，关键发现已抽查核实。
> 目的：恢复对项目的全局掌控，产出一张可逐项裁决的问题清单。本文件是快照，后续整改完成后可归档或重写。

## 0. 规模快照

| 指标 | 数值 |
|---|---|
| 提交数 / 首次提交 | 392 / 2026-02-23 |
| 后端 Java 文件 | 319 |
| 前端 TS/TSX 文件 | 235 |
| Flyway 迁移 | V1–V17，现存表 12 张 |
| 后端测试 | 44 个测试类；`query`、`user` 包零测试 |
| 前端测试 | 45 个测试文件；`dashboard`、`users`、`core` 零测试 |

整体判断：**架构骨架是健康的**——后端 controller→service→mapper 分层零违规，前端 API 层全部收口到共享 axios 实例，路由守卫链清晰。失控感主要来自三个来源：`offline` 域体积与概念堆积、一批入库的不安全默认值、若干命名/目录层面的不一致。

## 1. 后端模块地图

依赖方向：`query → datasource/auth`；`datasource → auth`；`auth → user/group/datasource`；`offline → auth/datasource/git/parameter`；`operations → offline/git`；`parameter → auth`；`common` 被所有包依赖。注意 `git ↔ offline` 已成环（见 P1-1），`common` 反向依赖业务包（见 P1-2）。

| 包 | 类数 | 职责 | 主要端点 |
|---|---|---|---|
| auth | 19 | 登录、会话令牌、系统/组两级权限 | `/api/v1/auth`（login/me/context/logout） |
| common | 8 | Result、分页、全局异常、基础配置 | — |
| datasource | 12 | 数据源 CRUD、连通测试、插件注册 + 连接池 | `/api/v1/datasources`、`/groups/{id}/datasources` |
| git | 21 | Git PAT 配置、分支→Kestra 同步配置 | `/api/v1/git/config`、`/api/v1/git/sync-config` |
| group | 21 | 项目组成员、设置、用户偏好 | `/api/v1/group-settings`、`/groups/{id}/settings` |
| offline | 110（占 40%） | 离线 Flow 文档/节点、Git 工作树、Kestra 执行/调试/日志、调度、SeaTunnel 传输子包 | `/api/v1/offline/flows|executions|schedules`、`/api/v1/offline`（repo，16 方法的最大控制器）、`/internal/offline/transfer` |
| operations | 12 | 跨 Flow 执行运维列表与重跑审计 | `/api/v1/operations/executions` |
| parameter | 17 | 项目组级参数组/参数定义/取值预览 | `/api/v1/parameter-groups` |
| query | 11 | 即席 SQL 执行、元数据浏览、结果导出（无 entity/mapper） | `/api/v1/query` |
| user | 15 | 用户 CRUD；**项目组主端点也在这个包** | `/api/v1/users`、`/api/v1/groups` |

## 2. 前端模块地图

守卫链：`AuthGuard`（token + `/auth/context`）→ 布局/全屏分支 → `RequireGroup` → `RequirePermission` / `RequireSystemAdmin`。全部路由 lazy + 骨架屏。

| Path | View | 额外守卫 |
|---|---|---|
| /login | core/Login | 无 |
| / | dashboard/Dashboard | — |
| /datasources | datasources/DataSourceList | `datasource.read` |
| /query | query/Query | `query.use` |
| /offline | offline/OfflineWorkbench | `offline.read` |
| /operations | operations/OperationsCenter | 借用 `offline.read`（见 P1-5） |
| /parameters | parameters/ParameterGroupPage | `parameter.read` |
| /group-settings | group-settings/GroupSettingsPage | `member.read` |
| /users、/groups | users/、groups/ | RequireSystemAdmin |
| /offline/executions/:id、/operations/executions/:id | 两份近似实现（见 P1-4） | 布局外全屏 |

API 层：12 个文件全部走 `utils/request.ts` 共享实例（Bearer 注入、解包、401 跳转）；`api/groupScoped.ts` 统一拼组前缀。状态：Zustand 仅 2 个 store（auth、全局操作反馈），服务器状态用 React Query，offline 域另有 7 个手写 `*State.ts` 纯函数模块。组件：`components/ui/` shadcn 原子件 + 自研选择器/对话框；样式为 Tailwind v4 与 31 个手写 CSS 文件并存。

## 3. 表结构清单

| 表 | 关键字段 | 用途 | 备注 |
|---|---|---|---|
| datasource | type、host/port、password、connection_params(JSON)、status | 数据源 | 唯一无 `wb_` 前缀的表 |
| wb_user | username、password_hash、system_role、status | 系统用户 | |
| wb_project_group | name、status、created_by | 项目组 | V10 加 status |
| wb_project_group_member | group_id+user_id 唯一、role | 组成员 | |
| wb_user_group_preference | user_id+group_id、default_datasource_id | 组内个人偏好 | |
| wb_query_export_task | task_uuid、sql_text、status、file_path、expires_at | 查询导出任务 | **死表**（见 P0-4） |
| wb_git_config | provider、token、base_url、project_group_id | Git PAT 配置 | V8→V9 全局改按组，V11 删 owner |
| wb_git_sync_config | group_id+branch 唯一、enabled、last_sync_* | 分支同步 | |
| wb_operation_execution_action | action_type、original/new_execution_id | 重跑审计 | |
| wb_parameter_group | group_id+code、version+revision、status | 参数组 | version/revision 两概念并存 |
| wb_parameter_definition | parameter_key、value_source、constant_value、time_basis、offset_days | 参数定义 | V16 改造后留孤儿列（见 P2-1） |
| wb_execution_parameter_snapshot | snapshot_id(SHA-256)、snapshot_json | 执行参数不可变快照 | |

## 4. 问题清单

### P0 安全/正确性 ✅ 已于 2026-09-12 整改

- [x] **P0-1 入库的不安全默认值（application.yml）**：主配置已移除全部默认值（DB 密码、Kestra 凭据、插件目录、离线仓库目录必填注入；CORS 默认仅 localhost）。新增 `application-dev.yml` 承接本地默认值（含相对路径 `../../plugins`、`../../output/...`），本地启动加 `SPRING_PROFILES_ACTIVE=dev`。个人 Tailscale 域名移出版本库，由开发者用 `WB_DATA_CORS_ORIGINS` 自行追加（见 local-development.md）。`scripts/dev/transfer-smoke.sh:11-16` 的本地默认值保留（本地工具脚本，与应用配置解耦）。
- [x] **P0-2 开发种子默认密码**：实际风险比初判低——`DevDataInitializer` 有 `@Profile("dev")` + `WB_DATA_SEED_DEV_DATA=false` 双开关。已移除源码默认密码 `Dev123456!`，开启种子但未配 `WB_DATA_DEV_DEFAULT_PASSWORD` 时告警并跳过。
- [x] **P0-3 DataSource 实体直接出网**：新增 `DataSourceResponse` DTO（不含 password），`DataSourceController` 列表/详情改返回 DTO，实体 `@JsonIgnore` 同步移除。前端 `api/datasource.ts` 拆分为 `DataSource`（读）与 `DataSourceSavePayload`（写）。
- [x] **P0-4 查询导出任务：死表 + 内存态**：用户裁决走删表路线。V18 删除 `wb_query_export_task`；`QueryExportServiceImpl` 增加 1 小时 TTL 惰性淘汰（终态任务过期后从内存移除并删除临时文件）、`@PreDestroy` 停机清理文件。新增 `QueryExportServiceImplTest`（4 个用例：成功下载+停机清理、失败阻断下载、未知任务异常、TTL 判定）。

### P1 结构性问题，建议下次大改相关域前处理

- [x] **P1-1 git ↔ offline 包级循环依赖**（2026-09-12 解除）：offline 定义 `OfflineGitRemotePort` 端口接口（工作树推送所需的最小远程操作集），git 包提供 `GitRemoteAccessAdapter` 实现；`GitCommandService` 不再 import git 包。offline→git 引用归零，git→offline 单向（kestra 契约/config/端口）。
- [x] **P1-2 common 反向依赖业务包**（2026-09-12 矫正）：`GlobalExceptionHandler` 不再认识 offline 类型，`DirtyWorkingTreeException` 由 offline 包新增的 `OfflineExceptionHandler` 接管；`GroupAuthContextResolver` 注册挪到 auth 包自带的 `AuthWebMvcConfig`，common/config 只留 CORS。
- [ ] **P1-3 offline 域体积失控**：后端 Top4 大文件全在 offline（`OfflineFlowDocumentService` 977 行、`OfflineFlowYamlSupport` 813、`GitCommandService` 705、`KestraHttpClient` 633）；前端 Top5 中 4 个在 views/offline（`TransferNodeDialog` 971、`OfflineWorkbench` 909、`useFlowEditingSession` 823、`FlowCanvas` 670；另有 `DataSourceForm` 748）。建议优先拆 `OfflineFlowDocumentService`。
- [x] **P1-4 execution 概念双轨制**（2026-09-12 按 B 方案"共享核心、保留两入口"整改）：① 后端 `LogEntry`/`TaskRun` 合并为共享 `ExecutionLogEntry`/`ExecutionTaskRun`，Kestra 客户端接口与模型抽到 `offline.kestra` 子包（实现 `KestraHttpClient` 因依赖包私有 YAML 支持留在 offline.service）；② 前端 `executionPresentation` 移到 `components/execution`，`OperationsExecutionDetailPage` 删除本地重写 helper，`isUserTaskId`/`computeLogLevelCounts` 三份合一；③ 两个详情页日志区统一共享虚拟化 `LogViewer`（颜色变量化，operations 深色主题经容器变量覆盖保留），**顺带修复日志高亮的 dangerouslySetInnerHTML XSS 隐患**。两轨场景语义（DEBUG vs 生产、停止 vs 重跑）经调研确认为真实分工，URL/权限/路由未动。
- [ ] **P1-5 operations 无独立权限**：`router/index.tsx:177,248` 借用 `offline.read`，运维与开发权限未分离，后续收紧成本高。

### P2 一致性/卫生，可随手清理

- [x] **P2-1 V16 孤儿列**（2026-09-12 随 V19 删除）：`wb_parameter_definition` 的 `data_type`、`timezone`、`offset_amount`、`offset_unit` 已 DROP。遗留：`version`/`revision` 双概念并存仍待裁决。
- [ ] **P2-2 group 域拆进两个包**：项目组主端点 `GroupController` 在 `user/controller/`，设置在 `group/controller/`；且 group 包内 Service 风格不一（具体类 vs 接口+Impl）。
- [ ] **P2-3 命名不一致**：`datasource` 表无 `wb_` 前缀；DTO 后缀混乱（部分无 Request/Response 后缀）；api 文件单复数混用（datasource.ts vs parameterGroups.ts）；views 仅 `group-settings` 用 kebab-case；页面后缀 List/Page/Center 三种并存；Flow 文档后端叫 document、前端混用 flow/draft/editingSession；前端"工作区"对应后端 repo。
- [x] **P2-4 重复实现**（2026-09-12 小项已收敛）：分页工具三套写法已统一到 `utils/pagination.ts`（group-settings 删复制实现，datasources 修复 `?size=5` 被静默重置的缺陷）；`gitSettingsApi.ts` 已挪入 `src/api/gitSettings.ts`；导出下载改走共享 axios 实例（request.ts 拦截器支持 blob 直通）。遗留：选择器组件 5 套合并（工作量大，单独专项）；view 层直接 import `AxiosError`。
- [x] **P2-5 死目录/杂散文件**（2026-09-12 清理）：核实后这些 `CLAUDE.md` 均为 claude-mem 本地生成物，本就命中 `.gitignore` 的 `**/CLAUDE.md` 规则未入库；`docs/**`、`docs/refactor`、`docs/validation`、`src/pages/` 空壳同为本地残留。已全部本地删除，无仓库变更。

### P3 测试空洞

- [x] ~~后端 `query`、`user` 两个核心包零测试~~（2026-09-12 补齐，共 31 个用例）：query 域新增 `QueryServiceImplTest`、`MetadataServiceImplTest`、`QueryControllerPermissionTest`（另有 P0-4 的 `QueryExportServiceImplTest`）；user 域新增 `UserServiceTest`、`UserControllerPermissionTest`、`GroupControllerPermissionTest`。
- [ ] 插件 `wb-data-plugin-api`、`postgresql`、`starrocks` 零测试。
- [ ] 前端 `dashboard`、`users`、`core`（登录/兜底页）零测试。
- [ ] 全仓 TODO/FIXME 零命中——没有就地标注已知问题的习惯，建议整改期间开始标注。

## 5. 建议的把关流程（防止再次失控）

1. **每个 PR 走 code-review**：合并前用 `code-review` 技能按 Standards + Spec 两轴审查，本文件的问题清单可作为 Standards 的补充基线。
2. **黄金路径亲自走**：涉及传输/执行链路的改动，跑 `scripts/dev/smoke-verify.sh` 并亲自点一遍 UI（既定策略，贵在执行）。
3. **就地标注**：发现的问题不立刻改时，在代码处留 TODO + 本文件条目编号，避免"扫不出 TODO"的假象。
4. **定期快照复审**：每 1–2 个月对照本文件复查一次，重写或归档。

## 6. 建议处理顺序

1. 本周：P0-1～P0-4（配置默认值清理约半天；P0-4 需要先做"接表还是删表"的裁决）。
2. 下次触碰 offline 域时：P1-3 拆分类 + P1-4 收敛 execution 语义，顺势解决 P1-1/P1-2。
3. 随手：P2 各项，每做一个 PR 顺手带一两项。
4. 持续：P3 从 `query`/`user` 补起，新功能必须带测试（既定约定）。
