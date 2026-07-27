const fs = require("fs");
const path = require("path");
const { parseFinanceTrendFile, parseSupplementaryFile } = require("../parse-finance-trend");

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

// 格式化数字：加千分位
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
function fmtPct(v) {
  if (v == null || isNaN(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

// 涨跌箭头
function arrow(v) {
  if (v == null) return "";
  return v >= 0 ? "▲" : "▼";
}

/**
 * 生成一周走势 SVG 折线图（sparkline）。
 * @param {Array} weekData [{date, close, change}, ...]
 * @param {number} w SVG 宽
 * @param {number} h SVG 高
 */
function renderSparkline(weekData, w = 220, h = 56) {
  if (!weekData || weekData.length < 2) {
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="12" fill="#999">无数据</text>
    </svg>`;
  }

  const closes = weekData.map((d) => d.close).filter((v) => v != null);
  if (closes.length < 2) {
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="12" fill="#999">无数据</text>
    </svg>`;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const padX = 6;
  const padY = 8;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const stepX = innerW / (weekData.length - 1);

  // 把每个 close 映射为 (x, y)
  const points = weekData.map((d, i) => {
    const x = padX + i * stepX;
    // y 越小越靠上（值越大）
    const y =
      padY + innerH - ((d.close - min) / range) * innerH;
    return { x, y, close: d.close };
  });

  // 折线 path
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  // 填充区域 path（折线下方）
  const areaPath =
    `M${points[0].x.toFixed(1)},${(h - padY).toFixed(1)} ` +
    points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${points[points.length - 1].x.toFixed(1)},${(h - padY).toFixed(1)} Z`;

  // 数据点圆圈
  const dots = points
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#000" stroke="#fff" stroke-width="0.8"/>`
    )
    .join("");

  // 最新点高亮（更大圆圈）
  const last = points[points.length - 1];
  const lastDot = `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5" fill="#000" stroke="#fff" stroke-width="1"/>`;

  // 最高/最低标注（小字）
  const maxIdx = closes.indexOf(max);
  const minIdx = closes.indexOf(min);
  const maxPt = points[maxIdx];
  const minPt = points[minIdx];
  const maxLabel = `<text x="${maxPt.x.toFixed(1)}" y="${(maxPt.y - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="#666">${fmtNum(max)}</text>`;
  const minLabel = `<text x="${minPt.x.toFixed(1)}" y="${(minPt.y + 11).toFixed(1)}" text-anchor="middle" font-size="9" fill="#666">${fmtNum(min)}</text>`;

  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${areaPath}" fill="#000" fill-opacity="0.12" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="#000" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${lastDot}
    ${maxLabel}
    ${minLabel}
  </svg>`;
}

// 渲染单条指标行
function renderIndicatorRow(item, showUnit) {
  const change = item.dailyChange;
  const up = change != null && change >= 0;
  const unitStr = showUnit && item.unit ? `<span class="row-unit">${item.unit}</span>` : "";

  return `
    <div class="ind-row ${up ? "up" : "down"}">
      <div class="ind-name">
        <span class="ind-name-text">${item.name}</span>
        ${unitStr}
      </div>
      <div class="ind-latest">${fmtNum(item.latest)}</div>
      <div class="ind-change">
        <span class="ind-arrow">${arrow(change)}</span>
        <span class="ind-pct">${fmtPct(change)}</span>
      </div>
      <div class="ind-spark">${renderSparkline(item.weekData)}</div>
    </div>`;
}

// 渲染一个模块（section）
function renderSection(title, items, showUnit) {
  if (!items || items.length === 0) return "";
  return `
    <div class="section">
      <div class="section-title">${title}</div>
      <div class="section-body">
        ${items.map((it) => renderIndicatorRow(it, showUnit)).join("")}
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
      <div class="section-title">宏观经济</div>
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
      <div class="section-title">走势展望</div>
      <div class="outlook-list">${rows}</div>
    </div>`;
}

function renderHtml(data) {
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
    padding: 26px 30px 22px;
    position: relative;
    -webkit-font-smoothing: none;
  }

  /* ===== Header ===== */
  .header {
    border-bottom: 4px solid #000;
    padding-bottom: 10px;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .header-left { font-size: 36px; font-weight: bold; letter-spacing: -0.5px; }
  .header-right { font-size: 18px; color: #444; text-align: right; }
  .header-date { font-size: 14px; color: #777; margin-top: 2px; }

  /* ===== Section ===== */
  .section { margin-bottom: 12px; }
  .section-title {
    font-size: 20px;
    font-weight: bold;
    border-left: 5px solid #000;
    padding-left: 9px;
    margin-bottom: 6px;
    line-height: 1.2;
  }

  /* ===== 指标行 ===== */
  .ind-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #ccc;
    padding: 7px 4px;
    gap: 12px;
  }
  .ind-row:last-child { border-bottom: 2px solid #000; }

  .ind-name {
    flex: 0 0 200px;
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .ind-name-text { font-size: 19px; font-weight: 600; }
  .row-unit { font-size: 12px; color: #888; margin-top: 2px; }

  .ind-latest {
    flex: 0 0 180px;
    font-size: 26px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .ind-change {
    flex: 0 0 130px;
    font-size: 20px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .ind-arrow { font-size: 16px; margin-right: 3px; }
  .ind-row.up .ind-change { }
  .ind-row.down .ind-change { }
  .ind-row.down .ind-arrow,
  .ind-row.down .ind-pct {
    /* 在 e-ink 黑白屏上保持黑色高对比度，不使用颜色 */
  }

  .ind-spark {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }
  .spark { display: block; }

  /* ===== Footer ===== */
  .footer {
    position: absolute;
    bottom: 10px;
    left: 30px;
    right: 30px;
    font-size: 14px;
    color: #888;
    text-align: center;
  }

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
    font-size: 14px;
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
    font-size: 14px;
    line-height: 1.4;
    padding: 4px 0;
    border-bottom: 1px dotted #bbb;
  }
  .outlook-item:last-child { border-bottom: none; }
  .outlook-label {
    flex: 0 0 56px;
    font-weight: bold;
    color: #000;
  }
  .outlook-text { flex: 1; color: #222; }
</style>
</head>
<body>

  <div class="header">
    <div class="header-left">经济趋势</div>
    <div class="header-right">
      <div>${formatTime()}</div>
      ${data.reportTime ? `<div class="header-date">报告：${data.reportTime}</div>` : ""}
    </div>
  </div>

  ${renderSection("国内市场", data.domestic, false)}
  ${renderSection("美股市场", data.us, false)}
  ${renderSection("商品期货", data.futures, true)}
  ${renderSection("加密货币", data.crypto, true)}
  ${renderMacroSection(data.macro || [])}
  ${renderOutlookSection(data.outlook || [])}

  <div class="footer">lazybeartoby · 经济趋势（含一周走势）</div>

</body>
</html>`;
}

/**
 * 获取经济趋势数据
 */
async function fetchData(settings) {
  const dataFile =
    (settings && settings.financeTrend && settings.financeTrend.dataFile) ||
    path.resolve(__dirname, "..", "..", "data", "fince-data.md");

  console.log(`Parsing finance-trend data from: ${dataFile}`);
  const data = parseFinanceTrendFile(dataFile);
  console.log(
    `Finance-trend data parsed: 国内=${data.domestic.length}, 美股=${data.us.length}, 期货=${data.futures.length}, 加密=${data.crypto.length}`
  );

  // 读取补充内容（宏观经济 + 走势展望）
  // 仅当用户在管理后台显式配置了 supplementaryFile 时才加载，否则不显示这两个 section
  const suppFile =
    (settings && settings.financeTrend && settings.financeTrend.supplementaryFile) || "";
  if (suppFile.trim()) {
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
  } else {
    console.log("No supplementaryFile configured, skipping macro/outlook sections");
    data.macro = [];
    data.outlook = [];
  }

  return data;
}

function render(data) {
  const html = renderHtml(data);
  const htmlPath = path.join(
    __dirname,
    "..",
    "..",
    "public",
    "finance-trend.html"
  );
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

module.exports = {
  id: "finance-trend",
  name: "经济趋势",
  fetchData,
  render,
};
