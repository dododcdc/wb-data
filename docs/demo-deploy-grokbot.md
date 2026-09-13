# 演示部署（Grok Bot 机器 + Nginx + Jar + Tailscale Funnel）

本文描述把 WB-Data **临时**部署到 Grok Bot 本机、用 Tailscale Funnel 给朋友看的操作。  
**不是**长期生产方案：这台机器会更新/重置，公网入口也无访客登录墙。

相关：日常开发见 [本地开发](local-development.md)。GitHub Actions 自动部署暂不做；你 `push` 后跟我说一声，我在本机拉代码、构建、重启。

## 拓扑

```text
朋友浏览器
  → https://cursor.tail84596d.ts.net   (Tailscale Funnel，按需开关)
    → 本机 Nginx :80
         ├─ /          → 前端 dist 静态文件
         └─ /api/      → 反代 http://127.0.0.1:8080
              → java -jar wb-data-backend-*.jar
                   → Docker：MySQL（必选）；Kestra / Hive / ClickHouse（按演示范围）
```

同域由 Nginx 托管页面并反代 `/api`，浏览器不跨源，一般**不必**再配 `WB_DATA_CORS_ORIGINS`。若有人仍直连 `:5173` 开发服，继续用本地开发文档里的 CORS 说明。

当前 Tailscale 本机 DNS：`cursor.tail84596d.ts.net`（以 `tailscale status` 为准）。

## 演示范围建议

| 范围 | 要起的东西 | 说明 |
| --- | --- | --- |
| 管理端 / 数据源 / 查询 | MySQL + Nginx + Jar | 最小演示 |
| 离线画布执行 | 上面 + Kestra | 需 `dev` 的 host 改写等，见本地开发文档 |
| 数据传输 | 再加 Hive / SeaTunnel 相关 | 环境更重，按需 |

给外人看时优先最小范围；演示账号用弱权限，不要发 `sys_admin` 强密码到群里。Funnel **没有**访问控制，链接等于公开。

## 一次性准备

### 1. Tailscale

本机已安装 `tailscale`。需保持登录且在线：

```bash
tailscale status
# 期望 Backend 在线；本机名类似 cursor.tail….ts.net
```

未登录时在本机完成 `tailscale login`（需你在浏览器确认）。

### 2. Nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

配置示例（路径按仓库在 `/workspace/wb-data` 调整）：

```nginx
server {
    listen 80 default_server;
    server_name _;

    root /workspace/wb-data/wb-data-frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用并检查：

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI http://127.0.0.1/ | head -5
curl -sI http://127.0.0.1/api/v1/ | head -5
```

### 3. 依赖服务

管理端最小集：

```bash
docker compose -f docker/docker-compose.mysql.yml up -d
```

## 构建与启动（本机）

仓库根目录：`/workspace/wb-data`。

### 后端与插件

```bash
cd /workspace/wb-data/wb-data-server
mvn -q clean install -DskipTests
cd /workspace/wb-data
bash scripts/prepare-plugins.sh
```

### 前端

```bash
cd /workspace/wb-data/wb-data-frontend
npm ci
npm run build
# 产出：wb-data-frontend/dist
```

### 启动 Jar

演示阶段可继续用 `dev` profile（本地默认库、插件路径等）。**不要**把真实密钥写进仓库。

```bash
cd /workspace/wb-data/wb-data-server/wb-data-backend
SPRING_PROFILES_ACTIVE=dev \
DB_PASSWORD=<mysql-password> \
java -jar target/wb-data-backend-0.0.1-SNAPSHOT.jar
```

需要种子账号时再加 `WB_DATA_SEED_DEV_DATA=true` 与 `WB_DATA_DEV_DEFAULT_PASSWORD=...`（见本地开发文档）。

建议用 `systemd` 用户单元或 `tmux`/`nohup` 保活，避免关掉终端就停。端口占用时先停掉开发用的旧 Java / Vite（`:8080` / `:5173`），避免和 Nginx 演示栈抢后端。

## 打开 / 关闭公网（Funnel）

先确保本机 Nginx `:80` 与后端 `:8080` 正常，再开 Funnel：

```bash
# 把公网 HTTPS 指到本机 Nginx
sudo tailscale funnel --bg 80
tailscale funnel status
```

朋友访问：`https://cursor.tail84596d.ts.net`（以 status 里的 DNS 名为准）。

看完关掉：

```bash
sudo tailscale funnel off
# 或按 funnel status 提示关闭对应 handler
```

若 `tailscale status` 里出现 iptables/connmark 内核模块告警，Funnel 可能异常：先本机 `curl` 验证 Nginx，再排查 Funnel；必要时改用短时 `cloudflared tunnel --url http://127.0.0.1`（随机 `*.trycloudflare.com`，无固定域名）。

## 你改代码后怎么更新

约定（暂无 Actions）：

1. 你推到 `origin/main`（或约定分支）
2. 在聊天里跟我说一声（可附 commit / 要不要含 Kestra）
3. 我在本机执行大致流程：

```bash
cd /workspace/wb-data
git pull --ff-only
# 按改动范围：
#   仅前端 → npm ci && npm run build，reload nginx
#   含后端 → mvn install + prepare-plugins，重启 jar
#   含 compose → 再 up -d 对应文件
```

## 安全与边界

- Funnel 打开期间等同公网只读入口暴露；演示完立刻 `funnel off`
- 勿长期把强管理员密码留在演示环境；演示后可改密或关掉 Funnel
- 数据源里不要填生产库；本机 Docker 演示库即可
- 机器重置后需重装依赖、重登 Tailscale、重建 `dist` / 再起 Jar
- Cloudflare Tunnel + Access、自购域名、VPS、GitHub Actions：有需要再单开文档

## 快速检查清单

- [ ] `tailscale status` 在线
- [ ] MySQL 容器健康
- [ ] `dist` 已构建且 Nginx `root` 指向正确
- [ ] Jar 在 `:8080` 响应
- [ ] `curl http://127.0.0.1/api/...` 经 Nginx 通
- [ ] Funnel 仅在需要时开启；分享链接后约定关闭时间
