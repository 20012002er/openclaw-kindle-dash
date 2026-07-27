const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const DEFAULT_SETTINGS = {
  activeTemplate: "openclaw",
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
      openclaw: { ...DEFAULT_SETTINGS.openclaw, ...(parsed.openclaw || {}) },
      weather: { ...DEFAULT_SETTINGS.weather, ...(parsed.weather || {}) },
      notion: { ...DEFAULT_SETTINGS.notion, ...(parsed.notion || {}) },
      finance: { ...DEFAULT_SETTINGS.finance, ...(parsed.finance || {}) },
    };
  } catch (e) {
    console.error("Failed to read settings, using defaults:", e.message);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(newSettings) {
  ensureDataDir();
  const merged = {
    ...DEFAULT_SETTINGS,
    ...newSettings,
    openclaw: { ...DEFAULT_SETTINGS.openclaw, ...(newSettings.openclaw || {}) },
    weather: { ...DEFAULT_SETTINGS.weather, ...(newSettings.weather || {}) },
    notion: { ...DEFAULT_SETTINGS.notion, ...(newSettings.notion || {}) },
    finance: { ...DEFAULT_SETTINGS.finance, ...(newSettings.finance || {}) },
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { getSettings, saveSettings, SETTINGS_FILE, DATA_DIR };
