# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

wb-data is a data processing center with two main components:
- **Frontend**: React + Vite + TypeScript SPA
- **Backend**: Spring Boot 3.2.2 + Java 21 multi-module Maven project

## Build Commands

### Frontend (`wb-data-frontend/`)
```bash
npm install          # Install dependencies
npm run dev          # Start dev server (proxies /api to localhost:8080)
npm run build        # Production build (TypeScript + Vite)
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

### Backend (`wb-data-server/`)
```bash
mvn clean install                # Build all modules
mvn -pl wb-data-backend spring-boot:run  # Run backend only
```

The backend starts on port 8080. The frontend dev server proxies `/api` requests to it.

## Architecture

### Frontend Structure
- `src/views/` - Page components (Dashboard, Query, DataSourceList, UserList, Login)
- `src/components/` - Shared UI components (shadcn/ui based)
- `src/api/` - API clients (auth, query, datasource, user)
- `src/utils/` - Utilities (auth store, request axios instance)
- `src/router/` - React Router setup with lazy-loaded route modules
- `src/hooks/` - Custom hooks (useAuthContext, useDelayedBusy, useKeyboardFocusMode)

**Routing**: Uses React Router v7 with lazy loading. Route modules are functions that return dynamic imports via `routeModules.ts`.

**State Management**: Zustand store (`src/utils/auth.ts`) manages auth state (token, user context, current project group, permissions).

**Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin.

### Backend Structure
```
wb-data-server/
├── pom.xml                    # Parent POM, defines all modules
├── wb-data-plugin-api/        # Plugin interface (DataSourcePlugin, etc.)
├── wb-data-plugin-mysql/      # MySQL plugin implementation
├── wb-data-plugin-postgresql/ # PostgreSQL plugin implementation
├── wb-data-plugin-hive/      # Hive plugin implementation
├── wb-data-plugin-starrocks/ # StarRocks plugin implementation
└── wb-data-backend/           # Main Spring Boot application
```

**Key Packages** (`com.wbdata`):
- `auth/` - Authentication (login, JWT tokens, permissions)
- `user/` - User management (CRUD, group assignment)
- `group/` - Project group management (members, preferences)
- `datasource/` - Data source CRUD, plugin registry, connection pool
- `query/` - SQL query execution, metadata, export
- `common/` - Shared (Result wrapper, GlobalExceptionHandler)

**Plugin System**: `DataSourcePlugin` interface in `wb-data-plugin-api`. Each database type implements this interface and is registered via `DataSourcePluginRegistry`. Plugins are discovered via Java ServiceLoader (`META-INF/services`).

### Permission Model
- Users belong to Project Groups
- Project Groups have permissions (`datasource.read`, `query.use`)
- System Admin role bypasses permission checks
- Routes protected by `RequirePermission` and `RequireSystemAdmin` guards

## Database
- MySQL for application data (users, groups, datasources)
- Flyway migrations in `wb-data-backend/src/main/resources/db/migration/`
- HikariCP connection pooling with Caffeine cache for datasource connection pools

## API
- REST API under `/api`
- Swagger UI at `/swagger-ui.html` (springdoc-openapi)
- JWT authentication via `Authorization: Bearer <token>` header
