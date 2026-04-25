# 离线开发执行结果界面优化与后端能力增强设计文档

## 1. 背景与目标
当前离线开发（Offline Workbench）的执行结果对话框存在以下问题：
- **布局不合理**：右侧节点状态以网格形式展示，难以容纳更多操作。
- **功能缺失**：无法针对单个运行中的节点进行停止操作，只能停止整个 Flow。
- **交互不便**：执行进度需要用户手动点击刷新才能看到更新。
- **视觉冗余**：左侧搜索功能利用率低；用户过滤下拉框尺寸过大、倒角过圆，与 IDE 风格不符。

本方案旨在通过后端接口增强和前端界面重构，提供更精细的执行控制和更流畅的交互体验。

## 2. 详细设计

### 2.1 后端能力增强 (wb-data-server)

为了支持“只停止某个节点”，我们需要利用 Kestra 的状态变更接口。

#### 2.1.1 `KestraClient` 扩展
- **新增接口**：`void setTaskRunState(String executionId, String taskRunId, String state)`
- **实现细节**：调用 `POST /api/v1/{tenant}/executions/{executionId}/state`，请求体包含 `taskRunId` 和目标 `state` (如 `KILLED`)。

#### 2.1.2 `OfflineExecutionService` 扩展
- **新增方法**：`void stopTaskRun(Long groupId, String executionId, String taskId)`
- **逻辑**：
  1. 调用 `kestraClient.getExecution(executionId)` 获取当前执行详情。
  2. 在 `taskRunList` 中匹配对应的 `taskId`。
  3. 如果找到处于运行中状态的 `taskRunId`，调用 `kestraClient.setTaskRunState` 将其置为 `KILLED`。

#### 2.1.3 `OfflineExecutionController` 扩展
- **新增路由**：`POST /api/v1/offline/executions/{executionId}/tasks/{taskId}/stop`
- **权限**：要求 `Permission.OFFLINE_WRITE`。

### 2.2 前端重构 (wb-data-frontend)

#### 2.2.1 `ExecutionDialog` 布局调整
- **左侧列表**：移除搜索框（Search Input）。
- **右侧详情页**：
  - **顶部操作栏**：将“停止所有”文案改为“停止全部”。
  - **节点展示**：由 `offline-detail-tasks-grid` (网格) 改为 `offline-detail-tasks-list` (纵向列表)。
  - **节点行设计**：
    - [状态图标] [节点名称/ID] [右侧操作区]
    - 操作区包含：
      - **查看日志**：点击跳转至日志详情页。
      - **停止**：仅在节点状态为 `RUNNING`、`CREATED`、`QUEUED` 时显示。点击触发 `stopOfflineTaskRun`。

#### 2.2.2 自动刷新机制
- 在 `OfflineWorkbench` 组件中，当 `executionDialogOpen` 为 `true` 且当前选中的执行记录处于未完成状态时，启动一个 3 秒的 `setInterval`。
- 定时器触发时，调用现有的 `handleRefreshExecutions` 和 `handleSelectExecution` (拉取详情) 逻辑。
- 对话框关闭或任务全部结束时清除定时器。

#### 2.2.3 UI 细节优化
- **用户过滤器**：
  - `height`: 调整为 `32px`。
  - `border-radius`: 调整为 `6px`。
- **文案统一**：全局“停止所有”统一替换为“停止全部”。

## 3. 技术挑战与注意事项
- **Kestra 状态同步**：强制变更 TaskRun 状态后，Kestra 引擎可能需要短暂时间反应，前端自动刷新应能处理这种延迟。
- **并发刷新**：确保自动刷新请求不会因堆积导致性能问题（使用 Flag 确保前一个请求完成后再触发下一个）。

## 4. 验证计划
- **功能测试**：
  - 验证点击单个节点的“停止”按钮后，该节点变为已停止状态，而同一 Flow 的其他节点（若是并行的）继续运行。
  - 验证顶部“停止全部”依然能杀死整个 Execution。
  - 验证 3 秒自动刷新的准确性。
- **视觉测试**：
  - 检查用户过滤器下拉框的尺寸和圆角。
  - 检查节点列表的排列和按钮样式。
