# 调度配置弹窗重设计

**日期**: 2026-05-04
**状态**: 已确认

---

## 一、概述

重设计 `ScheduleDialog` 组件，移除预设/Cron 双模式，仅保留 Cron 表达式方式，改善交互和反馈。

## 二、变更点

| 项目 | 当前 | 改为 |
|---|---|---|
| 模式 | 无模式区分 | 仅 Cron 表达式（不引入预设 UI） |
| 启用/停用 | 独立按钮「停用/启用调度」 | 标题栏右侧开关控件 |
| 保存按钮 | 「保存调度」 | 「暂存调度」（单个按钮） |
| 执行预览 | 无 | 未来 3 次执行时间，cron 无效时报错 |
| Flow 标识 | 文件路径 `_flows/.../flow.yaml` | Flow 名称（从路径提取） |
| 生效提示 | 无 | 底部灰色小字 |

## 三、弹窗布局（自上而下）

1. **标题栏** — 左侧「调度配置」+ Flow 名称，右侧启用/停用开关
2. **Cron 表达式** — 文本输入，placeholder `例如：0 10 * * *`，下方标注「分 时 日 月 周」
3. **时区** — 文本输入，默认浏览器本地时区
4. **执行预览** — 绿色底色区域，显示未来 3 次执行时间；cron 无效时红色底色显示错误信息
5. **暂存按钮** — 右对齐，「暂存调度」
6. **提示文字** — 居中灰色小字：「设置将在 Commit + Push 后由 Kestra 同步生效」

## 四、交互规则

- **打开弹窗**：读取 Flow YAML 中已有的 Schedule trigger，回填 cron、时区、启用状态
- **无调度时**：cron 输入框空白，开关默认关闭，预览区显示「请先配置调度时间」，暂存按钮置灰
- **Cron 无效时**：预览区红色显示「无效的 cron 表达式」，暂存按钮置灰
- **开关切换**：单独调用 `PATCH /status` 接口，不依赖暂存按钮
- **暂存调度**：调用 `PUT` 接口写入 cron + 时区到本地 YAML
- **Kestra 兼容**：`disabled` 属性为 Kestra 原生支持，后端已实现

## 五、后端改动

无。三个 API 端点保持不变：
- `GET /api/v1/offline/schedule` — 读取
- `PUT /api/v1/offline/schedule` — 更新 cron + timezone
- `PATCH /api/v1/offline/schedule/status` — 切换 enabled

## 六、前端改动范围

- `OfflineWorkbench.tsx` — `ScheduleDialog` 组件重写
- `offline.ts` API 层 — 接口不变
- 新增依赖：`cron-parser` npm 包，用于计算未来执行时间
