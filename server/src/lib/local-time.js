/**
 * 时区相关的时间格式化 helper。
 *
 * 不能直接用 new Date().toISOString()，因为它永远返回 UTC（带 Z 后缀），
 * 在 TZ=Asia/Shanghai 的容器里日志会显示 UTC 时间，造成困惑。
 *
 * 这些 helper 依据 process.env.TZ（由 Dockerfile / .env 设置）输出
 * 带时区偏移的 ISO 字符串，既能让人直观看懂，又能被 new Date() 正确解析。
 */

/**
 * 返回当前时刻的本地 ISO 字符串，带时区偏移。
 * 例：TZ=Asia/Shanghai 时返回 "2026-07-27T17:18:25+08:00"
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function nowLocalISO(date = new Date()) {
  const tz = process.env.TZ;
  if (!tz) return date.toISOString();
  // sv-SE locale 输出 YYYY-MM-DD HH:mm:ss
  const localStr = date
    .toLocaleString("sv-SE", { timeZone: tz })
    .replace(" ", "T");
  // getTimezoneOffset() 受 process.env.TZ 影响，返回 UTC - local 的分钟数
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const offsetHH = String(Math.floor(absMin / 60)).padStart(2, "0");
  const offsetMM = String(absMin % 60).padStart(2, "0");
  return `${localStr}${sign}${offsetHH}:${offsetMM}`;
}

module.exports = { nowLocalISO };
