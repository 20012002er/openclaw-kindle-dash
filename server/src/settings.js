const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// 默认 cron：取自环境变量 GENERATE_CRON
const DEFAULT_CRON = process.env.GENERATE_CRON || "*/5 * * * *";

const DEFAULT_SETTINGS = {
  activeTemplate: "openclaw",
  // 每个模板独立配置 cron 表达式；只有 activeTemplate 的 cron 会被调度执行
  // 空字符串表示使用默认 cron
  cronByTemplate: {
    openclaw: DEFAULT_CRON,
    "calendar-weather-todo": "0 8 * * *",
    finance: "0 9,15,17 * * 1-5",
    "finance-trend": "0 9,15,17 * * 1-5",
  },
  // 多模板时段调度：每项 { templateId, startHour, endHour }
  // startHour: 0-23，endHour: 1-24，要求 startHour < endHour，且各时段不能重叠
  // 当数组为空时，回退到单一 activeTemplate 模式（向后兼容）
  schedule: [],
  openclaw: {
    baseUrl: process.env.OPENCLAW_BASE_URL || "http://127.0.0.1:18789",
    authMode: process.env.OPENCLAW_AUTH_MODE || "password", // "password" | "token" | "none"
    credential: process.env.OPENCLAW_CREDENTIAL || "",
  },
  weather: {
    city: "武汉",
  },
  notion: {
    apiKey: "",
    dbId: "",
  },
  finance: {
    dataFile: "",
  },
  financeTrend: {
      dataFile: "",
      supplementaryFile: "",
    },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    // 合并默认值，确保新增字段存在
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      cronByTemplate: {
        ...DEFAULT_SETTINGS.cronByTemplate,
        ...(parsed.cronByTemplate || {}),
      },
      schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [],
      openclaw: { ...DEFAULT_SETTINGS.openclaw, ...(parsed.openclaw || {}) },
      weather: { ...DEFAULT_SETTINGS.weather, ...(parsed.weather || {}) },
      notion: { ...DEFAULT_SETTINGS.notion, ...(parsed.notion || {}) },
      finance: { ...DEFAULT_SETTINGS.finance, ...(parsed.finance || {}) },
      financeTrend: {
        ...DEFAULT_SETTINGS.financeTrend,
        ...(parsed.financeTrend || {}),
      },
    };
  } catch (e) {
    console.error("Failed to read settings, using defaults:", e.message);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(newSettings) {
  ensureDataDir();
  // 保留磁盘上已有的 cronByTemplate 值（如果调用方未传该字段）
  let existingCronByTemplate = {};
  let existingSchedule = [];
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      existingCronByTemplate = parsed.cronByTemplate || {};
      existingSchedule = Array.isArray(parsed.schedule) ? parsed.schedule : [];
    } catch (e) {
      // ignore
    }
  }
  const merged = {
    ...DEFAULT_SETTINGS,
    ...newSettings,
    cronByTemplate: {
      ...DEFAULT_SETTINGS.cronByTemplate,
      ...existingCronByTemplate,
      ...(newSettings.cronByTemplate || {}),
    },
    schedule: Array.isArray(newSettings.schedule)
      ? newSettings.schedule
      : Array.isArray(existingSchedule)
      ? existingSchedule
      : [],
    openclaw: { ...DEFAULT_SETTINGS.openclaw, ...(newSettings.openclaw || {}) },
    weather: { ...DEFAULT_SETTINGS.weather, ...(newSettings.weather || {}) },
    notion: { ...DEFAULT_SETTINGS.notion, ...(newSettings.notion || {}) },
    finance: { ...DEFAULT_SETTINGS.finance, ...(newSettings.finance || {}) },
    financeTrend: {
      ...DEFAULT_SETTINGS.financeTrend,
      ...(newSettings.financeTrend || {}),
    },
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

/**
 * 获取指定模板的 cron 表达式。
 * 优先级：cronByTemplate[id] > DEFAULT_CRON
 */
function getCronForTemplate(templateId) {
  const settings = getSettings();
  const cronExpr = (settings.cronByTemplate || {})[templateId];
  return cronExpr && cronExpr.trim() ? cronExpr.trim() : DEFAULT_CRON;
}

/**
 * 校验时段调度配置。
 * 规则：
 *   - 每项必须包含 templateId、startHour、endHour
 *   - startHour 为 0-23 的整数，endHour 为 1-24 的整数，且 startHour < endHour
 *   - templateId 必须在 availableTemplateIds 列表中
 *   - 各时段不能重叠（按 startHour 排序后，前一项 endHour 不能大于后一项 startHour）
 *
 * @param {Array} schedule - 待校验的调度数组
 * @param {Array<string>} availableTemplateIds - 可用模板 ID 列表
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSchedule(schedule, availableTemplateIds) {
  const errors = [];
  if (!Array.isArray(schedule)) {
    return { valid: false, errors: ["schedule 必须是数组"] };
  }
  const idSet = new Set(availableTemplateIds);
  const normalized = [];
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i] || {};
    const start = Number(entry.startHour);
    const end = Number(entry.endHour);
    if (!entry.templateId || !idSet.has(entry.templateId)) {
      errors.push(`第 ${i + 1} 项：templateId 无效（"${entry.templateId}"）`);
      continue;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start > 23 ||
      end < 1 ||
      end > 24 ||
      start >= end
    ) {
      errors.push(
        `第 ${i + 1} 项：时段无效（startHour=${entry.startHour}, endHour=${entry.endHour}），要求 startHour 0-23、endHour 1-24 且 startHour < endHour`
      );
      continue;
    }
    normalized.push({ start, end, index: i });
  }
  // 重叠检测：按 start 升序，相邻比较
  if (normalized.length > 0 && errors.length === 0) {
    const sorted = [...normalized].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].end > sorted[i].start) {
        errors.push(
          `时段重叠：第 ${sorted[i - 1].index + 1} 项 [${sorted[i - 1].start}-${sorted[i - 1].end}] 与第 ${sorted[i].index + 1} 项 [${sorted[i].start}-${sorted[i].end}]`
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 根据当前小时（0-23）查找调度中生效的模板。
 * @param {Array} schedule
 * @param {number} hour - 0-23
 * @returns {string|null} - 生效的 templateId，或 null（无匹配时段）
 */
function getActiveTemplateByHour(schedule, hour) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  for (const entry of schedule) {
    const start = Number(entry.startHour);
    const end = Number(entry.endHour);
    if (hour >= start && hour < end) {
      return entry.templateId;
    }
  }
  return null;
}

module.exports = {
  getSettings,
  saveSettings,
  getCronForTemplate,
  validateSchedule,
  getActiveTemplateByHour,
  SETTINGS_FILE,
  DATA_DIR,
  DEFAULT_CRON,
};
