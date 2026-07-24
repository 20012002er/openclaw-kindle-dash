const fs = require("fs");
const path = require("path");

const SCREEN_WIDTH = parseInt(process.env.SCREEN_WIDTH || "1072", 10);
const SCREEN_HEIGHT = parseInt(process.env.SCREEN_HEIGHT || "1448", 10);

function formatNumber(n) {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + "B";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(Math.round(n));
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function renderTopModels(models) {
  if (!models || models.length === 0)
    return '<div class="empty">No model data</div>';
  const displayModels = models.filter((m) => (m.tokens || 0) > 0);
  if (displayModels.length === 0)
    return '<div class="empty">No model data</div>';
  const max = Math.max(...displayModels.map((m) => m.tokens || 0));
  return displayModels
    .map((m) => {
      const pct = max > 0 ? Math.round((m.tokens / max) * 100) : 0;
      return `
      <div class="bar-row">
        <div class="bar-label">${m.name}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-value">${formatNumber(m.tokens)}</div>
      </div>`;
    })
    .join("");
}

function renderChannels(channels) {
  if (!channels || channels.length === 0)
    return '<div class="empty">No channels</div>';
  // 过滤掉没有任何活动的 channel
  const active = channels.filter((ch) => ch.lastActivity > 0);
  if (active.length === 0)
    return '<div class="empty">No active channels</div>';
  return active
    .map((ch) => {
      const isOnline = !!ch.online;
      const lastSeen = ch.lastActivity
        ? " · " + formatTime(new Date(ch.lastActivity).toISOString()).slice(5)
        : "";
      return `
      <div class="channel-row">
        <span class="dot ${isOnline ? "dot-on" : "dot-off"}">${isOnline ? "●" : "○"}</span>
        <span class="channel-name">${ch.name}</span>
        <span class="channel-status ${isOnline ? "status-on" : "status-off"}">${isOnline ? "Online" : "Offline"}${lastSeen}</span>
      </div>`;
    })
    .join("");
}

function renderProviders(providers) {
  if (!providers || providers.length === 0)
    return '<div class="empty">No provider data</div>';
  return providers
    .map((p) => {
      const pct = p.usedPercent || 0;
      const barWidth = Math.min(100, pct);
      const balanceText = p.balance ? ` · ${p.balance}` : "";
      return `
      <div class="provider-row">
        <span class="provider-name">${p.name}</span>
        <div class="provider-bar-track"><div class="provider-bar-fill" style="width:${barWidth}%"></div></div>
        <span class="provider-pct">${pct}%</span>
        <span class="provider-balance">${balanceText}</span>
      </div>`;
    })
    .join("");
}

function renderTrend(trend) {
  if (!trend || trend.length === 0) return "";
  const max = Math.max(...trend);
  if (max === 0) return "";
  const bars = trend
    .map((v) => {
      const h = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 2;
      return `<div class="trend-bar" style="height:${h}%"></div>`;
    })
    .join("");
  return `<div class="trend-chart">${bars}</div>`;
}

function renderHtml(data) {
  const s = data.summary || {};
  const totalChannels = (s.onlineChannels || 0) + (s.offlineChannels || 0);
  const costDisplay =
    s.totalCost && s.totalCost > 0 ? "$" + s.totalCost.toFixed(2) : "—";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: ${SCREEN_WIDTH}px;
    height: ${SCREEN_HEIGHT}px;
    font-family: "Helvetica", "Arial", "Noto Sans CJK SC", sans-serif;
    background: #fff;
    color: #000;
    padding: 36px 40px;
    position: relative;
    -webkit-font-smoothing: none;
  }

  .header {
    border-bottom: 4px solid #000;
    padding-bottom: 18px;
    margin-bottom: 28px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .title { font-size: 50px; font-weight: bold; letter-spacing: -1px; }
  .timestamp { font-size: 26px; color: #333; }

  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 30px;
  }
  .metric-card {
    flex: 1 1 calc(33.33% - 12px);
    border: 3px solid #000;
    padding: 16px 14px;
    text-align: center;
    min-width: 280px;
  }
  .metric-label { font-size: 22px; color: #444; margin-bottom: 8px; }
  .metric-value { font-size: 48px; font-weight: bold; line-height: 1.1; }

  .section { margin-bottom: 28px; }
  .section-title {
    font-size: 30px;
    font-weight: bold;
    border-bottom: 2px solid #000;
    padding-bottom: 8px;
    margin-bottom: 14px;
  }
  .empty { font-size: 24px; color: #888; padding: 10px 0; }

  .bar-row {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
  }
  .bar-label { width: 200px; font-size: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track {
    flex: 1;
    height: 26px;
    border: 2px solid #000;
    margin: 0 12px;
  }
  .bar-fill { height: 100%; background: #000; }
  .bar-value { width: 80px; font-size: 24px; text-align: right; font-variant-numeric: tabular-nums; }

  .channel-row {
    display: flex;
    align-items: center;
    font-size: 26px;
    margin-bottom: 10px;
  }
  .dot { font-size: 28px; margin-right: 12px; line-height: 1; }
  .dot-on { color: #000; }
  .dot-off { color: #bbb; }
  .channel-name { flex: 1; font-weight: 500; }
  .channel-status { font-size: 22px; }
  .status-on { font-weight: bold; }
  .status-off { color: #999; }

  .provider-row {
    display: flex;
    align-items: center;
    font-size: 24px;
    margin-bottom: 12px;
  }
  .provider-name { width: 120px; font-weight: 500; }
  .provider-bar-track {
    flex: 1;
    height: 22px;
    border: 2px solid #000;
    margin: 0 12px;
  }
  .provider-bar-fill { height: 100%; background: #000; }
  .provider-pct { width: 60px; font-size: 22px; text-align: right; font-variant-numeric: tabular-nums; }
  .provider-balance { width: 140px; font-size: 20px; color: #555; text-align: right; }

  .trend-chart {
    display: flex;
    align-items: flex-end;
    height: 160px;
    gap: 3px;
    border-bottom: 2px solid #000;
  }
  .trend-bar { flex: 1; background: #000; min-width: 4px; }

  .footer {
    position: absolute;
    bottom: 22px;
    left: 40px;
    right: 40px;
    font-size: 20px;
    color: #888;
    text-align: center;
  }
</style>
</head>
<body>

  <div class="header">
    <div class="title">OpenClaw Usage</div>
    <div class="timestamp">${formatTime(data.timestamp)}</div>
  </div>

  <div class="metrics">
    <div class="metric-card">
      <div class="metric-label">Messages</div>
      <div class="metric-value">${formatNumber(s.totalRequests || 0)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Tokens</div>
      <div class="metric-value">${formatNumber(s.totalTokens || 0)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Cost</div>
      <div class="metric-value">${costDisplay}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Sessions</div>
      <div class="metric-value">${s.activeSessions || 0}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Channels</div>
      <div class="metric-value">${s.onlineChannels || 0}/${totalChannels}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Top Models</div>
    ${renderTopModels(data.topModels)}
  </div>

  ${
    data.providers && data.providers.length > 0
      ? `<div class="section">
    <div class="section-title">Provider Quota</div>
    ${renderProviders(data.providers)}
  </div>`
      : ""
  }

  <div class="section">
    <div class="section-title">Channels</div>
    ${renderChannels(data.channels)}
  </div>

  ${
    data.hourlyTrend && data.hourlyTrend.length > 1
      ? `<div class="section">
    <div class="section-title">Recent Trend (tokens/hour)</div>
    ${renderTrend(data.hourlyTrend)}
  </div>`
      : ""
  }

  <div class="footer">OpenClaw · kindle-dash</div>

</body>
</html>`;
}

function renderDashboard(data) {
  const html = renderHtml(data);
  const htmlPath = path.join(__dirname, "..", "public", "dashboard.html");
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

module.exports = { renderDashboard };
