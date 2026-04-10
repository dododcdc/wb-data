# 离线开发模块设计文档

**日期**：2026-04-10
**状态**：头脑风暴阶段
**参与人**：dcdc, dodo

---

## 一、核心定位

离线开发模块是 wb-data 的任务编排平台，用于可视化编排和执行 Kestra Flow。
用户通过拖拽式 DAG 画布构建任务流程，文件存储于 Gitea，执行引擎为 Kestra。

---

## 二、技术架构

| 组件 | 角色 |
|-----|------|
| Gitea | Git 仓库，**唯一真相源**，存储 Flow 定义和脚本文件 |
| Kestra | 执行引擎，从 Gitea SyncFlows 同步后执行任务 |
| wb-data | 用户界面 + 项目组管理，不维护 Flow 文件副本 |

---

## 三、目录结构

使用 Kestra 官方约定的目录结构：

```
📁 Gitea 仓库
│
├── 📁 _flows/
│     └── 📁 {namespace}/
│           ├── 📁 {任务A}/
│           │     └── flow.yaml      ← Kestra 读的 Flow 定义
│           └── 📁 {任务B}/
│                 └── flow.yaml
│
└── 📁 scripts/
      ├── 📁 {任务A}/
      │     ├── query.sql
      │     └── transform.sh
      └── 📁 {任务B}/
            └── query.sql
```

**说明**：
- `_flows/` 是 Kestra SyncFlows 的扫描根目录（约定，不可更改）
- `scripts/` 存放 Flow 引用的脚本文件，可与 `_flows/` 下的任务目录结构对应
- namespace 在 `flow.yaml` 内部定义（如 `namespace: pg-{project_group_id}`）
- `_flows/` 下的嵌套目录层级**自由**，Kestra 只扫描所有子目录的 `flow.yaml`
- wb-data 左侧项目树直接映射 Gitea 的 `_flows/` 目录结构

---

## 四、画布界面

### 4.1 布局（三栏）

| 区域 | 内容 |
|-----|------|
| 左侧 | 项目树（Gitea `_flows/` 目录映射） |
| 中间 | 画布（节点 + DAG 连线） |
| 右侧 | 节点类型面板 |

### 4.2 节点类型（MVP）

| 节点类型 | 说明 |
|---------|------|
| SQL 节点 | 双击弹出全屏编辑面板 → 选择数据源 → 写 SQL |
| Shell 节点 | 双击弹出全屏编辑面板 → 写 Shell 脚本 |

**数据源选择**：SQL 节点复用 wb-data 已配置的数据源（MySQL / PostgreSQL / Hive / StarRocks）。

### 4.3 节点编辑界面

**全屏切换视图**（点击节点后画布切换到编辑视图，关闭后回到画布）。

### 4.4 连线规则

- **支持分支并行**：A → [B, C 并行] → D
- **不做条件分支**（SWITCH / if-else）
- **连线样式**：折线（直角），自动避开节点
- **join 逻辑**：Kestra 的 `Parallel` 任务自动处理等待逻辑，wb-data 只需生成正确 YAML

### 4.5 DAG → Kestra YAML 编译

画布上的 DAG 编译为 Kestra YAML 示例：

```yaml
tasks:
  - id: A
    type: io.kestra.plugin.scripts.shell.Commands
    commands:
      - bash {{ namespaceFiles['scripts/taskA/run.sh'] }}

  - id: parallel_tasks
    type: io.kestra.plugin.core.flow.Parallel
    tasks:
      - id: B
        type: io.kestra.plugin.hive.queries.Query
        datasourceId: "{{ inputs.hive_ds }}"
        sql: "SELECT * FROM table_a;"
      - id: C
        type: io.kestra.plugin.scripts.shell.Commands
        commands:
          - bash {{ namespaceFiles['scripts/taskA/transform.sh'] }}

  - id: D
    type: io.kestra.plugin.scripts.shell.Commands
    commands:
      - bash {{ namespaceFiles['scripts/taskA/export.sh'] }}
```

当检测到 D 有两条入边来自 B 和 C，自动将 B 和 C 包入 `Parallel` 块。

---

## 五、Git 操作

| 操作 | 触发时机 | 实现方式 |
|-----|---------|---------|
| 读取 | 打开 Flow | 后端调 Gitea API 拉取 `_flows/{任务名}/flow.yaml` |
| 上线 | 点"上线" | wb-data 调 Gitea API 执行 add + commit + push |
| SyncFlows | push 后自动触发 | Kestra 官方插件处理，非 wb-data 实现 |

**上线流程**：填写 commit message → 确认 → Gitea add + commit + push → push 成功触发 Kestra SyncFlows → Kestra 同步 Flow 到执行环境。

---

## 六、锁机制（MVP）

- **粒度**：Flow 级别（锁整个任务）
- **行为**：用户 A 打开 Flow → 加锁 → 用户 B 打开同一 Flow → 提示"其他用户正在编辑" → 用户 A 关闭页面或切换 Flow → 锁释放
- **未覆盖**：节点级别锁、多节点并发编辑冲突处理

---

## 七、待后续完善的功能

以下功能 MVP 不做，记录于此：

1. **参数组** — 系统级参数组（全项目组可用）+ 项目级参数组（项目组负责人创建），参数名 + 参数值，可在节点中引用
2. **本地草稿机制** — 保存 ≠ 上线，用户可先保存再决定何时上线
3. **冲突处理** — 上线时检测 Gitea 远程是否有新版本
4. **节点级数据传递** — 前置节点的输出结果作为后置节点的输入
5. **条件分支** — SWITCH / if-else 逻辑
6. **节点级别锁** — 从 Flow 级别细化到 Task 节点级别
7. **查询历史** — 后端存储用户执行过的历史查询
8. **查询保存/收藏**
9. **定时调度**
10. **结果分享**

---

## 八、MVP 范围总结

| 功能 | MVP 是否包含 |
|-----|------------|
| 三栏画布界面 | ✅ |
| SQL 节点 + Shell 节点 | ✅ |
| 全屏节点编辑面板 | ✅ |
| 分支并行 DAG | ✅ |
| 折线连线 | ✅ |
| Gitea 目录树映射 | ✅ |
| Flow 级别锁 | ✅ |
| 上线（commit + push）| ✅ |
| Kestra 执行触发 | ✅ |
| 目录层级管理 | ✅（Gitea 端管理） |
| 条件分支 | ❌ |
| 节点数据传递 | ❌ |
| 参数组 | ❌ |
| 本地草稿 | ❌ |
| 冲突处理 | ❌ |

---

## 九、讨论纪要

### 目录结构讨论（2026-04-10）

- 用户曾提出将脚本和 `flow.yaml` 放在同一任务目录下（而不是 `_flows/` 和 `scripts/` 分开）
- 经讨论，**采用官方约定的 `_flows/` + `scripts/` 双目录结构**，更规范且便于未来扩展共享脚本
- Gitea 嵌套目录完全支持，Kestra 的 `includeChildNamespaces: true` 可递归扫描
- namespace 定义在 `flow.yaml` 内部，与目录路径无关
