# 通知与错误展示规则

## 决策树

操作失败后，用户是否需要当前页面上下文才能理解/处理这个错误？

- **是 → Inline Error**（保持在上下文内展示）
  - 表单提交失败 → 表单底部 banner (`.form-feedback-error`)
  - 字段校验失败 → 字段下方 (`.input-error`)
  - SQL 执行失败 → 结果面板内卡片 (`QueryResultsPanel`)
  - 列表加载失败 → DataTable 行内错误 (`DataTableShell`)
- **否 → Global Toast**（右上角 `OperationFeedback`）
  - CRUD 增删改成功/失败
  - 启用/停用操作
  - 下载失败
  - 其他导航无关的独立操作

## 时长规则

| Toast 类型 | 默认时长 | 说明 |
|-----------|---------|------|
| `success` | 3000ms | 快速确认 |
| `info`    | 3000ms | 简短提示 |
| `error`   | 5000ms | 错误需要更多阅读时间 |

Inline Error：**无自动消失**，用户操作后才清除。

## API

```typescript
const { showFeedback, showSuccess, showError, dismissFeedback } = useOperationFeedback();

// 通用方法（可自定义 tone 和时长）
showFeedback({ tone: 'info', title: '处理中…', detail: '' });

// 便捷方法（自动推断时长）
showSuccess('保存成功');
showError(error, '保存失败');  // 自动调用 getErrorMessage
dismissFeedback();
```

## 注意

- 不要使用 `showFeedback` 展示 SQL 执行结果（应使用 `QueryResultsPanel` 行内卡片）
- 不要使用 `showFeedback` 展示字段校验错误（应使用 `.input-error` 组件）
- 错误 toast 默认时长 5000ms，传 `durationMs` 参数可覆盖
