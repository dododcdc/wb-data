# Kestra 参数能力研究：参数组阶段 0

> 状态：Kestra 1.3.7 核心链路已实测并固定；扩展矩阵和 1.3.30 升级验证待完成
>
> 核对日期：2026-08-15
>
> 范围：Kestra Flow inputs、执行 API、Schedule、时间表达式、JDBC 命名参数和版本固定

## 1. 结论摘要

参数组 V1 可以继续采用“WB-Data 参数快照 → Kestra Flow inputs → JDBC `parameters`”的总体方向，但业务实现前必须先完成本地兼容性实测。

已经能由官方资料确认的能力：

- Flow 可以声明 inputs；输入会在创建执行时校验，并可通过 `{{ inputs.key }}` 访问。
- 手动创建执行可以用 `multipart/form-data` 提交输入。
- Schedule trigger 有 `inputs` 属性，并提供 `trigger.date`；执行上下文提供 `execution.startDate`。
- `date` 支持格式和目标时区，`dateAdd` 支持正负时间偏移。
- JDBC Query 的 `parameters` 是命名参数映射；当前官方插件源码把 `:name` 改写为 `?`，再通过 `PreparedStatement.setObject` 绑定值。
- Kestra 官方提供不可变的精确 Docker 版本标签，并明确说明 `latest` 是滚动标签。

尚不能只凭文档确定的关键点：

- 官方 inputs 文档警告动态 Pebble 默认值不能同时保证强类型；v1.3.30 源码又显示默认值渲染后会按类型解析和校验。必须对选定镜像实测，不能从源码推断生产行为。
- Schedule 确实支持 `inputs`，源码也会渲染该 map，但官方资料没有明确保证 `Schedule.inputs` 渲染时一定可访问本次的 `trigger.date`。
- JDBC 参数最终类型由 Pebble 渲染后的 Java 对象、Kestra 插件和 JDBC 驱动共同决定；尤其 `DECIMAL` 精度、DATE/DATETIME 和 null 必须连接真实 MySQL 验证。
- 当前 JDBC 命名参数解析是正则匹配，不是 SQL 语法解析器。字符串字面量、注释和方言冒号语法存在误识别风险。

因此，阶段 0 的架构决策不能只凭“Flow 能跑一次”。当前核心矩阵已经足够确定参数组 CRUD 与快照模型；进入 Flow 编译和执行实现前，还应完成本文第 9 节中与对应类型、时间边界和 SQL 方言相关的用例。

## 2. 证据分级

本文使用以下标记：

- **官方事实**：Kestra 官方文档、官方仓库源码或官方 blueprint 直接陈述或实现的行为。
- **设计推断**：基于官方事实对 WB-Data 的建议，不代表 Kestra 的兼容性承诺。
- **本地待验证**：官方资料不足、文档与源码存在口径差异，或行为依赖具体版本和驱动。

## 3. Flow inputs

### 3.1 类型、默认值和执行上下文

**官方事实**

Kestra Flow inputs 是执行时输入。输入在创建执行时进行类型和约束校验；缺少必填值且没有默认值时，执行不会创建。输入保存在执行上下文中，通过 `{{ inputs.key }}` 使用，也可在执行页面查看。

官方文档列出的类型包括 STRING、INT、FLOAT、BOOL/BOOLEAN、DATETIME、DATE、TIME、DURATION、FILE、JSON、YAML、URI、SECRET、ARRAY、SELECT 和 MULTISELECT 等。类型集合随版本演进；例如官方 0.23 迁移文档将 `BOOLEAN` 标记为向 `BOOL` 迁移，而 v1.3.30 源码仍兼容两者。

来源：

- [Workflow inputs 官方文档](https://kestra.io/docs/workflow-components/inputs)
- [Kestra 0.23 BOOLEAN → BOOL 迁移说明](https://kestra.io/docs/migration-guide/v0.23.0)
- [v1.3.30 输入类型枚举源码](https://github.com/kestra-io/kestra/blob/v1.3.30/core/src/main/java/io/kestra/core/models/flows/Type.java)
- [v1.3.30 Execution 保存 inputs 的源码](https://github.com/kestra-io/kestra/blob/v1.3.30/core/src/main/java/io/kestra/core/models/executions/Execution.java#L84-L88)

**设计推断**

WB-Data V1 的直接映射可先限定为：

| WB-Data 类型 | Kestra input | 备注 |
| --- | --- | --- |
| STRING | STRING | 常量字符串不保存 SQL 引号 |
| INTEGER | INT | 必须验证范围和 multipart 文本转换 |
| BOOLEAN | BOOL | 避免继续生成已弃用的 BOOLEAN |
| DATE | DATE | 使用 ISO `yyyy-MM-dd` 作为类型值 |
| DATETIME | DATETIME | 使用带 UTC/offset 的 ISO 8601 |
| DECIMAL | 暂不直接定案 | Kestra FLOAT 不能等同于任意精度十进制 |

`DECIMAL` 不应未经验证直接映射为 FLOAT。若业务要求金额精度，应先验证 `BigDecimal` 是否能从 input 一直保持到 MySQL `PreparedStatement`；不能保证时，应缩小 V1 类型范围。

### 3.2 动态 defaults

**官方事实**

官方文档给出了动态默认值示例：

```yaml
inputs:
  - id: date
    type: DATETIME
    defaults: "{{ now() }}"
```

但同一节明确警告：当前不能在动态渲染 Pebble 表达式的同时强制保证强类型。

另一方面，v1.3.30 的 `FlowInputOutput` 源码会先解析 `defaults`，再按 input 类型转换并执行校验。官方 blueprint 也存在以下正式示例：

```yaml
inputs:
  - id: load_date
    type: STRING
    defaults: "{{ (trigger.date ?? execution.startDate) | date('yyyy-MM-dd') }}"
```

该 blueprint 随后把 `inputs.load_date` 放入 JDBC `parameters`，SQL 使用 `:loadDate`。

来源：

- [Workflow inputs 的 Dynamic inputs 章节](https://kestra.io/docs/workflow-components/inputs#dynamic-inputs)
- [v1.3.30 默认值解析源码](https://github.com/kestra-io/kestra/blob/v1.3.30/core/src/main/java/io/kestra/core/runners/FlowInputOutput.java#L340-L410)
- [官方 SAP HANA 定时查询 blueprint](https://github.com/kestra-io/blueprints/blob/main/flows/sap-hana-query-to-s3.yaml)

**本地待验证**

- STRING 动态默认值是否总是以最终字符串保存在 `execution.inputs`。
- INT、BOOL、DATE、DATETIME 使用动态默认值时是否仍按声明类型校验。
- 无 trigger 的手动执行中，`trigger.date ?? execution.startDate` 是否稳定回退。
- multipart 显式值是否总是优先于 defaults。
- 重跑、回放和 backfill 时 defaults 是否重新渲染，还是复用原 inputs。

在这些测试通过前，动态 defaults 只能作为候选实现，不能视为已经确认的契约。

## 4. multipart 创建执行

**官方事实**

创建执行的 HTTP 入口为：

```text
POST /api/v1/{tenant}/executions/{namespace}/{flowId}
```

普通 input 以 input ID 作为 multipart 字段名提交：

```bash
curl -X POST \
  http://localhost:8080/api/v1/main/executions/company.team/example \
  -F xxx="小明" \
  -F v_day="20260815"
```

Kestra 会在执行创建时校验声明的 inputs；不同类型的普通值也通过 multipart 字段传递。FILE input 有单独的文件 part 约定，本次 V1 不需要支持。

来源：

- [Executions 官方文档：Execute a flow with inputs](https://kestra.io/docs/workflow-components/execution#execute-a-flow-with-inputs)
- [Workflow inputs 官方文档：API submission](https://kestra.io/docs/workflow-components/inputs#set-input-values-at-flow-execution)

**设计推断**

WB-Data 的 `KestraClient.createExecution` 应接受显式 input map，并生成 multipart 请求。值为空时应区分“未提交，使用 default”和“显式 null”；V1 可以禁止显式 null，从而避免跨类型歧义。

**本地待验证**

- 各基础类型的 multipart 文本如何转成 `execution.inputs` 中的 JSON 类型。
- 缺少必填输入、无效值和未知字段对应的 HTTP 状态码及错误体。
- 中文、引号、换行和特殊字符的编码。
- 创建执行响应及随后查询执行详情时，是否都能读到最终解析值。

## 5. Schedule、`trigger.date` 和 `execution.startDate`

**官方事实**

Schedule trigger 提供：

- `inputs`：传给定时 Flow 的输入 map。
- `trigger.date`：当前计划调度时间。
- `trigger.previous` / `trigger.next`：前后计划时间。
- `timezone`：计算 cron 的时区。

执行上下文始终提供 `execution.startDate`；`trigger.*` 只在由相应 trigger 启动时存在。官方源码显示 Schedule 的 inputs 会经过渲染后交给 Flow input 解析器，显式 trigger input 会与 Flow defaults 一起解析。

来源：

- [Schedule trigger 官方插件文档](https://kestra.io/plugins/core/trigger/io.kestra.plugin.core.trigger.schedule)
- [Expression context 官方文档](https://kestra.io/docs/expressions/context)
- [v1.3.30 Schedule 源码](https://github.com/kestra-io/kestra/blob/v1.3.30/core/src/main/java/io/kestra/plugin/core/trigger/Schedule.java)
- [v1.3.30 SchedulableExecutionFactory 源码](https://github.com/kestra-io/kestra/blob/v1.3.30/core/src/main/java/io/kestra/plugin/core/trigger/SchedulableExecutionFactory.java#L60-L87)

**设计推断**

参数 `v_day` 的语义应是“调度执行取计划时间，手动执行取执行开始时间”。候选 YAML 有两种：

1. Flow input 的动态 default 使用 `trigger.date ?? execution.startDate`。
2. Flow input default 使用 `execution.startDate`，Schedule `inputs` 显式传入由 `trigger.date` 计算的值。

第一种有官方 blueprint 例证，结构更简单；第二种与 WB-Data 当前设计文档一致，但 `Schedule.inputs` 渲染 `trigger.date` 的时点需要实测。阶段 0 应同时跑通两种方式，再选择行为最稳定且最终 inputs 可追溯的一种。

**本地待验证**

- `Schedule.inputs.v_day: "{{ trigger.date ... }}"` 是否能访问本次 trigger 上下文。
- 延迟执行、missed schedule 恢复和 backfill 时，`trigger.date` 是否保持原计划时间。
- 计划时间与 `execution.startDate` 存在延迟时，两者是否确实不同。
- Schedule 显式 inputs、Flow defaults 和手动 multipart 的优先级。
- 未设置 timezone 时的实际默认时区。WB-Data 无论结果如何都应显式生成 timezone。

## 6. 日期格式、偏移与时区

**官方事实**

`date` 过滤器支持 `format`、`existingFormat`、`timeZone` 和 `locale`。固定版本 Kestra v1.3.7 的 `dateAdd` 还接受 `format`、`timeZone`、`existingFormat` 和 `locale`，内部先按目标 `ZoneId` 构造 `ZonedDateTime`，再调用 `plus(amount, unit)`。

```text
{{ trigger.date | timestampMilli | dateAdd(-1, 'DAYS', format='yyyyMMdd', timeZone='Asia/Shanghai') }}
```

来源：[Date and Time Filters 官方文档](https://kestra.io/docs/expressions/filters/dates)、[v1.3.7 DateAddFilter 源码](https://github.com/kestra-io/kestra/blob/v1.3.7/core/src/main/java/io/kestra/core/runners/pebble/filters/DateAddFilter.java)、[v1.3.7 AbstractDate 源码](https://github.com/kestra-io/kestra/blob/v1.3.7/core/src/main/java/io/kestra/core/runners/pebble/AbstractDate.java)

**设计推断**

WB-Data 应始终生成显式 IANA timezone，禁止依赖 Kestra 容器或宿主机默认时区。有日偏移时先用 `timestampMilli` 把输入统一为绝对时间点，再由 `dateAdd(..., timeZone=Flow时区)` 在 Flow 时区中执行日历日偏移并直接格式化；这与后端 `atZone(...).plusDays(...)` 的语义一致。

**本地待验证**

- `yyyyMMdd`、ISO DATE、ISO DATETIME 的实际结果类型。
- 固定 Kestra 容器中具有夏令时的时区边界结果。
- 月末、年末、闰日、夏令时切换和负偏移。

## 7. MySQL JDBC Query 命名参数

### 7.1 官方接口和实现

**官方事实**

MySQL Query 继承通用 JDBC Query。官方插件接口将 `parameters` 定义为 `Map<String, Object>`，key 对应 SQL 中的 `:parameterName`。

当前官方 plugin-jdbc v1.15.5 源码的实现步骤是：

1. 渲染 `parameters` map。
2. 使用正则 `:\w+` 按 SQL 出现顺序查找命名参数。
3. 将匹配内容替换成 `?`。
4. 创建 `PreparedStatement`。
5. 使用 `PreparedStatement.setObject(index, value)` 绑定渲染后的 Java 对象。

来源：

- [MySQL Query 官方插件文档](https://kestra.io/plugins/plugin-jdbc-mysql/io.kestra.plugin.jdbc.mysql.query)
- [plugin-jdbc v1.15.5 参数接口源码](https://github.com/kestra-io/plugin-jdbc/blob/v1.15.5/plugin-jdbc/src/main/java/io/kestra/plugin/jdbc/JdbcQueryInterface.java#L67-L72)
- [plugin-jdbc v1.15.5 参数解析与绑定源码](https://github.com/kestra-io/plugin-jdbc/blob/v1.15.5/plugin-jdbc/src/main/java/io/kestra/plugin/jdbc/AbstractJdbcBaseQuery.java#L258-L289)
- [plugin-jdbc v1.15.5 官方发布](https://github.com/kestra-io/plugin-jdbc/releases/tag/v1.15.5)

### 7.2 对 WB-Data 的含义

**设计推断**

- SQL 值使用 `:xxx` + `parameters.xxx`，不要使用 `${xxx}` 或 Pebble 直接拼接值。
- 参数只能绑定“值”，不能绑定表名、列名或 SQL 片段。
- 字符串常量保存为 `小明`，不能保存为 `'小明'`；引号由 PreparedStatement 语义处理。
- 同一个名称重复出现会生成多个 `?`，并重复绑定同一 map 值。
- `parameters` 完全不存在和 `parameters: {}` 可能产生不同执行路径；无参数 SQL 应省略该属性。

**源码揭示的风险，不属于稳定 API 承诺**

该实现是正则扫描，不理解 SQL 字符串、注释或方言语法。因此类似内容可能被当成参数：

```sql
SELECT ':not_a_parameter';
-- comment :also_not_a_parameter
```

共享 JDBC 实现还可能碰到 PostgreSQL `::type` 语法。缺失的 map key 会被 `Map.get` 解析为 null，额外 map key 看起来会被忽略；这些都不能作为 WB-Data 的校验规则依赖。

**本地待验证**

- STRING、INT、BOOL、DATE、DATETIME，以及金额场景的十进制精度。
- 中文、单引号和疑似 SQL 注入字符串是否始终作为值绑定。
- 重复参数、缺失参数、额外参数和 null。
- 空 `parameters` map。
- 字符串字面量、行/块注释中的冒号。
- WB-Data 当前 Kestra 镜像内实际安装的 plugin-jdbc 版本，是否与 v1.15.5 源码一致。

## 8. 版本固定建议

**官方事实**

Kestra 官方 Docker 文档将标签分为：

- `latest`：滚动到最新稳定版本，适合尝试新功能，不是 LTS。
- `latest-lts`：滚动到当前 LTS 线。
- `vX.Y`：在某个 minor 线内自动更新 patch。
- `vX.Y.Z`：精确且不可变，官方称最适合锁定生产环境。
- `develop`：不稳定开发构建，不建议生产使用。

官方升级文档也明确支持把 Docker image 固定到精确 release，并要求升级前检查 release notes 和 breaking changes。

截至 2026-08-15，Kestra 官方仓库的 latest release 是 `v1.3.30`；当前 LTS 线是 1.3。WB-Data 本地容器经只读检查仍配置为 `kestra/kestra:latest`，因此当前结果不可重复，也无法把一次实测结果绑定到明确版本。

来源：

- [官方 Docker image tags 文档](https://kestra.io/docs/installation/docker#docker-image-tags)
- [官方升级与版本固定文档](https://kestra.io/docs/administrator-guide/upgrades#how-to-stick-to-a-specific-kestra-version)
- [官方 Releases 与 LTS 策略](https://kestra.io/docs/releases)
- [Kestra v1.3.30 官方 release](https://github.com/kestra-io/kestra/releases/tag/v1.3.30)

**建议**

1. 以 `kestra/kestra:v1.3.30` 作为当前阶段 0 的候选镜像，而不是继续验证 `latest`。
2. 先记录现有 Kestra 数据卷和数据库状态，再按官方升级说明切换测试环境；本研究不执行升级。
3. 在该精确镜像上完成第 9 节矩阵，记录 Kestra `/api/v1/plugins` 返回的 MySQL Query 插件信息。
4. 测试通过后，把精确版本写入受版本控制的环境配置和开发文档。
5. 后续升级必须显式修改版本，并重新执行本能力矩阵；不要让容器重建隐式升级 Kestra。

这里推荐 `v1.3.30` 是基于核对日期的阶段 0 候选，不是永久版本。若开始实测时已有新的受支持 patch，应先读 release notes，再决定升级候选；一旦选定，仍须使用精确 `vX.Y.Z`。

## 9. 阶段 0 最小实测矩阵

以下全部通过后，参数组后端开发才应开始。

### A. Flow inputs

- 常量 STRING、INT、BOOL、DATE、DATETIME 能创建执行，并在执行详情中保持预期类型和值。
- 错误类型和缺少 required input 时 API 拒绝创建，且不会留下误导性的执行记录。
- `trigger.date ?? execution.startDate` 的 STRING 动态 default 分别在手动和调度执行中得到预期值。
- 至少一个非 STRING 动态 default 用例，确认官方文档所述强类型限制在固定版本上的实际表现。
- multipart 显式值覆盖 default；省略字段使用 default。

### B. Schedule 和时间

- `Schedule.inputs` 能把常量传入 Flow。
- `Schedule.inputs` 中直接使用 `trigger.date` 的候选 YAML 能通过校验并产生预期值。
- 比较上述方式与动态 default 方式，确认最终解析值均出现在 `execution.inputs`。
- 验证计划时间与执行开始时间存在延迟时，`v_day` 仍按产品定义取计划时间。
- UTC、Asia/Shanghai、Europe/Berlin、负一天、月末、闰日和夏令时边界结果正确。

### C. multipart API

- WB-Data 使用 Java HttpClient 生成的 multipart 请求被 Kestra 正确接收。
- 中文、引号、换行、布尔、整数和 ISO 日期时间正确编码。
- 记录失败响应的状态码和 JSON 结构，供后端转换为稳定业务错误。

### D. MySQL JDBC

- `WHERE name = :xxx` + `parameters.xxx` 能安全绑定中文和单引号字符串。
- INT、BOOL、DATE、DATETIME 和十进制值在 MySQL 中表现符合预期。
- 重复、缺失、额外、null 和空 map 行为已记录。
- SQL 字符串及注释里的冒号用例已记录；若插件会误识别，WB-Data 保存前校验器必须给出明确限制或采用与目标插件一致、可测试的解析方案。

### E. 版本证据

- 测试报告记录精确 Kestra image tag、image digest、Kestra 版本和 MySQL JDBC 插件版本。
- 配置中不存在 `latest`、`latest-lts`、`vX.Y` 或 `develop` 等滚动标签。
- 保存最小 Flow、请求样例、执行 ID 和关键响应，作为后续升级回归基线；不得保存密码或 token。

## 10. 阶段 0 的决策门

实测后只允许以下结论之一：

1. **直接采用 Kestra inputs**：类型、动态时间、multipart、Schedule 和 JDBC 全部满足要求。
2. **混合解析**：常量和手动覆盖使用 Kestra inputs；时间参数由 WB-Data 后端或 Flow 编译器在明确时点解析，但 SQL 仍使用 JDBC parameters。
3. **缩小 V1 范围**：仅支持验证通过的 STRING/INT/BOOL/DATE 等类型，推迟 DECIMAL、null 或复杂时间语义。

无论选择哪一种，都不应退回 SQL 字符串替换；JDBC 命名参数绑定是参数值安全和类型语义的底线。

## 11. WB-Data 本地实测结果

### 11.1 被测环境

2026-08-15 对当前本地容器只读核对得到：

- 容器配置的镜像名是滚动标签 `kestra/kestra:latest`。
- Kestra API 返回 OSS `1.3.7`，commit `a3b606f`；该 commit 与官方 v1.3.7 release 一致。
- 当前安装的 MySQL JDBC 插件版本是 `1.9.2`。
- 当前容器的 Compose 源文件不在 WB-Data 仓库内，因此仓库暂时无法复现这个环境。

以下结论只对上述精确运行时成立，不能外推到尚未实测的 v1.3.30。

### 11.2 已通过

| 能力 | 结果 | 证据摘要 |
| --- | --- | --- |
| multipart 手动输入 | 通过 | STRING、INT、BOOL、DATE、DATETIME 被接收，基础类型和值符合预期 |
| 显式值覆盖 default | 通过 | 手动传入值覆盖静态 default |
| STRING 动态 default | 通过 | `execution.startDate` 格式化为 `yyyyMMdd` 并写入 execution inputs |
| 输入类型错误 | 通过 | INT 收到非整数时返回 HTTP 422，不创建执行 |
| 直接使用 `trigger.date` | 通过 | Schedule 启动后，task 表达式可读取计划时间；`dateAdd(-1, 'DAYS')` 与时区格式化正确 |
| MySQL 命名参数 | 通过 | 中文字符串通过 `:name` 和 PreparedStatement 绑定，未进行 SQL 值拼接 |
| 特殊字符串安全绑定 | 通过 | 单引号、分号和疑似注入文本使用 form-string 提交后原样作为一个值返回 |
| 重复命名参数 | 通过 | 同一个 `:name` 出现两次时，两处均绑定相同值 |
| 手动时间覆盖 | 通过 | 可选 `v_day` 由 multipart 显式传入后优先使用 |
| 调度时间解析 | 通过 | `v_day` 未传时，task 按 `trigger.date ?? execution.startDate` 得到计划日期 |

### 11.3 发现的兼容性陷阱

#### Schedule inputs 中不能使用本次 `trigger.date`

下列候选方式在 1.3.7 上失败：

```yaml
triggers:
  - id: schedule
    type: io.kestra.plugin.core.trigger.Schedule
    inputs:
      v_day: '{{ trigger.date | date("yyyyMMdd") }}'
```

Kestra 在创建执行前返回 `Unable to find date`。同一个表达式放在 task 属性中可以正常读取 `trigger.date`。因此 V1 不能依赖 Schedule `inputs` 解析运行时间。

#### 逐项渲染 JDBC parameter 会丢失类型

以下写法虽然使用了 PreparedStatement，但动态值会先变成字符串：

```yaml
parameters:
  count: '{{ inputs.count }}'
  enabled: '{{ inputs.enabled }}'
```

MySQL 实测结果中，动态 INT 为字符串 `"41"`、动态 BOOLEAN 为字符串 `"true"`；同一 map 内写死的 YAML 数字和布尔值仍保持类型。

把整个 map 作为 JSON 一次渲染，可以保留输入类型：

```yaml
parameters: '{{ {"count": inputs.count, "enabled": inputs.enabled} | toJson }}'
```

实测 MySQL 收到整数 `41` 和布尔值（返回为 `1`），这是 V1 编译器应采用的方式。

#### Kestra 不拒绝未知 multipart 字段

额外提交未声明的 multipart 字段时，1.3.7 返回 HTTP 200，并静默丢弃该字段。WB-Data 后端必须在调用 Kestra 前校验覆盖键，不能把未知键校验委托给 Kestra。

#### 缺失 JDBC 参数会被静默绑定为 null

SQL 引用了 `:missing`、但 parameter map 没有该 key 时，1.3.7 的 MySQL task 仍执行成功，结果为 SQL null。V1 禁止 null，因此保存或执行前必须校验 SQL 引用集合与参数集合，不能依赖插件报错。

#### SQL 字符串中的冒号会被错误识别

`SELECT ':not_a_parameter', :actual` 在 1.3.7 上失败，错误为 JDBC parameter index 越界。这证明插件会扫描字符串字面量中的 `:name`，与官方源码显示的正则实现一致。WB-Data 必须采用 SQL 感知的解析和校验，并为字符串、注释及 PostgreSQL `::type` 建立回归用例。

### 11.4 已验证的 V1 生成模式

```yaml
inputs:
  - id: person_name
    type: STRING
    defaults: 小明
  - id: count
    type: INT
    defaults: 41
  - id: enabled
    type: BOOLEAN
    defaults: true
  - id: v_day
    type: STRING
    required: false

tasks:
  - id: query
    type: io.kestra.plugin.jdbc.mysql.Query
    sql: 'select :person_name, :count, :enabled, :v_day'
    parameters: '{{ {"person_name": inputs.person_name, "count": inputs.count, "enabled": inputs.enabled, "v_day": (inputs.v_day ?? ((trigger.date ?? execution.startDate) | date("yyyyMMdd", timeZone="Asia/Shanghai")))} | toJson }}'
```

同一个临时 Flow 的两条执行均成功：

- 手动执行：multipart 覆盖姓名、整数、布尔和 `v_day`，MySQL 收到对应类型和值。
- 调度执行：常量采用 defaults；`v_day` input 为 null，但 SQL task 按 `trigger.date` 绑定正确计划日期。

这意味着调度执行的 `execution.inputs.v_day` 不是最终解析值。WB-Data 运维详情应根据参数快照和 execution 的 trigger/start 时间计算“已解析参数集”，不能直接把 Kestra inputs 当作最终 SQL 参数。

### 11.5 尚未通过的项目

- v1.3.30 镜像层已开始下载，但 Docker Desktop 长时间停留在导入阶段；下载已中止，没有启动或替换任何容器。因此 v1.3.30 仍只是升级候选版本。
- DECIMAL 和显式 null 不在 V1 范围；以后加入前必须完成真实 MySQL 精度与 null 矩阵。
- SQL 注释和 PostgreSQL `::type` 的冒号误识别尚未实测；字符串字面量误识别已经复现。
- 夏令时、闰日、月末、missed schedule、backfill 和重跑语义尚未实测。
- Java `KestraHttpClient` 尚未实现 multipart input map；本轮使用 HTTP API 直接验证协议。

所有临时 Flow 均已删除；测试 execution 记录保留在本地 Kestra 中作为诊断证据。没有修改或重启现有 Kestra、MySQL 与业务 Flow。

### 11.6 当前决策

阶段 0 选择“混合解析”方向：

1. 常量和手动覆盖使用强类型 Flow inputs。
2. 时间参数声明为可选 input；手动覆盖优先，否则 SQL task 在运行时按 `trigger.date ?? execution.startDate` 计算。
3. JDBC `parameters` 必须整体 `toJson` 渲染，不能逐项字符串插值。
4. WB-Data 在提交前自行拒绝未知覆盖键和类型错误。
5. 仓库已新增 `docker/docker-compose.kestra.yml`，把当前兼容基线固定为 `kestra/kestra:v1.3.7`。当前正在运行的容器没有被重建；后续升级必须显式修改版本并重跑矩阵。

参数组数据库、管理 API 和 Git 快照可以进入阶段 1；Flow 编译和执行链路实现必须遵循上述生成模式，并在合入前补齐其直接涉及的剩余矩阵。
