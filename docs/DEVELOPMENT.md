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
├── KUAL/                         # KUAL 扩展配置
│   └── kindle-dash/
│       ├── config.xml
│       └── menu.json
├── docs/
│   ├── tipstricks.md             # 生成仪表盘图片的提示
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
