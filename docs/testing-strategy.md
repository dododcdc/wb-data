# 测试策略

本文档记录 WB-Data 当前的测试分层、每层的运行方式和决策理由。环境搭建细节见 [本地开发](local-development.md) 与 [数据传输集成验证](local-integration-testing.md)。

## 分层现状

| 层 | 内容 | 命令 | 何时跑 |
| --- | --- | --- | --- |
| L0 单元测试 | 前端 vitest（333 个）、后端 JUnit + Mockito（211 个），全部不依赖外部服务 | 前端 `npm run test`；后端 `mvn clean install` | 每次提交前 |
| L3 集成冒烟 | 真实 MySQL / Hive / Kestra / SeaTunnel 全链路 | `scripts/dev/transfer-smoke.sh` 准备环境，`scripts/dev/smoke-verify.sh` 自动验证 | 改动执行链路、数据源、调度相关代码后；发版前 |
| 手动 UI 走查 | 浏览器实际操作 | 见各功能文档 | 视觉 / 交互改动 |

L0 与 L3 之间目前没有自动化集成层（无 `@SpringBootTest`、无 Testcontainers）。这是有意的暂缓决策，见下文。

## L3 冒烟怎么用

1. 环境准备（幂等，可重复跑）：`DB_PASSWORD=<元数据库密码> scripts/dev/transfer-smoke.sh`
2. 自动验证（幂等，可重复跑）：`WB_DATA_PASSWORD=<admin 密码> scripts/dev/smoke-verify.sh`

verify 脚本通过后端 API 完成：登录 → 定位 `policy` 项目组 → 重置测试数据 → 依次验证七个场景：

- 数据源管理：API 创建数据源 + 测试连接（`smoke_it_mysql_api`，重复执行时复用）
- MySQL → MySQL `append`（使用上一步创建的数据源）
- MySQL → MySQL `overwrite_table`
- MySQL → Hive 分区表 `overwrite_partition`
- Hive → MySQL `append`
- 选中单个传输节点执行时只运行该节点
- 运维中心执行列表接口可用性

每个传输场景断言目标库的实际行数/分区数据。脚本在 `_flows/smoke_it/` 下保存测试 flow（未提交状态，重复执行会原地更新，不需要时可在界面删除）。

边界：verify 走 debug 执行接口（`wb-debug-*` 命名空间），按设计不进运维中心列表——运维中心只扫 git sync 配置的业务命名空间。因此 commit/push → Kestra 同步链路、调度触发、运维中心的记录可见性仍需手动验证，后续可将 push 链路补成场景（依赖组内 Git 凭据，目前仅 `policy` 组已配置）。

## 决策记录（2026-09-12）

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
- UI 改动：`npm run lint`、`npm run test`、`npm run build` + 浏览器走查。
