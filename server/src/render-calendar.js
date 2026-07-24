const { Solar, Lunar } = require("lunar-javascript");

/**
 * 生成当月日历数据，包含公历、农历、节日/节气信息。
 */
function getCalendarData() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  // 当月第一天是星期几（0=周日）
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  // 当月天数
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // 上月天数（用于填充前面的空格）
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = now.getDate();
  const cells = [];

  // 前面补上月日期
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    cells.push(buildCell(prevYear, prevMonth, d, false));
  }

  // 当月日期
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(buildCell(year, month, d, d === today));
  }

  // 后面补下月日期，凑满 6 行（42 格）
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    cells.push(buildCell(nextYear, nextMonth, d, false));
  }

  return {
    year,
    month: month + 1,
    today,
    cells,
    lunarToday: getLunarToday(),
  };
}

function buildCell(year, monthIdx, day, isToday) {
  const solar = Solar.fromYmd(year, monthIdx + 1, day);
  const lunar = solar.getLunar();

  // 农历日（初一显示月名，如"六月"，其余显示日如"初八"）
  let lunarText;
  const lunarDay = lunar.getDayInChinese();
  if (lunarDay === "初一") {
    lunarText = lunar.getMonthInChinese() + "月";
  } else {
    lunarText = lunarDay;
  }

  // 节气
  const jieQi = lunar.getJieQi();
  // 传统节日（春节、端午等）
  const festivals = lunar.getFestivals();
  // 其他节日
  const otherFestivals = lunar.getOtherFestivals();

  // 公历节日（简单判断）
  const solarFestivals = getSolarFestival(monthIdx + 1, day);

  // 优先级：节气 > 传统节日 > 公历节日 > 农历日
  let label = lunarText;
  let isHoliday = false;
  if (jieQi) {
    label = jieQi;
    isHoliday = true;
  } else if (festivals.length > 0) {
    label = festivals[0];
    isHoliday = true;
  } else if (solarFestivals) {
    label = solarFestivals;
    isHoliday = true;
  } else if (otherFestivals.length > 0) {
    label = otherFestivals[0];
    isHoliday = true;
  }

  return {
    day,
    lunarText,
    label,
    isHoliday,
    isToday,
    isCurrentMonth: monthIdx === new Date().getMonth(),
  };
}

function getLunarToday() {
  const now = new Date();
  const solar = Solar.fromYmd(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  const lunar = solar.getLunar();
  return (
    lunar.getMonthInChinese() +
    "月" +
    lunar.getDayInChinese() +
    " · " +
    lunar.getYearInGanZhi() +
    "年" +
    lunar.getYearShengXiao()
  );
}

function getSolarFestival(month, day) {
  const map = {
    "1-1": "元旦",
    "2-14": "情人节",
    "3-8": "妇女节",
    "3-12": "植树节",
    "4-1": "愚人节",
    "5-1": "劳动节",
    "5-4": "青年节",
    "6-1": "儿童节",
    "7-1": "建党节",
    "8-1": "建军节",
    "9-10": "教师节",
    "10-1": "国庆节",
    "12-25": "圣诞节",
  };
  return map[`${month}-${day}`] || null;
}

module.exports = { getCalendarData };
