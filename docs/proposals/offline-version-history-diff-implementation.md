# 实施：离线任务版本历史与多维度比对

> 状态：S4 业务语义 diff 已完成（2026-11-08），S5 待实施
> 范围：离线任务的开发版本、提交版本、线上版本历史，以及任意两个版本的只读比对
> 关联方案：保留部署状态徽标方案的 P1；本文取代其 P2/P3
> 引擎约束：Kestra 固定为 1.3.7，本方案不附带升级

---

## 0. 实施原则

本功能不按“一个 V1 大需求”一次性交付，而按以下依赖链拆小步：

```text
推送记录与真实部署证据
  → 版本历史与只读快照
    → 结构化差异与原始文件差异
      → 双画布可视化
```

必须先保证“当前线上”可信，再建设历史与比对 UI。任何无法取得真实部署证据的场景都显示“生效状态未知”，不得仅凭推送成功或同步任务触发成功推断已生效。

V1 已确定的边界：

- 开发版本、提交版本、线上版本共用一套只读任务快照模型。
- 后端负责还原快照；前端用纯函数计算结构化 diff。
- V1 节点页先交付“变更清单 + 节点详情 diff”；双画布放入 V1.1。
- 不做恢复版本、跨路径历史、自动配对重命名、跨分支比对。
- 不替换现有 Git → Kestra 同步主链路，不直接操作工作树来读取历史版本。

---

## 1. 目标与非目标

### 1.1 目标

| ID | 能力 | 验收口径 |
|----|------|----------|
| G1 | 查看任务完整提交历史 | 当前分支完整 Git path history 中，修改任务历史路径集合的 commit 均出现 |
| G2 | 将推送聚合为任务线上版本 | 10 次任务提交、2 次包含该任务的推送，显示 2 个线上版本 |
| G3 | 区分推送意图与实际生效 | 连续推送、同步失败、定时同步补成功时，不误标“当前线上” |
| G4 | 任意两个版本可比 | 开发版本、提交版本、线上版本可两两组合，旧在左、新在右 |
| G5 | 差异按业务维度展示 | 概览、节点、调度、依赖、参数、原始文件均有明确结果 |
| G6 | 不同节点采用合适 diff | SQL/Shell 为文本 diff；Transfer 为结构化配置与映射 diff |
| G7 | 模型未覆盖内容可排障 | 原始文件 diff 覆盖两个版本托管文件并集，不遗漏删除文件 |

### 1.2 非目标

- 不将“提交”“推送”“同步成功”合并为一个版本状态。
- 不在 V1 恢复历史版本；V2 恢复也只能覆盖工作区后走正常提交、推送，不直接写 Kestra。
- 不对比数据源连接串、账号、密码或参数组当前定义。
- 不保证跨任务移动/重命名前的连续历史；V1 只提示原路径。
- 不做 SQL AST 级语义 diff，不将单纯格式变化自动判为等价。
- 不将布局坐标变化计入执行差异；原始文件 Tab 仍可查看布局变化。

---

## 2. 版本模型与核心不变量

### 2.1 三类版本

| 版本 | 定义 | 数据来源 |
|------|------|----------|
| 开发版本 | 当前工作区中已自动保存的任务文档 | `WORKTREE` 快照 |
| 提交版本 | 改动过该任务历史路径集合的每个 commit | 当前分支 `git log --full-history -- <任务历史路径集合>` |
| 线上版本 | 每次推送中，该任务最后一个提交 | 推送记录 + Git 区间计算 |

示例：

```text
c1—c2—c3—c4—c5—…—c9—c10—W
          │           │     └─ 开发版本
          │           └─ 线上 v2（是否“当前线上”取决于真实 deployed_sha）
          └─ 线上 v1

c10 = 已提交、未推送
W   = 工作区开发版本
```

线上版本以 `publish_record.id` 为独立身份、以该记录的 `after_sha` 为内容基准，commit 只是归因和展示元数据；同一 commit 被基线、重建或多次推送关联时可以对应多个线上版本。线上版本号按任务、分支分别编号，顺序使用 `(COALESCE(pushed_at, created_at), publish_record.id)`，不使用 Git commit 时间编号。

### 2.2 核心不变量

1. **推送记录是发布意图，`deployed_sha` 是部署证据，二者不得互相替代。**
2. “当前线上”只能由已确认的 `deployed_sha` 推导；`last_deployed_sha` 为空时显示“生效状态未知”。
3. 同步执行状态为 `SUCCESS`，但无法确认实际 SHA 时，仍不得设置“当前线上”。
4. 推送未配置或未启用 Kestra 同步的分支，只显示“已推送”，不生成任务线上版本号。
5. 同步失败的推送可保留线上版本记录，但必须标“推送未生效”，不得成为“当前线上”。
6. 历史快照只包含该 revision 的不可变内容，不混入当前参数组状态、当前数据源名称等动态解析结果。
7. 所有比对只读，不 checkout、不 rebase、不写工作区、不修改 Kestra。

---

## 3. 现状锚点与需要改造的能力

| 现状 | 代码锚点 | 本方案处理 |
|------|----------|------------|
| 任务提交只包含任务托管文件 | `GitCommandService.commitCurrentFlowUnlocked`、`OfflineFlowDocumentService.resolveManagedFiles` | 复用托管文件解析，历史读取需支持 Git revision |
| 推送失败后可能 `pull --rebase` 再推送 | `GitCommandService.pushUnlocked` | `before_sha/after_sha` 必须在 rebase 后、成功推送时重新读取 |
| 推送事件只有项目组和分支 | `GitRepoPushedEvent` | 增加发布记录 ID、before/after SHA |
| 同步只记录分支最近一次触发状态 | `GitSyncConfigService.trigger` | 增加执行终态回填和真实部署证据 |
| 同步插件按分支名拉取内容 | `GitSyncFlowSourceBuilder.buildSyncFlowSource` | 不能将某次 execution 直接等同于推送时的 `after_sha` |
| 工作区快照已能解析节点、脚本、Transfer、参数、调度、依赖 | `OfflineFlowDocumentService.readSnapshot` | 抽取文件读取端口，复用解析逻辑 |
| 参数快照、Transfer 配置和脚本均进入任务托管文件 | `OfflineFlowDocumentService.readSnapshot/resolveManagedFiles` | 历史版本从同一个 commit 读取完整任务文件集合 |
| 前端已有 Monaco | `wb-data-frontend/package.json` | 使用 Monaco DiffEditor，不新增第二套代码编辑器 |
| 后端已有 cron-utils | `wb-data-backend/pom.xml`、`OperationsScheduleWindows` | 下一次触发时间在后端计算，前端不引入 Cron 解析器 |

---

## 4. 推送记录与真实部署证据

### 4.1 发布记录表

新增 Flyway 迁移与 `wb_offline_publish_record`：

```text
id                     BIGINT PK
group_id               BIGINT NOT NULL
branch                 VARCHAR(255) NOT NULL
record_type            VARCHAR(20) NOT NULL
before_sha             VARCHAR(64) NULL
after_sha              VARCHAR(64) NOT NULL
pushed_by              BIGINT NULL
pushed_at              DATETIME NULL
sync_enabled_at_push   BOOLEAN NOT NULL
sync_execution_id      VARCHAR(64) NULL
sync_status            VARCHAR(32) NOT NULL
sync_message           VARCHAR(1000) NULL
created_at             DATETIME NOT NULL
updated_at             DATETIME NOT NULL

INDEX (group_id, branch, pushed_at, id)
INDEX (group_id, branch, after_sha)
```

约束与语义：

- `record_type = PUSH | BASELINE | RECONCILED`；正常推送的 `pushed_at` 必填，基线和对账补记使用 `created_at` 表示记录时间，不伪造推送时间。
- 首次推送或重建远程时 `before_sha = null`。
- 相同 SHA 的两次成功推送允许存在两条记录；是否产生“无任务变化”的版本由任务级区间计算决定。
- `sync_status` 仅描述该记录关联的同步尝试：`PENDING | RUNNING | SUCCESS | FAILED | UNKNOWN`。
- `sync_status = SUCCESS` 不等于该 `after_sha` 已成为真实部署版本。
- `pushed_by` 从当前认证上下文传入；系统基线和对账记录允许为空。

### 4.2 分支部署状态

扩展 `wb_git_sync_config`，将“当前真实部署”与“最后一次同步尝试”分开：

```text
last_deployed_sha      VARCHAR(64) NULL
last_deployed_at       DATETIME NULL
deployment_evidence    VARCHAR(32) NOT NULL DEFAULT 'UNCONFIRMED'
```

`deployment_evidence`：

| 状态 | 含义 |
|------|------|
| `UNCONFIRMED` | 尚无真实部署证据 |
| `CONFIRMED` | `last_deployed_sha` 已通过 §4.4 的证据规则确认，可用于“当前线上” |
| `UNKNOWN` | 曾有确认版本但当前可能已被部分覆盖，界面显示“生效状态未知” |

`last_deployed_sha` 在转为 UNKNOWN 时可以保留为“最后确认版本”供排障，但此时 `currentOnline=false`；execution 创建前触发失败、尚未执行任何同步任务时，才可保留原 CONFIRMED 状态。不在 `wb_offline_publish_record` 上简单增加一个可随意回填的 `deployed_sha` 作为当前状态；当前状态属于分支，且一次同步可能覆盖多次推送。

### 4.3 推送记录时机

`GitCommandService.pushUnlocked` 与 `rebuildUnlocked` 统一走一个发布记录收口方法：

1. 处理远程创建、配置切换和必要的 `pull --rebase`。
2. 在最后一次实际推送前，重新读取当前分支、`HEAD` 和最新 `origin/<branch>`；此时远端值记为 `before_sha`，不能使用首次推送尝试前的旧值。
3. 执行最后一次推送，令 `after_sha = 该次 HEAD`，并校验推送成功后 `origin/<branch> = after_sha`。
4. 推送成功后先持久化发布记录，再发布包含 `publishRecordId/beforeSha/afterSha` 的事件。
5. 记录数据库失败时，向用户返回“推送已成功，但发布记录写入失败”，并进入对账流程；不得回滚或假装远程推送未发生。

Git 远程操作与数据库无法做成原子事务，因此需要一个按 `(group_id, branch, origin/<branch>)` 查漏的对账入口；V1 至少在分支历史打开时检测“该分支远端 HEAD 无发布记录”，提示并允许补记为 `RECONCILED + UNKNOWN` 的记录。

### 4.4 `deployed_sha` 证据规则（实施闸门 G0）

当前 `SyncFlows` 与 `SyncNamespaceFiles` 按分支同步，执行时可能已是更新的远端 HEAD，且推送、手动和定时触发可能重叠。因此必须先完成一个针对 Kestra 1.3.7 的技术验证与最小链路改造：

1. 同一个同步 Flow/分支的 execution 必须互斥，验证并启用 Kestra 1.3.7 的并发限制，后续执行采用排队而非取消最新版本；无法保证互斥时不得进入 CONFIRMED。
2. 对账更新以 execution 终态时间和证据代数做条件更新，禁止较旧执行的轮询结果覆盖较新状态。
3. 在互斥执行内记录首尾 SHA：

```text
同步执行开始（同分支无其他同步执行）
  → 解析远端分支 SHA（sync_start_sha）
  → SyncFlows + SyncNamespaceFiles
  → 再解析远端分支 SHA（sync_end_sha）
  → 执行终态回填
```

只有同时满足以下条件才允许写入 `last_deployed_sha`：

1. 两个同步任务均成功。
2. `sync_start_sha = sync_end_sha`。
3. 该 SHA 能通过 Git revision 读取。
4. 抽查业务 Flow 的实际 Kestra source 与该 SHA 的 `.wb-data/kestra-flows` 内容一致；比较前必须按 `SyncFlows` 的 `targetNamespace` 规则规范化预期 source，不能与 Git 原文直接做字符串相等，不存在业务 Flow 的纯配置同步可由前 3 项确认。

若首尾 SHA 不同、执行开始后的任一任务失败或内容校验失败：

- 保留旧 SHA 仅作为“最后确认版本”，将分支证据改为 `UNKNOWN`，不得继续显示当前线上。
- 将本次尝试标为 `FAILED` 或证据 `UNKNOWN`。
- 触发/等待最新分支同步，不把任何中间推送猜成当前线上。

另外，`GitSyncFlowSourceBuilder.boundedIdentifier` 对短分支名只做 slug，`feature/a` 与 `feature-a` 可能映射到同一个同步 Flow/namespace。G0 必须检测同项目组内的标识碰撞；存在碰撞的相关分支一律保持 UNKNOWN，不参与当前线上判定，并提示先治理同步配置，标识映射迁移不在本方案顺带实施。

S0 已确定并实现最小任务 `io.wbdata.kestra.core.GitRemoteRevision`：复用 JGit `lsRemote` 读取 `refs/heads/<branch>`，输出 `sha`，支持现有 HTTP 用户名/令牌凭据。正式同步 Flow 按以下契约组合：

```text
concurrency.limit = 1
concurrency.behavior = QUEUE

resolve_start (GitRemoteRevision)
  → sync_flows (SyncFlows)
  → sync_files (SyncNamespaceFiles)
  → resolve_end (GitRemoteRevision)

Flow outputs.start_sha = outputs.resolve_start.sha
Flow outputs.end_sha   = outputs.resolve_end.sha
```

Kestra 1.3.7 的 execution API 已在根对象返回 `outputs` 映射；后端只需扩展 `KestraExecutionSnapshot/KestraPayloadParser` 读取该映射，不需要解析日志或读取任务容器文件。

### 4.5 同步执行对账

新增 `GitSyncExecutionReconciliationService`：

- 回填手动触发和推送触发的 execution 终态，不能只保存创建时的 `RUNNING/CREATED`。
- 扩展 `KestraExecutionSnapshot/KestraPayloadParser` 读取根对象 `outputs`；FAILED 时 outputs 可能为 null，不能以“没有 end_sha”推断具体失败位置，必须结合任务终态。
- 处理定时触发的同步执行；一次成功执行可确认多个待生效推送所共同指向的分支状态。
- 按执行读取首尾 SHA 与终态，满足 §4.4 后更新分支 `last_deployed_sha`。
- 对连续推送采用保守判定：不能确认中间版本曾生效时，只更新最终可确认版本，中间版本保留为历史线上版本，不补写“曾经当前”。
- 对 UNKNOWN 提供“重新检查/重新同步”入口，复用现有手动同步能力。

### 4.6 任务级线上版本计算

对每条 `sync_enabled_at_push = true` 的发布记录，使用 §5 的任务历史路径集合执行：

```bash
git log --full-history --topo-order -1 <before_sha>..<after_sha> -- <任务历史路径集合>
```

- 首次推送没有 `before_sha` 时，改为在 `<after_sha>` 可达历史中查最后一个任务提交。
- 有结果：该 commit 是本次推送的归因提交，发布记录生成一个独立任务线上版本。
- 无结果：本次推送未修改任务，不生成新的任务线上版本。
- 合并 DAG 中“拓扑序最后一个任务提交”只用于归因展示；若 `after_sha` 本身修改任务则优先归因于 `after_sha`，否则按上述命令取一个归因提交，并在测试中固定合并场景预期。
- 线上版本的权威内容始终是该发布记录 `after_sha` 下的任务快照，不要求它与归因 commit 的内容相等；比对和恢复引用必须同时保留 `publishRecordId/afterSha`，不能只保存归因 commit。
- 当前线上版本：仅在分支证据为 CONFIRMED 时，于 `last_deployed_sha` 下解析任务最后提交并匹配线上版本记录；无法匹配时显示“当前部署未纳入发布历史”。

### 4.7 存量基线

Flyway 只负责表结构，存量基线由应用层启动任务或首次打开分支历史时按需回填，因为 SQL 迁移无法访问各项目组 Git 仓库：

- 为每个已配置同步的分支新鲜读取 `origin/<branch>`，必要时通过远端 `refs/heads/<branch>` 对账，不使用代表默认分支的 `origin/HEAD`。
- 写入 `record_type = BASELINE`、`before_sha = null`、`after_sha = 该分支 SHA`、`pushed_by = null`、`pushed_at = null`。
- 备注为“版本历史基线”，以 `created_at` 表示补记时间，不伪造推送人和推送时间。
- `sync_status = UNKNOWN`，`last_deployed_sha` 初始为空。
- 必须通过一次满足 §4.4 的同步后才能显示“当前线上”；否则显示“已推送 / 生效状态未知”。

---

## 5. 任务托管文件与历史范围

任务文件集合继续复用 `resolveManagedFiles` 的语义：

```text
flow.yaml
+ 各版本实际引用的脚本文件
+ 各版本实际引用的 *.transfer.json
+ .parameters.json
+ .layout.json
+ .wb-data/kestra-flows/<flowId>.yaml
```

实现约束：

1. 版本列表的 pathspec 不能只取当前 `resolveManagedFiles`，应组成“任务历史路径集合”：任务目录、对应的 `scripts/<任务目录>/`、`transfers/<任务目录名>/`、Kestra 镜像文件及当前托管文件，以覆盖历史中已经删除、当前不再被引用的脚本和 Transfer 文件。
2. 历史查询使用 `git log --full-history --topo-order -- <任务历史路径集合>`，避免默认路径历史简化跳过合并另一侧的任务提交；归因排序与版本内容仍分别遵循 §4.6。
3. 读取某个历史 revision 时，必须从**该 revision 的 flow.yaml**重新推导脚本和 Transfer 文件，不能使用当前工作区的文件清单。
4. 原始文件 diff 使用 base/target 两个快照文件集合的并集；单侧不存在即新增或删除。
5. `.wb-data/kestra-flows` 是编译产物，业务 diff 以解析后的任务文档为主，原始文件 Tab 保留它用于排障。
6. 任务移动/重命名后，V1 接受历史在新路径处中断；在历史末尾显示“此前历史可能位于原路径”，原路径从移动 commit 信息中提取，无法确定时只给通用提示。
7. V2 再评估 `--follow` 或显式路径映射，不在 V1 隐式拼接可能错误的历史。

---

## 6. 后端只读快照

### 6.1 文件读取端口

从 `OfflineFlowDocumentService.readSnapshot` 抽取文件读取能力：

```text
FlowSnapshotSource
  ├─ WorkingTreeFlowSnapshotSource
  └─ GitRevisionFlowSnapshotSource(fullCommitSha)
```

端口职责只包括：

- 判断文件是否存在。
- 读取 UTF-8 文本。
- 获取不可变内容哈希。
- 列出该 revision 的任务托管文件。

Git 实现使用参数化 `git show <sha>:<path>` / `git cat-file`，不得拼接 shell 命令，不得 checkout 历史版本。

`rev` 只接受 `WORKTREE` 或完整 40/64 位十六进制 SHA；禁止接受任意 Git revision 表达式和以 `-` 开头的参数。

### 6.2 快照 DTO

在现有 `OfflineFlowDocument` 同构文档外增加版本元数据和文件清单：

```ts
interface FlowVersionSnapshot {
  revision: 'WORKTREE' | string;
  document: OfflineFlowDocument;
  files: Array<{
    path: string;
    sha256: string;
    size: number;
  }>;
  nodeMetadata: Record<string, {
    referencedParameters: string[];
  }>;
}
```

规则：

- Git revision 的 `documentHash` 由文件内容计算，不使用文件 mtime。
- diff 忽略 `documentUpdatedAt/documentHash` 本身。
- `referencedParameters` 由后端复用参数编译扫描规则生成；前端只做集合 diff，禁止另写一套正则模拟 `SqlNamedParameterScanner`。
- 快照不返回数据源连接信息；节点只保留数据源 ID 和类型。
- 参数绑定保留 `code/boundVersion/definitions` 等快照字段；`currentVersion/status` 等当前状态不得进入不可变快照或 diff。
- 当前数据源名称、参数组名称、上游任务显示名在 API 外层单独解析，并明确标记为“当前名称”，解析结果不写入 Git revision 缓存。

### 6.3 API

均要求 `Permission.OFFLINE_READ`，并校验任务属于当前项目组：

```http
GET /offline/flows/versions?path=&onlineOnly=false&page=1&size=50
GET /offline/flows/snapshot?path=&rev=WORKTREE|<fullSha>
GET /offline/flows/snapshot/file?path=&rev=WORKTREE|<fullSha>&filePath=
```

`versions` 返回：

```ts
interface FlowVersionHistoryItem {
  revision: 'WORKTREE' | string;
  kind: 'DEVELOPMENT' | 'COMMIT';
  message: string | null;
  authorName: string | null;
  committedAt: string | null;
  dirty: boolean;
  publications: Array<{
    publishRecordId: number;
    onlineVersion: number;
    afterSha: string;
    status: 'PENDING' | 'RUNNING' | 'FAILED' | 'UNKNOWN' | 'EFFECTIVE';
    currentOnline: boolean;
  }>;
}
```

`snapshot/file` 的 `filePath` 必须属于该 revision 的托管文件集合；禁止利用 `../` 或绝对路径读取任意仓库/系统文件。大文件按现有编辑器可承受范围设置响应上限，超限返回明确错误，原始 diff 不静默截断。

### 6.4 缓存

- 仅缓存不可变 Git 快照，key 至少包含 `groupId + path + fullSha + snapshotSchemaVersion`。
- 不缓存 `WORKTREE`。
- 当前名称、权限、同步状态不得进入快照缓存。
- 缓存不是正确性的前置条件，V1 可先用有界 Caffeine 缓存；无性能证据不做分布式缓存。

### 6.5 开发版本的一致性

开发版本定义为“已自动保存的工作区”，但打开对比前必须：

1. 将节点编辑器暂存内容合入 working draft。
2. 调用现有 `flushDraftNow`，等待保存成功。
3. 保存成功后重新获取 `WORKTREE` 快照。
4. 保存冲突或失败时停止对比并复用现有错误/冲突 UI，不能拿旧工作区冒充当前编辑内容。

历史面板可以在未 flush 时展示“有未提交修改”，但真正进入对比必须完成上述步骤。

---

## 7. 前端结构化 diff

### 7.1 纯函数边界

新增 `flowVersionDiff.ts`：

```ts
diffFlowVersions(base: FlowVersionSnapshot, target: FlowVersionSnapshot): FlowVersionDiff
```

建议结果模型：

```ts
type DiffKind = 'ADDED' | 'REMOVED' | 'MODIFIED';

interface FlowVersionDiff {
  nodes: NodeVersionDiff[];
  edges: EdgeVersionDiff[];
  schedule: FieldVersionDiff[];
  dependencies: DependencyVersionDiff;
  parameters: ParameterVersionDiff;
  summary: FlowVersionDiffSummary;
}

interface NodeVersionDiff {
  taskId: string;
  kind: DiffKind;
  contentChanged: boolean;
  configChanged: boolean;
  structureChanged: boolean;
  upstreamChanged: boolean;
  referencedParametersAdded: string[];
  referencedParametersRemoved: string[];
}
```

该纯函数不请求 API、不读 React 状态、不格式化当前时间，便于覆盖完整单测。

### 7.2 规范化与忽略规则

业务 diff 默认忽略：

- `layout` 坐标。
- YAML/JSON 键顺序。
- `documentHash/documentUpdatedAt`。
- 参数组 `currentVersion/status` 和当前显示名。
- `transferDraft/transferDraftValid` 等编辑器暂存字段。
- 托管脚本路径本身的纯移动；路径变化仍在原始文件 Tab 显示。

脚本末尾空白与空白字符是否忽略，由“忽略空白”开关控制；默认不忽略。开关只影响脚本和原始文本 diff，不影响结构化字段。

### 7.3 节点与连线

- 节点身份只使用 `taskId`，不按名称、位置或脚本相似度自动配对。
- 同 `taskId`：比较 kind、数据源、脚本内容、Transfer 配置、stage/parallel 等。
- 不同 `taskId`：一边新增、一边删除。
- `contentChanged`：SQL/Shell 脚本或 Transfer 内容变化。
- `configChanged`：节点类型、数据源等配置变化。
- `structureChanged`：stage 并行属性等非单边上游结构变化。
- `upstreamChanged`：入边集合变化；只给边和详情原因，不将节点误判为内容修改。
- V1 不做重命名启发式；V2 若增加“一删一增且脚本相似度 >80%”，也只能提示，不能自动合并身份。

### 7.4 调度

逐字段比较：

- `period`
- `cron`
- `timezone`
- `enabled`
- `runtimeTimezone`

后端基于 cron-utils 和版本时区返回从“查看时刻”开始的下 3 次计划点火时间；界面注明“按当前时间模拟，不是实际执行记录”。禁用调度时优先显示“未启用”，不展示误导性的下一触发列表。

### 7.5 任务依赖

- 上游按 `(groupId, flowId)` 对齐，标新增、删除。
- 比较 `failurePolicy`、`crossGroupDependency`。
- 当前显示名单独解析；上游已删除时显示 `flowId` 和“已不存在”。
- 此处是任务间前置依赖，不与画布内节点连线混为一项。

### 7.6 参数

- 参数组按稳定 `parameterGroupId`，缺失时按 `code` 对齐。
- 比较 `code`、快照 `boundVersion` 和不可变定义快照。
- 定义按 `key` 对齐，比较 `valueSource/constantValue/format/offsetDays/timeBasis`。
- 复用 `flowParameterDiff.ts` 的描述与相等语义，避免升级弹窗和版本对比出现两套解释。
- 根据节点 `referencedParameters` 找出受参数变化影响的节点，支持跳转节点 Tab 并选中。

### 7.7 原始文件

- 文件集合取 base/target 并集。
- 默认只列有差异文件，提供“显示全部”。
- 文本使用 Monaco DiffEditor；JSON 可格式化后 diff，但必须保留“查看原始内容”。
- 二进制或超出大小限制的文件只显示路径、哈希和大小，不伪装成文本 diff。

---

## 8. 界面与交互

### 8.1 版本历史抽屉

入口：

- 画布工具栏“版本”。
- 部署状态徽标 →“查看历史”。

内容：

- 顶部固定开发版本，其后为当前分支提交时间线。
- 每行显示短 SHA、提交说明、作者、提交时间、推送状态、线上版本号和“当前线上”；同一 commit 对应多个发布记录时展示多个徽章。
- 选择某个线上徽章进入查看或对比时，以该发布的 `afterSha` 为快照 revision；选择普通提交行时才使用 commit 自身。
- 支持“只看线上版本”和分页/加载更多。
- 每行支持“查看”“与开发版本对比”。
- 勾选两项后进入“对比所选”。
- 默认快捷对比为“当前线上 → 开发版本”；当前线上未知时禁用并说明原因，可改选最近提交。

“查看”使用同一只读快照页面，不进入可编辑画布。

### 8.2 比对页顶栏

```text
左：旧版本信息  →  右：新版本信息       [忽略空白]
```

- 方向固定旧左新右，V1 不提供“交换”。
- 两个 commit 的先后按 Git 拓扑/祖先关系判断，不按作者时间或可能相同的 commit 时间简单排序。
- 开发版本始终作为较新一侧。
- 非祖先关系按当前分支 `rev-list --topo-order` 的位置排序；仍无法确定时保持用户选择并明确显示“左/右”，不得偷偷反转。

### 8.3 Tab

| Tab | 内容 |
|-----|------|
| 概览 | 各维度变更数、版本信息；点击计数跳转 |
| 节点 | V1 变更清单与详情弹窗；V1.1 双画布 |
| 调度 | 字段对照、Cron 描述、模拟点火时间 |
| 依赖 | 上游集合与策略差异 |
| 参数 | 参数组、定义、受影响节点 |
| 原始文件 | 两个版本托管文件并集的文本 diff |

Tab 显示变更数；无差异时显示“无差异”，仍允许点击查看，不使用无法理解的禁用态。

### 8.4 V1 节点变更清单

- 按“新增、删除、内容变化、配置变化、结构变化、上游变化”分组。
- 每项显示节点名、类型和修改原因。
- 单击打开节点详情 diff；有匹配节点时同时展示两侧元数据。
- 提供“仅显示有差异节点”和按名称/taskId 过滤。
- 大任务先以清单保证可用性，不在 V1 引入双画布性能问题。

### 8.5 节点详情 diff

共同头部：节点名、taskId、类型、修改原因；同 taskId 但 kind 不同，顶部显示类型变化横幅。

| 节点类型 | 头部字段 | 主体 |
|----------|----------|------|
| SQL / MySQL / PostgreSQL / ClickHouse | 数据源 ID、类型、当前名称 | Monaco SQL DiffEditor，支持折叠未变化区域 |
| Hive SQL | 数据源 ID、类型、当前名称 | Monaco SQL DiffEditor |
| Shell | — | Monaco Shell DiffEditor |
| Transfer | 源端/目标端摘要 | 结构化对比，见 §8.6 |

SQL 与 Shell 额外展示 `${xxx}` 引用参数的新增、删除，数据来自快照 `referencedParameters`。

### 8.6 Transfer 结构化 diff

| 分区 | 对比方式 |
|------|----------|
| 源端 | 数据源、库、表字段对照；`where` 内联文本 diff；`preSql/postSql` 按条目 diff |
| 目标端 | 同源端，并比较写入模式 |
| 字段映射 | 按 `target` 对齐，逐单元格比较 `kind/source/expression/value` |
| 分区映射 | 同字段映射 |
| 原始 JSON | 折叠兜底 |

映射默认只显示差异行，提供“显示全部”；新增绿、删除红、修改黄，同时配文字/图标，不仅依赖颜色表达。

### 8.7 V1.1 双画布

- 复用 `@xyflow/react` 和现有节点渲染器，但建立明确的只读适配层，不直接开启完整 `FlowCanvas` 的拖拽、重连、右键编辑等能力。
- 两侧各用各版本 layout，不强行对齐。
- 左侧独有节点红色，右侧独有绿色，双方都有但有业务差异为黄色，无差异节点降低透明度。
- 删除边在左侧红色虚线，新增边在右侧绿色；仅上游变化时节点不变黄。
- 单击节点联动另一侧高亮并居中；双击打开详情。
- 底部变更清单支持两侧定位。
- “同步视口”默认关闭，用户主动开启。
- 大画布只渲染需要展示的节点/差异块，先以真实任务测量再决定是否做虚拟化，不预设复杂优化。

---

## 9. 分步实施与提交边界

每一步独立可验收，按顺序执行；不把全部改动压进一个提交。

### S0：真实部署证据技术验证（已完成，证据见 §13）

**内容**

- 用最小 Kestra 1.3.7 同步 Flow 验证同分支 execution 互斥、首尾远端 SHA 输出、execution 读取和失败分支。
- 明确 `sync_start_sha/sync_end_sha` 的插件实现与输出契约，以及 `targetNamespace` 规范化后的 source 校验方式。
- 检测分支 slug/namespace 碰撞，碰撞分支保持 UNKNOWN。
- 验证连续推送 c9、c10 和两个执行真实交错时，不会把旧版本误判为当前线上，也不会让旧对账结果覆盖新状态。

**完成条件**：能按 §4.4 得出 CONFIRMED 或 UNKNOWN，没有第三种“猜一个 SHA”的路径；同分支同步互斥已实测。

**交付物**：`GitRemoteRevision` 任务、JGit 依赖、2 个本地仓库单测、隔离 Kestra 验证镜像与 execution 证据；未修改正式同步 Flow，未重启现有 Kestra。

### S1-A：同步证据链路（已完成，证据见 §13.5）

- 在 `GitSyncFlowSourceBuilder` 接入 `concurrency + QUEUE`、首尾 `GitRemoteRevision` 和 Flow outputs。
- 扩展 `KestraExecutionSnapshot/KestraPayloadParser` 读取 execution 根对象 outputs，并更新受影响的构造调用与测试。
- 用实际构建器 YAML 在隔离 Kestra 中验证普通同步、连续推送和部分失败。
- 使用进程环境变量中的真实凭据只读验证私有 GitHub 分支 HEAD，不将令牌写入文件或容器。

### S1-B：推送记录、同步对账与当前线上（已完成，证据见 §13.6）

**内容**

- 新增发布记录表和分支部署字段。
- 改造 push/rebuild、事件、pushed_by 上下文传递。
- 实现同步执行对账、`last_deployed_sha` 和存量基线。
- 部署状态徽标接入“当前线上 / 未生效 / 状态未知”。

**验收**：10 次提交、2 次推送可生成正确记录；rebase 后 SHA 正确；同步失败和连续推送状态正确。

### S2：任务版本历史（已完成，证据见 §13.7）

**内容**

- 实现任务托管文件的 Git 历史查询和线上版本区间计算。
- 实现版本历史 API 与右侧抽屉。
- 实现“只看线上版本”、版本选择和只读版本信息。

**验收**：2 次包含任务的推送显示 2 个线上版本；其他任务的推送不新增版本；基线不伪造当前线上。

### S3：只读快照与原始文件 diff（已完成，证据见 §13.8）

**内容**

- 抽取 `FlowSnapshotSource`，实现 WORKTREE/GitRevision。
- 实现 snapshot/file API、权限与路径校验、不可变缓存。
- 对比前 flush 开发版本。
- 实现原始文件并集 diff 和 Monaco 只读对比。

**验收**：旧 commit 的已删除脚本可读；不切换工作树；越权路径和任意 revision 被拒绝；开发版不会读到 flush 前旧内容。

### S4：业务维度 diff 与 V1 节点清单（已完成，证据见 §13.9）

**内容**

- 实现 `flowVersionDiff.ts` 与单测。
- 实现概览、调度、依赖、参数 Tab。
- 实现节点变更清单、SQL/Shell/Transfer 详情 diff。
- 实现参数变化到受影响节点的跳转。

**验收**：分别修改 SQL、cron、依赖、参数、数据源、字段映射、分区映射、前置 SQL，均能在对应位置看到且计数一致。

### S5：V1.1 双画布

**内容**

- 只读双画布、节点/边着色、变更清单定位、双击详情。
- 可选同步视口。

**验收**：新增/删除/修改/仅上游变化视觉正确；缩放、平移、弹窗和滚动经真实浏览器走查。

### S6：V2 候选，另行立项

- 恢复版本到工作区。
- 跨移动路径历史。
- 重命名相似度提示。
- 跨分支/合并版本对比。

---

## 10. 测试方案

### 10.1 后端 L0

重点覆盖：

- push 首次成功、失败后 rebase 成功、rebuild 的 before/after SHA。
- 推送成功但数据库记录失败的对账结果。
- 任务推送区间：单提交、多提交、无任务变化、首次推送、合并提交。
- 同步成功但首尾 SHA 不同、输出缺失、targetNamespace 规范化后 source 不一致。
- execution 创建前失败可保留旧 CONFIRMED；执行开始后失败或部分覆盖必须转为 UNKNOWN。
- 连续推送 c9/c10、一次同步覆盖多个推送、两个 execution 真实交错、旧对账结果晚于新结果返回。
- 分支 slug/namespace 碰撞不得产生 CONFIRMED。
- 存量基线默认为 UNKNOWN，不能自动成为当前线上。
- GitRevisionSource 读取脚本、Transfer、参数、删除文件和不存在 revision。
- API 权限、路径逃逸、非法 SHA、越权 filePath。
- 历史快照不包含当前参数组 `currentVersion/status`。
- Cron 下三次点火的时区、月末、夏令时和禁用状态。

### 10.2 前端 L0

为 `flowVersionDiff.ts` 建立表驱动用例：

- 节点新增、删除、同 ID 修改、同 ID 改类型。
- 内容/配置/结构/上游原因独立，只有入边变化时内容不变。
- layout、hash、时间、当前参数组状态不制造业务 diff。
- 调度、依赖、参数定义的新增/删除/修改。
- SQL/Shell 参数引用增减。
- Transfer 端点、写入模式、pre/post SQL、字段映射和分区映射。
- 原始文件并集、单侧删除、空白开关。
- diff summary 与各 Tab 计数一致。

组件测试覆盖历史选择、只看线上、无差异、状态未知、保存失败阻止对比；不以 jsdom 结果替代真实浏览器验收。

### 10.3 L3 与真实链路

后端改动执行 `mvn clean install`，前端执行 `npm run lint && npm run test && npm run build`。

执行链路改动后运行：

```bash
WB_DATA_PASSWORD=<admin-密码> scripts/dev/smoke-verify.sh --quick
```

并按 `docs/testing-strategy.md` 手动验证 commit → push → Kestra 同步，因为现有脚本不覆盖完整发布链路。

至少保留以下真实环境证据：

1. 连续两次推送后，真实 `deployed_sha` 与 Kestra 内容一致。
2. 同步尚未开始便触发失败时保留上一次确认状态；同步开始后发现部分失败时转为“生效状态未知”，旧版本只显示为最后确认版本。
3. 定时同步补成功后，分支部署状态得到更新。
4. 修改 SQL + 调度 + 参数 + Transfer 后推送，历史与当前线上内容一致。

### 10.4 真实浏览器走查

按测试策略使用 ego-browser，覆盖：

- 历史抽屉滚动、分页、筛选、两项选择。
- 对比前自动 flush、保存冲突、保存失败。
- Tab 切换、Monaco 折叠、长 SQL、几十行 Transfer 映射。
- 节点详情弹窗焦点、Escape、滚动和浮层。
- V1.1 双画布缩放、平移、联动定位、同步视口。

---

## 11. 端到端验收场景

### 场景 A：10 次提交、2 次线上版本

1. 对任务产生 c1…c10。
2. 第一次推送包含至 c4，第二次推送包含至 c9。
3. c10 不推送。

期望：c4 为线上 v1，c9 为线上 v2，c10 为已提交未推送，W 为开发版本；不包含该任务的推送不增加线上版本号。

### 场景 B：连续推送

1. 推送 c9 后立即推送 c10。
2. 第一次同步实际读取到 c10，或首尾 SHA 不一致。

期望：同分支同步执行互斥，旧执行不能覆盖新执行；不把 c9 标成当前线上；只有证据确认的 SHA 可成为当前线上；无法确认时显示状态未知。

### 场景 C：同步失败与恢复

1. c9 推送成功，同步失败。
2. 后续定时同步成功。

期望：若执行尚未开始，当前线上保持上一次确认状态；若同步已开始并可能部分覆盖，分支转为“生效状态未知”，旧版本仅保留为最后确认版本；恢复后由真实证据更新，不回填虚假的 c9 生效历史。

### 场景 D：完整多维 diff

在两个版本间分别修改：

- 一个 Hive SQL 节点脚本和数据源。
- 一个 Shell 节点参数引用。
- 一个 Transfer 的 where、preSql、写入模式和两条映射。
- 调度周期与时区。
- 一个上游依赖和失败策略。
- 一个参数组绑定版本和参数定义。
- 删除一个旧脚本节点。

期望：各 Tab 计数正确，节点清单原因正确，删除文件出现在原始文件 Tab，开发版本与线上版本默认方向正确。

---

## 12. 决策记录

| # | 决策 | 结论 |
|---|------|------|
| D1 | 未配置同步分支的推送是否算线上 | 不算，只标已推送 |
| D2 | 同步失败如何处理 | 保留版本记录并标未生效，当前线上只认真实部署证据 |
| D3 | 节点身份 | `taskId`；V1 不自动配对重命名 |
| D4 | 历史是否按分支隔离 | 是，V1 只跟随当前分支 |
| D5 | 数据源连接变化 | 不对比连接串，只比较 ID/类型；名称为当前名称 |
| D6 | 是否校验 Kestra 实际内容 | 是，作为当前线上证据的一部分，不是可选装饰 |
| D7 | diff 放在哪侧 | 后端还原不可变快照，前端纯函数算结构化 diff |
| D8 | 开发版本是否直接读 WORKTREE | 进入对比前必须 flush 成功，再读 WORKTREE |
| D9 | 是否允许交换左右 | V1 不允许，固定旧左新右 |
| D10 | 原始文件范围 | 两个版本托管文件并集 |
| D11 | 双画布是否进入首个交付 | 不进，V1 清单 + 详情，V1.1 双画布 |
| D12 | 无法确认实际部署时如何显示 | 生效状态未知，不猜测、不回填假证据 |

---

## 13. S0 技术验证记录（2026-11-07）

### 13.1 环境隔离

- 现有实例：`wb-data/kestra:v1.3.7-sql-template`，未重启、未替换镜像、未修改正式 Flow。
- 验证实例：独立镜像 `wb-data/kestra:s0-version-history-probe` 与独立容器 `wb-data-s0-kestra`，使用本地 H2/文件存储。
- 验证仓库：仅使用临时本地 bare 仓库，不向 GitHub 或其他远程服务推送测试数据。
- 初始并发/输出实验使用 namespace `wb-s0-version-history`；实际部署写入隔离 namespace `wb-s0-deployed`。

### 13.2 能力与失败边界

| 验证项 | execution / 证据 | 结果 |
|--------|------------------|------|
| 同 Flow 并发限制 | `suV5IoJfwFXbLBMvjJH7H` RUNNING 时，`64uEuYVQZhMlncVHLjaxGo` 为 QUEUED；前者结束后后者才 RUNNING | `limit=1 + QUEUE` 生效 |
| Shell 输出注意事项 | 上述两个实验 Flow 最终 FAILED | 1.3.7 Shell `Commands` 无 `stdOut`，不能采用该输出契约；不是并发失败 |
| Flow outputs 返回 | `3BN0lISrD1B17e9nS05sJM` | 文件型任务输出经 Flow outputs 渲染成功，execution 根对象存在 `outputs` |
| 自定义 SHA 输出 | `1hh6ueZN6dy9v2c0Q0H0t6` | `GitRemoteRevision` 两次输出 c1 `8c6acef38c4672d006deb2ed019ffbc07742370b` |
| 实际同步链路 | `CvNVxa0BiVNmvd7gQa3iY` | resolve_start → sync_flows → sync_files → resolve_end 全部 SUCCESS，首尾均为 c1 |
| targetNamespace | 查询 `wb-s0-deployed/s0_business?source=true` | Git 中 `source-namespace` 被改为 `wb-s0-deployed`，证实 source 校验必须先规范化 namespace |
| 分支不存在 | `1U8d7AdP2ilKvsnY2xWfGS` | resolve_start FAILED，后续同步任务未执行，Flow outputs 为 null |
| 受控连续推送 | A=`3AgRo06mIYy37S4KOXPQaE`，B=`6ladMe11FtTRzJjxxqXpGL` | A 读取 c1 后等待，远端推进到 c3，B 为 QUEUED；A 最终 start=c1/end=c3，B 最终 start=end=c3 |
| 部分失败 | `7IW9jHscQRwCAFrQv5Sdt0` | sync_flows SUCCESS、sync_files FAILED，无 Flow outputs；实际 Flow 已变为 c4，故旧 CONFIRMED 必须转 UNKNOWN |
| 失败恢复 | `6aDNyX4wuPbMwYY1GP2Xt3` | 恢复后全部 SUCCESS，start=end=c4 `ecf5e73922108ab7dffa2a4ff15c9692ac5f79f5` |

受控连续推送的实际 c3 为 `6e254b4e44ea919683b14cdbaa87e99ae7b3c2a3`；A/B 的 execution 终态虽然都是 SUCCESS，但只有 B 的首尾 SHA 一致，证明不能仅凭 execution SUCCESS 判定部署证据。

### 13.3 静态确认：分支标识碰撞

`GitSyncFlowSourceBuilder.boundedIdentifier` 对未超长的 `feature/a` 与 `feature-a` 都生成相同 slug，因此相同 group 下会共享同步 Flow ID 和目标 namespace。S1 必须先检测该碰撞并使相关分支保持 UNKNOWN；本方案不顺带改变现有 namespace 映射。

### 13.4 验证命令与范围

- `GitRemoteRevisionTest`：2/2 通过，覆盖读取本地分支 HEAD 和拒绝不存在分支。
- `mvn -q -pl wb-data-kestra-plugin -am test`：通过。
- `mvn -q clean install`（`wb-data-server` 全模块）：通过。
- 私有 HTTP 仓库凭据路径在 S1 接入真实项目组时验证；S0 使用本地仓库验证 JGit 读取与 Kestra 输出契约。
- 旧对账结果的条件更新属于 S1 数据库实现，S0 已通过同 Flow QUEUE 证明执行不会并行，但尚未实现数据库对账服务。

### 13.5 S1-A 同步证据链路验证（2026-11-08）

- 实际 `GitSyncFlowSourceBuilder` 产物经 Kestra `/flows/validate` 校验通过；普通同步 execution `5APRCnC4ImYlF3fe9FB7AC` 全部任务 SUCCESS，start=end=c1 `8c4ae07f7c9b1ccbdbcab6a9389abbfc09a002f7`。
- 受控连续推送：A=`6XtKDUBPhQRtQQ1YF32Sx7` 最终 start=c1/end=c2 `badfcbd262b1c3addfbff5e0147dcf11fd588349`，B=`6zw3QDVOkvJr1yWyj3kIpk` 先进入 QUEUED，最终 start=end=c2。
- 部分失败：`5XgSlVIJYkV7ksjBX8Z4Fe` 的 sync_flows SUCCESS、sync_files FAILED，Flow outputs 为 null，实际 Flow 已部署 c3 `47c5a384fde9bef4c4f35085ad44b16a4df550db`，再次证明 FAILED 后不能沿用旧当前线上。
- 私有 HTTP 仓库：使用进程环境变量中的凭据调用同一 `GitRemoteRevision.resolveBranchSha`，只读得到 `dododcdc/wb-data-4` main HEAD `dba3ed8a27a0f5c8d249256c8da2d17c3697cce3`；未把真实令牌写入 YAML、容器或日志。
- `GitSyncFlowSourceBuilderTest`、`KestraHttpClientTest` 及全部受影响执行/运维服务测试通过；`mvn -q clean install`（`wb-data-server` 全模块）通过。
- 验证仅使用隔离容器 `wb-data-s1a-kestra` 和本地临时仓库；未修改正式同步 Flow，未推送私有仓库。

### 13.6 S1-B 推送记录与部署对账验证（2026-11-08）

- `GitCommandServiceTest` 覆盖首次推送、rebase 后 before/after SHA、事件与记录 ID；`OfflinePublishRecordServiceTest` 覆盖操作者、同步意图、基线和终态映射。
- `GitSyncExecutionReconciliationServiceTest` 覆盖首尾 SHA 一致、namespace 规范化 source、输出不一致、已开始失败、较旧证据、标识碰撞和缺失 execution 宽限后 UNKNOWN。
- Flyway V22 已在独立 8081 后端实际执行，新增发布记录表与部署证据字段；存量启用分支写入 2 条 `BASELINE + UNKNOWN`，未伪造当前线上。
- `WB_DATA_BACKEND_BASE_URL=http://127.0.0.1:8081 WB_DATA_PASSWORD=admin123 scripts/dev/smoke-verify.sh --quick` 全部通过。
- 状态 API 返回 `lastDeployedSha/lastDeployedAt/deploymentEvidence`；当前 Kestra 中旧 execution 已缺失，经 2 分钟宽限后 `main` 与 `feature/policy-review` 均为 UNKNOWN，而非永久 CREATED。
- 真实浏览器（ego-browser）已打开独立 5174 页面、登录并进入任务画布，确认工具栏徽标实际渲染；UNKNOWN 状态同时通过 API 与前端纯函数用例验证。
- `mvn -q clean install`（后端全模块）通过；前端 lint、89 个测试文件 712 个用例和生产构建通过。
- S1-B 未把旧 execution 的 SUCCESS 当作当前线上；真实 CONFIRMED 仍需新同步执行满足首尾 SHA 与 source 校验，与 S0/S1-A 的隔离证据链一致。

### 13.7 S2 版本历史验证（2026-11-08）

- `OfflineFlowVersionServiceTest` 使用真实临时 Git 仓库覆盖 10 次任务提交、前两次线上版本、第三次携带任务提交的推送，以及第四次无任务变化推送不新增空版本；同时覆盖开发版本 dirty 和只看线上筛选。
- 真实 API 对 `_flows/crm_sales_daily_analysis/flow.yaml` 返回开发版本、2 个提交和 `线上 v1 · 状态未知`；归因 commit 为 `f76333c`，发布快照 `afterSha=f9822f75`，证明发布身份与归因分离。
- 真实浏览器（ego-browser）已打开版本抽屉，显示分支、开发版本、提交说明、作者、时间、线上版本及 UNKNOWN；右侧布局与滚动正常，筛选交互由组件测试覆盖。
- `WB_DATA_BACKEND_BASE_URL=http://127.0.0.1:8081 WB_DATA_PASSWORD=admin123 scripts/dev/smoke-verify.sh --quick` 全部通过。
- `mvn -q clean install`（后端全模块）通过；前端 lint、90 个测试文件 713 个用例和生产构建通过。
- 查看快照、查看原始文件及任意两版本对比不在 S2 范围，统一由 S3 接入，不在抽屉中放置未完成动作。

### 13.8 S3 只读快照与原始文件 diff 验证（2026-11-08）

- `OfflineFlowSnapshotServiceTest` 使用两次真实保存与提交验证：旧版两个节点、新版删除节点并修改脚本，历史文件不混用当前工作区，参数 `currentVersion/status` 被清理，越权路径和任意 revision 被拒绝。
- 真实 API 对 `2589eab` 与 `f76333c` 均完整返回 Hive SQL、ClickHouse、Transfer 节点及 `.parameters.json`、脚本、Transfer 配置和布局；`snapshot/file` 能读取对应 SQL 原文。
- 历史抽屉支持开发版本、任意两个提交和线上版本选择；含 WORKTREE 时先 `flushDraftNow` 成功再打开对比，保存失败不展示旧快照。
- 真实浏览器（ego-browser）已选择两个提交并打开 Monaco 原始文件对比，确认文件并集、左右内容、SQL/YAML 高亮、滚动与弹窗布局正常。
- `WB_DATA_BACKEND_BASE_URL=http://127.0.0.1:8081 WB_DATA_PASSWORD=admin123 scripts/dev/smoke-verify.sh --quick` 全部通过。
- `mvn -q clean install`（后端全模块）通过；前端 lint、91 个测试文件 714 个用例和生产构建通过。
- 节点、调度、依赖、参数等业务语义 diff 不在 S3 范围，统一由 S4 实现；S3 以原始文件 diff 作为完整兜底。

### 13.9 S4 业务语义 diff 验证（2026-11-08）

- `flowVersionDiff.test.ts` 覆盖稳定 taskId 配对、节点/边新增删除修改、配置与上游原因、调度字段、依赖集合与策略、参数组版本、定义及影响节点；布局变化不计入业务差异。
- `OfflineVersionCompareDialog.test.tsx` 验证原始文件左右内容；`OfflineNodeDiffDialog.test.tsx` 验证 Transfer 源端、目标端、写入模式和字段映射结构化展示，不使用整段 JSON diff 作为主视图。
- 真实浏览器（ego-browser）已验证概览计数、调度 4 个字段、依赖新增、原始文件 Tab；节点无实际变化时清单保持为空，参数影响节点可点击打开详情。
- 前端 lint、93 个测试文件 718 个用例和生产构建通过；后端未新增 S4 代码，沿用 S3 快照与全模块验证结果。
- S4 使用前端纯函数统一汇总计数与各 Tab 展示，SQL/Shell 使用 Monaco，Transfer 按端点和映射结构比较，参数链接到受影响节点详情。

## 14. 完成定义

V1 只有同时满足以下条件才算完成：

- 推送记录、同步终态、真实部署证据均持久化并可解释。
- 任意历史版本的“当前线上”标识都能追溯到 `last_deployed_sha` 和证据状态。
- 版本历史、快照、文件 API 均通过权限与路径安全测试。
- 所有业务 Tab 与原始文件 Tab 的计数、内容和方向一致。
- 开发版本对比前 flush，失败时不展示过期结果。
- 受影响的后端、前端、执行链路和真实浏览器验证全部完成并记录证据。
