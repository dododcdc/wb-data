# `@pierre/trees` 用于离线开发目录树的适配评估

> 调研时间：2026-08-16  
> 调研范围：[`trees.software`](https://trees.software/)、官方文档、官方 GitHub 源码与 issue、npm 元数据。本文没有采用第三方评测。

## 结论

`@pierre/trees` **能够替换 WB-Data 现有目录树的渲染与基础交互层，但不适合现在直接做一次性“完全重构”**。

它对文件树最难实现的通用能力覆盖得很好：虚拟化、键盘导航、搜索、多选、右键菜单、行内重命名和拖拽都已内置，测试也较扎实。WB-Data 当前使用 React 18.3.1，正好位于其官方 peer dependency 范围内。

但是它不是普通的受控 React TreeView，而是一个“路径优先、模型持有状态、Shadow DOM 渲染”的文件树引擎。WB-Data 仍需自行负责：

- `OfflineRepoTreeNode` 与 UI 路径之间的双向映射；
- 当前 Flow 与库内选择状态的同步；
- 刷新后的展开状态保留；
- 新建、删除、重命名、移动的后端持久化和失败回滚；
- 权限、业务状态和现有暖色视觉的适配。

尤其需要注意：官网明确说明该项目仍处于 **Beta**，Beta 版本间可能继续发生小型 API 调整；当前最新版同时也是 beta 版 `1.0.0-beta.6`。[官方 Beta 说明](https://trees.software/docs#overview) · [npm 版本](https://www.npmjs.com/package/@pierre/trees/v/1.0.0-beta.6)

因此建议先做一个隔离原型，而不是立刻删除现有 `RepoTreeBranch`。原型通过本文末尾的验收条件后，再决定是否正式替换。

## 1. 项目身份和成熟度

| 项目 | 调研结果 |
| --- | --- |
| 真实包名 | `@pierre/trees` |
| 定位 | Path-first file tree UI，不是任意业务树或 headless tree |
| 官方入口 | 核心/Vanilla：`@pierre/trees`；React：`@pierre/trees/react`；SSR：`@pierre/trees/ssr`；Web Component：`@pierre/trees/web-components` |
| 最新版本 | `1.0.0-beta.6`；npm 的 `latest` 与 `beta` 均指向该版本 |
| 首次发布 | 2026-03-16 |
| 最新发布 | 2026-07-25 |
| 许可证 | Apache-2.0，并附带来自 `headless-tree/core` 的 NOTICE |

包名、四个入口和路径模型来自[官方 README](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/README.md)；版本、peer dependencies 和发布结构见[官方 package.json](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/package.json)。许可证和归属要求见[LICENSE](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/LICENSE.md)与[NOTICE](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/NOTICE.md)。

维护活跃度不差：截至调研日，官方仓库未归档，最近一个月 `packages/trees` 仍有搜索、公开导航 API 和 beta.6 发布等提交；npm 官方下载 API 显示 2026-07-17 至 2026-08-15 有 1,945,424 次下载。[相关提交记录](https://github.com/pierrecomputer/pierre/commits/main/packages/trees) · [npm 下载数据](https://api.npmjs.org/downloads/point/last-month/@pierre%2Ftrees)

不过，发布历史只有约五个月且没有稳定版。生产采用时应锁定精确版本，不使用 `^1.0.0-beta.6` 自动接收后续 beta。

## 2. 与 WB-Data 技术栈的兼容性

### React 与 TypeScript

- React peer 范围是 `^18.3.1 || ^19.0.0`，WB-Data 当前为 React `18.3.1`，直接满足要求。
- 包是 ESM-only，提供 `.d.ts` 类型声明；WB-Data 使用 Vite、TypeScript strict mode，与其发布形式兼容。
- React 入口只是对同一命令式模型的包装。`useFileTree(options)` 只创建一次模型，后续 option 变化会被刻意忽略，调用方必须使用 `resetPaths()`、`setComposition()` 等模型方法更新。[React Hook 源码](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/src/react/useFileTree.ts) · [React API](https://trees.software/docs#react-api-usefiletree)

### SSR

库支持 declarative Shadow DOM 的 SSR 和 hydration，但服务端与客户端必须使用一致的 ID、路径和影响初始状态的配置，否则会产生 hydration mismatch。[SSR 文档](https://trees.software/docs#ssr)

WB-Data 当前是 Vite SPA，目录树不需要为了引入该库而增加 SSR；这一能力暂时没有直接收益。

### 浏览器

官方 monorepo 的目标是 Chrome/Edge 123+、Safari 17.5+、Firefox 125+。[`.browserslistrc`](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/.browserslistrc)

但需要保守理解这项信息：该文件的注释主要列出 docs 与 `@pierre/diffs`，`@pierre/trees` 的 npm 元数据没有单独公布浏览器兼容矩阵，也没有 `engines` 字段。其样式使用 Shadow DOM、`:has()`、`light-dark()` 和 `color-mix()` 等现代能力，因此不应承诺支持旧版企业浏览器。

## 3. 功能覆盖

| 能力 | 支持情况 | 对 WB-Data 的含义 |
| --- | --- | --- |
| 展开/折叠 | 支持初始全开、全关、按深度、指定路径；目录 handle 可 `expand/collapse/toggle` | 能实现现有行为，但不是 React 受控 prop |
| 选择 | 单选、多选、范围选择；`onSelectionChange` 与 React selector hook | 需要适配为 WB-Data 的“单一活动 Flow”语义 |
| 新增/删除/移动 | `add/remove/move/batch/resetPaths` | 只改前端模型；服务端持久化仍归 WB-Data |
| 重命名 | 行内 rename；支持 `canRename/onRename/onError` | 可替换现有对话框，但必须设计异步失败回滚 |
| 右键菜单 | 右键、行尾按钮或两者；React `renderContextMenu` | 能复用现有 shadcn/Radix 菜单，需做 path → node 映射 |
| 拖拽 | 多项拖拽、`canDrag/canDrop`、完成与错误回调 | 当前后端没有完整 move 工作流，不宜第一阶段启用 |
| 键盘 | 方向键、Home/End、多选组合键和键盘菜单；使用 `tree/treeitem` ARIA | 明显优于当前递归按钮实现 |
| 搜索 | `hide-non-matches`、`collapse-non-matches`、`expand-matches` | 可作为新增能力，不必另写搜索树算法 |
| 虚拟化 | 默认内置，只渲染可见窗口和 overscan | 大目录时是主要收益；宿主必须设置真实高度 |
| 异步子树加载 | 没有公开 loader API | 当前后端一次性返回整棵树时无影响；未来做懒加载会受限 |
| 任意节点渲染 | 不支持通用 `renderItem/renderRow` | 复杂业务徽标、多个行内按钮或特殊 Flow 行结构受限 |

官方对选择、焦点、键盘和搜索的说明见[导航指南](https://trees.software/docs#navigate-selection-focus-and-search)，重命名、拖拽、右键菜单和持久化边界见[交互指南](https://trees.software/docs#rename-drag-and-trigger-item-actions)，虚拟化与大树策略见[性能指南](https://trees.software/docs#handle-large-trees-efficiently)。公开类型见[模型 API](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/src/model/publicTypes.ts)。

## 4. 最关键的状态边界

### 4.1 它不是传统的完全受控组件

它没有如下 React API：

```tsx
<FileTree
  expandedPaths={expandedPaths}
  selectedPaths={selectedPaths}
  onExpandedPathsChange={setExpandedPaths}
/>
```

真实模式是：树模型拥有状态，React selector 读取状态，应用通过模型或 item handle 发命令。选择有 `useFileTreeSelection()`，但展开状态没有对应的公开 React hook 或 `onExpansionChange`。目录展开状态要通过 `model.getItem(path)` 后的 handle 查询和改变。[选择 Hook](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/src/react/useFileTreeSelection.ts) · [item handle 类型](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/src/model/publicTypes.ts#L121-L141)

### 4.2 它不会自动解决“刷新后保持折叠”

`resetPaths()` 会创建新的底层 path store。若不显式传 `initialExpandedPaths`，新 store 会重新使用模型构造时的初始展开规则，而不是自动继承用户当前展开集合。[`resetPaths()` 源码](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/src/model/FileTreeController.ts#L1262-L1337)

这与刚修复的 WB-Data 问题直接相关：如果初始规则是全部展开，而服务端刷新后简单调用 `resetPaths(paths)`，所有目录仍可能再次展开。

正式适配必须选择一种策略：

1. 刷新前遍历已知目录，通过 item handle 采集 `isExpanded()`，再将仍存在的目录作为 `initialExpandedPaths` 传给 `resetPaths()`；或
2. 对已知新建、删除、移动操作使用 `add/remove/move` 增量更新，只在真正的全量刷新时重建路径；或
3. 在 WB-Data 自己的 store 中长期持有展开集合，将库当作该集合的命令执行器。

第一种最接近当前实现，第三种最可控，但需要写一层适配器。

### 4.3 “点击 Flow 打开文档”需要额外适配

库没有独立的 `onItemActivate`/`onItemClick` 公共回调。普通点击首先改变选择；文件打开通常由应用监听选择变化后实现。官方自己的 IDE 示例也写了一层 `useOpenTabs`，从 `useFileTreeSelection(model)` 找到最新选中的文件，再同步活动 tab。[官方 TreeApp 示例](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/apps/docs/app/%28trees%29/_components/TreeApp.tsx#L632-L807)

WB-Data 只有一个活动 Flow，应实现更严格的适配：目录选择只展开，不打开；Flow 选择调用 `onOpenFlow`；切换活动 Flow 时反向同步库内选择；即使用户按 Ctrl/Meta 产生多选，也不能让多个 Flow 同时变成活动文档。

## 5. 数据模型适配

现有服务端返回的是业务树：

```ts
interface OfflineRepoTreeNode {
  id: string;
  kind: 'ROOT' | 'DIRECTORY' | 'FLOW';
  name: string;
  path: string;
  children: OfflineRepoTreeNode[];
}
```

`@pierre/trees` 的公共身份则是 canonical path string，输入主体是 `paths` 或 `preparedInput`，不是带任意业务字段的节点对象。[路径优先说明](https://trees.software/docs#choose-your-integration-1-path-first-identity) · [输入形态](https://trees.software/docs#shared-concepts-input-shapes)

建议适配器输出：

```ts
interface OfflineTreeAdapterResult {
  paths: string[];
  nodeByTreePath: Map<string, OfflineRepoTreeNode>;
  treePathByNodeId: Map<string, string>;
  treePathByFlowPath: Map<string, string>;
}
```

具体规则需要在原型中验证：

- 目录路径以 `/` 结尾；
- Flow 在库内必须表现为“文件叶子”，才能与目录区分；
- 当前后端 Flow 路径以 `flow.yaml` 结尾，但界面显示的是上一级 Flow 名称。可以为树构造不带后缀的 UI 路径，并通过 map 保留真实后端路径；
- 若要保留当前可右键的根节点，应把根名称作为所有 UI 路径的共同前缀，因为库的自然 root 是隐式的；
- 权限、组 ID、业务节点 ID、活动状态不应编码进展示路径，而应保留在映射中。

这意味着它可以替换树引擎，但不能替换 WB-Data 的业务模型。

## 6. 增删改、右键菜单和拖拽的持久化风险

官方明确区分：树拥有交互表面，应用拥有持久化。[官方交互指南](https://trees.software/docs#rename-drag-and-trigger-item-actions-the-tree-owns-the-interaction-surface-your-app-owns-persistence)

更具体地说：

- 行内重命名会先触发 `onRename`，随后立即在本地模型中执行 `move()`；回调不是可 `await` 的事务接口。[重命名源码](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/src/model/FileTreeController.ts#L1174-L1251)
- 拖拽完成时，模型先执行本地 `move/batch`，再调用 `onDropComplete`。[拖拽源码](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/src/model/FileTreeController.ts#L983-L1041)

因此后端 API 失败时，WB-Data 必须主动回滚或重新拉取服务端树。第一阶段建议：

- 保留现有新建、重命名、删除对话框及 API 流程；
- 只用 `renderContextMenu` 触发现有命令；
- 请求成功后再刷新/增量更新树模型；
- 暂不启用内置行内 rename 与 drag-and-drop。

这能先获得虚拟化、搜索、键盘和可访问性收益，同时避免把 Git/后端事务逻辑与乐观 UI 绑死。

## 7. 样式定制与 Shadow DOM

官方提供四层样式入口：

1. 宿主元素的普通 `className/style`；
2. `--trees-*` CSS variables；
3. `themeToTreeStyles()` 将 VS Code/Shiki 风格主题映射成变量；
4. `unsafeCSS` 向 Shadow Root 注入原始 CSS。

详见[样式文档](https://trees.software/docs#styling-and-theming)与[官方 README 示例](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/README.md#styling)。

对 WB-Data 的影响是：现有 `.offline-tree-row`、Tailwind selector 和普通级联样式不能直接穿透 Shadow DOM。颜色、行高、hover、选中和 focus 大多可用变量表达；12px 圆角、特殊间距或更精细的行布局可能需要 `unsafeCSS`。

`unsafeCSS` 是官方定义的 escape hatch，不宜靠它复制整套组件 CSS。如果最终为了还原当前设计需要大量注入内部 selector，说明这个库的封装边界并不适合本项目。

此外，目前没有完整的任意节点 renderer；`renderRowDecoration` 只支持一段文字或一个图标。复杂 badge、多按钮和按业务类型改变整行结构仍受限。[任意节点渲染请求 #498](https://github.com/pierrecomputer/pierre/issues/498) · [更开放的渲染架构提案 #691](https://github.com/pierrecomputer/pierre/issues/691)

## 8. 依赖与体积

`1.0.0-beta.6` 的 npm 元数据显示：

- 发布包 244 个文件；
- unpacked size 1,456,269 bytes，约 1.39 MiB；
- 直接运行依赖为 `preact@11.0.0-beta.0`、`preact-render-to-string@6.6.5` 和 `@pierre/theming@1.0.0`；
- React 与 React DOM 是 peer dependencies；
- 内部的 `@pierre/path-store` 在发布时内联，不会作为单独依赖安装。[npm 元数据](https://registry.npmjs.org/%40pierre%2Ftrees/1.0.0-beta.6) · [发布说明](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/PUBLISHING.md)

对官方 tarball 的静态盘点显示 `dist` 中 JS 合计约 471 KB（未压缩、未合并），但这不是 Vite 最终 bundle 大小，不能拿来当用户实际下载量。官方尚未提供可靠的 production minify/gzip 基准。

还存在一个开放的[内置图标 tree-shaking 问题 #864](https://github.com/pierrecomputer/pierre/issues/864)。若做原型，应以 WB-Data 自己的 `npm run build` 产物为准，比较引入前后的主 chunk 与懒加载 chunk，而不是依赖宣传数据。

## 9. 测试成熟度

按调研时官方 `main` 目录计数，`packages/trees/test` 包含：

- 30 个 unit/integration 测试文件；
- 10 个 Playwright E2E spec；
- 测试源码中约 387 个 `test()`/`it()` 用例。

覆盖选择、键盘、搜索、拖拽、重命名、动态 mutation、虚拟化、SSR hydration、Shadow DOM 样式隔离和 Git 状态。[测试目录](https://github.com/pierrecomputer/pierre/tree/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/test) · [测试策略](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/test/TESTING.md) · [CI](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/.github/workflows/ci.yml)

需要保留两点风险：

- Playwright 配置只运行 Chromium，没有 Firefox/WebKit 项目。[Playwright 配置](https://github.com/pierrecomputer/pierre/blob/d9eb0ab8e5c8e797520aecda0e1d9ba74e281ac8/packages/trees/test/e2e/playwright.config.ts)
- 官方未公布覆盖率百分比，也没有发现独立 WCAG 审计；ARIA 与键盘支持有源码测试，但不能等同于正式无障碍认证。

## 10. 已知限制与开放问题

以下均来自官方 issue。Bug issue 是用户报告，不等于维护者已经确认根因，但适合作为原型回归清单：

- [#498：缺少任意节点 renderer](https://github.com/pierrecomputer/pierre/issues/498)
- [#691：更完整的 headless/插件化 row lane 仍是提案](https://github.com/pierrecomputer/pierre/issues/691)
- [#725：缺少异步数据 loader](https://github.com/pierrecomputer/pierre/issues/725)
- [#803：Vanilla 入口仍要求 React peer dependency](https://github.com/pierrecomputer/pierre/issues/803)
- [#864：内置图标 tree-shaking](https://github.com/pierrecomputer/pierre/issues/864)
- [#664：连续右键不同节点时的菜单问题](https://github.com/pierrecomputer/pierre/issues/664)
- [#816：特定 Chrome/Safari 缩放比例下的错误省略号](https://github.com/pierrecomputer/pierre/issues/816)
- [#941：深层单一路径显示不理想](https://github.com/pierrecomputer/pierre/issues/941)
- [#1027：flatten 后整条路径尾截断仍是提案](https://github.com/pierrecomputer/pierre/issues/1027)
- [#1069：按目录名或展开状态灵活定制目录图标仍是提案](https://github.com/pierrecomputer/pierre/issues/1069)

## 11. 建议的实施路径

### 阶段 A：隔离原型，不进入主流程

只替换目录树内容区，保留分支切换、新建、刷新、提交、推送工具栏和现有 API 调用链。

原型至少验证：

1. 折叠若干目录后刷新，展开状态完全不变；
2. 新建 Flow 后只展开其祖先路径，不展开无关目录；
3. 活动 Flow 高亮、鼠标打开、键盘选择和外部切换能双向同步；
4. 根、目录、Flow 的右键菜单能完整映射到现有业务节点；
5. 后端重命名/删除失败时 UI 不出现幽灵路径；
6. 暖色视觉能主要通过 CSS variables 完成，而不是依赖大段 `unsafeCSS`；
7. 100、1,000、10,000 个节点的首屏、滚动和搜索表现；
8. `npm run build` 前后 bundle 体积差异；
9. Chrome、Safari、Firefox 的键盘、菜单和省略号表现。

### 阶段 B：受控地替换渲染层

原型通过后：

- 增加独立 `offlineTreeAdapter.ts`，业务代码不直接拼接库路径；
- 模型只创建一次，服务端刷新走统一的状态保留更新函数；
- 将右键菜单通过库的 composition surface 接回现有命令；
- 为刷新保留展开状态、Flow 激活同步、path 映射和失败恢复补齐回归测试；
- 锁定精确 beta 版本并记录升级检查项。

### 阶段 C：再决定是否启用高级交互

行内重命名和拖拽移动应在后端具备明确的 move/rename 事务、权限校验和失败回滚以后再启用。它们不应作为引库第一阶段的附带改动。

## 最终判断

| 问题 | 判断 |
| --- | --- |
| 技术上能否用它重构左侧目录？ | 能 |
| 是否是直接替换现有递归 JSX 的 drop-in 组件？ | 不是 |
| 是否能减少通用树交互代码？ | 能，尤其是虚拟化、键盘、搜索、选择和菜单定位 |
| 是否能替代 WB-Data 的树业务状态和后端流程？ | 不能 |
| 是否建议现在一次性完全重构？ | 不建议 |
| 建议下一步 | 做一个隔离原型，以刷新状态、Flow 映射、菜单、视觉和 bundle 为 Go/No-Go 标准 |

如果原型必须大量操作 Shadow DOM 内部结构、模拟完全受控展开状态，或为单活动 Flow 语义反复对抗内置多选模型，就应停止替换，继续强化当前轻量目录树，而不是因为库功能多而强行采用。
