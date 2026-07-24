# Kindle Dashboard for OpenClaw

Turn an old Kindle into a low-power dashboard that displays real-time usage statistics from your [OpenClaw](https://github.com/openclaw/openclaw) AI gateway.

[中文文档](./README.zh-CN.md)

![Kindle Dashboard](./example/photo.jpg)

## Dashboard Screenshot

![Dashboard Demo](./example/dashboard-demo.png)

## What this project is

This project turns a Kindle Paperwhite (or other jailbroken Kindle models) into an always-on, ultra-low-power dashboard that visualizes usage data from a self-hosted OpenClaw gateway. It consists of two parts:

1. **Server** (`server/`) — A Node.js service deployed on the same host as OpenClaw. It connects to the OpenClaw gateway via WebSocket RPC, fetches usage data, renders an e-ink friendly HTML dashboard, and generates a grayscale PNG screenshot tailored to the Kindle's screen resolution.
2. **Client** (`src/`) — A lightweight shell-based agent running on the Kindle. It periodically fetches the latest PNG from the server, displays it on the e-ink screen, and suspends the device to RAM between updates to minimize power consumption.

The server pre-generates the dashboard image on a schedule (default: every 5 minutes). The Kindle wakes up on its own schedule (default: every 10 minutes), pulls the latest image, displays it, and goes back to sleep. A single charge can last weeks.

## Architecture

```
┌─────────────────────────────────────────────┐
│           Aliyun Cloud Server               │
│  ┌─────────────┐      ┌──────────────────┐  │
│  │  OpenClaw   │      │  kindle-dash     │  │
│  │  Gateway    │◄────►│  server (Node)   │  │
│  │  (WS RPC)   │ WS   │                  │  │
│  └─────────────┘      │  • fetch usage   │  │
│                       │  • render HTML   │  │
│                       │  • screenshot    │  │
│                       │  • serve PNG     │  │
│                       └────────┬─────────┘  │
└────────────────────────────────┼────────────┘
                                 │ HTTP
                                 ▼
┌─────────────────────────────────────────────┐
│              Kindle Paperwhite              │
│  ┌───────────────────────────────────────┐  │
│  │  dash.sh                             │  │
│  │  • wake up via RTC alarm             │  │
│  │  • fetch dash.png via xh             │  │
│  │  • display on e-ink (eips)           │  │
│  │  • suspend to RAM                    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Features

- **Real-time OpenClaw metrics** — Token usage, message counts, active sessions, top models, provider quotas (DeepSeek balance, z.ai usage windows), channel status (WebChat, Telegram, QQ Bot, etc.)
- **E-ink optimized rendering** — Pure black & white, high contrast, no anti-aliasing, CSS bar charts, tuned for Kindle Paperwhite 7th Gen (1072×1448 portrait)
- **WebSocket RPC** — Connects directly to OpenClaw's gateway WebSocket, supports `token` and `password` authentication modes
- **Ultra-low power** — Kindle suspends to RAM between updates; a single charge lasts weeks
- **RTC wake alarm** — Auto-detects the correct RTC path on different Kindle models for reliable scheduled wake-ups
- **Docker deployment** — One-command deployment via `docker compose up -d --build`
- **Configurable schedule** — Server generates new images every 5 minutes (cron); Kindle refreshes every 10 minutes (configurable)
- **Grayscale conversion** — PNG is converted to pure grayscale (no alpha channel) for crisp e-ink rendering
- **Debug endpoint** — `GET /debug` returns the normalized JSON data for easy troubleshooting

## Prerequisites

### Server side
- A server running OpenClaw gateway (with `password` or `token` auth mode)
- Docker and Docker Compose

### Kindle side
- A jailbroken Kindle with Wi-Fi configured
- SSH access via [USBNetwork](https://wiki.mobileread.com/wiki/USBNetwork)
- Tested on Kindle Paperwhite 7th Gen; should work on other jailbroken Kindles with minor modifications

## Server setup

### 1. Configure

```sh
cd server
cp .env.example .env
vi .env
```

Key settings in `.env`:

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_BASE_URL` | `http://127.0.0.1:18789` | OpenClaw gateway URL (use `127.0.0.1` when server runs on same host as OpenClaw with `network_mode: host`) |
| `OPENCLAW_CREDENTIAL` | — | Your OpenClaw gateway password or token |
| `FETCH_MODE` | `api` | `api` = connect to OpenClaw via WS, `mock` = use fake data for testing |
| `PORT` | `3000` | HTTP server port |
| `OUTPUT_FILE` | `public/dash.png` | Generated PNG output path |
| `GENERATE_CRON` | `*/5 * * * *` | Cron schedule for image generation |
| `SCREEN_WIDTH` | `1072` | Kindle screen width (portrait) |
| `SCREEN_HEIGHT` | `1448` | Kindle screen height (portrait) |

### 2. Deploy

```sh
# Prepare public directory permissions (UID 1000 matches the container's node user)
mkdir -p ./public && chown -R 1000:1000 ./public

# Build and start
docker compose up -d --build
```

### 3. Verify

```sh
# Check logs
docker compose logs -f

# View normalized data (without generating image)
curl http://localhost:3000/debug | python3 -m json.tool

# Manually trigger image generation
curl -X POST http://localhost:3000/generate

# Download the generated image
curl http://localhost:3000/dash.png -o test.png
```

## Kindle client setup

### 1. Download and extract

Download the [latest release](https://github.com/20012002er/openclaw-kindle-dash/releases) on your computer and extract it.

### 2. Configure

Edit `local/env.sh` and set `DASHBOARD_URL` to point to your server:

```sh
export DASHBOARD_URL="http://YOUR-ALIYUN-PUBLIC-IP:3000/dash.png"
```

Other options in `local/env.sh`:

| Variable | Default | Description |
|---|---|---|
| `DASHBOARD_URL` | — | **Must set** — URL of the server's `/dash.png` endpoint |
| `REFRESH_SCHEDULE` | `*/10 * * * *` | Cron schedule for Kindle wake-up / refresh |
| `TIMEZONE` | `Asia/Shanghai` | Timezone for cron evaluation |
| `FULL_DISPLAY_REFRESH_RATE` | `4` | Do a full e-ink refresh every N partial refreshes (removes ghosting) |
| `SLEEP_SCREEN_INTERVAL` | `3600` | Show sleep screen if next wake-up is more than N seconds away |

### 3. Copy to Kindle

```sh
rsync -vr ./ kindle:/mnt/us/dashboard
```

### 4. Start

Via SSH:
```sh
ssh root@kindle "/mnt/us/dashboard/start.sh"
```

Or via [KUAL](https://wiki.mobileread.com/wiki/KUAL): copy `KUAL/kindle-dash/` to `/mnt/us/extensions/kindle-dash/`, then launch from the KUAL menu.

The device will suspend about 10–15 seconds after starting. Screen updates happen on the configured cron schedule.

### 5. Stop

```sh
ssh root@kindle "/mnt/us/dashboard/stop.sh"
```

## How it works

### Server side
1. On startup and every 5 minutes (cron), the server connects to OpenClaw's gateway WebSocket
2. Authenticates with `password` or `token` (configurable via `OPENCLAW_AUTH_MODE`)
3. Calls `sessions.usage` and `usage.status` RPC methods in parallel
4. Normalizes the response into a standard format (tokens, messages, models, channels, providers)
5. Renders an e-ink friendly HTML template
6. Uses Puppeteer to screenshot the HTML into a PNG
7. Converts the PNG to pure grayscale (no alpha)
8. Serves the PNG at `GET /dash.png`

### Kindle side
1. On start, stops the Kindle framework and enters a loop
2. Each iteration: fetches `dash.png` via the `xh` HTTP client
3. Displays the image using `eips` (Kindle's e-ink display tool)
4. Calculates seconds until next cron trigger using `next-wakeup`
5. Sets an RTC wake alarm (`/sys/class/rtc/rtc0/wakealarm`) and suspends to RAM
6. On wake-up, repeats from step 2

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/dash.png` | The generated dashboard image (PNG) |
| `GET` | `/health` | Health check |
| `GET` | `/debug` | Normalized JSON data for troubleshooting |
| `POST` | `/generate` | Manually trigger image generation |

## Debugging

### Server logs
```sh
docker compose logs -f
```

### Server data inspection
```sh
curl http://localhost:3000/debug | python3 -m json.tool
```

### Kindle logs
```sh
ssh root@kindle "tail -50 /mnt/us/dashboard/logs/dash.log"
```

### Common issues

| Symptom | Cause / Fix |
|---|---|
| Server log: `WS fetch failed: connect ECONNREFUSED` | OpenClaw not running, or wrong `OPENCLAW_BASE_URL`. With Docker, ensure `network_mode: host` or use `host.docker.internal` |
| Server log: `RPC error (connect)` | Wrong `OPENCLAW_CREDENTIAL` or auth mode |
| Kindle log: `Wi-Fi connected` but screen doesn't update | `DASHBOARD_URL` unreachable from Kindle; test with `curl` on Kindle |
| Kindle log: `cat: can't open '.../wakeup_enable'` | Old RTC path; fixed in latest `dash.sh` which auto-detects `/sys/class/rtc/rtc0/wakealarm` |
| Image ghosting on e-ink | Decrease `FULL_DISPLAY_REFRESH_RATE` (e.g. to `2`) |
| Battery draining fast | Increase `REFRESH_SCHEDULE` interval (e.g. `0 * * * *` = hourly) |

## Development

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for detailed development and customization documentation.

## Credits

- Original kindle-dash concept by [pascalw/kindle-dash](https://github.com/pascalw/kindle-dash)
- Inspiration from [davidhampgonsalves/life-dashboard](https://github.com/davidhampgonsalves/life-dashboard)
- [OpenClaw](https://github.com/openclaw/openclaw) — the AI gateway this dashboard visualizes

## License

MIT
