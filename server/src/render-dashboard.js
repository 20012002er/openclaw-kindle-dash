const fs = require("fs");
const path = require("path");

const SCREEN_WIDTH = parseInt(process.env.SCREEN_WIDTH || "1072", 10);
const SCREEN_HEIGHT = parseInt(process.env.SCREEN_HEIGHT || "1448", 10);

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function renderTopModels(models) {
  if (!models || models.length === 0) return '<div class="empty">No data</div>';
  const max = Math.max(...models.map((m) => m.requests));
  return models
    .map((m) => {
      const pct = max > 0 ? Math.round((m.requests / max) * 100) : 0;
      return `
      <div class="bar-row">
        <div class="bar-label">${m.name}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-value">${m.requests}</div>
      </div>`;
    })
    .join("");
}

function renderChannels(channels) {
  if (!channels || channels.length === 0)
    return '<div class="empty">No channels</div>';
  return channels
    .map((ch) => {
      const isOnline = ch.status === "online";
      return `
      <div class="channel-row">
        <span class="dot ${isOnline ? "dot-on" : "dot-off"}">${isOnline ? "●" : "○"}</span>
        <span class="channel-name">${ch.name}</span>
        <span class="channel-status ${isOnline ? "status-on" : "status-off"}">${isOnline ? "Online" : "Offline"}</span>
      </div>`;
    })
    .join("");
}

function renderTrend(trend) {
  if (!trend || trend.length === 0) return "";
  const max = Math.max(...trend);
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

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: ${SCREEN_WIDTH}px;
    height: ${SCREEN_HEIGHT}px;
    font-family: "Noto Sans", "Helvetica", "Arial", sans-serif;
    background: #fff;
    color: #000;
    padding: 40px;
    position: relative;
    -webkit-font-smoothing: none;
  }

  /* ===== 标题栏 ===== */
  .header {
    border-bottom: 4px solid #000;
    padding-bottom: 20px;
    margin-bottom: 30px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .title { font-size: 52px; font-weight: bold; }
  .timestamp { font-size: 28px; color: #333; }

  /* ===== 指标卡片 ===== */
  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin-bottom: 35px;
  }
  .metric-card {
    flex: 1 1 290px;
    border: 3px solid #000;
    padding: 20px;
    text-align: center;
  }
  .metric-label { font-size: 24px; color: #333; margin-bottom: 10px; }
  .metric-value { font-size: 56px; font-weight: bold; }

  /* ===== 区块通用 ===== */
  .section { margin-bottom: 35px; }
  .section-title {
    font-size: 32px;
    font-weight: bold;
    border-bottom: 2px solid #000;
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .empty { font-size: 26px; color: #666; }

  /* ===== 条形图（Top Models） ===== */
  .bar-row {
    display: flex;
    align-items: center;
    margin-bottom: 14px;
  }
  .bar-label { width: 220px; font-size: 26px; }
  .bar-track {
    flex: 1;
    height: 30px;
    border: 2px solid #000;
    margin: 0 15px;
  }
  .bar-fill { height: 100%; background: #000; }
  .bar-value { width: 90px; font-size: 26px; text-align: right; }

  /* ===== 渠道列表 ===== */
  .channel-row {
    display: flex;
    align-items: center;
    font-size: 28px;
    margin-bottom: 12px;
  }
  .dot { font-size: 32px; margin-right: 15px; }
  .dot-on { color: #000; }
  .dot-off { color: #999; }
  .channel-name { flex: 1; }
  .status-on { font-weight: bold; }
  .status-off { color: #999; }

  /* ===== 趋势图 ===== */
  .trend-chart {
    display: flex;
    align-items: flex-end;
    height: 200px;
    gap: 4px;
    border-bottom: 2px solid #000;
    padding-bottom: 0;
  }
  .trend-bar { flex: 1; background: #000; }

  /* ===== 页脚 ===== */
  .footer {
    position: absolute;
    bottom: 25px;
    left: 40px;
    right: 40px;
    font-size: 22px;
    color: #666;
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
      <div class="metric-label">Total Requests</div>
      <div class="metric-value">${formatNumber(s.totalRequests || 0)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Tokens</div>
      <div class="metric-value">${formatNumber(s.totalTokens || 0)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Cost</div>
      <div class="metric-value">$${(s.totalCost || 0).toFixed(2)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Sessions</div>
      <div class="metric-value">${s.activeSessions || 0}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Channels Online</div>
      <div class="metric-value">${s.onlineChannels || 0}/${totalChannels}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Top Models</div>
    ${renderTopModels(data.topModels)}
  </div>

  <div class="section">
    <div class="section-title">Channels</div>
    ${renderChannels(data.channels)}
  </div>

  ${
    data.hourlyTrend && data.hourlyTrend.length > 0
      ? `<div class="section">
    <div class="section-title">24h Trend</div>
    ${renderTrend(data.hourlyTrend)}
  </div>`
      : ""
  }

  <div class="footer">Powered by OpenClaw · kindle-dash</div>

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
