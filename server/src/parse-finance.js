const fs = require("fs");
const path = require("path");

/**
 * 解析经济形势 markdown 文档，提取股指、期货、加密货币数据。
 * 文档格式参考 docs/fince.md：
 *   ## 2. A股市场  —— 表格含 指数名称/最新点位/日涨跌幅/周涨跌幅
 *   ## 3. 美股市场 —— 同上
 *   ## 4. 商品市场 —— 黄金期货(fuGC)、原油期货(fuCL) 的 OHLC 表
 *   ## 5. 加密货币 —— BTC 价格 + 24h 涨跌
 */

// 将全角空格(　)和多个空格统一为分隔符
function normalizeLine(line) {
  return line.replace(/\u3000/g, " ").trim();
}

// 从含 emoji 箭头(🔺🔻)的百分比字符串中提取数值
// 例如 "🔺+1.29%" -> { value: 1.29, positive: true }
function parseChange(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[🔺🔻▲▼↑↓]/g, "").trim();
  const match = cleaned.match(/^([+-]?)\s*([\d.]+)\s*%?$/);
  if (!match) return null;
  const num = parseFloat(match[2]);
  const sign = match[1] === "-" ? -1 : 1;
  const value = sign * num;
  return { value, positive: value >= 0, raw: cleaned };
}

// 解析数字（去掉千分位逗号）
function parseNumber(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * 从代码块表格中解析股指行。
 * 行格式示例: 上证指数  3814.20  🔻-1.62%  🔺+0.47%
 */
function parseIndexRow(line, wantedNames) {
  const parts = normalizeLine(line).split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const name = parts[0];
  if (!wantedNames.includes(name)) return null;
  const value = parseNumber(parts[1]);
  if (value == null) return null;
  const dailyChange = parseChange(parts[2]);
  const weeklyChange = parts[3] ? parseChange(parts[3]) : null;
  return { name, value, dailyChange, weeklyChange };
}

/**
 * 从代码块表格中解析期货 OHLC 行。
 * 行格式示例: 7月27日  4097.5  4109.2  4119.3  4085.8
 */
function parseFuturesRow(line) {
  const parts = normalizeLine(line).split(/\s+/).filter(Boolean);
  if (parts.length < 5) return null;
  // 第一列是日期，后四列是 开盘/最新/最高/最低
  const date = parts[0];
  const open = parseNumber(parts[1]);
  const latest = parseNumber(parts[2]);
  const high = parseNumber(parts[3]);
  const low = parseNumber(parts[4]);
  if (open == null || latest == null) return null;
  return { date, open, latest, high, low };
}

/**
 * 在 markdown 中查找指定标题下方的代码块内容。
 * 返回代码块内的行数组。
 */
function extractCodeBlock(md, sectionPattern) {
  const lines = md.split("\n");
  let inSection = false;
  let inCodeBlock = false;
  let blockLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测是否进入目标 section
    if (/^#{1,6}\s/.test(line)) {
      if (sectionPattern.test(line)) {
        inSection = true;
      } else if (inSection) {
        // 遇到下一个同级或更高级标题，退出 section
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
        // 代码块结束
        return blockLines;
      }
      continue;
    }

    if (inCodeBlock) {
      blockLines.push(line);
    }
  }
  return blockLines;
}

/**
 * 查找 subsection（### 黄金期货）下方的代码块。
 */
function extractCodeBlockAfterSubsection(md, subsectionPattern) {
  const lines = md.split("\n");
  let found = false;
  let inCodeBlock = false;
  let blockLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^###\s/.test(line)) {
      if (subsectionPattern.test(line)) {
        found = true;
      } else if (found) {
        break;
      }
      continue;
    }

    if (!found) continue;

    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        blockLines = [];
      } else {
        return blockLines;
      }
      continue;
    }

    if (inCodeBlock) {
      blockLines.push(line);
    }
  }
  return blockLines;
}

/**
 * 主解析函数。
 * @param {string} md markdown 原文
 */
function parseFinance(md) {
  const result = {
    reportDate: null,
    aShares: [],
    usStocks: [],
    gold: null,
    oil: null,
    btc: null,
    timestamp: require("./lib/local-time").nowLocalISO(),
  };

  // 提取报告日期（第一行标题中的日期）
  const titleMatch = md.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
  if (titleMatch) result.reportDate = titleMatch[1];

  // ===== A股市场（section 2）=====
  const aShareNames = ["上证指数", "深证成指", "创业板指", "科创50", "沪深300", "中证500", "北证50"];
  const aShareBlock = extractCodeBlock(md, /A股|A股市场/);
  for (const line of aShareBlock) {
    // 跳过表头行
    if (/指数名称|最新点位|日涨跌幅|周涨跌幅/.test(line)) continue;
    const row = parseIndexRow(line, aShareNames);
    if (row) result.aShares.push(row);
  }

  // ===== 美股市场（section 3）=====
  const usNames = ["道琼斯", "纳斯达克", "标普500", "标普", "标普500指数"];
  const usBlock = extractCodeBlock(md, /美股|美股市场/);
  for (const line of usBlock) {
    if (/指数名称|最新点位|日涨跌幅|周涨跌幅/.test(line)) continue;
    const row = parseIndexRow(line, usNames);
    if (row) result.usStocks.push(row);
  }

  // ===== 黄金期货（subsection）=====
  const goldBlock = extractCodeBlockAfterSubsection(md, /黄金|fuGC/);
  // 跳过表头，取第一行（最新日期）
  const goldDataLines = goldBlock.filter(
    (l) => !/日期|开盘|最新|最高|最低/.test(l) && normalizeLine(l).length > 0
  );
  if (goldDataLines.length > 0) {
    const row = parseFuturesRow(goldDataLines[0]);
    if (row) result.gold = row;
  }

  // ===== 原油期货（subsection）=====
  const oilBlock = extractCodeBlockAfterSubsection(md, /原油|fuCL/);
  const oilDataLines = oilBlock.filter(
    (l) => !/日期|开盘|最新|最高|最低/.test(l) && normalizeLine(l).length > 0
  );
  if (oilDataLines.length > 0) {
    const row = parseFuturesRow(oilDataLines[0]);
    if (row) result.oil = row;
  }

  // ===== 加密货币（section 5）=====
  const cryptoBlock = extractCodeBlock(md, /加密货币|加密/);
  for (const line of cryptoBlock) {
    if (/币种|最新价格|24h|涨跌幅/.test(line)) continue;
    const parts = normalizeLine(line).split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    if (parts[0].includes("BTC") || parts[0] === "比特币") {
      const price = parseNumber(parts[1]);
      const change = parts[2] ? parseChange(parts[2]) : null;
      if (price != null) {
        result.btc = { price, change };
      }
    }
  }

  return result;
}

/**
 * 从文件读取并解析。
 * @param {string} filePath markdown 文件路径
 */
function parseFinanceFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Finance data file not found: ${filePath}`);
  }
  const md = fs.readFileSync(filePath, "utf-8");
  return parseFinance(md);
}

module.exports = { parseFinance, parseFinanceFile };
