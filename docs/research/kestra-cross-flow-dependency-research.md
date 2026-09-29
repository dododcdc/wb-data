# 调研：Kestra 1.3.7 跨 flow 依赖闸门能力验证

> 日期：2026-09-29
> 关联：[task-level-dependencies-v1.md](../proposals/task-level-dependencies-v1.md) §6（闸门方案 A）
> 结论：方案 A 的全部前置能力在本机 Kestra `v1.3.7`（`wb-data/kestra:v1.3.7-sql-template`）验证通过；scheduleKey 必须放插件 Java 计算，不能用 Pebble。

## 验证项与结论

### 1. Pebble `date` 过滤器：时区可用，周格式不是 ISO 周（关键坑）

实测 flow（`Log` task 渲染固定时刻字符串）：

| 表达式 | 输出 | 判定 |
|--------|------|------|
| `"2026-01-01T16:30:00Z" \| date("yyyy-MM-dd", timeZone="Asia/Shanghai")` | `2026-01-02` | ✅ 时区换算正确 |
| `date("yyyy-MM-dd'T'HH", timeZone="Asia/Shanghai")` | `2026-01-02T00` | ✅ |
| `date("YYYY-'W'ww")` @ `2026-01-01` | `2026-W01` | ✅（碰巧与 ISO 一致） |
| `date("YYYY-'W'ww")` @ `2021-01-01` | **`2021-W01`** | ❌ ISO 应为 `2020-W53` |
| `date("YYYY-'W'ww")` @ `2025-12-29` | `2026-W01` | ✅（碰巧一致） |

`YYYY`/`ww` 走的是 JVM 默认 locale 的周规则（周日开头、首周最短 1 天），不是 ISO-8601 周（周一开头、首周最少 4 天）。跨年时与 `OfflineScheduleKeys`（`IsoFields`）不一致。

**结论**：scheduleKey 一律在插件 Java 里算（与后端 `OfflineScheduleKeys` 同一套测试向量），Pebble 只负责把 `{{ trigger.date ?? inputs.wbdata_planned_time }}` 原始值传进 task。

### 2. 未声明 input：能传但流程内不可见

`POST /executions/{ns}/{flow}` 带未声明 input：HTTP 200，执行创建成功，但日志告警 `Input xxx was provided ... but isn't declared`，流程内 `{{ inputs.xxx }}` 渲染为 NULL。

**结论**：手动旁路开关 `wbdata_bypass_gate` 必须是闸门生成时在 flow YAML 里声明的 input（BOOL，默认 false）。注意：Kestra UI 手动触发对话框也能看到并改这个 input——能操作 Kestra UI 的都是管理员，可接受，在此备案。

### 3. 插件 task 取数：可经 DefaultRunContext 拿 ApplicationContext（无需 REST/凭据）

证据链（1.3.0 编译依赖与运行中 1.3.7 fat jar `/app/kestra` 双向核对）：

- 核心插件 `io.kestra.plugin.core.execution.PurgeExecutions` 的字节码即此模式：`((DefaultRunContext) runContext).getApplicationContext()` 取 Micronaut `ApplicationContext` 再 `getBean(...)`。
- 1.3.7 fat jar 中 `DefaultRunContext.getApplicationContext()` 为 public。
- `ExecutionRepositoryInterface.findByFlowId(tenant, namespace, flowId, Pageable)` 存在（1.3.0 与 1.3.7 签名一致）。
- `FlowRepositoryInterface.findById(...)` 存在——闸门可在运行时读上游 flow 当前定义，拿到最新 cron/timezone（对应拍板 A：上游改时区下游无感）。
- `ExecutionTrigger.getVariables()` 暴露触发变量；Schedule 触发器 Output 含 `getDate(): ZonedDateTime`（计划时间），变量序列化后可能是 String，插件解析时两种都兼容。
- `Execution.getInputs()` / `getLabels()` / `getState()` 齐全——「重跑该期」的执行可从 inputs 取回 `wbdata_planned_time`。
- `io.kestra.plugin.core.execution.Labels` 实现 `ExecutionUpdatableTask`——运行中可以更新 execution labels。我们的闸门 task 成功通过后可用同一机制回写自身 `wb.scheduleKey` 标签，供运维筛选；task 抛异常失败时不会回写，超时标记仍走 output + 日志。

**结论**：插件走内部仓库取数，不引入 REST 调用与凭据配置。

### 4. Schedule 触发器无 labels 属性

1.3.7 `io.kestra.plugin.core.trigger.Schedule` 属性全集：`allowConcurrent, backfill, conditions, cron, inputs, lateMaximumDelay, recoverMissedSchedules, scheduleConditions, stopAfter, timezone, withSeconds`。没有 `labels`，调度产生的 execution 只继承 flow 级 labels。

**结论**：不能靠触发器给 execution 打 scheduleKey 标签；匹配靠闸门 task 扫描前置 executions 并用 Java 重算 key（本就在设计中），运维可见性靠第 3 条的 `ExecutionUpdatableTask` 回写。

### 5. 附带确认

- fat jar 内含 `com.cronutils`（Schedule 触发器同款 cron 库）——插件可用来按 cron+timezone 精确计算「下一个计划点火点」作为超时边界，月长/夏令时不需近似。
- Schedule 触发器自身有 `nextEvaluationDate()`，但其类型在插件类加载器中可用性待 task 开发时确认；保底用 cron-utils 自算。
- executions 搜索 API 支持 `filters[labels][EQUALS][key]`（后端 `KestraHttpClient` 已在用），运维中心按标签筛选可行。
- `POST /executions/{ns}/{flow}?labels=k:v` 创建执行时可打 labels（`KestraHttpClient.createExecution` 已支持）——「重跑该期」入口可标记来源。

## 对实现计划的落点

| 计划项 | 验证结果 |
|--------|----------|
| 插件注入内部仓库（决策 A 读上游 flow 定义） | ✅ 可行，按此实现；兜底「禁止上游改时区」不需要启用 |
| scheduleKey 计算位置 | 插件 Java，禁用 Pebble 周格式 |
| 手动旁路开关 | flow input 声明 `wbdata_bypass_gate: BOOL=false` |
| 超时边界 | cron-utils 算下一计划点火点 |
| 超时失败标记 | task output `reason=TIMEOUT` + 日志 + FAILED 状态（label 运行中不可写在失败路径上） |

## 验证方法留痕

- Pebble：临时 flow `wbtest/wb_spike_pebble_date`（已删除）跑 `Log` 渲染。
- 未声明 input：临时 flow `wbtest/wb_spike_undeclared_input`（已删除）。
- 字节码：`javap` 检查 `~/.m2` 的 core-1.3.0.jar 与容器内 `/app/kestra`（1.3.7 fat jar）。
