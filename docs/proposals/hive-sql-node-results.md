# 方案：Hive SQL 节点结构化结果与下游传值

> 状态：提案（未立项）  
> 范围：离线任务 `HIVE_SQL` 节点；对照 JDBC（MySQL / PostgreSQL / ClickHouse）与 Azkaban「日志 + 结果文件」实践  
> 仓库现状锚点：`OfflineNodeTaskCompiler.HiveSqlTaskAdapter` → Kestra `io.kestra.plugin.scripts.shell.Commands` + `beeline -f`

---

## 1. 背景

离线画布执行后，产品希望：

1. **执行结果面板**能看到节点产出的表数据（不只是日志文本）。
2. **A → B 传值**：下游节点能引用上游节点结果（参数、过滤条件、临时路径等）。

对 MySQL / PostgreSQL / ClickHouse，Kestra 官方 JDBC 插件已有 `fetchType`（`FETCH` / `FETCH_ONE` / `STORE` / `NONE`）与 task `outputs`，缺的是编译侧打开这些选项，以及画布「引用上游输出」的产品封装。

对 **Hive**，当前没有可用的官方 `plugin-jdbc-hive` Query/Queries 任务。现网编译路径是：

```text
HIVE_SQL 节点
  → Shell Commands
  → beeline -u jdbc:hive2://… -n … -p … -f <script.hql>
  → 结果只出现在 stdout / Kestra 日志
```

你提供的 Azkaban + YARN 日志长图表明：业界常见做法是 **stdout 里打印结果表**，同时 **落本地文件并上传 HDFS**（`create local result file` → `upload result to hdfs`）。这证明「从执行侧拿出表结果」可行，但产品主链路应学其 **文件落盘**，而不是学其 **人肉读 YARN UI**。

---

## 2. 目标与非目标

### 2.1 目标（本方案要交付的能力）

| ID | 能力 | 验收口径 |
|----|------|----------|
| G1 | Hive SQL 节点执行后，结果面板可展示**结构化表**（列名 + 行） | 与 JDBC 节点同一套「结果」UI 模型；日志仍可看 |
| G2 | 下游节点可引用上游 Hive 结果 | 至少支持：整表文件 URI；可选：单值 / 首行字段（二期） |
| G3 | 多语句脚本语义明确 | 与 JDBC 侧已达成共识一致：**预览与默认传值取「最后一条 SELECT」** |
| G4 | 不依赖解析 YARN Web UI | 编排层（Kestra outputs）可拿到稳定产物 |
| G5 | 改动可控 | 优先复用现有 Beeline + Shell，不阻塞 JDBC outputs 主线 |

### 2.2 非目标（本方案不做或后置）

- 不做「爬取 YARN Application / containerlogs HTML」作为产品接口。
- 不在 V1 实现完整 Azkaban 式 HDFS `job_output` 权限体系（可留扩展点）。
- 不在 V1 自研完整 Hive JDBC Kestra Query/Queries 插件（可作为 V2 替换实现，接口对齐）。
- 不保证超大结果集进 UI（必须有行数 / 字节上限与截断策略）。
- Shell / 传输节点结构化结果不在本方案范围（可复用「文件 → output」模式，另案）。

---

## 3. 现状摘要

### 3.1 编译

`HiveSqlTaskAdapter`：

- `type`: `io.kestra.plugin.scripts.shell.Commands`（常量 `SHELL_COMMANDS_TASK_TYPE`）
- `namespaceFiles`: 挂载节点脚本
- `commands`: 单条 `beeline … -f '<scriptPath>'`
- 显式 `clearJdbcTaskFields`（含去掉 `fetchType` / `store` 等）

### 3.2 元数据与连接

- 数据源插件 `wb-data-plugin-hive` 已能通过 HiveServer2 JDBC 做测连 / 库表字段（管理面）。
- 执行面故意走 Beeline，以支持多语句脚本、与集群侧 `beeline` 行为一致。

### 3.3 执行 UI

- 已有「执行结果」对话框与运维向日志查看。
- 结构化表结果：**仅规划给 JDBC SQL 节点**；Hive 目前日志-only（既有共识）。

### 3.4 A → B

- Kestra 原生：`{{ outputs.<taskId>.xxx }}`。
- JDBC：`FETCH` → `rows`，`FETCH_ONE` → `row`，`STORE` → `uri`。
- 产品缺口：编译默认 `NONE`、画布引用交互未接线。Hive 还需**先有可引用的 output 约定**。

---

## 4. 方案对比

| 方案 | 做法 | 优点 | 缺点 | 建议 |
|------|------|------|------|------|
| **A. 解析日志 / YARN stdout** | 正则抠 ASCII 表或调 RM/NM API 拉日志 | 与现网「日志里看得见」一致；几乎不改编译 | 格式脆、截断、编码、多段日志难对齐；不适合 A→B；运维耦合 YARN | **否决作主链路**；仅作排障 |
| **B. Beeline 落盘 + Kestra `outputFiles`（推荐）** | Beeline 输出 TSV/CSV → 工作目录约定文件 → Shell `outputFiles` 暴露 URI | 与 Azkaban「结果文件」同构；改动中等；不依赖 YARN UI；可与 JDBC `STORE` 的「uri」模型对齐 | Beeline 输出格式需钉死；超大结果要截断；多语句要拆或约定 | **V1 推荐** |
| **C. 落盘后再 `hdfs dfs -put`** | 在 B 之上增加 HDFS 路径 | 贴近你图里的 Azkaban；跨作业共享方便 | 依赖 HDFS 客户端与权限；路径规范、清理策略更重；本地/Demo 环境不一定有 | **可选增强（V1.1）**，output 同时给 `localUri` + `hdfsUri` |
| **D. 自研 Kestra Hive JDBC Query/Queries** | 类似现有 MySQL 插件，`fetchType`/`STORE` | 与 JDBC 节点完全同构；类型更干净 | 工作量大；多语句 / Hive 驱动 quirks；与「Beeline 脚本」用户习惯可能分叉 | **V2 替换实现**，对外 output 契约与 B 对齐 |
| **E. 只展示日志，不做结构化** | 维持现状 | 零成本 | 不满足 G1/G2 | 仅当明确砍需求 |

**结论**：V1 用 **方案 B**；接口预留与 JDBC `STORE` 类似的 `uri`；方案 C 作开关；方案 D 作长期替换且不改产品契约。

---

## 5. 推荐方案（V1）详细设计

### 5.1 一句话

> Hive SQL 节点仍编译为 Shell + Beeline，但执行时把**最后一条 SELECT** 的结果以**约定分隔格式**写入工作目录文件，并通过 Kestra `outputFiles`（及必要的 `outputs` 映射）交给 WB-Data；结果面板读该文件做表预览，下游用 URI / 解析后的字段引用。

### 5.2 逻辑流程

```text
用户执行任务
  → 后端编译 HIVE_SQL → Kestra Shell Commands
  → 容器/宿主执行：
       1) 准备脚本（原 .hql）
       2) beeline 跑脚本（日志仍进 stdout/stderr）
       3) 另一次（或同脚本尾部约定）把「结果查询」导出到 result.tsv
       4) 声明 outputFiles: [result.tsv]
  → Kestra execution outputs.<taskId> 含文件 URI
  → WB-Data 拉 execution task outputs
       → 结果面板：解析 TSV → { columns, rows }（带上限）
       → 下游编译：把 {{ node.xxx.uri }} 等写入 B 的 SQL/脚本模板
```

### 5.3 编译侧改动（`HiveSqlTaskAdapter`）

当前：

```text
commands: [ "beeline -u … -f 'scripts/hive_1.hql'" ]
```

目标示意（逻辑，非最终 YAML 字面量）：

```yaml
id: hive_1
type: io.kestra.plugin.scripts.shell.Commands
namespaceFiles:
  enabled: true
  include:
    - scripts/hive_1.hql
outputFiles:
  - wb-result/result.tsv
  - wb-result/meta.json   # 可选：列类型、截断标记、语句摘要
commands:
  - |
    set -euo pipefail
    mkdir -p wb-result
    # 1) 执行用户完整脚本（副作用 / DDL / 中间 SELECT 仅打日志）
    beeline -u 'jdbc:hive2://…' -n '…' -p '…' \
      --silent=true --showHeader=false --outputformat=tsv2 \
      -f 'scripts/hive_1.hql' \
      > wb-result/full.stdout 2> wb-result/full.stderr || { cat wb-result/full.stderr >&2; exit 1; }

    # 2) 导出「最后一条 SELECT」——见 §5.5
    # 由后端在编译期抽出 lastSelect.sql 写入 namespaceFiles
    beeline -u 'jdbc:hive2://…' -n '…' -p '…' \
      --silent=true --showHeader=true --outputformat=tsv2 \
      -f 'scripts/hive_1.last_select.hql' \
      > wb-result/result.tsv 2>> wb-result/full.stderr

    # 3) 写 meta（行数、是否截断等）可由小型 shell/awk 或后端侧事后统计
    wc -l < wb-result/result.tsv > wb-result/linecount.txt || true
```

要点：

1. **用户脚本仍完整执行一遍**（保证 INSERT/OVERWRITE 等副作用发生）。
2. **结构化结果单独再跑「最后一条 SELECT」**（或编译期改写脚本，见备选），避免从混杂 stdout 解析。
3. `outputFiles` 让 Kestra 把 `wb-result/result.tsv` 收进 execution outputs。
4. Beeline 输出格式钉死：`tsv2` + `showHeader=true`（结果文件）；完整执行可用 `tsv2` 或默认，但**不以 full.stdout 作解析源**。

#### 备选编译策略（需你拍板）

| 策略 | 说明 | 取舍 |
|------|------|------|
| **B1. 双次执行（上文）** | 全脚本一次 + last SELECT 一次 | 实现简单；有副作用的 SELECT 会跑两次；纯查询成本 ×2 |
| **B2. 单次执行 + 脚本改写** | 编译期把最后 SELECT 改为 `INSERT OVERWRITE LOCAL DIRECTORY …` 或 `… > file` | 只跑一次；Hive 版本/`LOCAL DIRECTORY` 权限差异大 |
| **B3. 单次执行 + 仅依赖 Beeline 对最后查询的 stdout** | 仍要解析 stdout | 回到脆路径，不推荐 |

**默认建议 B1**；若集群上 last SELECT 很重，再评估 B2。

### 5.4 结果文件格式（契约）

**`wb-result/result.tsv`（V1 强制）**

- 编码：UTF-8
- 分隔：Tab（Beeline `tsv2`）
- 首行：列名
- 其后：数据行
- 空结果：仅表头，或仅空文件 + `meta.json` 标明 `rowCount=0`

**`wb-result/meta.json`（V1 建议，可二期）**

```json
{
  "format": "tsv2",
  "source": "hive_beeline",
  "statement": "SELECT …",
  "rowCount": 12,
  "columnCount": 2,
  "truncated": false,
  "maxRows": 10000,
  "maxBytes": 10485760
}
```

**截断策略（必须）**

| 限制 | 建议默认 | 行为 |
|------|----------|------|
| 最大行数 | 10_000（可配置） | 超过则只保留前 N 行，`truncated=true`；日志告警 |
| 最大字节 | 10 MiB | 同上 |
| UI 预览行数 | 200～1000 | 面板只渲染子集，全量仍以文件 URI 为准 |

A → B 传「整表」时传 **URI**，不要把 10k 行内联进下游 SQL 字符串。

### 5.5 多语句规则

与 JDBC 侧共识对齐：

1. 脚本可含多条语句（`;` 分隔；注意字符串内分号——V1 可用简单分割 + 已知限制说明）。
2. **结构化结果 / 默认 output** = **最后一条只读 SELECT**（`SELECT` / `WITH … SELECT`）。
3. 若最后一条不是 SELECT（纯 DDL/DML）：
   - `result.tsv` 为空或缺失；
   - `meta.json`：`rowCount=0`, `statementKind=NON_QUERY`；
   - UI 显示「无表结果」+ 成功日志；
   - 下游若引用 `.rows` / `.uri` 应在编译期或运行期给出明确错误。
4. 中间 SELECT 只进日志，不进结构化结果（避免歧义）。

### 5.6 Kestra outputs 与 WB-Data 统一模型

为让 Hive 与 JDBC 在产品层同构，建议统一「节点结果」视图模型（后端 DTO）：

```text
NodeExecutionResult
  kind: TABLE | FILE | NONE | ERROR
  columns?: string[]
  rows?: any[][]          # 仅预览切片
  uri?: string            # Kestra storage / 内部可下载地址
  meta?: { truncated, rowCount, statement, … }
  logRef?: …              # 仍链到原有日志
```

映射：

| 节点类型 | kind | 来源 |
|----------|------|------|
| JDBC + FETCH | TABLE | outputs.rows（预览截断） |
| JDBC + STORE | FILE → 可再物化为 TABLE 预览 | outputs.uri |
| Hive V1 | FILE + 解析为 TABLE 预览 | outputFiles → uri → 读 TSV |
| DDL-only | NONE | — |

### 5.7 后端取回结果（执行详情 API）

在现有 Offline execution 详情上扩展（示意）：

1. 调 Kestra：拿到 task run outputs（含 `outputFiles` 映射后的 URI）。
2. 若存在 `result.tsv`：
   - 流式下载（限 `maxBytes`）；
   - 解析 TSV → `columns` + `rows`（限 `maxRows` / UI 更小窗口）。
3. 权限：与执行记录同一项目组鉴权；URI 不直接把 Kestra 内网地址暴露给浏览器，由 WB-Data 代理下载。

### 5.8 A → B 传值（产品语义）

**V1 最小集**

| 引用 | 含义 | 编译到下游 |
|------|------|------------|
| `{{ nodes.<id>.result.uri }}` | 结果文件 | 字符串路径 / 由下游自行 `LOAD`（少见） |
| `{{ nodes.<id>.result.rowCount }}` | 行数 | 数字文本 |

**V1.1 / V2**

| 引用 | 含义 |
|------|------|
| `{{ nodes.<id>.result.first.col_name }}` | 首行某列（需列名校验） |
| `{{ nodes.<id>.result.rows }}` | 仅小结果允许内联；超限编译失败 |

画布交互：在 B 的 SQL 编辑器插入「上游输出」时，只列出**已连线上游**且 `kind≠NONE` 的字段。

Hive V1 更务实的 A→B 模式往往是：

- A：Hive 查询写出 **Hive 表 / 临时表**（用户 SQL 自己 `CREATE TABLE AS`）；
- 结构化 `result.tsv` 主要用于**预览与小结果传参**；
- 大结果下游继续用表名，而不是文件。

方案需在文档与 UI 文案中写清：**预览文件 ≠ 数仓事实表**。

### 5.9 与 Azkaban 图的对应关系

| Azkaban（你的图） | 本方案 V1 |
|-------------------|-----------|
| stdout 打印 ASCII 表 | 保留在 Beeline/Kestra 日志，**不解析** |
| `create local result file` | `wb-result/result.tsv` |
| `upload result to hdfs` | 可选 V1.1：配置开关 `hiveResult.hdfsUpload` |
| YARN 日志页人工查看 | 运维排障通道；产品走 execution API |

---

## 6. 环境与运行约束

Hive Beeline 必须在 **Kestra 执行该 Shell 任务的环境**里可用：

| 环境 | 说明 |
|------|------|
| Demo / 本机 Compose Hive | 需确认 Shell 任务跑在哪：Kestra 宿主、还是带 beeline 的镜像；与当前 transfer Docker runner 策略对齐 |
| 客户 Yarn 集群 | 通常用「含 Hive 客户端的镜像」或宿主已装 beeline；密码出现在 process list 的问题与现状相同，后续可改 credential file |

V1 实现前要先钉死：**当前 Grok Bot / 本地 demo 的 Hive 节点究竟在哪个 runtime 里调 beeline**（与 `buildBeelineCommand` 现状一致即可，但加 `outputFiles` 后工作目录必须可写）。

---

## 7. 分阶段落地

### Phase 0 — 决策（本文）

拍板：B1 vs B2、是否要 HDFS 上传、截断默认值、是否与 JDBC outputs 同一迭代。

### Phase 1 — Hive 预览闭环（约中等）

1. 编译：`outputFiles` + last SELECT 导出 TSV + meta。
2. 执行详情 API：解析 TSV → 结构化 DTO。
3. 前端执行结果：Hive 节点与 JDBC 共用表组件。
4. 单测：编译快照、TSV 解析、多语句抽取、截断。
5. 集成：本地 Hive Compose 跑一条两列 SELECT。

### Phase 2 — A → B 最小引用

1. 画布插入 `result.uri` / `rowCount`。
2. 编译期解析引用并写入下游任务。
3. 文档：大结果应落 Hive 表的最佳实践。

### Phase 3 — JDBC outputs 对齐（可与 Phase 1 并行）

1. MySQL/PG/CH 编译打开 `FETCH`/`STORE`。
2. 同一 `NodeExecutionResult` 模型。

### Phase 4 — 可选增强

1. HDFS upload（Azkaban 对齐）。
2. 自研 Hive JDBC Kestra 插件，替换 Beeline 导出实现，**保留同一 output 契约**。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Beeline `tsv2` 在不同 Hive 版本差异 | 版本矩阵冒烟；meta 记录 beeline 版本；解析容忍 |
| 双次执行副作用 / 成本 | 文档说明；纯 DML 脚本不导出；后续 B2 |
| 密码进命令行 | 现状已有；后续 `--password-file` / 环境变量 |
| 超大结果拖垮 API | 强制 maxRows/maxBytes；预览与下载分离 |
| 简单分号切分 SQL 误伤 | V1 文档限制；二期用 SQL 解析器 |
| Demo 环境无 beeline | Phase 1 前先验证 runtime；必要时专用镜像 |

---

## 9. 测试计划（摘要）

1. **单元**：last SELECT 抽取；非 SELECT 结尾；空结果；截断；TSV 解析含 Tab/换行转义（按 Beeline 实际）。
2. **编译快照**：`HiveSqlTaskAdapter` 生成 commands / outputFiles 稳定。
3. **集成**：HiveServer2 上执行 `SELECT 'a' AS x, 'b' AS y` → API 返回两列一行；执行失败时无脏成功结果。
4. **回归**：现有 `OfflineNodeTaskCompilerTest` 中 Hive beeline 命令用例更新。

---

## 10. 待你拍板的决策清单

请按项选择（可直接回复编号）：

1. **V1 是否采用方案 B（Beeline 落盘 + outputFiles）？**  
   - 是 / 否（若否，倾向 D 自研 JDBC 还是维持日志-only）

2. **导出策略：B1 双次执行 vs B2 单次改写？**  
   - 默认提案：**B1**

3. **V1 是否包含 HDFS 上传（方案 C）？**  
   - 提案：**不做**，仅本地/Kestra storage URI；需要时 V1.1

4. **结构化结果是否与 JDBC outputs 同一迭代做？**  
   - 提案：Hive Phase 1 可先做；JDBC `fetchType` 并行或紧随，统一 DTO

5. **截断默认：maxRows=10000、预览=500、maxBytes=10MiB 是否可接受？**

6. **A→B V1 是否只做 `uri` + `rowCount`，首行字段放到 V1.1？**  
   - 提案：**是**

7. **大结果官方建议：是否在 UI 提示「超过 N 行请 CTAS 落表，而不是依赖结果文件」？**  
   - 提案：**是**

---

## 11. 建议决策（产品一句话）

> **可以**用你图里那种「执行侧产出结果文件」的方式拿 Hive 结果；WB-Data V1 应实现为 **Beeline → 约定 TSV → Kestra outputFiles → 执行 API 解析预览**，并把 A→B 建立在 **URI（及小元数据）** 上。  
> **不要**把 YARN 日志页当结果接口。自研 Hive JDBC 插件作为 V2 替换引擎，对外契约保持不变。

---

## 12. 文档与代码落点（立项后）

| 项 | 位置 |
|----|------|
| 本提案 | `docs/proposals/hive-sql-node-results.md` |
| 编译 | `OfflineNodeTaskCompiler.HiveSqlTaskAdapter` |
| 执行聚合 | `OfflineExecutionService` / Kestra client |
| 前端结果面板 | `OfflineExecutionDialog` 及节点结果组件 |
| 测试 | `OfflineNodeTaskCompilerTest` + 新建 TSV/抽取单测 + Hive 集成冒烟 |

---

*写完后不自动开工；等你按 §10 拍板后再拆任务实现。*
