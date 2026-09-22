# 方案：CRM 销售场景端到端测试计划

> 状态：**已拍板（2026-09-19），执行中**
> 目的：用一个贴近真实的业务场景（MySQL 抽数 → Hive ODS → 分析 → 结果写 ClickHouse → 每日调度 + 任务级依赖）端到端压测平台能力
> 纪律：测试中发现的问题**只记录、不修复**，记入 §9 问题清单，统一裁决后再动手
> 执行方式：数据/表结构准备用脚本；**建数据源 → 建任务 → 配置 → 保存推送 → 执行 → 调度** 全程在浏览器模拟真人操作（ego 浏览器）；中途走不通就停下来对齐

---

## 1. 场景与验证目标

**业务故事**：CRM 业务库（MySQL）里有订单、订单明细、客户、门店、商品五张表。每天凌晨把五张表全量快照抽入 Hive 的 `ods_crm` 库；抽数完成后，分析任务按「天 × 门店 × 商品」粒度汇总销量与销售额，结果每天全量写入 ClickHouse，供下游报表使用。

**这一圈要验证的平台能力**：

| # | 能力 | 现状 |
|---|------|------|
| V1 | 单任务多传输节点（MySQL→Hive × 5）并行执行 | 单节点已冒烟，多节点同任务未验证 |
| V2 | MySQL→Hive 每日快照（分区覆写 / 整表覆写） | overwrite_partition 已冒烟（固定值），运行日期分区未验证 |
| V3 | HiveSQL 节点跑分析 SQL（多语句、聚合、落结果表） | beeline 路径已有，真实业务 SQL 未验证 |
| V4 | **任务级依赖**：分析任务等抽数任务同期成功（P2 新功能） | 刚实现，首次真实使用 |
| V5 | **Hive→ClickHouse 传输**（JDBC sink） | 从未冒烟；SeaTunnel 镜像内 ClickHouse 驱动存疑 |
| V6 | 每日调度（Kestra Schedule）连续多天自动触发 | 手动/debug 执行为主，长期调度未观察 |
| V7 | 保存 → 提交 → 推送 → 调度生效全链路 | 界面流程已通，本场景回归 |

**已识别的能力边界（提前声明，避免误判为 bug）**：

- 平台传输节点不支持 Kafka 目标。场景中结果写 **ClickHouse**（与需求描述一致）；若确需 Kafka，记为能力缺口而非缺陷。
- Hive 结果表面板（结构化结果）是未立项提案，HiveSQL 节点执行后只能看日志，属预期。

---

## 2. 环境准备

按 [本地开发](../local-development.md) 拓扑，需启动：

```bash
docker compose -f docker/docker-compose.mysql.yml up -d      # 元数据 + 业务库
docker compose -f docker/docker-compose.hive.yml up -d       # Hive Metastore + HiveServer2
docker compose -f docker/docker-compose.clickhouse.yml up -d # ClickHouse（8123/9000）
# Kestra 按本地开发文档启动；SeaTunnel 镜像按 transfer-smoke.sh 构建
```

后端带齐传输变量（`dev` profile，详见本地开发文档「数据传输」一节）。

平台上需配置的数据源（host 一律 `localhost`，由容器改写兜底）：

| 数据源 | 类型 | 库 | 备注 |
|--------|------|----|------|
| `crm_mysql` | MySQL | `crm_demo` | 业务源库 |
| `crm_hive` | Hive | `default` | metastoreUri 连接参数指向本地 metastore |
| `crm_clickhouse` | ClickHouse | `default` | JDBC 走 8123 |

---

## 3. 业务数据准备（MySQL `crm_demo`）

五张表，数据量控制在「能看出聚合效果、秒级跑完」的规模：

| 表 | 行数建议 | 关键字段 |
|----|---------|---------|
| `user`（客户） | 100 | user_id, name, gender, city, level, created_at |
| `store`（门店） | 10 | store_id, name, city, region |
| `product`（商品） | 50 | product_id, name, category, price |
| `orders`（订单） | 5,000 | order_id, user_id, store_id, status, total_amount, created_at |
| `order_item`（明细） | ~12,000 | item_id, order_id, product_id, quantity, price |

造数要求：

- `orders.created_at` 随机分布在最近 7 天，让聚合结果跨多个交易日。
- `order_item` 每单 1~5 行，`product_id` 随机引用商品表。
- 预留「第二天能看到变化」的手段：造数脚本可重复执行、每天追加一批新订单（用于验证第 2 天调度后结果确实变化）。
- 造数脚本落盘为 `scripts/dev/init/crm/` 下的 SQL（参照现有 `init/transfer/` 惯例），方便重置。

---

## 4. Hive ODS 层设计

库：`ods_crm`。五张快照表，命名 `ods_<源表名>_all_d`：

| Hive 表 | 源表 |
|---------|------|
| `ods_crm.ods_user_all_d` | `crm_demo.user` |
| `ods_crm.ods_store_all_d` | `crm_demo.store` |
| `ods_crm.ods_product_all_d` | `crm_demo.product` |
| `ods_crm.ods_orders_all_d` | `crm_demo.orders` |
| `ods_crm.ods_order_item_all_d` | `crm_demo.order_item` |

**快照方式（D1 已拍板）**：表按 `dt STRING`（格式 `yyyyMMdd`）分区，每天覆写当天分区；`dt` 用传输映射 `source_expression`（源查询里生成当天日期）——表达式分区是未验证能力，本身即测试点。

目标表提前建好（脚本 beeline 执行），因为 Hive sink 要求表已存在。

结果表（分析产出，Hive 侧）：

```text
dm_crm.dm_store_product_sales_d
  dt            STRING   -- 交易日期 yyyyMMdd
  store_id      BIGINT
  store_name    STRING
  product_id    BIGINT
  product_name  STRING
  sales_qty     BIGINT   -- 销量
  sales_amount  DECIMAL(16,2) -- 销售额
```

分析 SQL 每天全量重算（`INSERT OVERWRITE` 整表或按 dt 分区，随 D1 定）。

---

## 5. 任务设计

### 任务一：`crm_ods_daily_extract`（抽数任务）

- 画布：5 个传输节点（MySQL→Hive），无连线（并行），分别抽五张表。
- 调度：**每天 01:00**。
- 所在项目组：`policy`（唯一配了 Git 的组，D3）。

### 任务二：`crm_sales_daily_analysis`（分析任务）

- 画布（有依赖连线）：
  1. `HiveSQL` 节点：跑聚合 SQL，产出 `dm_crm.dm_store_product_sales_d`。
  2. `传输` 节点：Hive（`dm_crm` 结果表）→ ClickHouse（结果表），每天全量（写法见 §6）。
- 调度：**每天 02:00**。
- **任务级依赖**：依赖 `crm_ods_daily_extract`（同为每天）。这是 P2 功能的首次真实使用：
  - 预期闸门行为：02:00 到点时若抽数未完成则等待；抽数提前完成也不抢跑（等自己的 02:00）。
  - 同在 `policy` 组（D3），跨组依赖本次不验证。

### 节奏安排

1. **第 0 天（配置当天）**：先不开调度。手动/debug 执行两个任务，验证数据链路全通（注意：按 P2 设计，手动/debug 执行旁路依赖闸门，这本身也要观察确认）。
2. **第 0 天傍晚**：把两个任务的计划时间临时配到当天临近时刻（如 20:00 / 20:10），观察真实调度触发 + 依赖闸门的「到点等待 / 不抢跑」行为。
3. 确认无误后改回 01:00 / 02:00（同频率改计划时间不受 P2 上游保护限制），**第 1、2 天早上**检查自动执行结果、运维中心展示、以及 ClickHouse 数据是否按预期刷新。
4. 第 1 天抽数前在 MySQL 追加一批新订单，验证结果表数据确实随源变化。

---

## 6. ClickHouse 写入方案（决策点 D2）

结果表每天全量刷新。三个候选：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **A. 传输节点 overwrite_table（推荐）** | JDBC sink `data_save_mode=DROP_DATA`，先清空再写入 | 平台原生支持，零额外组件；语义=「每天清一下再写」 | 写入窗口期内表为空/不完整（测试数据量下窗口是秒级） |
| B. 临时表 + `EXCHANGE TABLES` 交换 | 先写 `_tmp` 表，再用 ClickHouse SQL 节点原子交换 | 无空窗，生产级 | 多两步；且 Hive→ClickHouse 传输本身未验证，不宜叠加复杂度 |
| C. ReplacingMergeTree + append | 以 dt 为版本，查询侧去重 | 无覆写动作 | 查询方必须感知去重逻辑，结果表不「干净」 |

**推荐 A**：先把主链路跑通；空窗问题在本地测试数据量下可忽略。若后续要模拟生产标准，再单独立项做 B。

ClickHouse 侧预建表（`default` 库，MergeTree，`ORDER BY (dt, store_id, product_id)`）。

**预检结果（2026-09-19）**：镜像 `lib/` 只有 hive-jdbc 与 mysql-connector，**没有独立的 ClickHouse JDBC 驱动**；但 `connectors/connector-clickhouse-2.3.13.jar` 内捆绑了 `com.clickhouse.jdbc.ClickHouseDriver.class`。平台生成的配置是通用 `Jdbc` sink + `com.clickhouse.jdbc.ClickHouseDriver`，能否被 Jdbc 连接器的类加载器看到（lib 可见、其他 connector 的 jar 通常不可见）不确定——按风险推进，Hive→ClickHouse 传输执行时见分晓，失败则记入 §9。

---

## 7. 观察点清单（测试时逐项打勾）

抽数链路：

- [ ] 5 个传输节点在同一任务内并行/按连线执行，全部成功
- [ ] Hive 五张 ODS 表行数与 MySQL 源一致；分区值 = 运行当天（若 D1 选 a）
- [ ] 第二天重跑，旧分区/旧数据按预期覆写，不产生重复

分析链路：

- [ ] HiveSQL 聚合结果抽样核对（挑 1 天 × 1 门店 × 1 商品手工对数）
- [ ] Hive→ClickHouse 传输成功；ClickHouse 行数与 Hive 结果表一致
- [ ] 第二天 ClickHouse 数据被完整替换（旧数据不残留）

调度与依赖：

- [ ] 保存 → 提交 → 推送后，Kestra 侧调度按预期时间触发
- [ ] 依赖闸门：抽数未完成时分析任务等待；抽数提前完成时分析任务不抢跑（等到自己计划点）
- [ ] 运维中心能看到「等待前置」状态与本期 scheduleKey
- [ ] 手动/debug 执行确实旁路依赖闸门
- [ ] 连续两天自动执行均成功，执行记录、节点状态、日志可查

---

## 8. 决策记录（2026-09-19 已拍板）

| # | 问题 | 结论 |
|---|------|------|
| D1 | ODS 快照方式 | **dt 分区 + overwrite_partition**；`dt` 格式 `yyyyMMdd`（STRING） |
| D2 | ClickHouse 每天全量的写法 | **overwrite_table（先清空再写入）**；临时表交换暂不做 |
| D3 | 项目组 | **不拆组**：目前只有 `policy` 组配置了 Git，两个任务都放 `policy`；跨组依赖本次不验证 |
| D4 | 结果表经过 Hive `dm_crm` 中间层再传 ClickHouse | **是** |
| D5 | 结果终点 | **ClickHouse**（Kafka 为语音输入误识别，平台也不支持 Kafka sink） |

---

## 9. 问题清单（测试中填写，只记录不修复）

| # | 发现日期 | 环节 | 现象 | 预期 | 严重度 | 处置（待裁决） |
|---|---------|------|------|------|--------|---------------|
| P-01 | 2026-09-19 | 数据源-ClickHouse 测试连接 | 「测试连接」报「服务器内部错误」；后端日志 `NoClassDefFoundError: com/clickhouse/client/ClickHouseClient`。根因：`plugins/` 下的 clickhouse 插件 jar 是 2026-09-13 旧构建（7.8MB，缺 clickhouse-client 类），`wb-data-server/wb-data-plugin-clickhouse/target/` 有 2026-09-17 新构建（14MB，类齐全），但构建后没重跑 `prepare-plugins.sh`，后端（09-18 启动）加载的是旧 jar | 连接成功 | 阻断（仅 ClickHouse 链路） | 已按环境修复处理：cp 新 jar + 重启后端，测连通过。同时暴露流程缺口：插件重建后没有提醒同步 `plugins/` 的机制 |
| P-02 | 2026-09-19 | HiveSQL 节点执行 | debug 执行失败，日志 `/bin/sh: 2: beeline: not found`。根因：HIVE_SQL 编译为 Shell Commands + beeline，走 Kestra Docker runner 的默认镜像 `ubuntu:latest`（无 beeline）；`containerImage` 只给传输节点设置（SeaTunnel 镜像），Kestra compose 的 runner 配置也只有 `volume-enabled: true`。与 [hive-sql-node-results.md](hive-sql-node-results.md) §6「Demo 环境无 beeline」的预判吻合。**环境绕过已尝试并失败**：给 Kestra 配 `plugins.configurations`（`io.kestra.plugin.scripts.shell.Commands` 的默认 `containerImage`，kebab/camel 两种写法都试了）对 debug 执行不生效，仍起 ubuntu；Kestra 侧也没有可配 runner 默认镜像的入口。结论：唯一正解是编译器为 HIVE_SQL 指定 containerImage（平台修复） | HiveSQL 节点能执行 | **阻断分析任务** | **已裁决（2026-09-19）：破例平台修复**。编译器为 HIVE_SQL 指定 `containerImage`，镜像名走配置 `wbdata.offline.transfer.hive-sql-image`（默认 `apache/hive:4.0.0`），PROCESS runner 下不设置；同步更新编译单测。生产若用 process runner + 预装 beeline 的主机，改配置即可，无需再改代码 |
| P-03 | 2026-09-19 | 传输节点-目标端 ClickHouse 元数据 | 传输节点选 ClickHouse 目标后「目标数据库加载失败」，手动点「重试」后成功。后端无异常日志，疑似冷启动连接池（Hikari 池 20:16:01 创建）期间前端请求超时 | 首次加载即成功 | 低（体验） | 待裁决 |
| P-04 | 2026-09-19 | 画布切换任务 | 切换任务时「未保存的更改」弹窗点「保存并离开」两次后弹窗仍在，最终「放弃修改」才切换成功；草稿内容实际与已保存一致 | 「保存并离开」一次生效 | 中 | **根因已查明（2026-09-23）**：与执行状态轮询无关（轮询只写 executions/nodeStatuses 独立状态，`buildFlowDocumentSignature` 不含执行状态）。真实根因：当时 5 个无连线节点触发保存的图校验失败，错误只在 toast 一闪而过没被注意；「保存并离开」内部调 saveFlow 反复校验失败 → `if (!saved) return` → 弹窗不消失；debug 执行不受影响是因为 `/executions/debug/document` 直接提交工作草稿、不依赖已保存草稿。**V1 已修复**：草稿保存不再做图校验，切换不再因保存失败被拦 |
| P-05 | 2026-09-19 | 传输 Hive→ClickHouse | 传输节点失败，SeaTunnel 日志 `ClassNotFoundException: com.clickhouse.jdbc.ClickHouseDriver`（Hikari 无法加载驱动）。与 §6 预检预判一致：Jdbc sink 的类加载器看不到 connector-clickhouse 插件 jar 内捆绑的驱动，`lib/` 必须显式放驱动 jar。后端插件用的驱动版本是 clickhouse-jdbc 0.7.2（classifier all） | 传输成功 | 阻断结果写入链路 | **已裁决（2026-09-19）：镜像加驱动**。Dockerfile 按 hive-jdbc 同款加入 clickhouse-jdbc:0.7.2(all)（含 sha1 校验），重建后传输成功 |
| P-06 | 2026-09-19 | 传输 Overwrite table 语义 | ClickHouse 目标选「Overwrite table」每天全量写，实际**追加不去重**：连跑三次行数 1085→2170→3255。平台渲染的配置确实是 `data_save_mode = "DROP_DATA"`，但 SeaTunnel 2.3.13 的 Jdbc sink 对 ClickHouse 没有执行任何清理（日志无 TRUNCATE/DELETE，也无 save-mode 处理记录），疑似通用方言不支持/不执行 DROP_DATA 清理。**D2 的前提（平台原生 overwrite_table 即可实现每天清写）不成立** | 每天全量覆写、无重复 | 阻断 D2 设计 | **已裁决（2026-09-19）**：短期画布加 ClickHouse SQL 节点先 `TRUNCATE`（HiveSQL → TRUNCATE → Transfer），已验证两轮行数稳定 1085；长期正式立项「传输目标端前置/后置 SQL」（mysql/pg/ck 先行），见 [[transfer-pre-post-sql]] |
| P-07 | 2026-09-19 | ClickHouse SQL 节点执行 | debug 执行报「当前 Kestra 未安装 CLICKHOUSE 执行插件」。根因与 P-01 同源：Kestra 镜像（7 天前构建）里的 `wb-data-kestra-plugin.jar` 没有 clickhouse 类（0 个），当日新构建有（963 个）；重建 Kestra 镜像后 Kestra `/api/v1/plugins` 已注册 `io.wbdata.kestra.jdbc.clickhouse.Query`。附带发现：`KestraHttpClient.getTaskTypes()` 对插件清单**永久缓存**，Kestra 侧插件变化后必须重启后端才能执行 | ClickHouse SQL 节点可执行 | 阻断 | 已按环境修复处理：重建 Kestra 镜像 + 重启后端，TRUNCATE 执行成功。**缓存问题待裁决**：插件清单应考虑 TTL 或失败时刷新 |
| P-08 | 2026-09-19 | 草稿生命周期（**数据丢失**） | 抽数任务 5 个传输节点配置全部丢失。因果链：①「保存任务」只存草稿，**不写 git**；②切换任务时「保存并离开」两次不生效（P-04，疑似执行状态回写反复弄脏草稿）；③被迫选「放弃修改」，草稿回退到**已提交**的 flow.yaml——而任务从未提交过，flow.yaml 是空壳，画布因此清空。一个没意识到「保存≠提交」的用户会以为点了保存就安全，实际一次「放弃修改」全丢 | 放弃修改前应明确提示「将丢失未提交内容」；或保存即入 git | **高（真实数据丢失）** | 待裁决。缓解动作：今后配置完立即「提交当前任务 + 推送」（本次已重建抽数任务并提交推送） |
| P-09 | 2026-09-20 | 提交校验 | 「保存并提交」要求**所有节点连入一张依赖图**（报「画布中存在未连接的节点」），但 debug 执行允许无连线并行节点——抽数任务「5 节点并行」的形态无法提交/推送/调度，只能改成星型（1 根 + 4 并行）。「保存任务」单独点也存在无提示失败的嫌疑（19:55 首次保存未连通节点时未见报错 toast，但也可能其实失败了没被发现） | 并行无连线节点应可提交（Kestra 天然支持无依赖并行 task），或校验口径前后一致并提前提示 | 中（设计矛盾） | 待裁决 |
| P-10 | 2026-09-20 | 任务级依赖闸门 | 依赖配置已写入 YAML labels（`wbdataDependencies: 4:crm_ods_daily_extract`），调度 cron 正确生成（01:30/01:40），但分析任务 YAML **没有任何闸门逻辑**（无 LoopUntil / scheduleKey / waitFor）——依赖目前只是配置层记录，运行时到点即跑、不等上游同期成功。依赖对话框已提示「运行等待机制将在后续版本接入」，属预期内，记录观察 | §3.2 语义：start = max(自己计划时间, 前置同期完成时间) | 高（P2 核心能力未闭环） | 待裁决（P2 运行时尚未实现，非回归） |
| P-11 | 2026-09-22 | git→Kestra 同步 | 推送成功后调度不触发。根因：分支上遗留的非法 flow 使 `sync-flows-g4-feature-policy-review` 持续 FAILED——`transfer-smoke.yaml` 含 Quartz 风格 6 段 cron（Kestra 只认 5 段，来自旧测试提交 `4cf5573`）；`__sched_test_b.yaml`、`test4.yaml` 是空 Dag 测试残留。已手工删除 6 段 cron 并推送，crm 两任务成功同步进 `g4-feature-policy-review`（带 Schedule trigger）。暴露三个问题：①非法 flow 能经「开调度→提交」进入 kestra-flows（编译侧无 cron/Dag 合法性校验）；②SyncFlows 遇非法 flow 只标 FAILED 继续同步其余（好），但失败无任何告警，用户只看到「推送成功」；③测试残留 flow 长期污染分支 | 推送成功 = 调度真的生效；同步失败应可感知 | 高（静默坏死） | 环境层已恢复：删 6 段 cron + 删两个空 Dag 残留并推送，同步 SUCCESS、crm 两任务带 Schedule 同步成功（2026-09-22）。平台层待裁决：a) 编译/提交侧加 flow 校验；b) 同步失败告警到运维中心 |
| | | | | | | |

---

## 10. 风险与备注

| 风险 | 说明 |
|------|------|
| Hive→ClickHouse 路径零覆盖 | §6 预检步骤先行；翻车则记录为 P 级问题，不现场修 |
| 表达式分区（`source_expression` 生成 dt）未验证 | D1 选 a 时这是关键路径；翻车可临时改 static_value 或落 b 方案，仍记录问题 |
| 调度验证周期长 | 用 §5「临近时刻调度」技巧当天看到闸门行为，不必真等到凌晨 |
| 依赖 P2 首次实战 | 闸门语义（同期对齐、不抢跑）以 [task-level-dependencies-v1.md](task-level-dependencies-v1.md) §3.2 为验收标准 |
| 本地 Docker 资源 | MySQL + Hive + ClickHouse + Kestra 同时跑，注意内存 |
