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
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      existingCronByTemplate = parsed.cronByTemplate || {};
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

module.exports = {
  getSettings,
  saveSettings,
  getCronForTemplate,
  SETTINGS_FILE,
  DATA_DIR,
  DEFAULT_CRON,
};
