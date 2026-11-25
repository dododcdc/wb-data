# 任务失败自动重试与画布选节点重跑规划

> 本文档记录已确认的产品需求、技术方案与待实现清单，供后续会话直接承接开发。

## 一、背景与总体规划

WB Data 当前已打通「定时调度 → 跨任务前置依赖闸门（`WaitUpstream`）→ 上一期失败 `PAUSE` 策略 → 运维中心实例诊断与手动重跑」闭环，但仍缺少两项高频运维与容错能力：

1. **一期：任务失败自动重试** —— 解决数据库抖动、网络闪断、锁冲突等瞬时故障导致的夜间失败与下游长时间卡死问题，减少人工凌晨介入，同时在运维中心清晰区分「自动重试」与「手动重跑」。
2. **二期：运维中心画布选节点手动重跑** —— 点击重跑后通过 DAG 画布可视化选择重跑范围，默认选中失败/未执行节点及其全部下游，支持加选已成功的上游节点一并重跑，并在运维中心产生独立的新执行记录。

### 总体约束

- **遵守「Git 即发布真相」**：失败自动重试配置及二期部分重跑所需的 Flow 编译结构，均写入任务 Flow YAML，经「草稿暂存 → 提交 → 推送 → 同步 Kestra」后正式生效。
- **分两期独立交付**：一期先完整落地并验证「任务失败自动重试」，确认稳定后再开展二期「画布选节点手动重跑」。

---

## 二、已确认的产品决策

1. **自动重试配置入口与默认状态**
   - 入口放在离线开发的**调度配置弹窗**（`wb-data-frontend/src/views/offline/schedule/ScheduleDialog.tsx`），**默认不开启**。
   - 未开启「自动调度」时允许保留或提前配置重试参数，随调度配置一并写入 Flow YAML。
2. **自动重试风险提示文案（必须包含）**
   - 用户开启「失败自动重试」开关时，界面必须用**小字清晰提醒**：**自动重试会重跑整个任务（从头执行全部节点），而不是只重跑失败节点及其下游；请确认任务支持重复执行（幂等）**。
3. **自动重试参数默认值与可选范围**
   - **重试次数**（失败后额外重试次数）：支持 `1–5` 次，默认 `3` 次（编译为 Kestra YAML 时换算为 `maxAttempts = retryCount + 1`，即含首次执行在内）。
   - **重试间隔**：采用固定间隔（`type: constant`），支持 `1–60` 分钟，提供常用选项（如 `1 / 3 / 5 / 10 / 15 / 30` 分钟）或分钟数选择/输入，默认 `5` 分钟（编译为 `interval: PT<N>M`）。
   - 对小时级调度任务，若重试总耗时可能接近或跨过下一次调度间隔，界面可做温和提示。
4. **运维中心记录区分**
   - 运维中心执行列表与实例详情页必须明确区分**「自动重试」**（可标注轮次，如 `自动重试 #1` / `自动重试 #2`）与**「手动重跑」**。
5. **部分节点手动重跑（二期）**
   - 在运维中心点击重跑时，弹窗内展示任务画布与各节点原执行状态。
   - 默认选中失败（或停止/取消/未执行）节点及其全部下游节点，允许用户额外勾选上游已成功的节点一起重跑；提交后在运维中心生成一条新的独立执行记录。

---

## 三、一期详细设计：任务失败自动重试

### 3.1 Kestra 1.3 YAML 协议

已核实项目当前依赖的 Kestra 1.3.0 模型（`Flow`、`Constant`、`AbstractRetry$Behavior`）支持 Flow 根级 `retry` 配置：

- **开启自动重试时**，在 Flow YAML 根级写入：

```yaml
retry:
  type: constant
  interval: PT5M
  maxAttempts: 4
  behavior: CREATE_NEW_EXECUTION
```

- **关闭自动重试时**，从 Flow YAML 根级移除 `retry` 字段。
- 选择 `CREATE_NEW_EXECUTION` 的原因：每次自动重试都会生成一条独立的 Execution，与「手动重跑」在运维中心列表及实例详情页「本期共 N 次执行」的展示心智一致，且能独立查看每轮尝试的状态、耗时与日志。
- 在 `ScheduleDialog.tsx` 的线上只读视图（`readOnly` 模式）中同步展示线上版本的重试开关、次数与间隔。

### 3.2 画布 Debug 调试必须剥除重试配置

- `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowDebugYaml.java` 在生成调试 Flow 时，除剥除 `triggers` 与依赖闸门外，**必须同步移除根级 `retry`**，避免开发者在画布调试失败后触发后台自动重试。

### 3.3 上下游联动与 `WaitUpstream` / `PAUSE` 策略适配

- **下游自动放行机制**：[WaitUpstream.java](file:///Users/wenbin/Projects/wb-data/wb-data-server/wb-data-kestra-plugin/src/main/java/io/wbdata/kestra/core/WaitUpstream.java) 按 `scheduleKey` 判断前置任务在「同一计划业务期」内是否存在任意 `SUCCESS` 执行。Kestra `CREATE_NEW_EXECUTION` 生成的新执行仍位于原 `(namespace, flowId)` 并继承原触发计划时间，只要其中一次重试成功，处于轮询等待中的下游任务会在下一轮轮询（默认 `PT30S`）自动放行继续运行。
- **`RETRIED` 状态纳入终态**：使用 `CREATE_NEW_EXECUTION` 后，Kestra 会将触发重试的旧失败执行状态置为 `RETRIED`。
  - `WaitUpstream.java` 与 `OperationsInstanceDiagnosisService.java` 中的 `TERMINAL_STATES` 目前仅含 `SUCCESS`、`WARNING`、`FAILED`、`KILLED`、`CANCELLED`，需补充纳入 `RETRIED`。
  - **防范 `PAUSE` 策略空档期误判**：在上一期某次执行变为 `RETRIED`、下一轮重试尚未创建或刚排队的短暂空档内，如果恰逢本期 `WaitUpstream` 检查 `assertPreviousPeriodSucceeded`（或 `OperationsInstanceDiagnosisService.previousPeriodBlocked`），只按「全部已有执行均终态且无一 `SUCCESS`」可能会把“仍在自动重试中的上一期”误判为失败并阻塞本期。需要在实现时结合 `attemptNumber < maxAttempts` 与最近执行时间/状态设计保护条件，避免空档期误暂停。
- **开工前需在本地 Kestra 1.3.7 实测验证的两个边界**：
  1. **`wb_upstream_gate` 失败时的重试行为**：当任务前置依赖闸门因 `GateTimeoutException`（等待上游超时）或 `GatePausedException`（`PAUSE` 策略暂停）失败时，Flow 级 `retry` 会如何动作，是否会刷出无意义重试，以及是否需要在 `WaitUpstream` 内对过期重试做快速拦截/区分处理。
  2. **人工停止（`KILLED`）行为**：确认在运维中心手动点击「停止任务」使执行变为 `KILLED` 时，Kestra 不会触发自动重试。

### 3.4 区分「自动重试」与「手动重跑」

- **手动重跑**：保持现有机制，由 `OperationsExecutionService.rerunExecution(...)` 写入 `wb_operation_execution_action` 表（`action_type = 'RERUN'`，`new_execution_id`）。
- **自动重试**：扩展 `KestraExecutionSnapshot.java` 与 `KestraPayloadParser.java`，解析 Kestra Execution JSON 中的 `originalId` 与 `metadata.attemptNumber`：
  - 若 `newExecutionId` 命中 `wb_operation_execution_action` 的 `RERUN` 记录，标记为**手动重跑**（`MANUAL`）。
  - 否则若 `(originalId != null && !originalId.equals(id))` 或 `(attemptNumber != null && attemptNumber > 1)`，判定为**自动重试**（`AUTO`），并传递尝试轮次（如第 `attemptNumber - 1` 次重试，展示为 `自动重试 #1`）。
  - 若存在“手动重跑后再次失败并触发自动重试”的组合情况，Kestra 生成的新重试执行不会命中手动重跑表的 `new_execution_id`，会自然识别为该次手动执行后续的**自动重试**。
- **接口与列表/详情演进**：
  - 在 `OperationsExecutionListItem`、`OperationsInstanceExecutionItem`、`OperationsExecutionDetailResponse` 中新增可区分来源的字段（如 `rerunSource: NONE | MANUAL | AUTO` 及 `attemptNumber`），兼容或平稳替换现有布尔 `rerun`。
  - 前端 `OperationsTable.tsx` 与 `OperationsInstancePage.tsx`（含「本期共 N 次执行」的 chip 列表与单次重跑提示条）分别展示「手动重跑」与「自动重试 #N」徽标。
- **`RETRIED` 状态的展示、操作与统计口径**：
  - `OperationsExecutionService.java`：`RETRIED` 属于已被系统自动接续重跑的历史失败记录，**不允许再手动重跑（`rerunnable = false`）**，也不可停止（`stoppable = false`）。
  - 前端 `executionPresentation.ts`、`instancePresentation.ts`、`OperationsCenter.tsx` 补齐 `RETRIED`（「已重试」）的标签、色标与状态筛选项，并确认状态汇总计数 `OperationsExecutionStatusCounts` 的统计口径（避免自动重试中间态被重复计入失败数或漏计）。

### 3.5 一期涉及文件清单

#### 后端（`wb-data-server/wb-data-backend/`）

- 调度配置模型、读写与服务：
  - `src/main/java/com/wbdata/offline/schedule/dto/OfflineFlowSchedule.java`
  - `src/main/java/com/wbdata/offline/schedule/dto/OfflineScheduleResponse.java`
  - `src/main/java/com/wbdata/offline/schedule/dto/UpdateOfflineScheduleRequest.java`
  - `src/main/java/com/wbdata/offline/service/OfflineFlowScheduleYaml.java`
  - `src/main/java/com/wbdata/offline/service/OfflineFlowYamlSupport.java`
  - `src/main/java/com/wbdata/offline/service/OfflineFlowDocumentStore.java`
  - `src/main/java/com/wbdata/offline/service/OfflineFlowDocumentWriter.java`
  - `src/main/java/com/wbdata/offline/service/OfflineScheduleService.java`
  - `src/main/java/com/wbdata/offline/service/OfflineFlowInspector.java`
  - `src/main/java/com/wbdata/offline/service/OfflineFlowDebugYaml.java`
- Kestra 解析与运维中心：
  - `src/main/java/com/wbdata/offline/kestra/KestraExecutionSnapshot.java`
  - `src/main/java/com/wbdata/offline/kestra/KestraPayloadParser.java`
  - `src/main/java/com/wbdata/operations/service/OperationsExecutionService.java`
  - `src/main/java/com/wbdata/operations/service/OperationsInstanceDiagnosisService.java`
  - `src/main/java/com/wbdata/operations/dto/OperationsExecutionListItem.java`
  - `src/main/java/com/wbdata/operations/dto/OperationsExecutionDetailResponse.java`
  - `src/main/java/com/wbdata/operations/dto/OperationsInstanceExecutionItem.java`

#### Kestra 插件（`wb-data-server/wb-data-kestra-plugin/`）

- `src/main/java/io/wbdata/kestra/core/WaitUpstream.java`

#### 前端（`wb-data-frontend/src/`）

- API 与草稿状态：
  - `src/api/offline/schedules.ts`
  - `src/api/offline/flows.ts`
  - `src/api/operations.ts`
  - `src/views/offline/draft/flowDraftController.ts`
- 离线调度配置弹窗：
  - `src/views/offline/schedule/ScheduleDialog.tsx`
  - `src/views/offline/schedule/DependencyAwareScheduleDialog.tsx`
  - `src/views/offline/OfflineWorkbench.tsx`
- 运维中心展示：
  - `src/components/execution/executionPresentation.ts`
  - `src/views/operations/instancePresentation.ts`
  - `src/views/operations/OperationsCenter.tsx`
  - `src/views/operations/OperationsTable.tsx`
  - `src/views/operations/OperationsInstancePage.tsx`

### 3.6 一期验收与测试要点

- **后端单测**：Flow YAML `retry` 读写与关闭移除、`maxAttempts` 换算、次数（1–5）与间隔（1–60 分钟）校验、`OfflineFlowDebugYaml` 剥除 `retry`、`KestraPayloadParser` 解析 `originalId` / `metadata.attemptNumber`、运维中心区分 `MANUAL` / `AUTO`、实例诊断与 `WaitUpstream` 对 `RETRIED` 及 `PAUSE` 空档期的处理。
- **前端单测**：`ScheduleDialog` 默认关闭、开启后显示次数/间隔与“整条任务重跑”小字提示、暂存与线上只读态渲染；`OperationsTable` / `OperationsInstancePage` 正确展示「自动重试」「手动重跑」与 `RETRIED`（「已重试」）。
- **Kestra 1.3.7 联调验证**：验证失败自动重试产生新执行记录、重试成功后阻塞中的下游自动继续运行、`KILLED` 不触发自动重试、依赖闸门失败场景的表现。
- **真实浏览器走查**：覆盖调度配置弹窗的开关/下拉/校验/暂存及运维中心列表与详情页展示。

---

## 四、二期详细设计：运维中心画布选节点手动重跑

### 4.1 核心技术原理（已核实 Kestra 1.3.0 字节码）

无需为每次部分重跑克隆临时 Flow，直接在现有 Flow YAML 内原生支持：

1. **编译期注入选择输入与条件执行**：
   - 在 `OfflineFlowGraphYaml.java` 编译 DAG 时，为 Flow 增加可选输入 `wbdata_rerun_tasks`（非必填 `STRING`，默认空，存放本次指定要跑的 `taskId` 列表）。
   - 为 `flow_dag` 内的每个叶子节点注入 `runIf` 表达式：当 `wbdata_rerun_tasks` 为空时返回 `true`（定时调度和全量重跑走全量执行）；非空时仅当当前节点 `taskId` 在列表中才返回 `true`。
2. **跳过节点不会卡住下游或判失败**：
   - 已核实 Kestra 1.3.0 `io.kestra.plugin.core.flow.Dag` 与 `FlowableUtils.resolveDagNexts` 字节码：DAG 仅检查前置 `TaskRun.getState().isTerminated()` 即允许后继节点进入执行；且 `State.Type.SKIPPED.isTerminatedNoFail()` 返回 `true`。
   - 因此未被选中的节点在执行时会被立刻标记为 `SKIPPED`：既不阻断下游已选节点的执行，整条 Execution 在选中节点全部跑完后也会正常以 `SUCCESS` 收口，从而正常放行跨任务下游的 `WaitUpstream` 闸门。
3. **节点间无内存变量耦合**：
   - WB Data 的 SQL / HiveSQL / Shell / Transfer 节点均通过数据库表或外部存储衔接，未使用 `{{ outputs.<nodeId>.* }}`，跳过上游已成功节点不会引发表达式求值错误。
4. **Debug 兼容**：
   - `OfflineFlowDebugYaml.java` 需明确调试执行的 `runIf` / `wbdata_rerun_tasks` 兼容处理（调试场景本身按选中节点置 `disabled: true`，不受 `wbdata_rerun_tasks` 干扰）。

### 4.2 交互规则与安全护栏

1. **画布选区弹窗**：
   - 升级 `OperationsRerunDialog.tsx`，在弹窗内嵌只读可选 DAG 画布（复用 `@xyflow/react` 以及 `OfflineCompareCanvas.tsx` / `compareCanvasLayout.ts` 的自动布局与状态视觉样式），展示各节点在原执行中的状态（成功 / 失败 / 已停止 / 未执行）。
   - 后端需提供或扩展获取线上当前 Flow 图结构（可复用 `OfflineFlowGraphYaml.parseGraph`）及是否支持部分重跑的能力标记。
2. **防漏跑下游的默认必选护栏**：
   - 由于部分重跑最终以 `SUCCESS` 结束会放行跨任务下游 `WaitUpstream`，弹窗打开时**默认选中原执行中的失败/停止/取消/未执行节点及其全部下游节点**，且这批节点默认设为必选（不允许漏选下游节点造成假成功），防止上游表已重算而下游聚合节点未跑却误放行外部依赖。
3. **允许加选已成功上游与断层保护**：
   - 用户可以向上勾选失败节点上游已 `SUCCESS` 的节点一起重跑；同时提供「全选重跑」和「恢复默认选区」按钮。
   - 若用户勾选了更早的上游节点 `A`，而 `A` 到已选集合之间存在未勾选的中间节点 `B`，系统自动联动勾选路径上的中间节点 `B`（或给出强校验提示），防止数据产出出现断层。
4. **保留已有重跑选项**：
   - 继续保留「沿用原计划时间」与「沿用原执行的手动覆盖参数」选项。

### 4.3 平滑兼容与边界处理

- **老版本线上 Flow 平滑降级**：
  - 功能上线前已同步到 Kestra 的存量 Flow YAML 不含 `wbdata_rerun_tasks` 与 `runIf`。弹窗检测到当前线上 Flow 不支持按节点重跑时，自动降级为现有的「整条重跑」，并温和提示“重新提交并同步该任务后即可支持按节点选择重跑”。
- **原执行之后画布结构已变更**：
  - 若原执行的失败节点或部分节点在当前线上最新版本中已被重命名或删除，弹窗提示“原执行之后任务节点结构已更新”，默认退回全选让用户确认。
- **运维中心记录与状态展示**：
  - 在 `executionPresentation.ts` 中补齐 `SKIPPED` 状态映射（「已跳过」，中性样式），实例详情页节点列表可一眼分清本次重跑执行了哪些节点、跳过了哪些节点。
  - 审计表 / 执行标签记录本次部分重跑选择的节点信息（如 `wbdataRerunTasks`），列表与详情徽标可区分「手动重跑」与「手动重跑（部分 · X/Y 节点）」。

### 4.4 二期涉及文件清单

- **后端**：
  - `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowGraphYaml.java`
  - `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowDebugYaml.java`
  - `wb-data-server/wb-data-backend/src/main/java/com/wbdata/operations/service/OperationsExecutionService.java`
  - `wb-data-server/wb-data-backend/src/main/java/com/wbdata/operations/dto/OperationsExecutionRerunRequest.java`
  - 运维中心执行/重跑画布上下文查询接口（Controller / DTO / Service）
- **前端**：
  - `wb-data-frontend/src/views/operations/OperationsRerunDialog.tsx`（及新增只读可选画布子组件）
  - `wb-data-frontend/src/api/operations.ts`
  - `wb-data-frontend/src/components/execution/executionPresentation.ts`
  - `wb-data-frontend/src/views/operations/OperationsTable.tsx`
  - `wb-data-frontend/src/views/operations/OperationsInstancePage.tsx`

---

## 五、下次开工顺序与常规验证命令

### 建议推进顺序

1. **Kestra 1.3.7 边界实测**：先用本地 Kestra 实测 `wb_upstream_gate` 失败是否触发 Flow 级重试、人工 `KILLED` 不触发重试，以及 `PAUSE` 策略在重试间隔空档期的行为。
2. **完成一期（失败自动重试）**：后端 YAML 编译与运维中心适配 → `WaitUpstream` 插件适配 → 前端调度配置弹窗与运维中心展示 → 前后端单测与真实联调。
3. **完成二期（画布选节点手动重跑）**：`OfflineFlowGraphYaml` 注入 `wbdata_rerun_tasks` / `runIf` → 后端图结构与部分重跑接口 → 前端可选画布弹窗与 `SKIPPED` 展示 → 单测、联调与真实浏览器走查。

### 验证命令（见 `AGENTS.md`）

- 前端全量校验：
  ```bash
  cd wb-data-frontend
  npm run lint && npm run test && npm run build
  ```
- 后端全量构建与单测：
  ```bash
  cd wb-data-server
  mvn clean install
  ```
- 集成冒烟（依赖本地 Docker 环境）：
  ```bash
  WB_DATA_PASSWORD=<admin-密码> scripts/dev/smoke-verify.sh --quick
  WB_DATA_PASSWORD=<admin-密码> scripts/dev/smoke-verify.sh --transfer
  ```
- 弹窗 / 浮层交互需按 `docs/testing-strategy.md` 进行真实浏览器走查并记录结论。
