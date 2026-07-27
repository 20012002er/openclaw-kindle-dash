const fs = require("fs");
const path = require("path");
const { fetchWeather } = require("../fetch-weather");
const { fetchTodos } = require("../fetch-todos");
const { getCalendarData } = require("../render-calendar");

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

function weatherIcon(code) {
  // wttr.in weather code -> 简单符号
  const c = parseInt(code, 10);
  if (c === 113) return "晴";
  if (c === 116) return "多云";
  if ([143, 248, 260, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308].includes(c))
    return "雨";
  if ([179, 182, 185, 227, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 353, 356, 359, 362, 365].includes(c))
    return "雪";
  if ([200, 386, 389, 392, 395].includes(c)) return "雷雨";
  if ([119, 122].includes(c)) return "阴";
  return "天";
}

function renderCalendarGrid(cal) {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const headerCells = weekdays
    .map(
      (w, i) =>
        `<div class="cal-dow ${i === 0 || i === 6 ? "cal-weekend" : ""}">${w}</div>`
    )
    .join("");

  const dayCells = cal.cells
    .map((c) => {
      const classes = ["cal-cell"];
      if (!c.isCurrentMonth) classes.push("cal-other");
      if (c.isToday) classes.push("cal-today");
      if (c.isHoliday) classes.push("cal-holiday");
      if (c.label !== c.lunarText && c.label !== c.lunarText.replace("月", ""))
        classes.push("cal-special");

      return `
      <div class="${classes.join(" ")}">
        <div class="cal-day">${c.day}</div>
        <div class="cal-lunar">${c.label}</div>
      </div>`;
    })
    .join("");

  return `
    <div class="cal-grid">
      ${headerCells}
      ${dayCells}
    </div>`;
}

function renderTodos(todos) {
  if (!todos || (todos.todayTodos.length === 0 && todos.importantTodos.length === 0)) {
    return '<div class="todo-empty">今天没有待办事项</div>';
  }

  let html = "";

  if (todos.todayTodos.length > 0) {
    html += '<div class="todo-section-title">今日待办</div>';
    html += '<div class="todo-list">';
    todos.todayTodos.forEach((t, i) => {
      const icon = t.urgent ? "!!" : t.important ? "*" : "·";
      html += `<div class="todo-item"><span class="todo-icon">${icon}</span><span class="todo-text">${escapeHtml(t.title)}</span></div>`;
    });
    html += "</div>";
  }

  if (todos.importantTodos.length > 0) {
    html += '<div class="todo-section-title">重要未完成</div>';
    html += '<div class="todo-list">';
    todos.importantTodos.forEach((t) => {
      html += `<div class="todo-item"><span class="todo-icon">*</span><span class="todo-text">${escapeHtml(t.title)}</span><span class="todo-date">${t.date}</span></div>`;
    });
    html += "</div>";
  }

  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(data) {
  const { weather, calendar, todos } = data;
  const w = weather.current;
  const wToday = weather.today;

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
    padding: 30px 36px;
    position: relative;
    -webkit-font-smoothing: none;
  }

  .header {
    border-bottom: 4px solid #000;
    padding-bottom: 14px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .header-left { font-size: 40px; font-weight: bold; }
  .header-right { font-size: 22px; color: #444; text-align: right; }
  .header-lunar { font-size: 20px; color: #666; margin-top: 4px; }

  /* 天气区域 */
  .weather-box {
    display: flex;
    align-items: center;
    border: 3px solid #000;
    padding: 16px 20px;
    margin-bottom: 20px;
  }
  .weather-temp { font-size: 56px; font-weight: bold; line-height: 1; margin-right: 20px; }
  .weather-info { font-size: 24px; line-height: 1.5; }
  .weather-desc { font-size: 28px; font-weight: bold; }
  .weather-range { font-size: 22px; color: #555; margin-top: 2px; }
  .weather-city { font-size: 20px; color: #777; }

  /* 日历区域 */
  .cal-title {
    font-size: 26px;
    font-weight: bold;
    margin-bottom: 10px;
  }
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
    margin-bottom: 20px;
  }
  .cal-dow {
    text-align: center;
    font-size: 20px;
    font-weight: bold;
    padding: 6px 0;
    border-bottom: 2px solid #000;
  }
  .cal-weekend { color: #666; }
  .cal-cell {
    border: 1px solid #ddd;
    padding: 6px 4px;
    min-height: 72px;
    text-align: center;
    position: relative;
  }
  .cal-day { font-size: 22px; font-weight: bold; }
  .cal-lunar { font-size: 14px; color: #666; margin-top: 2px; }
  .cal-other { color: #ccc; }
  .cal-other .cal-lunar { color: #ddd; }
  .cal-today {
    background: #000;
    color: #fff;
  }
  .cal-today .cal-lunar { color: #ddd; }
  .cal-holiday .cal-lunar { font-weight: bold; }
  .cal-special .cal-lunar { font-weight: bold; }

  /* 待办区域 */
  .todo-section-title {
    font-size: 24px;
    font-weight: bold;
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
    margin: 16px 0 10px;
  }
  .todo-list { font-size: 22px; line-height: 1.6; }
  .todo-item { display: flex; align-items: baseline; margin-bottom: 4px; }
  .todo-icon { font-weight: bold; margin-right: 8px; min-width: 24px; }
  .todo-text { flex: 1; }
  .todo-date { font-size: 18px; color: #888; margin-left: 8px; }
  .todo-empty { font-size: 22px; color: #888; padding: 10px 0; }

  .footer {
    position: absolute;
    bottom: 16px;
    left: 36px;
    right: 36px;
    font-size: 18px;
    color: #888;
    text-align: center;
  }
</style>
</head>
<body>

  <div class="header">
    <div>
      <div class="header-left">${calendar.year}年${calendar.month}月</div>
      <div class="header-lunar">${calendar.lunarToday}</div>
    </div>
    <div class="header-right">${formatTime()}</div>
  </div>

  <div class="weather-box">
    <div class="weather-temp">${w.tempC}°</div>
    <div class="weather-info">
      <div class="weather-desc">${w.desc || weatherIcon(w.code)}</div>
      <div class="weather-range">${wToday.minTemp}° / ${wToday.maxTemp}° · 体感 ${w.feelsLikeC}°</div>
      <div class="weather-city">${weather.city} · 湿度${w.humidity}% · ${w.windDir}${w.windKmph}km/h</div>
    </div>
  </div>

  ${renderCalendarGrid(calendar)}

  ${renderTodos(todos)}

  <div class="footer">lazybeartoby · 日历/天气/待办</div>

</body>
</html>`;
}

/**
 * 获取日历+天气+待办数据
 */
async function fetchData(settings) {
  const city = (settings && settings.weather && settings.weather.city) || "武汉";
  const notionKey = (settings && settings.notion && settings.notion.apiKey) || "";
  const notionDb = (settings && settings.notion && settings.notion.dbId) || "";

  const [weather, calendar, todos] = await Promise.all([
    fetchWeather(city).catch((e) => {
      console.error("Weather fetch failed:", e.message);
      return {
        city: city,
        current: { tempC: 0, desc: "N/A", feelsLikeC: 0, humidity: 0, windKmph: 0, windDir: "", code: 0 },
        today: { minTemp: 0, maxTemp: 0 },
      };
    }),
    Promise.resolve(getCalendarData()),
    fetchTodos(notionKey, notionDb).catch((e) => {
      console.error("Todos fetch failed:", e.message);
      return { todayTodos: [], importantTodos: [], date: "" };
    }),
  ]);

  return { weather, calendar, todos, timestamp: require("../lib/local-time").nowLocalISO() };
}

function render(data) {
  const html = renderHtml(data);
  const htmlPath = path.join(__dirname, "..", "..", "public", "dashboard.html");
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

module.exports = {
  id: "calendar-weather-todo",
  name: "日历 / 天气 / 待办",
  fetchData,
  render,
};
