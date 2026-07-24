# Kindle Dashboard for OpenClaw

Turn an old Kindle into a low-power dashboard that displays real-time usage statistics from your [OpenClaw](https://github.com/openclaw/openclaw) AI gateway.

[中文文档](./README.zh-CN.md)

![Kindle Dashboard](./example/photo.jpg)

## Dashboard Screenshot

![Dashboard Demo](./example/dashboard-demo.png)

## What this project is

This project turns a Kindle Paperwhite (or other jailbroken Kindle models) into an always-on, ultra-low-power dashboard. It ships with a default dashboard visualizing usage data from a self-hosted OpenClaw AI gateway, plus a pluggable template system that lets you display anything — a second built-in template shows a monthly calendar (with lunar calendar & Chinese holidays), live weather, and today's Notion todos. A web admin panel lets you switch templates and configure everything from the browser.

It consists of two parts:

1. **Server** (`server/`) — A Node.js service deployed on the same host as OpenClaw. It connects to OpenClaw's gateway via WebSocket RPC (or fetches weather/todos for the second template), renders an e-ink friendly HTML dashboard, and generates a grayscale PNG screenshot tailored to the Kindle's screen resolution. A web admin panel (protected by username/password) lets you switch templates and configure connection settings.
2. **Client** (`src/`) — A lightweight shell-based agent running on the Kindle. It periodically fetches the latest PNG from the server, displays it on the e-ink screen, and suspends the device to RAM between updates to minimize power consumption.

The server pre-generates the dashboard image on a schedule (default: every 5 minutes). The Kindle wakes up on its own schedule (default: every 10 minutes), pulls the latest image, displays it, and goes back to sleep. A single charge can last weeks.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                Aliyun Cloud Server                   │
│  ┌─────────────┐      ┌──────────────────────────┐   │
│  │  OpenClaw   │      │  kindle-dash server      │   │
│  │  Gateway    │◄────►│  (Node.js)               │   │
│  │  (WS RPC)   │ WS   │                          │   │
│  └─────────────┘      │  Templates:              │   │
│                       │  • openclaw (WS RPC)     │   │
│  ┌─────────────┐      │  • calendar-weather-todo │   │
│  │  wttr.in /  │─────►│    (wttr.in + Notion)    │   │
│  │  Notion API │      │                          │   │
│  └─────────────┘      │  • render HTML           │   │
│                       │  • screenshot to PNG     │   │
│                       │  • serve /dash.png       │   │
│                       │  • admin panel (/admin)  │   │
│                       └────────┬─────────────────┘   │
└────────────────────────────────┼─────────────────────┘
                                 │ HTTP
                    ┌────────────┼────────────┐
                    ▼                         ▼
┌──────────────────────────┐    ┌─────────────────────────┐
│   Kindle Paperwhite      │    │   Browser (admin)       │
│  ┌────────────────────┐  │    │  ┌───────────────────┐  │
│  │  dash.sh           │  │    │  │  /admin           │  │
│  │  • wake via RTC    │  │    │  │  • login          │  │
│  │  • fetch dash.png  │  │    │  │  • switch tpl     │  │
│  │  • display (eips)  │  │    │  │  • edit config    │  │
│  │  • suspend to RAM  │  │    │  │  • test & generate│  │
│  └────────────────────┘  │    │  └───────────────────┘  │
└──────────────────────────┘    └─────────────────────────┘
```

## Features

- **Multiple dashboard templates** — Switch between dashboards from the admin panel:
  - **OpenClaw Usage** (default) — Token usage, message counts, active sessions, top models, provider quotas (DeepSeek balance, z.ai usage windows), channel status (WebChat, Telegram, QQ Bot, etc.)
  - **Calendar / Weather / Todo** — Monthly calendar (with lunar calendar & Chinese holidays), live weather from [wttr.in](https://wttr.in), and today's todos fetched from your Notion database
- **Web admin panel** — Protected by username/password authentication (express-session); switch templates, configure OpenClaw connection, weather city, and Notion credentials, test data fetching, and trigger manual generation — all from the browser
- **Responsive admin UI** — Left-right two-column layout on desktop that automatically collapses to a single column on mobile/tablet; includes a current-template status card with next refresh time, unsaved-changes indicator, full-screen loading overlay, and detailed Toast notifications
- **Template system** — Pluggable architecture; each template implements `fetchData()` + `render()`. Add your own by dropping a file in `server/src/templates/`
- **Configurable OpenClaw connection** — Gateway URL, auth mode (`password` / `token` / `none`), and credential can be configured from the admin panel (stored in `data/settings.json`); falls back to environment variables
- **E-ink optimized rendering** — Pure black & white, high contrast, no anti-aliasing, CSS bar charts, tuned for Kindle Paperwhite 7th Gen (1072×1448 portrait)
- **WebSocket RPC** — Connects directly to OpenClaw's gateway WebSocket, supports `token` and `password` authentication modes; calls `sessions.usage` and `usage.status` RPC methods in parallel
- **Ultra-low power** — Kindle suspends to RAM between updates; a single charge lasts weeks
- **RTC wake alarm** — Auto-detects the correct RTC path on different Kindle models for reliable scheduled wake-ups
- **Docker deployment** — One-command deployment via `docker compose up -d --build`; uses `network_mode: host` so the container can reach OpenClaw on localhost
- **Configurable schedule** — Server generates new images every 5 minutes (cron); Kindle refreshes every 10 minutes (configurable)
- **Grayscale conversion** — PNG is converted to pure grayscale (no alpha channel) for crisp e-ink rendering
- **Debug endpoints** — `GET /debug` returns normalized JSON data; `GET /api/test/:templateId` tests data fetching for any template

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
| `OPENCLAW_AUTH_MODE` | `password` | Auth mode: `password` / `token` / `none`. Can be overridden in admin panel |
| `OPENCLAW_CREDENTIAL` | — | Your OpenClaw gateway password or token. Can be overridden in admin panel |
| `FETCH_MODE` | `api` | `api` = connect to OpenClaw via WS, `mock` = use fake data for testing |
| `PORT` | `3000` | HTTP server port |
| `OUTPUT_FILE` | `public/dash.png` | Generated PNG output path |
| `GENERATE_CRON` | `*/5 * * * *` | Cron schedule for image generation |
| `SCREEN_WIDTH` | `1072` | Kindle screen width (portrait) |
| `SCREEN_HEIGHT` | `1448` | Kindle screen height (portrait) |
| `PAGE_RENDER_DELAY` | `1000` | Extra milliseconds to wait after page load before screenshotting (ensures fonts/layout are fully rendered) |
| `ADMIN_USERNAME` | `admin` | Admin panel username |
| `ADMIN_PASSWORD` | `admin` | Admin panel password (**change this!**) |
| `SESSION_SECRET` | `change-me-...` | Secret for signing session cookies (**change this!**) |

> Note: OpenClaw connection settings (`baseUrl`, `authMode`, `credential`) and template-specific settings (weather city, Notion API key/DB ID) are stored in `data/settings.json` after being configured via the admin panel. Environment variables serve as defaults / fallback.

### 2. Deploy

```sh
# Prepare public & data directory permissions (UID 1000 matches the container's node user)
mkdir -p ./public ./data && chown -R 1000:1000 ./public ./data

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

### 4. Configure via admin panel

Open `http://YOUR-SERVER-IP:3000/admin` in your browser and log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`.

The admin panel features a responsive left-right two-column layout:

- **Left column** — Current template status card (showing template name, description, ID, and next scheduled refresh time) + template selector
- **Right column** — Configuration form for the active template + data fetching test result panel

From the admin panel you can:

- **Switch dashboard template** — Select between OpenClaw Usage and Calendar / Weather / Todo
- **Configure OpenClaw connection** — Set gateway URL, auth mode (`password` / `token` / `none`), and credential
- **Configure weather city** — For the Calendar/Weather/Todo template (default: 武汉)
- **Configure Notion integration** — Enter your Notion API key and the Database ID of your daily todo database
- **Test data fetching** — Verify that the selected template can fetch data successfully before applying; results are displayed in a code block below the form
- **Trigger manual generation** — Generate the dashboard image immediately without waiting for the next cron run

UX features:

- **Unsaved changes indicator** — An orange dot appears when there are unsaved modifications; navigation is blocked with a confirmation prompt
- **Save feedback** — The save button shows a "Saving..." state with a full-screen loading overlay; success/failure is confirmed with a Toast notification (5-second display)
- **Responsive breakpoints** — Adapts to `<480px`, `<600px`, `<768px`, and `<1024px` screen widths; single-column layout on mobile/tablet; full-width Toast on mobile; sticky 60px navigation bar

Settings are persisted in `data/settings.json` and take precedence over environment variables.

### 5. Notion database setup (for Calendar/Weather/Todo template)

The Calendar/Weather/Todo template fetches today's todos from a Notion database. Your Notion database should have the following properties:

| Property | Type | Required | Description |
|---|---|---|---|
| Title | `title` | Yes | The todo title |
| Date | `date` | Recommended | The due date; todos with today's date are shown in "Today's Todos" |
| 重要否 (Important) | `checkbox` | Optional | If checked, unfinished items are shown in "Important Unfinished" |
| 紧急否 (Urgent) | `checkbox` | Optional | If checked, the todo is marked with `!!` icon |
| Status | `status` | Recommended | Items with "已完成" (Completed) in the status name are excluded |

The fetching logic:
1. Queries the database for items created since the first day of last month (sorted by creation time descending, max 100 items)
2. Filters out completed items (status name contains "已完成")
3. Separates into two groups: today's todos (date matches today) and important unfinished todos
4. Both groups are displayed on the dashboard

To set up:
1. Create a database in Notion with the above properties
2. Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) and get the API key
3. Share your database with the integration
4. Copy the database ID from the database URL (the 32-character string)
5. Enter the API key and database ID in the admin panel

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

### Template system
The server uses a pluggable template architecture. Each template lives in `server/src/templates/` and implements two methods:

- `fetchData(settings)` — Fetch data from external sources (OpenClaw WebSocket, weather API, Notion API, etc.)
- `render(data)` — Render the data into an e-ink friendly HTML file

On each cron tick, the server reads the active template from `data/settings.json`, calls `fetchData()`, then `render()`, and screenshots the HTML to a grayscale PNG.

Built-in templates:

| ID | Name | Description |
|---|---|---|
| `openclaw` | OpenClaw Usage | Token usage, messages, top models, provider quotas, channel status |
| `calendar-weather-todo` | Calendar / Weather / Todo | Monthly calendar (with lunar calendar & Chinese holidays), weather from wttr.in, today's todos from Notion |

#### Adding a custom template

1. Create a new file in `server/src/templates/` (e.g. `my-dashboard.js`)
2. Implement the template interface:

```javascript
// server/src/templates/my-dashboard.js
async function fetchData(settings) {
  // Fetch data from any external source
  // `settings` contains openclaw, weather, notion configs from data/settings.json
  return { /* your data */ };
}

function render(data) {
  // Return an e-ink friendly HTML string
  // The HTML must fit within SCREEN_WIDTH × SCREEN_HEIGHT (default 1072×1448)
  // Use pure black & white, high contrast, no anti-aliasing
  const html = `<!DOCTYPE html><html>...</html>`;
  // Write to a file and return the path
  const fs = require("fs");
  const path = require("path");
  const htmlPath = path.join(__dirname, "..", "..", "public", "my-dashboard.html");
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

module.exports = {
  id: "my-dashboard",
  name: "My Dashboard",
  fetchData,
  render,
};
```

3. Register the template in `server/src/templates/index.js`:

```javascript
const myDashboard = require("./my-dashboard");
const TEMPLATES = {
  [openclaw.id]: openclaw,
  [calendarWeatherTodo.id]: calendarWeatherTodo,
  [myDashboard.id]: myDashboard,  // <-- add this line
};
```

4. Restart the server — the new template will appear in the admin panel's template selector.

### Server side
1. On startup and every 5 minutes (cron), the server loads the active template from settings
2. The OpenClaw template connects to OpenClaw's gateway WebSocket, authenticates with `password` or `token`, and calls `sessions.usage` and `usage.status` RPC methods in parallel
3. The Calendar/Weather/Todo template fetches weather from wttr.in, generates calendar data (including lunar calendar and Chinese holidays via `lunar-javascript`), and queries the Notion database for today's todos
4. The template renders an e-ink friendly HTML
5. Puppeteer screenshots the HTML into a PNG
6. The PNG is converted to pure grayscale (no alpha)
7. The PNG is served at `GET /dash.png`

### Kindle side
1. On start, stops the Kindle framework and enters a loop
2. Each iteration: fetches `dash.png` via the `xh` HTTP client
3. Displays the image using `eips` (Kindle's e-ink display tool)
4. Calculates seconds until next cron trigger using `next-wakeup`
5. Sets an RTC wake alarm (`/sys/class/rtc/rtc0/wakealarm`) and suspends to RAM
6. On wake-up, repeats from step 2

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/dash.png` | — | The generated dashboard image (PNG) |
| `GET` | `/health` | — | Health check |
| `GET` | `/debug` | — | Normalized JSON data for troubleshooting |
| `POST` | `/generate` | — | Manually trigger image generation |
| `GET` | `/admin` | — | Admin panel (login page) |
| `POST` | `/api/login` | — | Admin login |
| `POST` | `/api/logout` | session | Admin logout |
| `GET` | `/api/settings` | session | Get current settings + template list + next run time |
| `PUT` | `/api/settings` | session | Save settings (active template, OpenClaw config, weather, Notion) |
| `GET` | `/api/test/:templateId` | session | Test data fetching for a specific template |

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

## Project structure

```
kindle-dash/
├── server/                        # Backend service
│   ├── src/
│   │   ├── templates/             # Dashboard templates (pluggable)
│   │   │   ├── index.js           # Template registry (getTemplate, listTemplates)
│   │   │   ├── openclaw.js        # OpenClaw usage template
│   │   │   └── calendar-weather-todo.js  # Calendar/Weather/Todo template
│   │   ├── admin.html             # Admin panel UI (responsive)
│   │   ├── auth.js                # Admin authentication (express-session)
│   │   ├── fetch-usage.js         # OpenClaw WebSocket RPC client
│   │   ├── fetch-weather.js       # wttr.in weather fetcher
│   │   ├── fetch-todos.js         # Notion todo fetcher
│   │   ├── render-calendar.js     # Calendar data (lunar + holidays via lunar-javascript)
│   │   ├── render-dashboard.js    # OpenClaw dashboard HTML renderer
│   │   ├── screenshot.js          # Puppeteer screenshot + grayscale conversion
│   │   ├── settings.js            # Settings persistence (data/settings.json)
│   │   └── index.js               # Express server + cron scheduler
│   ├── .env.example               # Environment variable template
│   ├── Dockerfile                 # Container image (node:20-bookworm-slim + chromium)
│   └── docker-compose.yml         # Docker Compose config (network_mode: host)
├── src/                           # Kindle client
│   ├── local/
│   │   ├── env.sh                 # Client configuration
│   │   ├── fetch-dashboard.sh     # Image fetch + display logic
│   │   └── low-battery.sh         # Low battery handler
│   ├── next-wakeup/               # Rust binary for cron next-run calculation
│   ├── dash.sh                    # Main dashboard loop (fetch → display → suspend)
│   ├── start.sh                   # Start script
│   ├── stop.sh                    # Stop script
│   └── wait-for-wifi.sh           # Wi-Fi connectivity check
├── KUAL/                          # KUAL extension for menu-based launch
├── docs/                          # Development docs
├── example/                       # Demo screenshots
└── README.md
```

## Development

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for detailed development and customization documentation.

## Credits

- Original kindle-dash concept by [pascalw/kindle-dash](https://github.com/pascalw/kindle-dash)
- Inspiration from [davidhampgonsalves/life-dashboard](https://github.com/davidhampgonsalves/life-dashboard)
- [OpenClaw](https://github.com/openclaw/openclaw) — the AI gateway this dashboard visualizes

## License

MIT
