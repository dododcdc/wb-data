# [统一列表搜索与分页通用逻辑] 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套标准的前后端分页与搜索架构，消除内存过滤导致的性能隐患，并统一 UI 表现。

**Architecture:** 后端引入通用的 `PageQuery` 和 `PageResult` DTO，通过工具类标准化 MyBatis-Plus 的分页转换；前端封装 `useDataTable` Hook，统一管理查询状态并集成 `react-query`。

**Tech Stack:** Java 21, MyBatis-Plus, React 18, TanStack Query v5.

---

### Task 1: 后端分页基础设施

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/common/dto/PageQuery.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/common/dto/PageResult.java`
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/common/util/PaginationUtils.java`

- [ ] **Step 1: 创建 PageQuery 基础查询 DTO**
- [ ] **Step 2: 创建 PageResult 统一响应 DTO**
- [ ] **Step 3: 编译验证**

### Task 2: 前端通用分页 Hook

**Files:**
- Create: `wb-data-frontend/src/hooks/useDataTable.ts`

- [ ] **Step 1: 编写 useDataTable Hook**

### Task 3: 试点重构 - 项目列表 (Group List)

**Files:**
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/service/GroupService.java`

- [ ] **Step 1: 优化后端 countMembersByGroupIds 逻辑**
- [ ] **Step 2: 应用后端通用 DTO 到 listGroups**
- [ ] **Step 3: 前端组件接入 useDataTable**

### Task 4: 试点重构 - 成员列表 (Member List)

**Files:**
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/service/GroupSettingsService.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/group/controller/GroupSettingsController.java`

- [ ] **Step 1: 更新 Controller 接口参数**
- [ ] **Step 2: 更新 Service 实现**
- [ ] **Step 3: 验证**
