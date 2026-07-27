/**
 * 极简 cron 表达式解析与"下次运行时间"计算。
 *
 * 支持 5 段标准 cron：minute hour day-of-month month day-of-week
 * 每段支持的语法：
 *   - 星号         表示所有值
 *   - 星号斜杠N    表示每 N 个单位
 *   - 单值         如 5
 *   - 列表         如 1,3,5
 *   - 区间         如 1-5
 *   - 区间斜杠N    如 1-10 斜杠 2
 *
 * 不支持：宏（@daily 等）、L/W/# 等扩展语法、秒级、年。
 * 这对本项目的调度场景已足够。
 */

const FIELD_RANGES = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7 }, // 0 和 7 都表示周日
};

/**
 * 解析单个 cron 字段，返回该字段允许的整数值集合。
 * @param {string} field
 * @param {{min:number,max:number}} range
 * @returns {Set<number>}
 */
function parseField(field, range) {
  const result = new Set();
  if (field === undefined || field === null || field === "") {
    throw new Error("空字段");
  }
  // 处理逗号分隔的列表
  for (const part of String(field).split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`无效步长: ${part}`);
    }
    let lo, hi;
    if (rangePart === "*") {
      lo = range.min;
      hi = range.max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
    } else {
      lo = parseInt(rangePart, 10);
      hi = stepPart ? range.max : lo; // 有步长且无范围时，从 lo 到 max
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < range.min || hi > range.max || lo > hi) {
      throw new Error(`字段值越界: ${part} (允许 ${range.min}-${range.max})`);
    }
    for (let v = lo; v <= hi; v += step) {
      result.add(v);
    }
  }
  return result;
}

/**
 * 计算给定 cron 表达式的下一次运行时间（>= from + 1 分钟）。
 * 若 7 天内无匹配，返回 null。
 *
 * @param {string} cronExpr - 5 段标准 cron 表达式
 * @param {Date} [from=new Date()]
 * @returns {Date|null}
 */
function getNextRun(cronExpr, from = new Date()) {
  if (!cronExpr || typeof cronExpr !== "string") return null;
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  let minutes, hours, doms, months, dows;
  try {
    minutes = parseField(parts[0], FIELD_RANGES.minute);
    hours = parseField(parts[1], FIELD_RANGES.hour);
    doms = parseField(parts[2], FIELD_RANGES.dayOfMonth);
    months = parseField(parts[3], FIELD_RANGES.month);
    dows = parseField(parts[4], FIELD_RANGES.dayOfWeek);
  } catch (e) {
    return null;
  }
  // dayOfWeek: 0 和 7 都表示周日，统一成 0-6
  const normalizedDows = new Set();
  for (const d of dows) {
    normalizedDows.add(d === 7 ? 0 : d);
  }

  // 从下一分钟开始逐分钟扫描，最多 7 天 = 10080 分钟
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const maxIter = 7 * 24 * 60;
  for (let i = 0; i < maxIter; i++) {
    const candidate = new Date(start.getTime() + i * 60 * 1000);
    if (!months.has(candidate.getMonth() + 1)) continue;
    if (!doms.has(candidate.getDate())) continue;
    const jsDow = candidate.getDay(); // 0=周日
    if (!normalizedDows.has(jsDow)) continue;
    if (!hours.has(candidate.getHours())) continue;
    if (!minutes.has(candidate.getMinutes())) continue;
    return candidate;
  }
  return null;
}

module.exports = { getNextRun, parseField };
