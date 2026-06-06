# 运维中心设计

## 背景

项目组成员在离线开发中创建任务、提交并推送到远程仓库后，Kestra 会按分支定时同步远程仓库中的业务 Flow。业务 Flow 随后由自身的调度配置执行。

用户需要一个面向生产运行的入口，查看这些正式调度任务的运行情况，并在失败后执行重跑。这个入口不应该混入离线开发的 Debug 执行，也不应该展示代码同步用的 `system/sync-flows-*` Flow。

## 目标

- 在左侧主导航增加一级入口 `运维中心`
- 只展示当前项目组的正式调度业务任务执行记录
- 默认展示当前项目组、当前分支、最近 24 小时的执行实例列表
- 支持按分支、任务、状态、时间范围筛选
- 支持查看执行详情、节点状态、日志、失败摘要和可用执行参数
- 支持对失败、取消、停止的执行重跑整条 Flow
- 普通开发者和项目组管理员都可以重跑
- 记录 wb-data 侧的重跑操作审计

## 非目标

- 不展示离线开发 Debug 执行
- 不展示代码同步 Flow，例如 `system/sync-flows-g4-main`
- 不做 `置成功`
- 不做失败节点单独重跑
- 不做跨项目组运维视图
- 不把所有 Kestra 执行历史批量同步入库
- 不实现告警、资源监控、SLA 统计或调度健康看板

## 任务范围定义

第一版只看正式业务 Flow 执行。正式业务 Flow 的范围来自当前项目组已纳入调度同步的分支：

1. 后端从当前登录上下文读取 `currentGroup.id`
2. 查询该项目组的同步分支配置
3. 按既有规则计算分支 namespace，例如 `g4-main`、`g4-feature-policy-review`
4. 查询这些 namespace 下的 Kestra 执行记录
5. 排除 `system` namespace 和 `sync-flows-*` 代码同步 Flow
6. 排除 `wb-debug-*` Debug namespace

前端不传任意 `groupId`。所有运维中心 API 都从认证上下文绑定当前项目组，防止越权查询其他项目组。

## 推荐方案

采用“后端代理 Kestra 查询 + wb-data 记录运维动作”的方案。

Kestra 仍是执行事实来源，运维中心列表和详情实时查询 Kestra。wb-data 不复制执行历史，只在用户点击重跑时记录一条操作审计，保存原执行 ID、新执行 ID、操作人和操作时间。

这个方案上线成本低，数据不容易和 Kestra 打架，同时保留生产操作的责任追踪。

## 导航与页面结构

左侧主导航新增一级菜单：

- 文案：`运维中心`
- 权限：`offline.read`
- 路由：`/operations`

页面第一版只有一个主视图：执行实例列表。

列表顶部是筛选区：

- 分支：默认当前分支，可切换为其他已同步分支或全部分支
- 任务：按 Flow ID 或任务名称搜索
- 状态：全部、运行中、成功、失败、已取消、已停止
- 时间：最近 24 小时、最近 7 天、自定义时间
- 刷新按钮

列表列：

- 任务
- 分支
- 状态
- 触发时间
- 开始时间
- 结束时间
- 耗时
- 失败摘要
- 操作

行操作：

- `查看详情`
- `重跑`，只对 `FAILED`、`CANCELLED`、`KILLED` 显示或启用

## 执行详情

点击执行记录进入详情页或详情面板。第一版推荐使用独立详情页，后续可以再做侧滑预览。

详情内容：

- 基本信息：执行 ID、namespace、Flow ID、分支、状态、触发时间、开始时间、结束时间、耗时
- 任务节点列表：节点 ID、节点状态、开始时间、结束时间
- 日志：复用现有日志展示能力，支持按节点过滤
- 参数与元数据：展示 Kestra 返回的 inputs、labels 或可用 metadata
- 失败信息：优先展示失败节点和错误日志摘要

详情页操作：

- `重跑整条 Flow`，只在失败、取消、停止终态展示
- 返回执行列表

## 重跑语义

第一版只重跑整条 Flow：

1. 用户点击失败执行的 `重跑`
2. 后端校验执行属于当前项目组的正式业务 namespace
3. 后端校验原状态是 `FAILED`、`CANCELLED` 或 `KILLED`
4. 后端调用 Kestra，使用原执行的 `namespace` 和 `flowId` 创建新执行
5. 后端写入重跑审计记录
6. 前端提示重跑已触发，并跳转或高亮新执行

不支持只重跑失败节点。这个能力涉及上游产物、依赖状态和参数快照，放到二期。

## 权限

查看：

- `offline.read`

重跑：

- `offline.write`

这意味着普通开发者和项目组管理员都可以重跑，前提是他们在当前项目组拥有离线写权限。

系统管理员如果进入某个项目组，也按当前项目组权限上下文查询，不在第一版提供跨项目组运维入口。

## 后端设计

新增 `operations` 领域，保持与现有 `offline` 领域边界清晰。

建议文件：

- `com.wbdata.operations.controller.OperationsExecutionController`
- `com.wbdata.operations.service.OperationsExecutionService`
- `com.wbdata.operations.dto.OperationsExecutionListItem`
- `com.wbdata.operations.dto.OperationsExecutionDetailResponse`
- `com.wbdata.operations.dto.OperationsExecutionRerunResponse`
- `com.wbdata.operations.entity.WbOperationExecutionAction`
- `com.wbdata.operations.mapper.WbOperationExecutionActionMapper`
- `resources/db/migration/V13__create_wb_operation_execution_action.sql`

API：

- `GET /api/v1/operations/executions`
- `GET /api/v1/operations/executions/{executionId}`
- `GET /api/v1/operations/executions/{executionId}/logs`
- `POST /api/v1/operations/executions/{executionId}/rerun`

查询参数：

- `branch`
- `flowId`
- `status`
- `from`
- `to`

后端不接收 `groupId` 查询参数。当前项目组来自 `@RequireGroupAuth`。

审计表字段：

- `id`
- `group_id`
- `action_type`，第一版固定为 `RERUN`
- `original_execution_id`
- `new_execution_id`
- `namespace`
- `flow_id`
- `requested_by`
- `requested_at`

## Kestra 集成

复用并扩展现有 `KestraClient`：

- 复用 `searchExecutions(filters)`
- 复用 `getExecution(executionId)`
- 复用 `getLogs(executionId, taskId)`
- 复用 `createExecution(namespace, flowId)` 作为重跑触发
- 扩展 `KestraExecutionSnapshot`，按需解析 inputs 或 labels，供详情页展示参数与元数据

如果 Kestra 的执行查询不支持一次传多个 namespace，后端按当前项目组的分支 namespace 循环查询，再在服务层合并、排序、分页。

## 前端设计

新增页面：

- `wb-data-frontend/src/views/operations/OperationsCenter.tsx`
- `wb-data-frontend/src/views/operations/OperationsCenter.css`
- `wb-data-frontend/src/api/operations.ts`

复用：

- `executionPresentation.ts` 的状态标签和状态颜色
- 现有日志展示组件或日志展示模式
- 现有执行详情页中的节点状态展示思路
- `useOperationFeedback` 展示重跑反馈

页面不做营销式说明。空状态只说明当前范围没有正式调度执行，并引导用户检查分支同步与任务调度配置。

## 状态展示

状态文案沿用现有执行状态映射：

- `CREATED`、`QUEUED`：就绪
- `RUNNING`、`RETRYING`：执行中
- `SUCCESS`：成功
- `FAILED`：失败
- `CANCELLED`：已取消
- `KILLED`：已停止
- `PAUSED`：已暂停

列表默认优先显示失败和运行中的信息密度，但不改变排序。默认排序是触发时间倒序。

## 错误处理

- Kestra 不可用：显示页面级错误，保留筛选条件和刷新入口
- 当前项目组没有同步分支：显示“当前项目组暂无正式调度任务”
- 执行不属于当前项目组：后端返回 404 或 403，不泄漏执行信息
- 重跑进行中的执行：后端返回 400，前端提示“当前状态不支持重跑”
- 重跑触发失败：记录失败反馈，不写成功审计记录

## 测试策略

后端：

- 当前项目组隔离，不允许通过执行 ID 查看其他项目组 namespace
- 列表排除 `system/sync-flows-*`
- 列表排除 Debug namespace
- 默认时间范围和状态过滤正确
- `FAILED`、`CANCELLED`、`KILLED` 允许重跑
- `RUNNING`、`CREATED`、`QUEUED`、`SUCCESS` 不允许重跑
- 重跑成功写入审计记录

前端：

- 导航出现 `运维中心`
- 默认加载当前项目组执行列表
- 筛选条件能正确传给 API
- 失败执行显示 `重跑`
- 成功或运行中执行不显示或禁用 `重跑`
- 点击重跑后刷新列表并展示反馈
- 空状态、错误状态、加载状态覆盖

## 二期预留

- `置成功`：记录人工确认成功，不修改 Kestra 原始状态
- 失败节点重跑
- 告警与通知
- 调度健康状态
- 跨项目组运维视图
- 任务定义列表
- 按负责人、业务域、数据源筛选
