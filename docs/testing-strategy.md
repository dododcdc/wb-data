# 测试策略

本文档记录 WB-Data 当前的测试分层、每层的运行方式和决策理由。环境搭建细节见 [本地开发](local-development.md) 与 [数据传输集成验证](local-integration-testing.md)。

## 分层现状

编号沿用业界测试分层惯例（L0 单元 / L1 服务集成 / L2 端到端 / L3 全链路）。L1 与 Playwright 为有意的暂缓决策（见两处决策记录）；浏览器走查承担 L2 职责但以人工执行，故不占编号，下表按执行方式列出：

| 层 | 内容 | 命令 | 何时跑 |
| --- | --- | --- | --- |
| L0 单元测试 | 前端 vitest（jsdom）、后端 JUnit + Mockito，全部不依赖外部服务 | 前端 `npm run test`；后端 `mvn clean install` | 每次提交前 |
| L3 集成冒烟 | 真实 MySQL / Hive / Kestra / SeaTunnel 全链路 | `scripts/dev/transfer-smoke.sh` 准备环境，`scripts/dev/smoke-verify.sh` 自动验证 | 改动执行链路、数据源、调度相关代码后；发版前 |
| 浏览器走查（L2 职责） | 真实浏览器实际操作 | 见 [真实浏览器走查](#真实浏览器走查jsdom-盲区) | 视觉 / 交互改动 |

L0 与 L3 之间目前没有自动化集成层（无 `@SpringBootTest`、无 Testcontainers）。这是有意的暂缓决策，见下文。测试数量以命令实际输出为准，不在本文维护。

## L3 冒烟怎么用

1. 环境准备（幂等，可重复跑）：`DB_PASSWORD=<元数据库密码> scripts/dev/transfer-smoke.sh`
2. 自动验证（幂等，可重复跑）：`WB_DATA_PASSWORD=<admin 密码> scripts/dev/smoke-verify.sh`

verify 脚本通过后端 API 完成：登录 → 定位 `policy` 项目组 → 重置测试数据 → 依次验证八个场景：

- 数据源管理：API 创建数据源 + 测试连接（`smoke_it_mysql_api`，重复执行时复用）
- MySQL → MySQL `append`（使用上一步创建的数据源）
- MySQL → MySQL `overwrite_table`
- MySQL → Hive 分区表 `overwrite_partition`
- Hive → MySQL `append`
- 选中单个传输节点执行时只运行该节点
- SQL 节点使用 `localhost` 数据源执行写入（依赖 `WB_DATA_TRANSFER_CONTAINER_HOST_REWRITE`，规则见 [本地开发](local-development.md#离线任务怎么连库)）
- 运维中心执行列表接口可用性

每个传输场景断言目标库的实际行数/分区数据。脚本在 `_flows/smoke_it/` 下保存测试 flow（未提交状态，重复执行会原地更新，不需要时可在界面删除）。

边界：verify 走 debug 执行接口（`wb-debug-*` 命名空间），按设计不进运维中心列表——运维中心只扫 git sync 配置的业务命名空间。因此 commit/push → Kestra 同步链路、调度触发、运维中心的记录可见性仍需手动验证，后续可将 push 链路补成场景（依赖组内 Git 凭据，目前仅 `policy` 组已配置）。

### 手动验证清单（L3 覆盖不到的链路）

按改动范围选验，每步给出期望结果：

| 链路 | 验法 | 期望 |
| --- | --- | --- |
| 保存 → commit → push → Kestra 同步 | 界面提交并推送一个任务，等同步周期（或用组设置里的手动触发），打开 Kestra UI 查对应 `g<组id>-<分支>` 命名空间 | flow 出现/更新，内容与仓库 `_flows/` 一致 |
| 调度触发 | 给任务配未来 1–2 分钟的计划时间，启用调度，到点观察 | Kestra 产生该期 execution，`wbdataSchedulePeriod` 等标签正确 |
| 依赖闸门 | 下游配前置后触发下游（计划时间取当期） | 闸门 task 日志打出 scheduleKey；前置同期 SUCCESS 前保持等待；超时边界为下一个计划点火点 |
| 运维中心可见性 | 上述执行完成后打开运维中心 | 列表能看到该执行；计划执行时间列显示业务期而非实际启动时间 |

## 决策记录（2026-09-12）：暂缓 L1 集成测试层

**结论：只做 L0 + 脚本化 L3，暂缓引入 L1 集成测试层。**

评估过的 L1 方案：`@SpringBootTest` + Testcontainers MySQL（真数据库、真 Spring 上下文）+ mock KestraClient。暂缓原因：

- 单人开发、项目处于早期，维护一层测试基建的成本高于收益。
- L3 冒烟脚本化之后，"每次都要手动点 UI" 的主要痛点已消除。
- Testcontainers 方案已完整评估过，随时可捡回来：它只需本机 Docker，临时容器用完即焚，与现有 compose 服务互不影响。

重新评估 L1 的触发条件（满足其一）：

- 开始多人协作或引入 CI（L3 依赖常驻环境，CI 里编排成本高）。
- API / Mapper / 权限层的回归开始频繁漏过 L0。
- 共享环境的状态污染导致 L3 结果不可信。

## 新功能的测试清单

- 纯逻辑改动：补 L0 单测（前端与源文件同目录 `*.test.ts(x)`，后端同包 `*Test.java`）。
- API / SQL / 权限改动：L0 单测 + 针对性手动验证（L1 暂缓期内靠这条兜底，review 时重点关注）。
- 执行链路改动（Kestra 交互、SeaTunnel、传输、调度触发）：必须跑 `smoke-verify.sh`，必要时补手动验证 push / 调度链路。
- UI 改动：`npm run lint`、`npm run test`、`npm run build` + 浏览器走查；涉及浮层 / 弹窗内交互必须按 [真实浏览器走查](#真实浏览器走查jsdom-盲区) 实测。

## 真实浏览器走查（jsdom 盲区）

jsdom 不渲染、不算布局、不做命中测试，也不模拟焦点域和 pointer-events 锁。组件测试里的 `fireEvent` / `userEvent` 是隔空向目标元素派发事件——元素在真实浏览器里即使被遮挡、在指针锁或焦点域之外，事件照样到达。所以"组件测试全绿"只代表在一个不存在这些约束的环境里通过。2026-09-14 调度弹窗 Select 无法点击 / 滚动的 bug（弹层 portal 到 body、落在 radix Dialog 指针锁外）就是这类盲区，测试全绿、浏览器必现。

以下交互属于盲区，单测只覆盖逻辑，交付前必须真实浏览器实测：

- 浮层类：Select / Popover / Tooltip / Dropdown / ContextMenu，尤其是弹窗内再开浮层
- 弹窗焦点管理：焦点域锁定、Esc 关闭、点击外部关闭
- 滚动：弹层内滚动、滚动锁定、粘性定位
- 拖拽、键盘导航

信号：组件测试里出现"迁就组件内部交互状态机"的写法（例如必须先 `mouseMove` 再 `click` 才能选中选项），说明该交互依赖真实指针状态机，jsdom 验证不了，必须浏览器实测。

### 工具与标准

- 交互走查首选 **ego-browser**（`ego-browser nodejs` CLI 驱动独立可见的 Ego Lite Chromium，rAF / 动画 / 命中测试是真实行为，可截图留证，技能文档见 ego-browser）。标准是对每个新增或改动的交互控件实际操作一遍（点击、滚动、键盘），不是打开页面只看渲染。
- Qoder 内嵌 browser-use（MCP）可作补充，但注意：面板未显示在屏幕上时页面 `visibilityState=hidden`、rAF 暂停，base-ui 弹层的打开/关闭动画会卡在中间态（残留弹层遮挡后续点击、aria-expanded 与 DOM 不同步）。这是工具假象不是产品 bug（base-ui 的 `useAnimationsFinished` 等 rAF，可见页面下一帧即卸载）；遇到即改用 ego-browser 复验。
- 布局 / 响应式判断：先查 `innerWidth` / `devicePixelRatio`——内嵌浏览器窗口可能只有约 600 CSS px（Retina DPR=2），拿不准就用可见浏览器复核。
- 登录态 / 账号相关验证：用 user-browser-use（直接复用本机浏览器登录态）。

## 决策记录（2026-09-15）：暂缓 Playwright，靠强制浏览器走查

**结论：暂缓 Playwright，浮层 / 弹窗类交互靠强制浏览器走查覆盖。**

- 不引入 Playwright：单人开发无 CI，浏览器二进制 + 用例维护成本高于收益；ego-browser 实测已能覆盖该盲区（上述调度弹窗 bug 即由它复现和验证）。
- 重新评估触发条件（满足其一）：浮层类交互 bug 再次漏到使用者手里；开始多人协作或引入 CI；浮层交互数量多到人工走查负担过重。
