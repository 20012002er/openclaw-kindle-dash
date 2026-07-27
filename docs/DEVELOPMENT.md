# kindle-dash 开发与定制化指南

本指南面向希望理解项目工作原理、进行二次开发或定制化部署的开发者。如果只是想开箱即用，请先阅读根目录的 [README.md](../README.md)。

---

## 1. 项目概览

kindle-dash 将旧款 Kindle 设备改造成低功耗仪表盘：周期性地通过 HTTP(s) 拉取一张 PNG 图片显示在屏幕上，随后挂起到内存（suspend to RAM）以节省电量，等到下一次刷新时刻再由 RTC 唤醒。

**重要设计原则**：本仓库只包含运行在 Kindle 端的代码，**不负责渲染仪表盘**。仪表盘图像应由外部服务生成后通过 HTTP(s) 提供。这样既节能，也让用户可以自由选择渲染工具（dashbling、Puppeteer、Grafana Image Renderer 等）。

### 1.1 支持设备

- 主要测试设备：Kindle 4 NT（分辨率 800×600）
- 理论上其他越狱 Kindle 也可运行，可能需要调整 `eips` 调用、RTC 路径或 `sleeping.png` 尺寸

### 1.2 运行前提

1. 越狱后的 Kindle，且已配置 Wi-Fi
2. Kindle 上已启用 SSH 服务（通过 [USBNetwork](https://wiki.mobileread.com/wiki/USBNetwork)）
3. （推荐）安装 KUAL，便于启动扩展

---

## 2. 仓库结构

```
kindle-dash/
├── src/                          # 源代码（部署到 Kindle 的内容）
│   ├── dash.sh                   # 主循环脚本
│   ├── start.sh                  # 入口脚本，加载 env 并后台启动 dash.sh
│   ├── stop.sh                   # 停止 dash.sh 进程
│   ├── wait-for-wifi.sh          # 等待 Wi-Fi 联网
│   ├── sleeping.png              # 休眠时显示的图片
│   ├── local/                    # 用户可定制的本地配置与脚本
│   │   ├── env.sh                # 环境变量配置
│   │   ├── fetch-dashboard.sh    # 抓取仪表盘图片的脚本
│   │   ├── low-battery.sh        # 低电量通知钩子
│   │   └── state/                # 运行时状态目录（如最近一次低电量上报时间）
│   └── next-wakeup/              # Rust 项目：计算 cron 下一次唤醒时间
│       ├── Cargo.toml
│       └── src/main.rs
├── server/                       # 后端服务：多模板仪表盘 + 定时生成 PNG
│   ├── src/
│   │   ├── index.js              # Express 服务 + 每模板 cron 调度器
│   │   ├── admin.html            # 管理面板界面（响应式）
│   │   ├── auth.js               # 管理面板认证（express-session）
│   │   ├── settings.js           # 配置持久化 + getCronForTemplate（data/settings.json）
│   │   ├── screenshot.js         # Puppeteer 截图 + 灰度转换
│   │   ├── fetch-usage.js        # OpenClaw WebSocket RPC 客户端
│   │   ├── fetch-weather.js      # wttr.in 天气获取
│   │   ├── fetch-todos.js        # Notion 待办获取
│   │   ├── parse-finance.js      # 财经快照 md 解析（指数/期货/加密货币）
│   │   ├── parse-finance-trend.js# 财经走势 md 解析（JSON 块 + 补充文件）
│   │   ├── render-calendar.js    # 日历数据（农历+节假日，使用 lunar-javascript）
│   │   ├── render-dashboard.js   # OpenClaw 仪表盘 HTML 渲染
│   │   └── templates/            # 仪表盘模板（可插拔）
│   │       ├── index.js          # 模板注册表（getTemplate, listTemplates）
│   │       ├── openclaw.js       # OpenClaw 用量模板
│   │       ├── calendar-weather-todo.js  # 日历/天气/待办模板
│   │       ├── finance.js        # 财经快照模板（md 驱动）
│   │       └── finance-trend.js  # 财经一周走势模板（md 驱动）
│   ├── data/                     # 持久化数据目录
│   │   ├── settings.json         # 管理面板保存的运行时配置
│   │   ├── fince.md              # 财经快照示例数据
│   │   └── fince-data.md         # 财经一周走势示例数据
│   ├── .env.example              # 环境变量模板
│   ├── Dockerfile                # 容器化部署
│   ├── docker-compose.yml        # 编排配置
│   └── package.json
├── KUAL/                         # KUAL 扩展配置
│   └── kindle-dash/
│       ├── config.xml
│       └── menu.json
├── docs/
│   ├── DEVELOPMENT.md            # 本文件
│   ├── tipstricks.md             # 生成仪表盘图片的提示
│   ├── fince.md                  # 财经快照示例数据
│   ├── fince-data.md             # 财经一周走势示例数据
│   └── screenshotter/            # Puppeteer 截图参考实现
│       ├── Dockerfile
│       ├── screenshot.js
│       └── package.json
├── example/                      # 示例图片
├── .github/workflows/ci.yml      # CI：sh-checker（shellcheck + shfmt）
├── Makefile                      # 构建/打包入口
├── CHANGELOG.md
└── README.md
```

---

## 3. 工作原理

### 3.1 主循环流程

主逻辑位于 [src/dash.sh](../src/dash.sh)，其工作流如下：

```
start.sh
  └─ 加载 local/env.sh
  └─ 后台启动 dash.sh（输出重定向到 logs/dash.log）

dash.sh
  ├─ init()
  │   ├─ /etc/init.d/framework stop          # 关闭 Kindle 原生 UI
  │   ├─ initctl stop webreader              # 停止 webreader 服务
  │   ├─ echo powersave > cpufreq governor   # CPU 降频省电
  │   └─ lipc-set-prop preventScreenSaver 1  # 禁用屏保
  │
  └─ main_loop()  无限循环
      ├─ log_battery_stats()                 # 通过 gasgauge-info 读取电量
      │   └─ 若低于阈值，调用 local/low-battery.sh
      │
      ├─ next-wakeup --schedule=... --timezone=...
      │   └─ 解析 cron 表达式，返回距下次唤醒的秒数
      │
      ├─ 分支判断：
      │   ├─ 下次唤醒 > SLEEP_SCREEN_INTERVAL → 显示 sleeping.png，进入休眠
      │   └─ 否则 → refresh_dashboard()
      │       ├─ wait-for-wifi.sh $WIFI_TEST_IP
      │       ├─ local/fetch-dashboard.sh $DASH_PNG
      │       └─ eips -g dash.png             # 显示图片
      │           （每 FULL_DISPLAY_REFRESH_RATE 次做一次 -f 全屏刷新消除残影）
      │
      ├─ sleep 10  # 留出可被中断的时间窗口
      └─ rtc_sleep $next_wakeup_secs
          ├─ echo -n $duration > /sys/devices/platform/mxc_rtc.0/wakeup_enable
          └─ echo mem > /sys/power/state       # 挂起到内存
```

### 3.2 关键 Kindle 系统接口

| 接口 | 作用 |
| --- | --- |
| `/usr/sbin/eips -g <png>` | 在 e-ink 屏幕上绘制 PNG（部分刷新） |
| `/usr/sbin/eips -f -g <png>` | 全屏刷新绘制 PNG（消除残影） |
| `lipc-set-prop com.lab126.powerd preventScreenSaver 1` | 禁用系统屏保 |
| `gasgauge-info -c` | 读取电池百分比 |
| `/sys/devices/platform/mxc_rtc.0/wakeup_enable` | 写入秒数设置 RTC 唤醒 |
| `/sys/power/state` | 写入 `mem` 触发挂起到 RAM |
| `/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor` | CPU 调频策略（`powersave`） |

### 3.3 next-wakeup 二进制

[src/next-wakeup/src/main.rs](../src/next-wakeup/src/main.rs) 是一个 Rust 程序，依赖 `cron-parser`、`chrono`、`chrono-tz`、`pico-args`。它接收 cron 表达式与时区，输出**距离下次触发的秒数**。

```sh
next-wakeup --schedule='2,32 8-17 * * MON-FRI' --timezone='Europe/Amsterdam'
# 输出：例如 1874
```

> 注意：v1.0.0-beta.3 起 cron 解析改为更严格的标准实现，自定义表达式前请确认格式。

### 3.4 xh HTTP 客户端

`dist/xh` 是预编译的 [xh](https://github.com/ducaale/xh)（前身 `ht`）二进制，针对 `arm-unknown-linux-musleabi` 交叉编译。Kindle 自带的 `curl`/`wget` 链接了过时的 openssl，无法处理现代 HTTPS，因此必须使用 `xh`。

---

## 4. 配置项参考

所有配置通过环境变量传入，集中在 [src/local/env.sh](../src/local/env.sh)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WIFI_TEST_IP` | `1.1.1.1` | 用于 ping 检测 Wi-Fi 是否联通的目标 IP |
| `REFRESH_SCHEDULE` | `2,32 8-17 * * MON-FRI` | cron 表达式，工作日 8:02、8:32、…、17:32 各刷新一次 |
| `TIMEZONE` | `Europe/Amsterdam` | cron 表达式解释所用的时区 |
| `FULL_DISPLAY_REFRESH_RATE` | `4` | 每多少次部分刷新后触发一次全屏刷新（消除残影） |
| `SLEEP_SCREEN_INTERVAL` | `3600` | 当下次唤醒间隔 ≥ 此秒数时，显示 sleeping.png 而非刷新仪表盘 |
| `LOW_BATTERY_REPORTING` | `false` | 是否启用低电量上报钩子 |
| `LOW_BATTERY_THRESHOLD_PERCENT` | `10` | 触发低电量钩子的电量阈值（百分比） |
| `DEBUG` | `false` | 调试模式：启用 `set -x`，rtc_sleep 改用 `sleep` 不会真的挂起 |

### 4.1 cron 表达式示例

```cron
# 每小时的第 5 分钟刷新
REFRESH_SCHEDULE="5 * * * *"

# 每天 7:00、12:00、18:00 各一次
REFRESH_SCHEDULE="0 7,12,18 * * *"

# 工作日早 8 点到晚 6 点，每 15 分钟一次
REFRESH_SCHEDULE="*/15 8-18 * * MON-FRI"
```

---

## 5. 定制化场景

### 5.1 替换仪表盘图片来源

编辑 [src/local/fetch-dashboard.sh](../src/local/fetch-dashboard.sh)。约定：**第一个参数 `$1` 为输出 PNG 文件路径**，脚本必须将图片写入该路径。

```sh
#!/usr/bin/env sh
# 方案 A：直接从自己的 URL 拉取
"$(dirname "$0")/../xh" -d -q -o "$1" get https://your-server.example.com/dash.png

# 方案 B：从本地文件复制（需自行保证文件存在）
# cp /mnt/us/my-dashboard.png "$1"

# 方案 C：调用 xh 时附带认证头
# "$(dirname "$0")/../xh" -d -q -o "$1" \
#   get https://your-server.example.com/dash.png \
#   Authorization:"Bearer YOUR_TOKEN"
```

`fetch-dashboard.sh` 退出码非 0 时，主循环不会更新屏幕（保留上一帧）。

### 5.2 实现低电量通知

编辑 [src/local/low-battery.sh](../src/local/low-battery.sh)。脚本接收一个参数：当前电量百分比（数字）。

默认实现使用 `state/last_battery_report` 文件记录上次上报时间，24 小时内只上报一次。示例上报方式：

```sh
# 通过 xh 发送到 Webhook（如 ntfy、Bark、Home Assistant）
"$(dirname "$0")/../xh" post https://ntfy.example.com/kindle-battery \
  body:"Kindle battery at $battery_level_percentage%"
```

### 5.3 自定义休眠画面

替换 [src/sleeping.png](../src/sleeping.png)。注意：
- 格式：灰度 PNG，无 alpha 通道
- 尺寸：需匹配设备屏幕（Kindle 4 NT 为 800×600）

### 5.4 生成仪表盘图片

参考 [docs/screenshotter/screenshot.js](../docs/screenshotter/screenshot.js)：使用 Puppeteer 启动 headless Chrome，对网页截图后通过 `pngjs` 转为灰度 PNG。可直接用 [Dockerfile](../docs/screenshotter/Dockerfile) 部署：

```sh
cd docs/screenshotter
docker build -t kindle-screenshotter .
docker run -e URL=https://your-dashboard.example.com \
  -v "$PWD/out:/app" kindle-screenshotter
# 输出 /app/dash.png
```

关键约束：
1. 必须是**灰度 PNG，无 alpha 层**
2. 分辨率匹配 Kindle 屏幕（Kindle 4 NT：800×600）
3. 建议在页面 `networkidle2` 后再额外 `sleep` 一段时间，确保异步资源加载完成

### 5.5 通过 KUAL 启动

将 `KUAL/kindle-dash/` 目录复制到 Kindle 的 `/mnt/us/extensions/` 即可在 KUAL 菜单看到 "Kindle Dashboard" 项，点击即执行 `/mnt/us/dashboard/start.sh`。

如需调整菜单项名称或启动命令，修改 [KUAL/kindle-dash/menu.json](../KUAL/kindle-dash/menu.json)：

```json
{
  "items": [
    {"name": "你的菜单名", "action": "/mnt/us/dashboard/start.sh"}
  ]
}
```

### 5.6 仪表盘后端服务

本仓库在 `server/` 目录下提供了一个后端服务，采用**可插拔模板系统**，支持 OpenClaw 用量、日历/天气/待办、财经快照、财经一周走势等多种仪表盘，渲染为 e-ink 友好的 PNG，通过 HTTP 暴露给 Kindle 拉取。每个模板拥有独立的 cron 计划，可通过 Web 管理面板在浏览器中切换模板、编辑 cron、配置数据源。

#### 架构

```
[阿里云服务器]                              [Kindle Paperwhite]
┌─────────────────────────┐               ┌──────────────────┐
│ OpenClaw Gateway :18789 │               │ kindle-dash      │
│   └ WS RPC              │               │  ├ dash.sh       │
│        ↑                │               │  ├ fetch-dash.sh │── xh GET ──┐
│  ┌─────┴──────────┐     │               │  └ eips 显示     │            │
│  │ dash-server     │     │               └──────────────────┘            │
│  │ (Node+Puppeteer)│     │                                               │
│  │ 模板系统：      │     │                                               │
│  │  • openclaw     │     │                                               │
│  │  • cal/weather  │     │                                               │
│  │  • finance      │     │                                               │
│  │  • finance-trend│     │                                               │
│  │ 每模板独立 cron │     │                                               │
│  │ 1.fetchData()   │     │                                               │
│  │ 2.render()      │     │                                               │
│  │ 3.截图灰度PNG   │     │                                               │
│  │ 4.HTTP /dash.png│ ←──────────────────────────────────────────────────┘
│  │ 5.管理面板/admin│     │
│  └────────────────┘     │
└─────────────────────────┘
```

#### 后端服务文件

| 文件 | 作用 |
| --- | --- |
| [server/src/index.js](../server/src/index.js) | Express HTTP 服务 + 每模板 cron 调度器（rescheduleActiveTask） |
| [server/src/admin.html](../server/src/admin.html) | 管理面板 UI（响应式，左右两栏） |
| [server/src/auth.js](../server/src/auth.js) | 管理面板认证（express-session） |
| [server/src/settings.js](../server/src/settings.js) | 配置持久化 + `getCronForTemplate()`（`data/settings.json`） |
| [server/src/screenshot.js](../server/src/screenshot.js) | Puppeteer 截图 + 灰度 PNG 转换 |
| [server/src/fetch-usage.js](../server/src/fetch-usage.js) | OpenClaw WebSocket RPC 客户端（password/token/none） |
| [server/src/fetch-weather.js](../server/src/fetch-weather.js) | wttr.in 天气获取 |
| [server/src/fetch-todos.js](../server/src/fetch-todos.js) | Notion 待办获取 |
| [server/src/parse-finance.js](../server/src/parse-finance.js) | 财经快照 md 解析（指数/期货/加密货币） |
| [server/src/parse-finance-trend.js](../server/src/parse-finance-trend.js) | 财经走势 md 解析（JSON 块 + 补充文件） |
| [server/src/render-calendar.js](../server/src/render-calendar.js) | 日历数据（农历+节假日，使用 lunar-javascript） |
| [server/src/render-dashboard.js](../server/src/render-dashboard.js) | OpenClaw 仪表盘 HTML 渲染 |
| [server/src/templates/index.js](../server/src/templates/index.js) | 模板注册表（`getTemplate` / `listTemplates`） |
| [server/src/templates/openclaw.js](../server/src/templates/openclaw.js) | OpenClaw 用量模板 |
| [server/src/templates/calendar-weather-todo.js](../server/src/templates/calendar-weather-todo.js) | 日历/天气/待办模板 |
| [server/src/templates/finance.js](../server/src/templates/finance.js) | 财经快照模板（md 驱动） |
| [server/src/templates/finance-trend.js](../server/src/templates/finance-trend.js) | 财经一周走势模板（md 驱动） |
| [server/.env.example](../server/.env.example) | 环境变量模板 |
| [server/Dockerfile](../server/Dockerfile) | 容器化部署 |
| [server/docker-compose.yml](../server/docker-compose.yml) | Docker 编排 |

#### 部署后端服务（阿里云）

**方式一：Docker（推荐）**

```sh
cd server
cp .env.example .env
# 编辑 .env，填入 OpenClaw 地址、凭证、管理账号等
vi .env
docker compose up -d --build
```

**方式二：直接运行**

```sh
cd server
cp .env.example .env
vi .env
npm install
npm start
```

服务启动后，可通过以下端点访问：

| 方法 | 端点 | 认证 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/dash.png` | 无 | 仪表盘图片（Kindle 拉取此 URL） |
| `GET` | `/health` | 无 | 健康检查 |
| `POST` | `/generate` | 无 | 手动触发生成 |
| `GET` | `/admin` | 需要 | 管理面板界面 |
| `POST` | `/api/login` | 无 | 管理面板登录 |
| `POST` | `/api/logout` | 需要 | 管理面板登出 |
| `GET` | `/api/settings` | 需要 | 读取当前配置 |
| `POST` | `/api/settings` | 需要 | 保存配置（含 `activeTemplate`、`cronByTemplate`、各模板参数） |
| `POST` | `/api/test` | 需要 | 测试当前模板数据获取 |

#### 配置项

环境变量集中在 [server/.env.example](../server/.env.example)：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENCLAW_BASE_URL` | `http://127.0.0.1:18789` | OpenClaw 网关地址 |
| `OPENCLAW_AUTH_MODE` | `password` | 认证模式：`token` / `password` / `none`（对应 `gateway.auth.mode`） |
| `OPENCLAW_CREDENTIAL` | （空） | 网关凭证（token 或 password），统一用 `Authorization: Bearer` 发送 |
| `OPENCLAW_USAGE_ENDPOINT` | `/api/usage` | Usage API 端点路径 |
| `FETCH_MODE` | `api` | 数据抓取模式：`api` 或 `mock`（仅 OpenClaw 模板） |
| `PORT` | `3000` | HTTP 服务端口 |
| `GENERATE_CRON` | `*/5 * * * *` | 默认 cron 回退值：当模板在 `data/settings.json` 中没有配置独立 cron 时使用 |
| `SCREEN_WIDTH` | `1072` | Kindle 屏幕宽度（KPW3 竖屏） |
| `SCREEN_HEIGHT` | `1448` | Kindle 屏幕高度（KPW3 竖屏） |
| `PAGE_RENDER_DELAY` | `1000` | 截图前等待渲染毫秒数 |
| `ADMIN_USERNAME` | `admin` | 管理面板登录用户名 |
| `ADMIN_PASSWORD` | （必填） | 管理面板登录密码 |
| `SESSION_SECRET` | （必填） | express-session 加密密钥 |

> **认证说明**：OpenClaw 只有单一凭证（token 或 password），没有用户名概念。不论 `auth.mode` 是 `token` 还是 `password`，请求头格式都是 `Authorization: Bearer <值>`。`OPENCLAW_AUTH_MODE` 主要用于日志展示和 `none` 模式判断，对请求头格式无影响。

#### 模板系统

每个模板是一个独立模块，导出 `id`、`name`、`description`、`defaultCron`、`fetchData(settings)` 和 `render(data)`。模板在 [server/src/templates/index.js](../server/src/templates/index.js) 中统一注册，`listTemplates()` 返回所有模板元数据，`getTemplate(id)` 按 ID 取模板。

内置模板：

| ID | 名称 | 默认 cron | 数据来源 |
| --- | --- | --- | --- |
| `openclaw` | OpenClaw 用量 | `*/5 * * * *` | OpenClaw Gateway WebSocket RPC |
| `calendar-weather-todo` | 日历/天气/待办 | `0 8 * * *` | wttr.in + Notion API + lunar-javascript |
| `finance` | 财经快照 | `0 9,15,17 * * 1-5` | 本地 Markdown 文件（`finance.dataFile`） |
| `finance-trend` | 财经一周走势 | `0 9,15,17 * * 1-5` | 本地 Markdown 文件（`financeTrend.dataFile` + 可选 `supplementaryFile`） |

#### 每模板独立 cron 调度

调度逻辑在 [server/src/index.js](../server/src/index.js) 的 `rescheduleActiveTask()` 中实现：

1. 启动时先生成一次仪表盘，然后调用 `rescheduleActiveTask()` 注册单个 cron 任务
2. cron 表达式取自 `settings.cronByTemplate[activeTemplate]`，无配置时回退到模板的 `defaultCron`，再回退到 `GENERATE_CRON`
3. 通过管理面板切换模板或修改 cron 时，先 `task.stop()` 旧任务，再用新表达式 `cron.schedule()` 新任务
4. `settings.cronByTemplate` 持久化在 `data/settings.json`，容器重启后自动恢复

`getCronForTemplate(templateId)`（[server/src/settings.js](../server/src/settings.js)）封装了上述回退链。

#### 联调 Kindle 端

1. 在阿里云上启动后端服务后，确认 `http://你的服务器IP:3000/dash.png` 可访问
2. 修改 Kindle 上的 [src/local/env.sh](../src/local/env.sh)，设置 `DASHBOARD_URL`：
   ```sh
   export DASHBOARD_URL="http://你的服务器IP:3000/dash.png"
   ```
3. 修改 `REFRESH_SCHEDULE` 和 `TIMEZONE` 匹配你的需求
4. 重启 dash：`/mnt/us/dashboard/stop.sh && /mnt/us/dashboard/start.sh`

#### 调试后端服务

```sh
# 单次生成（不启动 HTTP 服务和定时任务）
npm run generate

# 用 mock 数据测试（无需连接 OpenClaw）
FETCH_MODE=mock npm run generate

# 开发模式（文件变更自动重启）
npm run dev

# 查看渲染的中间 HTML
ls server/public/dashboard.html

# 手动触发生成
curl -X POST http://localhost:3000/generate

# 测试某个模板的数据获取（需登录 admin）
curl -b cookie.txt -X POST http://localhost:3000/api/test \
  -H 'Content-Type: application/json' \
  -d '{"template":"finance"}'
```

#### 适配 OpenClaw API

OpenClaw 的 API 可能因版本而异。如果默认的 WebSocket RPC 调用不可用：

1. **检查认证模式**：在 `.env` 中设置 `OPENCLAW_AUTH_MODE` 为 `password` / `token` / `none`
2. **调整数据映射**：修改 [server/src/fetch-usage.js](../server/src/fetch-usage.js) 中的 `normalizeData()` 函数，将 RPC 响应字段映射到仪表盘所需格式
3. **先用 mock 跑通**：设置 `FETCH_MODE=mock` 先验证整个流程，再切换到 `api` 模式

OpenClaw 模板所需的数据结构（`normalizeData` 的输出格式）：

```js
{
  timestamp: "ISO 时间字符串",
  summary: {
    totalRequests: 1234,      // 总请求数
    totalTokens: 456789,      // 总 Token 数
    totalCost: 12.34,         // 总费用（美元）
    activeSessions: 5,        // 活跃会话数
    onlineChannels: 3,        // 在线渠道数
    offlineChannels: 1,       // 离线渠道数
  },
  topModels: [                // 模型调用排行（按 requests 降序）
    { name: "GPT-4", requests: 523, tokens: 234000 },
  ],
  channels: [                 // 渠道状态列表
    { name: "Telegram", status: "online" },  // status: "online" | "offline"
  ],
  hourlyTrend: [12, 23, ...], // 最近 24 小时每小时请求数
}
```

#### 财经模板的数据文件

两个财经模板不调用任何外部 API，而是从 Markdown 文件解析数据，便于复用已有的市场数据流水线。

**`finance`（财经快照）** — 读取结构如 `docs/fince.md` 的文件：
- `## 2. A股市场` / `## 3. 美股市场`：指数表格（`名称 / 最新点位 / 日涨跌幅 / 周涨跌幅`）
- `## 4. 商品市场`：黄金 (`fuGC`) 与原油 (`fuCL`) 期货 OHLC 表格
- `## 5. 加密货币`：BTC 价格与 24h 涨跌

**`finance-trend`（财经一周走势）** — 读取一个 Markdown 文件，其末尾 `## 📦 原始数据 (JSON)` 代码块包含 JSON 对象，由四个数组组成：`🇨🇳 国内市场`、`🇺🇸 美股市场`、`📈 商品期货`、`₿ 加密货币`。每个条目含 `name`、`unit`、`latest_price`、`daily_change_pct`、`week_data`（`{date, close, change_pct}`）。可选的补充 Markdown 文件（即财经快照文件）提供宏观指标（CPI/PPI/PMI/M2 等）和市场展望章节。

数据文件路径在管理面板中配置，存储于 `data/settings.json` 的 `finance.dataFile` 和 `financeTrend.dataFile` / `financeTrend.supplementaryFile`。Docker 部署时建议挂载宿主机目录到 `/app/data`。

#### 适配其他 Kindle 设备

修改 `.env` 中的 `SCREEN_WIDTH` 和 `SCREEN_HEIGHT`：

| 设备 | 竖屏（宽×高） | 横屏（宽×高） |
| --- | --- | --- |
| Kindle 4 NT | 600×800 | 800×600 |
| KPW3 第7代 | 1072×1448 | 1448×1072 |
| KPW5 第11代 | 1264×1680 | 1680×1264 |

#### 自定义仪表盘布局

仪表盘的 HTML 在各模板的 `render(data)` 函数中生成。设计原则：

- 纯黑白灰度，无彩色（e-ink 屏幕只能显示灰度）
- 高对比度（`#000` 文字 + `#fff` 背景）
- 大字体（远距离可读）
- 无外部依赖（不加载远程 CSS/JS/字体，确保截图速度）
- 单页适配目标分辨率（默认 1072×1448），避免滚动

**添加新模板**的步骤：

1. 在 [server/src/templates/](../server/src/templates/) 下新建 `my-template.js`，导出 `id`、`name`、`description`、`defaultCron`、`fetchData(settings)`、`render(data)`
2. 在 [server/src/templates/index.js](../server/src/templates/index.js) 中 `require` 并加入 `templates` 数组
3. 如需配置项，在 [server/src/settings.js](../server/src/settings.js) 的默认配置中加入对应字段
4. 在 [server/src/admin.html](../server/src/admin.html) 的配置表单中加入对应输入项
5. 如需解析外部数据，可新建独立的 `parse-xxx.js` / `fetch-xxx.js` 模块，保持模板文件聚焦于渲染
6. 重启服务，在管理面板切换到新模板即可

---

## 6. 构建与发布

### 6.1 依赖

- `make`、`tar`
- Rust 工具链 + [`cross`](https://github.com/cross-rs/cross)
- Docker（用于 `xh` 的交叉编译与 strip）
- [`watchexec`](https://github.com/watchexec/watchexec)（可选，用于 `make watch`）
- [`shfmt`](https://github.com/mpatel/shfmt)（可选，用于 `make format`）

### 6.2 构建目标

```sh
make dist       # 构建完整 dist/ 目录：next-wakeup + xh + 所有 sh/png + local/state
make tarball    # 在 dist 基础上打包 kindle-dash-$VERSION.tgz
make clean      # 清理 dist/
make format     # 用 shfmt 格式化 src/**/*.sh（缩进 2 空格）
make watch      # 监听 src/ 变化自动 make
```

`dist/next-wakeup` 通过 `cross build --release --target arm-unknown-linux-musleabi` 构建。`dist/xh` 会从 GitHub 克隆 `ducaale/xh` v0.16.1 后交叉编译并 strip。

### 6.3 部署到 Kindle

```sh
# 首次部署
rsync -vr ./dist/ kindle:/mnt/us/dashboard

# 升级（保留 local 目录，避免覆盖你的定制配置）
rsync -vur --exclude=local ./dist/ kindle:/mnt/us/dashboard

# 启动
ssh kindle '/mnt/us/dashboard/start.sh'
```

启动后约 10–15 秒设备会进入挂起。

### 6.4 版本号

版本在 [Makefile](../Makefile) 顶部定义：`VERSION := v1.0.0-beta.4`。发布新版本时同步更新该变量与 [CHANGELOG.md](../CHANGELOG.md)。

---

## 7. 调试

### 7.1 启用 DEBUG 模式

```sh
# 在 Kindle 上
DEBUG=true /mnt/us/dashboard/start.sh
```

效果：
- 输出带 `set -x` 的详细执行轨迹
- `rtc_sleep` 改用 `sleep`，**不会真正挂起**，便于观察循环行为
- 前台运行，日志直接输出到终端

### 7.2 查看运行日志

非 DEBUG 模式下，`start.sh` 将日志写入 `logs/dash.log`：

```sh
ssh kindle 'tail -f /mnt/us/dashboard/logs/dash.log'
```

### 7.3 常见问题排查

| 现象 | 可能原因 |
| --- | --- |
| 屏幕一直显示 sleeping.png | `next-wakeup` 计算出的下次唤醒 > `SLEEP_SCREEN_INTERVAL`，检查 `REFRESH_SCHEDULE`/`TIMEZONE` |
| 不刷新图片 | `fetch-dashboard.sh` 返回非 0；或 Wi-Fi 未连接（`wait-for-wifi.sh` 退出码 1） |
| HTTPS 报错 | 是否误用了 Kindle 自带 `curl`/`wget`？必须用仓库自带的 `xh` |
| 屏幕残影严重 | 调低 `FULL_DISPLAY_REFRESH_RATE`（如改为 2） |
| 挂起后无法唤醒 | RTC 路径在不同设备上可能不同，确认 `/sys/devices/platform/mxc_rtc.0/wakeup_enable` 存在 |
| cron 不触发 | 时区设置错误；或表达式不符合新版严格 cron 语法 |

### 7.4 手动验证各组件

```sh
# 验证 next-wakeup
/mnt/us/dashboard/next-wakeup -s='*/15 8-18 * * MON-FRI' -tz='Asia/Shanghai'

# 手动拉取一次图片
/mnt/us/dashboard/local/fetch-dashboard.sh /tmp/test.png

# 手动显示图片
/usr/sbin/eips -g /tmp/test.png        # 部分刷新
/usr/sbin/eips -f -g /tmp/test.png     # 全屏刷新

# 检查电量
gasgauge-info -c
```

---

## 8. CI 与代码规范

### 8.1 CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) 使用 `luizm/action-sh-checker`，对所有 shell 脚本运行：
- `shellcheck`（`-s ash`，针对 POSIX sh）
- `shfmt`（`-i 2`，2 空格缩进）

### 8.2 Shell 规范

- **必须**使用 POSIX sh 语法，不能使用 bash 特性
- 缩进 2 空格
- 本地格式化：`make format`
- 变量引用建议加双引号

### 8.3 Rust 代码

`next-wakeup` 是独立 Cargo 项目，遵循标准 Rust 规范。修改后需通过 `make dist/next-wakeup` 重新交叉编译。

---

## 9. 扩展开发思路

### 9.1 增加新的环境变量

1. 在 [src/local/env.sh](../src/local/env.sh) 中 `export` 新变量并设默认值
2. 在 [src/dash.sh](../src/dash.sh) 中读取使用
3. 在本文件第 4 节配置表中补充文档

### 9.2 替换 next-wakeup 实现

`next-wakeup` 只是一个独立的 CLI：传入 cron 与时区，输出秒数。可完全用其他语言重写，只要保持相同的调用约定即可。注意必须静态链接 musl 才能在 Kindle 上运行。

### 9.3 增加刷新前/后钩子

参考 `fetch-dashboard.sh` 与 `low-battery.sh` 的设计：在 `dash.sh` 中以独立脚本调用，并通过退出码或 stdout 传递信息。这种"脚本钩子"模式是项目扩展的主要方式。

### 9.4 支持其他设备

可能需要调整的点：
- `eips` 命令的参数（部分设备路径或选项不同）
- RTC 唤醒的 sysfs 路径
- `sleeping.png` 与仪表盘 PNG 的分辨率
- 电池读取命令（`gasgauge-info` 在部分设备上不可用）

---

## 10. 参考资源

- 原项目：[pascalw/kindle-dash](https://github.com/pascalw/kindle-dash)
- 灵感来源：[davidhampgonsalves/life-dashboard](https://github.com/davidhampgonsalves/life-dashboard)
- Kindle 越狱与 USBNetwork：<https://wiki.mobileread.com/wiki/USBNetwork>
- KUAL（Kindle Unified Application Launcher）：<https://www.mobileread.com/forums/showthread.php?t=203326>
- cron 表达式语法：<https://en.wikipedia.org/wiki/Cron>
- xh HTTP 客户端：<https://github.com/ducaale/xh>
