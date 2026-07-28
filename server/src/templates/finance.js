const fs = require("fs");
const path = require("path");
const { parseFinanceFile } = require("../parse-finance");
const { parseSupplementaryFile } = require("../parse-finance-trend");

const SCREEN_WIDTH = parseInt(process.env.SCREEN_WIDTH || "1072", 10);
const SCREEN_HEIGHT = parseInt(process.env.SCREEN_HEIGHT || "1448", 10);

function formatTime() {
  const d = new Date();
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
}

// 格式化数字：大数加千分位
function fmtNum(n) {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return n.toFixed(2);
}

// 格式化百分比
function fmtPct(change) {
  if (!change) return "—";
  const v = change.value;
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

// 涨跌箭头
function arrow(change) {
  if (!change) return "";
  return change.positive ? "▲" : "▼";
}

// 渲染单个指数卡片
function renderIndexCard(idx, shortName) {
  const change = idx.dailyChange;
  const weekly = idx.weeklyChange;
  const arrowStr = arrow(change);
  const pctStr = fmtPct(change);
  const weeklyStr = weekly ? `周 ${fmtPct(weekly)}` : "";

  return `
    <div class="idx-card ${change && change.positive ? "up" : "down"}">
      <div class="idx-name">${shortName || idx.name}</div>
      <div class="idx-value">${fmtNum(idx.value)}</div>
      <div class="idx-change">
        <span class="arrow">${arrowStr}</span>
        <span class="pct">${pctStr}</span>
      </div>
      <div class="idx-weekly">${weeklyStr}</div>
    </div>`;
}

// 渲染期货卡片
function renderFuturesCard(f, title, unit) {
  if (!f) return `<div class="fut-card empty">${title}<br><span class="empty-text">无数据</span></div>`;
  const diff = f.latest - f.open;
  const diffStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
  return `
    <div class="fut-card">
      <div class="fut-title">${title}</div>
      <div class="fut-latest">${fmtNum(f.latest)} <span class="fut-unit">${unit || ""}</span></div>
      <div class="fut-diff ${diff >= 0 ? "up" : "down"}">
        ${diff >= 0 ? "▲" : "▼"} ${diffStr} ${f.date || ""}
      </div>
      <div class="fut-ohlc">
        <div class="ohlc-row"><span>开</span><span>${fmtNum(f.open)}</span></div>
        <div class="ohlc-row"><span>高</span><span>${fmtNum(f.high)}</span></div>
        <div class="ohlc-row"><span>低</span><span>${fmtNum(f.low)}</span></div>
      </div>
    </div>`;
}

/**
 * 渲染宏观经济 section（4 列网格紧凑展示）
 */
function renderMacroSection(items) {
  if (!items || items.length === 0) return "";
  const cells = items
    .map((it) => {
      const isNeg = /^-/.test(it.yoy);
      return `<div class="macro-item">
        <span class="macro-name">${it.name}</span>
        <span><span class="macro-val ${isNeg ? "neg" : ""}">${it.yoy}</span><span class="macro-period">${it.period}</span></span>
      </div>`;
    })
    .join("");
  return `
    <div class="section">
      <div class="section-title">
        <span>宏观经济</span>
        <span class="section-sub">${items.length > 0 ? "同比 / 数据月份" : ""}</span>
      </div>
      <div class="macro-grid">${cells}</div>
    </div>`;
}

/**
 * 渲染走势展望 section
 */
function renderOutlookSection(items) {
  if (!items || items.length === 0) return "";
  const rows = items
    .map(
      (it) => `<div class="outlook-item">
        <span class="outlook-label">${it.label}</span>
        <span class="outlook-text">${it.text}</span>
      </div>`
    )
    .join("");
  return `
    <div class="section">
      <div class="section-title"><span>走势展望</span></div>
      <div class="outlook-list">${rows}</div>
    </div>`;
}

function renderHtml(data) {
  const aShares = data.aShares || [];
  const usStocks = data.usStocks || [];

  // 名称映射（显示用简称）
  const aNameMap = {
    上证指数: "上证",
    深证成指: "深证",
    科创50: "科创50",
  };
  const usNameMap = {
    道琼斯: "道琼斯",
    纳斯达克: "纳斯达克",
    标普500: "标普500",
  };

  // 筛选要展示的指数（按优先级）
  const aWanted = ["上证指数", "深证成指", "科创50"];
  const aDisplay = aWanted
    .map((n) => aShares.find((s) => s.name === n))
    .filter(Boolean);

  const usWanted = ["道琼斯", "纳斯达克", "标普500"];
  const usDisplay = usWanted
    .map((n) => usStocks.find((s) => s.name === n))
    .filter(Boolean);

  // BTC
  const btc = data.btc;
  const btcChange = btc && btc.change ? btc.change : null;
  const btcArrow = btcChange ? (btcChange.positive ? "▲" : "▼") : "";
  const btcPct = btcChange ? fmtPct(btcChange) : "—";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: ${SCREEN_WIDTH}px;
    height: ${SCREEN_HEIGHT}px;
    font-family: "Noto Sans CJK SC", "Helvetica", "Arial", sans-serif;
    background: #fff;
    color: #000;
    padding: 28px 32px;
    position: relative;
    -webkit-font-smoothing: none;
    display: flex;
    flex-direction: column;
  }

  /* ===== Header ===== */
  .header {
    border-bottom: 4px solid #000;
    padding-bottom: 12px;
    margin-bottom: 18px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .header-left { font-size: 38px; font-weight: bold; letter-spacing: -0.5px; }
  .header-right { font-size: 20px; color: #444; text-align: right; }
  .header-date { font-size: 16px; color: #777; margin-top: 2px; }

  /* ===== Section ===== */
  .section { margin-bottom: 16px; }
  .section-title {
    font-size: 22px;
    font-weight: bold;
    border-left: 5px solid #000;
    padding-left: 10px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-sub {
    font-size: 14px;
    font-weight: 400;
    color: #888;
  }

  /* ===== 指数卡片行 ===== */
  .idx-row {
    display: flex;
    gap: 10px;
  }
  .idx-card {
    flex: 1;
    border: 3px solid #000;
    padding: 10px 8px;
    text-align: center;
    position: relative;
  }
  .idx-card.up {
    border-width: 4px;
  }
  .idx-card.down {
    background: #000;
    color: #fff;
  }
  .idx-card.down .idx-weekly { color: #bbb; }

  .idx-name { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
  .idx-value {
    font-size: 30px;
    font-weight: bold;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    margin-bottom: 4px;
  }
  .idx-change {
    font-size: 18px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }
  .idx-change .arrow { font-size: 16px; }
  .idx-weekly {
    font-size: 13px;
    color: #666;
    margin-top: 2px;
  }
  .idx-card.down .idx-weekly { color: #aaa; }

  /* ===== 期货卡片 ===== */
  .fut-row {
    display: flex;
    gap: 12px;
  }
  .fut-card {
    flex: 1;
    border: 3px solid #000;
    padding: 12px 14px;
  }
  .fut-card.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #999;
  }
  .fut-card.empty .empty-text { font-size: 16px; margin-top: 6px; }
  .fut-title { font-size: 20px; font-weight: bold; margin-bottom: 6px; }
  .fut-latest {
    font-size: 32px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    margin-bottom: 4px;
  }
  .fut-unit { font-size: 16px; font-weight: 400; color: #555; }
  .fut-diff {
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    margin-bottom: 8px;
  }
  .fut-diff.up { }
  .fut-diff.down { }
  .fut-ohlc {
    display: flex;
    gap: 14px;
    border-top: 2px solid #000;
    padding-top: 6px;
  }
  .ohlc-row {
    flex: 1;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
  }
  .ohlc-row span:first-child {
    color: #888;
    margin-right: 4px;
  }
  .fut-card.down-style .ohlc-row span:first-child { color: #aaa; }

  /* ===== BTC ===== */
  .btc-card {
    border: 3px solid #000;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .btc-left { display: flex; align-items: baseline; gap: 10px; }
  .btc-label { font-size: 22px; font-weight: bold; }
  .btc-price {
    font-size: 34px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }
  .btc-change {
    font-size: 22px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }
  .btc-change .arrow { margin-right: 4px; }

  /* ===== 宏观经济 ===== */
  .macro-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px 10px;
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
  }
  .macro-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 15px;
    border-bottom: 1px dotted #bbb;
    padding: 3px 0;
  }
  .macro-name { color: #333; }
  .macro-val { font-weight: bold; font-variant-numeric: tabular-nums; }
  .macro-val.neg { /* 负值 */ }
  .macro-period { font-size: 11px; color: #888; margin-left: 4px; }

  /* ===== 走势展望 ===== */
  .outlook-list {
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
  }
  .outlook-item {
    display: flex;
    font-size: 15px;
    line-height: 1.4;
    padding: 4px 0;
    border-bottom: 1px dotted #bbb;
  }
  .outlook-item:last-child { border-bottom: none; }
  .outlook-label {
    flex: 0 0 64px;
    font-weight: bold;
    color: #000;
  }
  .outlook-text { flex: 1; color: #222; }

  /* ===== Footer ===== */
  .footer {
    margin-top: auto;
    padding-top: 10px;
    font-size: 16px;
    color: #888;
    text-align: center;
  }
</style>
</head>
<body>

  <div class="header">
    <div>
      <div class="header-left">经济形势</div>
    </div>
    <div class="header-right">
      <div>${formatTime()}</div>
      ${data.reportDate ? `<div class="header-date">报告日期：${data.reportDate}</div>` : ""}
    </div>
  </div>

  <!-- A股 -->
  <div class="section">
    <div class="section-title">
      <span>A股市场</span>
      <span class="section-sub">日 / 周</span>
    </div>
    <div class="idx-row">
      ${aDisplay
        .map((idx) => renderIndexCard(idx, aNameMap[idx.name]))
        .join("")}
    </div>
  </div>

  <!-- 美股 -->
  <div class="section">
    <div class="section-title">
      <span>美股市场</span>
      <span class="section-sub">日 / 周</span>
    </div>
    <div class="idx-row">
      ${usDisplay
        .map((idx) => renderIndexCard(idx, usNameMap[idx.name]))
        .join("")}
    </div>
  </div>

  <!-- 商品期货 -->
  <div class="section">
    <div class="section-title">
      <span>商品期货</span>
      <span class="section-sub">最新 / 开盘 / 最高 / 最低</span>
    </div>
    <div class="fut-row">
      ${renderFuturesCard(data.gold, "黄金期货 (GC)", "美元/盎司")}
      ${renderFuturesCard(data.oil, "原油期货 (CL)", "美元/桶")}
    </div>
  </div>

  <!-- 加密货币 -->
  <div class="section">
    <div class="section-title">
      <span>加密货币</span>
      <span class="section-sub">24h</span>
    </div>
    <div class="btc-card">
      <div class="btc-left">
        <span class="btc-label">BTC</span>
        <span class="btc-price">$${fmtNum(btc ? btc.price : null)}</span>
      </div>
      <div class="btc-change ${btcChange && btcChange.positive ? "up" : "down"}">
        <span class="arrow">${btcArrow}</span>${btcPct}
      </div>
    </div>
  </div>

  ${renderMacroSection(data.macro || [])}
  ${renderOutlookSection(data.outlook || [])}

  <div class="footer">lazybeartoby · 经济形势</div>

</body>
</html>`;
}

/**
 * 获取经济形势数据
 */
async function fetchData(settings) {
  const dataFile =
    (settings && settings.finance && settings.finance.dataFile) ||
    path.resolve(__dirname, "..", "..", "data", "fince.md");

  console.log(`Parsing finance data from: ${dataFile}`);
  const data = parseFinanceFile(dataFile);
  console.log(
    `Finance data parsed: A股=${data.aShares.length}, 美股=${data.usStocks.length}, gold=${
      data.gold ? "yes" : "no"
    }, oil=${data.oil ? "yes" : "no"}, btc=${data.btc ? "yes" : "no"}`
  );

  // 读取补充内容（宏观经济 + 走势展望）。默认与行情数据同源（fince.md），
  // 用户可在管理后台通过 supplementaryFile 覆盖指向其他报告文件
  const suppFile =
    (settings && settings.finance && settings.finance.supplementaryFile) || dataFile;
  if (fs.existsSync(suppFile)) {
    console.log(`Parsing supplementary data from: ${suppFile}`);
    const supp = parseSupplementaryFile(suppFile);
    data.macro = supp.macro;
    data.outlook = supp.outlook;
    console.log(
      `Supplementary parsed: 宏观=${supp.macro.length}, 展望=${supp.outlook.length}`
    );
  } else {
    console.warn(`Supplementary file not found: ${suppFile}, skipping macro/outlook sections`);
    data.macro = [];
    data.outlook = [];
  }

  return data;
}

function render(data) {
  const html = renderHtml(data);
  const htmlPath = path.join(__dirname, "..", "..", "public", "finance.html");
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

module.exports = {
  id: "finance",
  name: "经济形势",
  fetchData,
  render,
};
