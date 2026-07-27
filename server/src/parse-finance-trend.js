const fs = require("fs");
const path = require("path");

/**
 * 解析经济趋势 markdown 文档。
 * 数据格式：在文档末尾的 "## 📦 原始数据 (JSON)" 代码块中包含完整 JSON。
 *
 * JSON 结构：
 * {
 *   "🇨🇳 国内市场": [{name, latest_price, daily_change_pct, week_data:[{date,close,change_pct}]}],
 *   "🇺🇸 美股市场": [...],
 *   "📈 商品期货": [{name, unit, latest_price, daily_change_pct, week_data}],
 *   "₿ 加密货币": [{name, unit, latest_price, daily_change_pct, week_data}]
 * }
 *
 * 可选：补充内容来自补充 md 文档（如 fince.md），包含：
 *   - 宏观经济指标（CPI/PPI/PMI/M2 等）
 *   - 未来走势展望（A股/美股/黄金/原油）
 */

// 从 markdown 中提取 "## 📦 原始数据 (JSON)" 下方的代码块内容
function extractJsonBlock(md) {
  const lines = md.split("\n");
  let inSection = false;
  let inCodeBlock = false;
  let blockLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^#{2,6}\s/.test(line)) {
      if (/原始数据|JSON/i.test(line)) {
        inSection = true;
      } else if (inSection) {
        break;
      }
      continue;
    }

    if (!inSection) continue;

    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        blockLines = [];
      } else {
        return blockLines.join("\n");
      }
      continue;
    }

    if (inCodeBlock) {
      blockLines.push(line);
    }
  }
  return null;
}

// 提取报告生成时间（"> **生成时间**: ..."）
function extractReportTime(md) {
  const m = md.match(/\*\*生成时间\*\*[:：]\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

/**
 * 主解析函数。
 * @param {string} md markdown 原文
 */
function parseFinanceTrend(md) {
  const result = {
    reportTime: null,
    domestic: [], // 国内市场 (A股)
    us: [], // 美股市场
    futures: [], // 商品期货
    crypto: [], // 加密货币
    timestamp: new Date().toISOString(),
  };

  result.reportTime = extractReportTime(md);

  const jsonStr = extractJsonBlock(md);
  if (!jsonStr) {
    console.warn("No JSON block found in finance-trend markdown");
    return result;
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse finance-trend JSON:", e.message);
    return result;
  }

  // 规范化每条指标
  const normalize = (arr) =>
    (arr || []).map((item) => ({
      name: item.name || "—",
      unit: item.unit || "",
      latest: item.latest_price != null ? item.latest_price : null,
      dailyChange:
        item.daily_change_pct != null ? item.daily_change_pct : null,
      weekData: (item.week_data || []).map((d) => ({
        date: d.date || "",
        close: d.close != null ? d.close : null,
        change: d.change_pct != null ? d.change_pct : null,
      })),
    }));

  // 国内市场
  result.domestic = normalize(
    data["🇨🇳 国内市场"] || data["国内市场"] || data["domestic"] || []
  );

  // 美股市场
  result.us = normalize(
    data["🇺🇸 美股市场"] || data["美股市场"] || data["us"] || []
  );

  // 商品期货
  result.futures = normalize(
    data["📈 商品期货"] || data["商品期货"] || data["futures"] || []
  );

  // 加密货币
  result.crypto = normalize(
    data["₿ 加密货币"] || data["加密货币"] || data["crypto"] || []
  );

  return result;
}

/**
 * 从文件读取并解析。
 * @param {string} filePath markdown 文件路径
 */
function parseFinanceTrendFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Finance trend data file not found: ${filePath}`);
  }
  const md = fs.readFileSync(filePath, "utf-8");
  return parseFinanceTrend(md);
}

// ===== 补充内容（来自 fince.md 等报告文档）=====

/**
 * 提取宏观经济指标。fince.md 中的格式：
 *   ## 6. 宏观经济（6月数据）
 *   ```
 *   指标名称  最新值  同比增速  数据月份
 *   CPI        —     4.1%    2026年6月
 *   ...
 *   ```
 * 返回 [{name, value, yoy, period}]
 */
function extractMacro(md) {
  const result = [];
  const lines = md.split("\n");
  let inSection = false;
  let inCodeBlock = false;
  let blockLines = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (/宏观经济/i.test(line)) {
        inSection = true;
      } else if (inSection) {
        break;
      }
      continue;
    }
    if (!inSection) continue;
    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        blockLines = [];
      } else {
        break;
      }
      continue;
    }
    if (inCodeBlock) blockLines.push(line);
  }

  for (const line of blockLines) {
    const cleaned = line.replace(/\u3000/g, " ").trim();
    if (!cleaned) continue;
    if (/指标名称|最新值|同比增速|数据月份/.test(cleaned)) continue;
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length < 3) continue;
    const name = parts[0];
    // 跳过要点分析的标题（如 "📌" 开头）
    if (/^[📌💡⚠️🔥]/.test(name)) continue;
    const value = parts[1];
    const yoy = parts[2];
    const period = parts.slice(3).join(" ") || "";
    result.push({ name, value, yoy, period });
  }
  return result;
}

/**
 * 提取走势展望。fince.md 中的格式：
 *   ## 10. 📈 未来走势展望
 *   **A股：** 上证指数在3800点附近获得支撑...
 *   **美股：** 道指和标普500处于历史高位...
 *   **黄金：** 4100美元关口多空博弈加剧...
 *   **原油：** 85美元附近或形成短期支撑...
 * 返回 [{label, text}]
 */
function extractOutlook(md) {
  const result = [];
  const lines = md.split("\n");
  let inSection = false;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (/走势展望|未来走势/i.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection) break;
    }
    if (!inSection) continue;

    // 匹配 **A股：** 或 **A股:** 等格式
    const m = line.match(/^\s*\*\*([^*:：]+)[:：]\*\*\s*(.+)$/);
    if (m) {
      result.push({ label: m[1].trim(), text: m[2].trim() });
    }
  }
  return result;
}

/**
 * 解析补充内容（宏观经济 + 走势展望）。
 * @param {string} filePath 补充 md 文件路径
 */
function parseSupplementaryFile(filePath) {
  const result = { macro: [], outlook: [] };
  if (!filePath || !fs.existsSync(filePath)) {
    return result;
  }
  const md = fs.readFileSync(filePath, "utf-8");
  result.macro = extractMacro(md);
  result.outlook = extractOutlook(md);
  return result;
}

module.exports = {
  parseFinanceTrend,
  parseFinanceTrendFile,
  parseSupplementaryFile,
  extractMacro,
  extractOutlook,
};
