# WB-Data Agent 开发指南

项目能力、技术栈和启动入口以 [README.md](README.md) 为准。日常环境配置见 [本地开发](docs/local-development.md)，数据传输验证见 [数据传输集成验证](docs/local-integration-testing.md)。

## 代码约定

### 前端（`wb-data-frontend/`）

- 使用 TypeScript strict mode，路径别名 `@/` 指向 `src/`。
- 使用 React 18、Tailwind CSS v4、shadcn/ui、Lucide Icons 和 Zustand。
- API 请求放在 `src/api/`，并使用 `src/utils/request.ts` 中的共享 axios 实例。
- 路由集中在 `src/router/`，业务界面主要按领域放在 `src/views/`，通用 UI 放在 `src/components/`。
- 测试文件与源文件同目录，命名为 `*.test.ts` 或 `*.test.tsx`。

### 后端（`wb-data-server/`）

- 使用 Java 21、Spring Boot 3、MyBatis-Plus、Flyway 和 Lombok。
- 代码按 `com.wbdata.{domain}` 业务域组织，再划分 controller、service、mapper、entity 和 dto 等职责。
- Mapper XML 放在 `wb-data-backend/src/main/resources/mapper/`，Flyway 迁移放在 `db/migration/`。
- 自定义配置统一使用 `wbdata.*` 前缀。
- 数据源驱动通过插件 API 和自定义 ClassLoader 从 `plugins/` 目录加载。

## 工作原则

- 修改前先检查工作区，保留用户已有的未提交变更。
- 只修改当前任务需要的内容，不顺手清理无关代码或文档。
- UI 修改遵循清晰、克制、一致和可读优先的设计方向。
- 修复缺陷时先确认真实调用链和根因，并补充能覆盖问题的回归测试。
- 涉及保存、提交、推送或调度时，分别验证持久化、Git 状态、事件同步和 Kestra 状态。

## 验证命令

前端：

```bash
cd wb-data-frontend
npm run lint
npm run test
npm run build
```

后端：

```bash
cd wb-data-server
mvn clean install
```

根据改动范围运行相关检查；提交或 PR 前应完成受影响部分的完整验证。

传输 / 执行链路改动还需跑集成冒烟（依赖本地 Docker 环境，见 [测试策略](docs/testing-strategy.md)）：

```bash
DB_PASSWORD=<元数据库密码> scripts/dev/transfer-smoke.sh
WB_DATA_PASSWORD=<admin-密码> scripts/dev/smoke-verify.sh
```

## Git 约定

- 分支从 `main` 创建。
- 人工功能分支使用 `feature/<描述>` 或 `fix/<描述>`；自动化 Agent 遵循其运行环境要求的分支前缀，例如 `codex/`。
- 提交保持原子化，每次提交一个逻辑变更。
- 暂存时指定准确路径，避免带入无关的工作区修改。
- 不合并到共享 `main`、不删除远程内容，也不移除 worktree，除非用户明确授权。

## PR 证据

- [ ] 前端改动：`npm run lint`、`npm run test`、`npm run build` 通过。
- [ ] 后端改动：`mvn clean install` 通过。
- [ ] 逻辑变更：补充或更新对应测试。
- [ ] PR 描述说明变更意图、影响范围和验证方式。
