# 本地开发 CORS 端口通配设计

## 背景

Vite 在多个 worktree 中启动时会依次使用 5173、5174、5175 等端口。浏览器对 `/api` 的同源请求经过 Vite 代理后仍携带原始 `Origin`，后端 `CorsFilter` 因默认白名单只包含 5173 而返回 `403 Invalid CORS request`。

## 目标

- `localhost` 和 `127.0.0.1` 上的任意开发端口都能通过后端 CORS 校验。
- 保留现有 Tailnet 域名访问。
- 不使用全局 `*`，不放宽非本机来源。
- 生产环境继续通过 `WB_DATA_CORS_ORIGINS` 显式覆盖允许来源。

## 方案

修改 `application.yml` 中 `wbdata.cors.allowed-origins` 的默认值：

```text
http://localhost:[*],http://127.0.0.1:[*],https://dododcdc.tail84596d.ts.net
```

现有 `WebMvcConfig` 已调用 `setAllowedOriginPatterns`，Spring Framework 6.1 支持 `:[*]` 表示任意端口，并在匹配后返回具体 Origin，因此可继续与 `allowCredentials=true` 配合使用。

不新增 Spring Profile：当前项目没有激活 `dev` Profile 的启动约定，直接新增 Profile 会导致现有 `java -jar` 启动方式仍无法访问 5174。默认值服务本地开发；部署环境必须通过已有环境变量提供严格域名列表。

## 安全边界

- 仅允许 `http://localhost` 和 `http://127.0.0.1` 的端口通配。
- 不允许任意主机、任意协议或任意域名。
- `WB_DATA_CORS_ORIGINS` 的优先级保持不变；生产配置不会合并本地默认值。
- 认证和权限校验保持不变，CORS 只决定浏览器来源是否可进入接口处理链。

## 测试与验收

新增后端配置测试，加载实际 `application.yml` 和 `WebMvcConfig`，验证：

- `http://localhost:5174`、`:5175`、`:5176`、`:5177` 可通过。
- `http://127.0.0.1` 的动态端口可通过。
- 非白名单来源仍返回 403。
- 修改后运行后端测试，并以携带 `Origin: http://localhost:5174` 的登录请求验证不再被 CORS 拦截。
