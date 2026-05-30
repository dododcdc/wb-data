# 执行结果功能增强与 UI 优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Kestra 节点级别的停止能力，重构执行详情列表布局，并引入自动刷新和 UI 细节优化。

**Architecture:** 后端通过调用 Kestra 的状态变更 API (`/state`) 实现单个 TaskRun 的终止；前端通过 `setInterval` 实现对话框内的自动轮询，并将节点展示重构为带有独立操作按钮的纵向列表。

**Tech Stack:** Java (Spring Boot), React, TypeScript, Lucide React (Icons), Kestra REST API.

---

### Task 1: 后端 - 更新 Kestra 客户端接口

**Files:**
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/KestraClient.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/KestraHttpClient.java`

- [ ] **Step 1: 在 KestraClient 接口中新增 setTaskRunState 方法**
```java
// KestraClient.java
void setTaskRunState(String executionId, String taskRunId, String state);
```

- [ ] **Step 2: 在 KestraHttpClient 中实现该方法**
```java
// KestraHttpClient.java
@Override
public void setTaskRunState(String executionId, String taskRunId, String state) {
    ensureCredentialsConfigured();
    Map<String, String> body = Map.of(
            "taskRunId", taskRunId,
            "state", state
    );
    try {
        byte[] payload = objectMapper.writeValueAsBytes(body);
        HttpResponse<byte[]> response = send(
                "POST",
                "/api/v1/" + properties.getTenant() + "/executions/" + encode(executionId) + "/state",
                payload,
                "application/json",
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "变更任务状态失败");
        }
    } catch (IOException e) {
        throw new UncheckedIOException(e);
    }
}
```

- [ ] **Step 3: 提交后端 Client 变更**
```bash
git add wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/KestraClient.java wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/KestraHttpClient.java
git commit -m "feat(backend): add task run state management in KestraClient"
```

---

### Task 2: 后端 - 增强执行服务逻辑

**Files:**
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineExecutionService.java`

- [ ] **Step 1: 实现 stopTaskRun 逻辑**
```java
// OfflineExecutionService.java
public void stopTaskRun(Long groupId, String executionId, String taskId) {
    KestraExecutionSnapshot execution = kestraClient.getExecution(executionId);
    ensureExecutionAccessible(execution, groupId);

    // 查找对应 taskId 的且处于运行中状态的 TaskRun
    execution.taskRuns().stream()
            .filter(tr -> taskId.equals(tr.taskId()) && isRunning(tr.status()))
            .findFirst()
            .ifPresentOrElse(
                    tr -> kestraClient.setTaskRunState(executionId, execution.id(), "KILLED"), // 注意：Kestra API 的 body 是 taskRunId
                    () -> { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "未找到运行中的任务节点: " + taskId); }
            );
}
```
*纠正：Kestra 的状态变更接口 body 需要的是具体实例的 ID（通常是 UUID），但在 KestraTaskRunSnapshot 中它被映射为 taskId？需要核实 KestraTaskRunSnapshot 定义。*

- [ ] **Step 2: 核实 KestraTaskRunSnapshot 结构并完善逻辑**
(假设 KestraTaskRunSnapshot 需要包含内部 id)

- [ ] **Step 3: 提交 Service 变更**
```bash
git commit -m "feat(backend): implement stopTaskRun in OfflineExecutionService"
```

---

### Task 3: 后端 - 暴露停止节点接口

**Files:**
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/controller/OfflineExecutionController.java`

- [ ] **Step 1: 新增 Controller 方法**
```java
// OfflineExecutionController.java
@Operation(summary = "停止单个节点的执行")
@PostMapping("/{executionId}/tasks/{taskId}/stop")
public Result<Void> stopTaskRun(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                               @PathVariable String executionId,
                               @PathVariable String taskId) {
    offlineExecutionService.stopTaskRun(context.currentGroup().id(), executionId, taskId);
    return Result.success(null);
}
```

- [ ] **Step 2: 提交 Controller 变更**
```bash
git commit -m "feat(backend): expose stop task run endpoint"
```

---

### Task 4: 前端 - 更新 API 定义

**Files:**
- Modify: `wb-data-frontend/src/api/offline.ts`

- [ ] **Step 1: 新增 stopOfflineTaskRun 函数**
```typescript
// offline.ts
export const stopOfflineTaskRun = (groupId: number, executionId: string, taskId: string) => {
    return request.post<unknown, null>(
        `/api/v1/offline/executions/${encodeURIComponent(executionId)}/tasks/${encodeURIComponent(taskId)}/stop?groupId=${groupId}`,
        null
    );
};
```

- [ ] **Step 2: 提交前端 API 变更**
```bash
git commit -m "feat(frontend): add stopOfflineTaskRun API"
```

---

### Task 5: 前端 - 重构 ExecutionDialog 节点列表

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css`

- [ ] **Step 1: 移除左侧搜索框，修改“停止全部”文案**
- [ ] **Step 2: 将右侧节点展示重构为一行一个记录的列表**
```tsx
// OfflineWorkbench.tsx 内的 ExecutionDialog 部分
<div className="offline-detail-tasks-list">
    {detail.taskRuns.map((task) => {
        const StatusIcon = getTaskStatusIcon(task.status);
        const isRunning = isRunningStatus(task.status);
        return (
            <div key={task.taskId} className="offline-detail-task-row">
                <div className="offline-task-row-info">
                    <StatusIcon
                        size={14}
                        className={`offline-task-icon is-${task.status.toLowerCase()}${isRunning ? ' is-animated' : ''}`}
                    />
                    <span title={task.taskId}>{task.taskId}</span>
                </div>
                <div className="offline-task-row-actions">
                    <Button variant="ghost" size="sm" onClick={() => onOpenLogs(task.taskId)}>查看日志</Button>
                    {isRunning && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger"
                            onClick={() => onStopTask(task.taskId)}
                            disabled={actionPending === task.taskId}
                        >
                            {actionPending === task.taskId ? <LoaderCircle className="offline-spin" size={14} /> : '停止'}
                        </Button>
                    )}
                </div>
            </div>
        );
    })}
</div>
```

- [ ] **Step 3: 更新 CSS 以适配新列表样式**
- [ ] **Step 4: 提交 UI 重构**
```bash
git commit -m "feat(frontend): refactor node list to row layout with action buttons"
```

---

### Task 6: 前端 - 实现自动刷新逻辑

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: 在 OfflineWorkbench 组件中增加轮询 useEffect**
```typescript
// 伪代码
useEffect(() => {
    let timer: number | null = null;
    if (executionDialogOpen && activeExecutionId && isAnyTaskRunning) {
        timer = window.setInterval(() => {
            handleRefreshExecutions(); // 刷新左侧列表和当前详情
        }, 3000);
    }
    return () => { if (timer) clearInterval(timer); };
}, [executionDialogOpen, activeExecutionId, isAnyTaskRunning]);
```

- [ ] **Step 2: 提交刷新逻辑**
```bash
git commit -m "feat(frontend): implement 3s auto-refresh for execution results"
```

---

### Task 7: 前端 - UI 细节微调

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.css`

- [ ] **Step 1: 调整用户过滤下拉框高度和倒角**
```css
/* OfflineWorkbench.css */
.offline-execution-filter-control .simple-select-trigger {
    height: 32px; /* 原为 44px */
    border-radius: 6px; /* 原为 14px */
}
```

- [ ] **Step 2: 提交视觉微调**
```bash
git commit -m "style(frontend): adjust user filter size and rounded corners"
```
