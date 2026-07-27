const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
require("dotenv").config();

const { generateDashboard } = require("./screenshot");
const { fetchUsage } = require("./fetch-usage");
const {
  getSettings,
  saveSettings,
  getCronForTemplate,
  DEFAULT_CRON,
} = require("./settings");
const { requireAuth, login, logout } = require("./auth");
const { listTemplates } = require("./templates");

const PORT = process.env.PORT || 3000;
const OUTPUT_FILE = path.resolve(process.env.OUTPUT_FILE || "public/dash.png");
const RUN_ONCE = process.argv.includes("--once");
const SESSION_SECRET =
  process.env.SESSION_SECRET || "kindle-dash-secret-change-me";

const app = express();
const PUBLIC_DIR = path.dirname(OUTPUT_FILE);

// 当前活跃的定时任务句柄；切换模板或保存设置时会重新调度
let activeScheduledTask = null;
let activeScheduledCron = null;

fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// 中间件
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24小时
  })
);
app.use(express.static(PUBLIC_DIR));

// 主图片端点：Kindle 通过 xh 拉取此 URL
app.get("/dash.png", (req, res) => {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return res.status(404).send("Dashboard not generated yet");
  }
  res.sendFile(OUTPUT_FILE);
});

// 健康检查
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    lastGenerated: fs.existsSync(OUTPUT_FILE)
      ? fs.statSync(OUTPUT_FILE).mtime
      : null,
  });
});

// 手动触发生成
app.post("/generate", async (req, res) => {
  try {
    await generateDashboard();
    res.json({ status: "ok", message: "Dashboard generated" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 调试端点：返回标准化后的 usage 数据（不生成图片）
app.get("/debug", async (req, res) => {
  try {
    const settings = getSettings();
    const data = await fetchUsage(settings);
    res.json(data);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ===== 管理页面 =====
// admin.html 放在 src/ 目录下（不被 ./public 挂载覆盖）
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// 登录/登出
app.post("/api/login", login);
app.post("/api/logout", logout);

// 获取当前模板列表 + 设置（需认证）
app.get("/api/settings", requireAuth, (req, res) => {
  const settings = getSettings();
  const templates = listTemplates();
  // 计算下次定时生成时间（基于当前 activeTemplate 的 cron）
  const activeCron = getCronForTemplate(settings.activeTemplate);
  let nextRun = null;
  try {
    const parts = activeCron.trim().split(/\s+/);
    const minutePart = parts[0];
    const now = new Date();
    if (minutePart.startsWith("*/")) {
      const interval = parseInt(minutePart.slice(2)) || 5;
      const next = new Date(now);
      const min = now.getMinutes();
      const nextMin = Math.ceil(min / interval) * interval;
      if (nextMin >= 60) {
        next.setHours(next.getHours() + 1, nextMin - 60, 0, 0);
      } else {
        next.setMinutes(nextMin, 0, 0);
      }
      nextRun = next.toLocaleTimeString("zh-CN", { hour12: false });
    } else {
      nextRun = activeCron;
    }
  } catch (e) {
    nextRun = null;
  }
  res.json({ settings, templates, nextRun, activeCron });
});

// 保存设置（需认证）
app.put("/api/settings", requireAuth, (req, res) => {
  const {
    activeTemplate,
    openclaw,
    weather,
    notion,
    finance,
    financeTrend,
    cronByTemplate,
  } = req.body || {};
  const current = getSettings();
  const updated = saveSettings({
    activeTemplate: activeTemplate || current.activeTemplate,
    openclaw: openclaw || current.openclaw,
    weather: weather || current.weather,
    notion: notion || current.notion,
    finance: finance || current.finance,
    financeTrend: financeTrend || current.financeTrend,
    cronByTemplate: cronByTemplate || current.cronByTemplate,
  });
  // 保存后重新调度定时任务（activeTemplate 可能切换或 cron 变更）
  rescheduleActiveTask();
  res.json({ ok: true, settings: updated });
});

// 测试某个模板的数据获取（需认证）
app.get("/api/test/:templateId", requireAuth, async (req, res) => {
  try {
    const { getTemplate } = require("./templates");
    const template = getTemplate(req.params.templateId);
    const settings = getSettings();
    const data = await template.fetchData(settings);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 重新调度当前 activeTemplate 的定时任务。
 * - 若 cron 变更或模板切换，会先停止旧任务再启动新任务
 * - 仅 activeTemplate 的 cron 会被注册执行
 */
function rescheduleActiveTask() {
  const settings = getSettings();
  const newCron = getCronForTemplate(settings.activeTemplate);

  if (activeScheduledCron === newCron && activeScheduledTask) {
    // cron 未变，无需重新调度
    return;
  }

  // 停止旧任务
  if (activeScheduledTask) {
    try {
      activeScheduledTask.stop();
      console.log(`Stopped previous cron task: ${activeScheduledCron}`);
    } catch (e) {
      console.error("Failed to stop previous task:", e.message);
    }
    activeScheduledTask = null;
  }

  // 校验 cron 表达式
  if (!cron.validate(newCron)) {
    console.error(`Invalid cron expression: ${newCron}, skipping schedule`);
    activeScheduledCron = null;
    return;
  }

  // 启动新任务
  activeScheduledTask = cron.schedule(newCron, async () => {
    console.log(
      `[${require("./lib/local-time").nowLocalISO()}] Generating dashboard (template: ${settings.activeTemplate})...`
    );
    try {
      await generateDashboard();
      console.log("Dashboard generated.");
    } catch (err) {
      console.error("Generation failed:", err.message);
    }
  });
  activeScheduledCron = newCron;
  console.log(
    `Scheduled cron for template "${settings.activeTemplate}": ${newCron}`
  );
}

async function main() {
  if (RUN_ONCE) {
    console.log("Generating dashboard once...");
    await generateDashboard();
    console.log("Done.");
    process.exit(0);
  }

  // 启动时先生成一次
  console.log("Generating initial dashboard...");
  try {
    await generateDashboard();
  } catch (err) {
    console.error("Initial generation failed:", err.message);
  }

  // 启动定时任务（基于 activeTemplate 的 cron 配置）
  rescheduleActiveTask();

  // 启动 HTTP 服务
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kindle dash server listening on http://0.0.0.0:${PORT}`);
    console.log(`  Dashboard PNG: http://localhost:${PORT}/dash.png`);
    console.log(`  Admin page:    http://localhost:${PORT}/admin`);
    console.log(`  Health check:  http://localhost:${PORT}/health`);
    const settings = getSettings();
    console.log(
      `  Active template: ${settings.activeTemplate} (cron: ${getCronForTemplate(
        settings.activeTemplate
      )})`
    );
  });
}

main();
