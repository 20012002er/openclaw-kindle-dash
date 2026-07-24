# Kindle OpenClaw 仪表盘

把旧 Kindle 变成一个低功耗仪表盘，实时展示你自托管的 [OpenClaw](https://github.com/openclaw/openclaw) AI 网关的用量数据。

![Kindle Dashboard](./example/photo.jpg)

## 仪表盘效果

![Dashboard Demo](./example/dashboard-demo.png)

## 项目简介

本项目将 Kindle Paperwhite（或其他越狱过的 Kindle 型号）变成一个常亮、超低功耗的仪表盘，可视化自托管 OpenClaw 网关的用量数据。项目由两部分组成：

1. **后端服务** (`server/`) — Node.js 服务，部署在 OpenClaw 所在的服务器上。通过 WebSocket RPC 连接到 OpenClaw 网关，获取用量数据，渲染适合 e-ink 屏幕的 HTML 仪表盘，并截图生成与 Kindle 屏幕分辨率匹配的灰度 PNG 图片。
2. **Kindle 客户端** (`src/`) — 运行在 Kindle 上的轻量 Shell 脚本。周期性从后端拉取最新的 PNG 图片，显示在 e-ink 屏幕上，并在两次刷新之间将设备挂起到内存（suspend to RAM）以最大限度省电。

后端按计划（默认每 5 分钟）预生成仪表盘图片；Kindle 按自己的计划（默认每 10 分钟）唤醒、拉取新图片、显示、再休眠。一次充电可使用数周。

## 架构

```
┌─────────────────────────────────────────────┐
│              阿里云服务器                    │
│  ┌─────────────┐      ┌──────────────────┐  │
│  │  OpenClaw   │      │  kindle-dash     │  │
│  │  Gateway    │◄────►│  后端服务 (Node)  │  │
│  │  (WS RPC)   │ WS   │                  │  │
│  └─────────────┘      │  • 获取用量数据   │  │
│                       │  • 渲染 HTML      │  │
│                       │  • 截图生成 PNG   │  │
│                       │  • 提供 HTTP 服务 │  │
│                       └────────┬─────────┘  │
└────────────────────────────────┼────────────┘
                                 │ HTTP
                                 ▼
┌─────────────────────────────────────────────┐
│              Kindle Paperwhite              │
│  ┌───────────────────────────────────────┐  │
│  │  dash.sh                             │  │
│  │  • 通过 RTC 唤醒                     │  │
│  │  • 用 xh 拉取 dash.png               │  │
│  │  • 用 eips 显示到 e-ink 屏幕         │  │
│  │  • 挂起到内存（省电）                │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 功能特性

- **实时 OpenClaw 指标** — Token 用量、消息数、活跃会话、热门模型、Provider 配额（DeepSeek 余额、z.ai 用量窗口）、渠道状态（WebChat、Telegram、QQ Bot 等）
- **E-ink 优化渲染** — 纯黑白、高对比度、无抗锯齿、CSS 条形图，针对 Kindle Paperwhite 第 7 代（1072×1448 竖屏）调优
- **WebSocket RPC** — 直连 OpenClaw 网关 WebSocket，支持 `token` 和 `password` 两种认证模式
- **超低功耗** — Kindle 在两次刷新之间挂起到内存；一次充电可用数周
- **RTC 唤醒** — 自动检测不同 Kindle 型号的 RTC 路径，确保按计划可靠唤醒
- **Docker 部署** — 通过 `docker compose up -d --build` 一键部署
- **可配置计划** — 后端每 5 分钟生成新图片（cron）；Kindle 每 10 分钟刷新一次（可配置）
- **灰度转换** — PNG 转为纯灰度（无 alpha 通道），确保 e-ink 显示清晰
- **调试端点** — `GET /debug` 返回标准化后的 JSON 数据，方便排查问题

## 前置条件

### 服务端
- 一台运行 OpenClaw 网关的服务器（使用 `password` 或 `token` 认证模式）
- 已安装 Docker 和 Docker Compose

### Kindle 端
- 一台已越狱的 Kindle，已配置 Wi-Fi
- 通过 [USBNetwork](https://wiki.mobileread.com/wiki/USBNetwork) 配置 SSH 访问
- 已在 Kindle Paperwhite 第 7 代上测试；其他越狱过的 Kindle 型号经少量修改也应可用

## 后端服务部署

### 1. 配置

```sh
cd server
cp .env.example .env
vi .env
```

`.env` 中的关键配置：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCLAW_BASE_URL` | `http://127.0.0.1:18789` | OpenClaw 网关地址（当后端与 OpenClaw 同机部署且使用 `network_mode: host` 时用 `127.0.0.1`） |
| `OPENCLAW_CREDENTIAL` | — | 你的 OpenClaw 网关密码或 token |
| `FETCH_MODE` | `api` | `api` = 通过 WS 连接 OpenClaw；`mock` = 使用模拟数据（用于测试） |
| `PORT` | `3000` | HTTP 服务端口 |
| `OUTPUT_FILE` | `public/dash.png` | 生成的 PNG 输出路径 |
| `GENERATE_CRON` | `*/5 * * * *` | 图片生成的 cron 计划 |
| `SCREEN_WIDTH` | `1072` | Kindle 屏幕宽度（竖屏） |
| `SCREEN_HEIGHT` | `1448` | Kindle 屏幕高度（竖屏） |

### 2. 部署

```sh
# 准备 public 目录权限（UID 1000 对应容器内的 node 用户）
mkdir -p ./public && chown -R 1000:1000 ./public

# 构建并启动
docker compose up -d --build
```

### 3. 验证

```sh
# 查看日志
docker compose logs -f

# 查看标准化后的数据（不生成图片）
curl http://localhost:3000/debug | python3 -m json.tool

# 手动触发生成图片
curl -X POST http://localhost:3000/generate

# 下载生成的图片
curl http://localhost:3000/dash.png -o test.png
```

## Kindle 客户端安装

### 1. 下载并解压

在电脑上下载 [最新 release](https://github.com/20012002er/openclaw-kindle-dash/releases) 并解压。

### 2. 配置

编辑 `local/env.sh`，将 `DASHBOARD_URL` 指向你的服务器：

```sh
export DASHBOARD_URL="http://你的阿里云公网IP:3000/dash.png"
```

`local/env.sh` 中的其他选项：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DASHBOARD_URL` | — | **必填** — 后端 `/dash.png` 端点的 URL |
| `REFRESH_SCHEDULE` | `*/10 * * * *` | Kindle 唤醒/刷新的 cron 计划 |
| `TIMEZONE` | `Asia/Shanghai` | cron 计算用的时区 |
| `FULL_DISPLAY_REFRESH_RATE` | `4` | 每 N 次局部刷新后做一次全屏刷新（消除残影） |
| `SLEEP_SCREEN_INTERVAL` | `3600` | 当下次唤醒间隔超过 N 秒时显示休眠界面 |

### 3. 推送到 Kindle

```sh
rsync -vr ./ kindle:/mnt/us/dashboard
```

### 4. 启动

通过 SSH：
```sh
ssh root@kindle "/mnt/us/dashboard/start.sh"
```

或通过 [KUAL](https://wiki.mobileread.com/wiki/KUAL)：将 `KUAL/kindle-dash/` 复制到 `/mnt/us/extensions/kindle-dash/`，然后从 KUAL 菜单启动。

启动后约 10–15 秒设备会进入挂起。屏幕按配置的 cron 计划刷新。

### 5. 停止

```sh
ssh root@kindle "/mnt/us/dashboard/stop.sh"
```

## 工作原理

### 服务端
1. 启动时和每 5 分钟（cron）连接 OpenClaw 网关 WebSocket
2. 用 `password` 或 `token` 认证（通过 `OPENCLAW_AUTH_MODE` 配置）
3. 并行调用 `sessions.usage` 和 `usage.status` RPC 方法
4. 将响应标准化为统一格式（tokens、messages、models、channels、providers）
5. 渲染 e-ink 友好的 HTML 模板
6. 用 Puppeteer 将 HTML 截图为 PNG
7. 将 PNG 转为纯灰度（无 alpha 通道）
8. 通过 `GET /dash.png` 提供 PNG

### Kindle 端
1. 启动时停止 Kindle 框架，进入循环
2. 每次循环：通过 `xh` HTTP 客户端拉取 `dash.png`
3. 用 `eips`（Kindle 的 e-ink 显示工具）显示图片
4. 用 `next-wakeup` 计算到下次 cron 触发的秒数
5. 设置 RTC 唤醒闹钟（`/sys/class/rtc/rtc0/wakealarm`）并挂起到内存
6. 唤醒后从第 2 步重复

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/dash.png` | 生成的仪表盘图片（PNG） |
| `GET` | `/health` | 健康检查 |
| `GET` | `/debug` | 标准化后的 JSON 数据（用于排查） |
| `POST` | `/generate` | 手动触发图片生成 |

## 调试

### 服务端日志
```sh
docker compose logs -f
```

### 服务端数据检查
```sh
curl http://localhost:3000/debug | python3 -m json.tool
```

### Kindle 日志
```sh
ssh root@kindle "tail -50 /mnt/us/dashboard/logs/dash.log"
```

### 常见问题

| 症状 | 原因 / 解决 |
|---|---|
| 服务端日志：`WS fetch failed: connect ECONNREFUSED` | OpenClaw 未运行，或 `OPENCLAW_BASE_URL` 错误。使用 Docker 时确保 `network_mode: host` 或用 `host.docker.internal` |
| 服务端日志：`RPC error (connect)` | `OPENCLAW_CREDENTIAL` 错误或认证模式不匹配 |
| Kindle 日志：`Wi-Fi connected` 但屏幕不更新 | Kindle 访问不到 `DASHBOARD_URL`；在 Kindle 上用 `curl` 测试 |
| Kindle 日志：`cat: can't open '.../wakeup_enable'` | 旧版 RTC 路径；最新 `dash.sh` 已自动检测 `/sys/class/rtc/rtc0/wakealarm` |
| E-ink 屏幕残影 | 减小 `FULL_DISPLAY_REFRESH_RATE`（如改为 `2`） |
| 耗电太快 | 增大 `REFRESH_SCHEDULE` 间隔（如 `0 * * * *` = 每小时一次） |

## 开发文档

详见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 致谢

- 原 kindle-dash 项目 [pascalw/kindle-dash](https://github.com/pascalw/kindle-dash)
- 灵感来源 [davidhampgonsalves/life-dashboard](https://github.com/davidhampgonsalves/life-dashboard)
- [OpenClaw](https://github.com/openclaw/openclaw) — 本仪表盘所可视化的 AI 网关

## License

MIT
