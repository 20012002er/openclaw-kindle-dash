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
function renderSparkline(weekData, w = 300, h = 80) {
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
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.8" fill="#000" stroke="#fff" stroke-width="1"/>`
    )
    .join("");

  // 最新点高亮（更大圆圈）
  const last = points[points.length - 1];
  const lastDot = `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4.5" fill="#000" stroke="#fff" stroke-width="1.4"/>`;

  // 最高/最低标注
  const maxIdx = closes.indexOf(max);
  const minIdx = closes.indexOf(min);
  const maxPt = points[maxIdx];
  const minPt = points[minIdx];
  const maxLabel = `<text x="${maxPt.x.toFixed(1)}" y="${(maxPt.y - 6).toFixed(1)}" text-anchor="middle" font-size="13" fill="#555">${fmtNum(max)}</text>`;
  const minLabel = `<text x="${minPt.x.toFixed(1)}" y="${(minPt.y + 15).toFixed(1)}" text-anchor="middle" font-size="13" fill="#555">${fmtNum(min)}</text>`;

  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${areaPath}" fill="#000" fill-opacity="0.12" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="#000" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
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
    padding: 30px 34px 26px;
    position: relative;
    -webkit-font-smoothing: none;
    display: flex;
    flex-direction: column;
  }

  /* ===== Header ===== */
  .header {
    border-bottom: 5px solid #000;
    padding-bottom: 14px;
    margin-bottom: 18px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .header-left { font-size: 48px; font-weight: bold; letter-spacing: -0.5px; }
  .header-right { font-size: 26px; color: #444; text-align: right; }
  .header-date { font-size: 20px; color: #777; margin-top: 4px; }

  /* ===== Section ===== */
  .section { margin-bottom: 16px; }
  .section-title {
    font-size: 30px;
    font-weight: bold;
    border-left: 7px solid #000;
    padding-left: 12px;
    margin-bottom: 8px;
    line-height: 1.2;
  }

  /* ===== 指标行 ===== */
  .ind-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #ccc;
    padding: 11px 6px;
    gap: 16px;
  }
  .ind-row:last-child { border-bottom: 3px solid #000; }

  .ind-name {
    flex: 0 0 280px;
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .ind-name-text { font-size: 28px; font-weight: 600; }
  .row-unit { font-size: 17px; color: #888; margin-top: 3px; }

  .ind-latest {
    flex: 0 0 240px;
    font-size: 38px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .ind-change {
    flex: 0 0 170px;
    font-size: 30px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .ind-arrow { font-size: 26px; margin-right: 4px; }
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
    margin-top: auto;
    padding-top: 12px;
    font-size: 20px;
    color: #888;
    text-align: center;
  }

  /* ===== 宏观经济 ===== */
  .macro-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px 14px;
    border-bottom: 3px solid #000;
    padding-bottom: 8px;
  }
  .macro-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 20px;
    border-bottom: 1px dotted #bbb;
    padding: 5px 0;
  }
  .macro-name { color: #333; }
  .macro-val { font-weight: bold; font-variant-numeric: tabular-nums; }
  .macro-val.neg { /* 负值 */ }
  .macro-period { font-size: 15px; color: #888; margin-left: 6px; }
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

  // 读取补充内容（宏观经济）。走势展望模块已移除，不再加载。
  // 默认从 data/fince.md 读取宏观经济；用户可在管理后台覆盖 supplementaryFile
  const suppFile =
    (settings && settings.financeTrend && settings.financeTrend.supplementaryFile) ||
    path.resolve(__dirname, "..", "..", "data", "fince.md");
  if (fs.existsSync(suppFile)) {
    console.log(`Parsing supplementary data from: ${suppFile}`);
    const supp = parseSupplementaryFile(suppFile);
    data.macro = supp.macro;
    console.log(`Supplementary parsed: 宏观=${supp.macro.length}`);
  } else {
    console.warn(`Supplementary file not found: ${suppFile}, skipping macro section`);
    data.macro = [];
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
