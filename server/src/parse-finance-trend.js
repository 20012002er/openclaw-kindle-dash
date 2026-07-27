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

module.exports = { parseFinanceTrend, parseFinanceTrendFile };
