# Execution Log Page Redesign

## Goal

Rebuild `ExecutionDetailPage` to make logs the absolute protagonist. Strip all chrome, collapse the sidebar into top tabs, and add real-time polling and log level filtering.

## Layout

```
┌──────────────────────────────────────────────────────┐
│ ← kkk  ● 运行中  00:03:12              36px top bar │
├──────────────────────────────────────────────────────┤
│ [全部] [node_1 ✓] [node_2 ⏳] [node_3 ✓] [nod…] ←→  │  32px tab row
├──────────────────────────────────────────────────────┤
│ ERROR:2  WARN:5  INFO:120       🔍 search  ⬇ bottom │  32px toolbar
├──────────────────────────────────────────────────────┤
│ 10:30:01  ERROR  node_2  Connection timeout          │  log body
│ 10:30:05  WARN   node_3  Missing index               │
│ 10:30:08  INFO   node_1  Query completed             │
└──────────────────────────────────────────────────────┘
```

## Components

### Top Bar (36px)

- `←` button: navigates back to flow editor, restoring canvas and tree state
- Flow name (e.g. `kkk`): identity when multiple tabs are open
- Status dot + text:
  - Running: `● 运行中 00:03:12` (live counter, ticks every second)
  - Terminal: `● 成功 14:30:00 → 14:32:45` (start → end, no elapsed)

### Tab Row (32px)

- `全部日志` always first, merges logs from all nodes sorted by timestamp
- Node tabs follow in topological order
- Each tab: `name + status icon` only, no elapsed time (avoids visual jitter)
- Overflow: horizontal scroll with fade indicators on edges
- Filtered out: `flow_dag`, `parallel_*` tasks
- When a node tab is selected: log rows omit the taskId column

### Toolbar (32px)

- Log level chips: `ERROR:N WARN:N INFO:N`
  - Click to toggle filter, multi-select supported
  - Filtered-out levels greyed out but keep their count
- Search input: Enter to trigger, matches against log message
- Scroll-to-bottom button: always visible, jumps to latest logs
  - Auto-scroll only when user is already at bottom
  - If user scrolled up (reading history), do not steal scroll position

### Log Body

- All-logs view: `HH:mm:ss | LEVEL | taskId | message` (4 columns)
- Single-node view: `HH:mm:ss | LEVEL | message` (3 columns, wider)
- Timestamp: `HH:mm:ss` only (date is implied by execution context)
- **Virtual scrolling** via `react-virtuoso`: only renders rows within the visible viewport (~40 DOM nodes) regardless of total log count. Critical for Hive jobs that can produce thousands of log lines. Also provides built-in auto-scroll-to-bottom and "load more" behavior.

## Auto-Refresh

- Trigger: execution status is RUNNING / PAUSED / RETRYING
- Interval: 3 seconds
- Scope: only the currently selected tab; other tabs are stale until selected
- Stop: when status becomes terminal
- Tab switch: immediate full fetch of the new tab's logs

## Empty / Error States

| State | Display |
|-------|---------|
| Loading | Skeleton placeholder |
| No logs | "当前节点暂无日志输出" |
| Network error | Error message + retry button |

## Back Navigation

Returning to the flow editor must restore canvas state and directory tree state as they were before leaving.

## What Is Removed

- Top navigation bar (only back button remains)
- Left sidebar (replaced by top tab row)
- Summary card with execution ID, branch, start/end time (status + timing compressed into top bar)
- Page title "执行详情" and its wasted horizontal space

## Tab Overflow

Horizontal scroll with left/right fade indicators. Typical flows have 3-10 nodes and won't overflow. For larger flows, the scrollable row handles it.

## Dependencies

- `react-virtuoso` — virtual scrolling for log body. Chosen over `react-window` because it handles dynamic row heights (log messages vary in length and may wrap), has first-class scroll-to-bottom support, and is the standard choice for log/chat UIs.

## Out of Scope

- Gantt / timeline visualization (future iteration)
- Log export / download (future iteration)
