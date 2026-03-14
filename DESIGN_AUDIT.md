# 设计质量审计报告

## Anti-Patterns Verdict

**Fail** — 存在明显 AI 生成痕迹和设计问题：

1. **发光效果残留** — `box-shadow: 0 0 15px var(--accent-glow)` 在 splitter 分隔条上
2. **硬编码颜色** — 7处使用十六进制颜色而非 CSS 变量
3. **Touch target 过小** — 多处 36px 高度按钮（应为 44px）
4. **Focus 样式缺失** — Query 页面按钮无 focus-visible 样式

---

## Executive Summary

| 类别 | 问题数 |
|------|--------|
| Critical | 3 |
| High | 5 |
| Medium | 8 |
| Low | 12 |

**Top 3 问题**：
1. Splitter 发光效果（AI 风格残留）
2. 无障碍：缺少 ARIA 标签和 focus 样式
3. 响应式：多处 touch target < 44px

---

## Critical Issues

### 1. Splitter 发光效果残留
- **Location**: `Query.css` 行 94, 149
- **Severity**: Critical
- **Category**: Anti-Patterns
- **Description**: 分隔条拖动时仍有 `box-shadow: 0 0 15px var(--accent-glow)` 发光效果
- **Impact**: AI 生成界面的标志性特征，降低专业感
- **Fix**: 移除发光效果，改用简洁的线条或色块变化
- **Command**: `/quieter`

### 2. 缺少 Focus 可见样式
- **Location**: `Query.css` - 所有交互按钮
- **Severity**: Critical
- **Category**: Accessibility
- **Description**: 格式化按钮、Run 按钮等缺少 `:focus-visible` 样式
- **Impact**: 键盘用户无法看到焦点位置，违反 WCAG 2.1
- **Fix**: 添加 `outline` 或 `ring` 样式
- **Command**: `/harden`

### 3. 硬编码颜色未使用 Design Tokens
- **Location**: `Query.css` 行 6, 252, 486, 570, 647, 677, 683
- **Severity**: Critical
- **Category**: Theming
- **Description**: 7处使用硬编码十六进制颜色，如 `#1e1e1e`, `#475569`, `#64748b`
- **Impact**: 无法支持主题切换，维护困难
- **Fix**: 替换为 `var(--color-*)` 变量
- **Command**: `/normalize`

---

## High-Severity Issues

### 4. Touch Target 过小
- **Location**: `Query.css` 行 328, 373, 406, 550 (36px)
- **Severity**: High
- **Category**: Responsive
- **Description**: 工具栏按钮高度为 36px，小于 Apple HIG 推荐的 44px
- **Impact**: 移动端用户容易误触
- **Fix**: 将 `height: 36px` 改为 `height: 44px`
- **Command**: `/adapt`

### 5. 缺少 ARIA 属性
- **Location**: `Query.tsx` - Tooltip 组件
- **Severity**: High
- **Category**: Accessibility
- **Description**: @ark-ui Tooltip 未配置 `aria-label`
- **Impact**: 屏幕阅读器用户无法理解提示内容
- **Fix**: 添加 `aria-describedby` 或在 Trigger 上加 `aria-label`
- **Command**: `/harden`

### 6. 颜色对比度不足
- **Location**: `Query.css` 行 202 (table-summary)
- **Severity**: High
- **Category**: Accessibility
- **Description**: 表名颜色使用 `#cbd5e1`，在浅色背景下对比度可能不足
- **Impact**: 低视力用户难以阅读
- **Fix**: 使用 `--color-text-secondary` 或更深的颜色
- **Command**: `/normalize`

---

## Medium-Severity Issues

### 7. 残留 Dark 模式变量
- **Location**: `Query.css` 行 3-9
- **Severity**: Medium
- **Category**: Theming
- **Description**: 定义了 `--bg-sidebar`, `--text-primary` 等变量但未使用
- **Impact**: 代码冗余，容易混淆
- **Fix**: 删除未使用的变量定义
- **Command**: `/distill`

### 8. 按钮 active 反馈不一致
- **Location**: `Query.css` - Run vs 格式化按钮
- **Severity**: Medium
- **Category**: UX/Consistency
- **Description**: Run 有 `transform: scale(0.98)`，格式化没有
- **Impact**: 用户感受不一致
- **Fix**: 统一 active 反馈效果
- **Command**: `/normalize`

### 9. 缺少 Skip Link
- **Location**: 所有页面
- **Severity**: Medium
- **Category**: Accessibility
- **Description**: 缺少 "Skip to main content" 链接
- **Impact**: 键盘用户需要多次 Tab 才能到达内容
- **Fix**: 添加 skip link
- **Command**: `/harden`

### 10. 表格 hover 样式问题
- **Location**: `Query.css` 行 212-215
- **Severity**: Medium
- **Category**: UX
- **Description**: 表节点 hover 使用 `rgba(255, 255, 255, 0.05)`，浅色模式下效果不明显
- **Impact**: 用户难以区分当前选中项
- **Fix**: 使用 `var(--color-bg-tertiary)` 或 `var(--color-accent-glow)`
- **Command**: `/normalize`

---

## Low-Severity Issues

1. 注释过多（行 301 "/* Tooltip (DataGrip style) */"）
2. 重复的 border-radius 定义（多处 `var(--radius-md)` 和 `6px` 混用）
3. 缺少 Loading 状态的骨架屏
4. 错误信息样式可以更友好
5. 下载按钮可以添加文件名提示

---

## Positive Findings

1. **浅色主题统一** — Query 页面已改为浅色，与其他页面一致
2. **Design Tokens 提取** — tokens.css 包含完整的颜色、间距、圆角变量
3. **按钮结构清晰** — 工具栏按钮使用 flex 布局，间距适当
4. **Monaco Editor 集成良好** — 主题与页面风格匹配

---

## Recommendations by Priority

### Immediate (Critical)
1. 移除 splitter 发光效果
2. 替换硬编码颜色为 CSS 变量
3. 添加 focus-visible 样式

### Short-term (High)
4. 增大 touch target 到 44px
5. 修复表格颜色对比度
6. 添加 ARIA 属性

### Medium-term
7. 清理未使用变量
8. 统一按钮 active 效果
9. 添加 skip link

---

## Suggested Commands

| 问题 | Command |
|------|---------|
| 发光效果残留 | `/quieter` |
| 硬编码颜色 | `/normalize` |
| Touch target | `/adapt` |
| Focus/ARIA | `/harden` |
| 代码冗余 | `/distill` |
