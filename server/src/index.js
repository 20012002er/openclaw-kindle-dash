const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
require("dotenv").config();

const { generateDashboard } = require("./screenshot");
const { fetchUsage } = require("./fetch-usage");
const { getSettings, saveSettings } = require("./settings");
const { requireAuth, login, logout } = require("./auth");
const { listTemplates } = require("./templates");

const PORT = process.env.PORT || 3000;
const OUTPUT_FILE = path.resolve(process.env.OUTPUT_FILE || "public/dash.png");
const GENERATE_CRON = process.env.GENERATE_CRON || "*/5 * * * *";
const RUN_ONCE = process.argv.includes("--once");
const SESSION_SECRET =
  process.env.SESSION_SECRET || "kindle-dash-secret-change-me";

const app = express();
const PUBLIC_DIR = path.dirname(OUTPUT_FILE);

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
  res.json({ settings, templates });
});

// 保存设置（需认证）
app.put("/api/settings", requireAuth, (req, res) => {
  const { activeTemplate, openclaw, weather, notion } = req.body || {};
  const current = getSettings();
  const updated = saveSettings({
    activeTemplate: activeTemplate || current.activeTemplate,
    openclaw: openclaw || current.openclaw,
    weather: weather || current.weather,
    notion: notion || current.notion,
  });
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

  // 启动定时任务
  cron.schedule(GENERATE_CRON, async () => {
    console.log(`[${new Date().toISOString()}] Generating dashboard...`);
    try {
      await generateDashboard();
      console.log("Dashboard generated.");
    } catch (err) {
      console.error("Generation failed:", err.message);
    }
  });

  // 启动 HTTP 服务
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kindle dash server listening on http://0.0.0.0:${PORT}`);
    console.log(`  Dashboard PNG: http://localhost:${PORT}/dash.png`);
    console.log(`  Admin page:    http://localhost:${PORT}/admin`);
    console.log(`  Health check:  http://localhost:${PORT}/health`);
    console.log(`  Cron schedule: ${GENERATE_CRON}`);
  });
}

main();
