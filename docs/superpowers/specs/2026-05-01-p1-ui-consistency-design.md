# P1 UI 一致性收口设计文档

## 1. 背景与目标

当前前端仍存在几类高频且用户可感知的 UI 不一致问题：
- **静默失败**：`AddMemberDialog` 中成员搜索失败会表现成“未找到匹配用户”，用户无法区分“无结果”和“请求失败”。
- **确认体验不统一**：`GitSettingsTab` 仍使用原生 `window.confirm`，而其他危险操作已经逐步迁移到应用内确认弹窗。
- **异步搜索下拉重复实现**：`DataSourceSelect`、`OfflineDataSourcePicker`、`AddMemberDialog` 各维护一套搜索下拉逻辑，导致状态、交互和可维护性持续分叉。
- **Tooltip 规范未落地**：项目已有统一 Tooltip 组件，但仍有多个交互入口使用原生 `title=` 作为提示。

本次设计仅覆盖 P1 范围，对应 issue `#14 #15 #21 #22`。目标是优先收敛最明显的交互不一致，同时控制改动面，为后续 `#20 #23 #24 #26` 留出可复用基础。

## 2. 实施边界

本轮按共享基础设施优先的方式落地，但在一次连续开发中完成以下三个子阶段：

1. **确认弹窗收口**：用现有 `ConfirmDialog` 替换 `GitSettingsTab` 中的 `window.confirm`。
2. **异步搜索下拉收口**：以 `DataSourceSelect` 为共享底座，补足当前通用能力，并让 `OfflineDataSourcePicker` 与 `AddMemberDialog` 回到统一实现轨道。
3. **Tooltip 收口**：先替换交互按钮、操作入口类 `title=` 用法；暂不一次性清理所有文本回显类 `title=`。

## 3. 详细设计

### 3.1 危险操作确认统一

#### 3.1.1 组件策略
- 不新增新的确认组件。
- 继续以 `wb-data-frontend/src/components/ui/confirm-dialog.tsx` 作为唯一标准实现。
- 仅在现有组件无法满足当前删除 Git 配置场景时做最小增强，避免扩散为新一轮 Dialog 体系重构。

#### 3.1.2 业务接入
- 将 `wb-data-frontend/src/views/group-settings/GitSettingsTab.tsx` 中的 `window.confirm(...)` 替换为 `ConfirmDialog`。
- 对齐以下行为：
  - 标题、说明文案、危险按钮文案统一由 Dialog 呈现。
  - 删除提交中禁用取消/确认按钮，避免重复提交。
  - 关闭逻辑遵循现有应用内 Dialog 模式，而不是浏览器阻塞式确认。

### 3.2 异步搜索下拉统一

#### 3.2.1 共享底座选择
- 使用 `wb-data-frontend/src/components/DataSourceSelect.tsx` 作为共享异步搜索选择器底座。
- 不继续保留 `OfflineDataSourcePicker` 和 `AddMemberDialog` 的独立 dropdown 状态机作为长期方案。

#### 3.2.2 通用能力补齐
`DataSourceSelect` 需要补齐当前 P1 所需的最小能力：
- **显式错误态**：支持在下拉面板中展示“加载失败”而不是沿用空态文案。
- **更丰富的选项内容**：支持主标题之外的辅助描述，用于成员搜索场景展示 `username` 与 `displayName`。
- **保留已有行为**：
  - 输入法组合输入处理
  - loading / loadingMore / hasMore / onLoadMore
  - 关闭时清空输入并恢复已选值显示

本轮不把它扩展成超大而全的组件；只补齐已经被至少两个业务场景需要的能力。

#### 3.2.3 业务迁移
- `OfflineDataSourcePicker` 调整为：
  - 直接使用共享选择器，或
  - 降级为极薄封装，只负责离线场景的数据映射与文案透传
- `AddMemberDialog` 调整为：
  - 使用共享选择器承载搜索输入、loading、empty、error、选择行为
  - 不再自己维护 `showDropdown`、点击外部关闭、结果列表渲染等整套交互逻辑

#### 3.2.4 静默失败修复
- `AddMemberDialog` 中成员搜索请求失败时，必须进入明确的错误态。
- “未找到匹配用户”只在请求成功且结果为空时出现。
- 关闭弹窗、清空选择、重新搜索后，错误态应被正常重置。

### 3.3 Tooltip 使用规范收口

#### 3.3.1 共享入口
- 继续使用 `wb-data-frontend/src/components/ui/tooltip.tsx` 作为标准 Tooltip 入口。
- 在该入口处统一默认延迟与基础样式使用方式，避免业务代码各自决定交互节奏。

#### 3.3.2 本轮处理范围
- 优先替换以下类型的 `title=`：
  - 图标按钮
  - 操作按钮
  - 明确承担“交互提示”职责的操作入口
- 典型目标包括但不限于：
  - `UserList.tsx`
  - `DataSourceList.tsx`
  - `GroupSettingsPage.tsx`
  - `QueryResultsPanel.tsx`
  - `Layout.tsx`
  - `FlowCanvas.tsx`

#### 3.3.3 暂不处理范围
- 纯文本溢出回显
- 表格单元格为了展示完整值而设置的 `title=`
- 需要结合更大信息架构调整才能决定的 Tooltip 文案问题

这一边界确保本轮聚焦“交互提示统一”，而不是把所有 `title=` 都混成一次高风险清理。

## 4. 技术注意事项

- **不要引入第二套通用组件**：如果 `DataSourceSelect` 可演进，就优先演进它，而不是再创建新的 `AsyncCombobox` 并保留旧实现。
- **错误态和空态必须语义分离**：共享选择器 API 需要明确表达错误场景，避免业务层再次用空数组伪装失败。
- **Tooltip 替换要保守**：交互提示和文本补全不是一回事，第一轮只动交互提示。
- **避免顺手扩大到 #19 / #20 / #23**：即使实现中会碰到相关代码，也不在本轮顺带做完整统一。

## 5. 验收标准

- `GitSettingsTab` 不再使用 `window.confirm` 删除 Git 配置。
- `AddMemberDialog` 中成员搜索失败时，用户能看到明确失败反馈，而不是“未找到匹配用户”。
- `OfflineDataSourcePicker` 与 `AddMemberDialog` 不再长期维护独立异步搜索下拉实现。
- 本轮目标文件中的交互按钮类 `title=` 改为统一 Tooltip 用法。
- 现有主要流程行为不倒退：搜索、选择、加载更多、关闭重开、删除确认都保持可用。

## 6. 验证计划

- **组件/行为测试**
  - 验证确认弹窗的打开、取消、确认、loading 态行为。
  - 验证共享异步搜索选择器的 loading / empty / error 三态区分。
  - 验证搜索词变化、关闭重开、重新选择时的状态重置。
- **业务回归**
  - 验证删除 Git 配置流程可正常完成。
  - 验证添加成员时的搜索成功、无结果、请求失败三种路径。
  - 验证离线数据源选择的搜索、滚动加载更多、选中行为保持正常。
- **交互一致性检查**
  - 验证目标文件中的操作入口改用统一 Tooltip 后，提示仍可访问且不影响点击行为。
