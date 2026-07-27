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
  validateSchedule,
  getActiveTemplateByHour,
  DEFAULT_CRON,
} = require("./settings");
const { requireAuth, login, logout } = require("./auth");
const { listTemplates, getTemplate } = require("./templates");
const { getNextRun } = require("./lib/cron-next");
const { nowLocalISO } = require("./lib/local-time");

const PORT = process.env.PORT || 3000;
const OUTPUT_FILE = path.resolve(process.env.OUTPUT_FILE || "public/dash.png");
const RUN_ONCE = process.argv.includes("--once");
const SESSION_SECRET =
  process.env.SESSION_SECRET || "kindle-dash-secret-change-me";

const app = express();
const PUBLIC_DIR = path.dirname(OUTPUT_FILE);

// 多模板时段调度相关的任务句柄
// activeScheduledTasks: [{ cron, task, templateId, startHour, endHour }]
let activeScheduledTasks = [];
// boundaryTask: 每分钟检查一次，用于在时段切换边界处立即生成新模板的仪表盘
let boundaryTask = null;
// 上次成功生成图片所用的模板 ID（用于检测时段切换）
let lastGeneratedTemplateId = null;

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
    // 多时段模式下，按当前小时对应的模板生成；否则用 activeTemplate
    const settings = getSettings();
    const schedule = Array.isArray(settings.schedule) ? settings.schedule : [];
    const currentHour = new Date().getHours();
    const slotTemplateId =
      getActiveTemplateByHour(schedule, currentHour) ||
      settings.activeTemplate;
    await generateDashboard(slotTemplateId);
    lastGeneratedTemplateId = slotTemplateId;
    res.json({
      status: "ok",
      message: "Dashboard generated",
      templateId: slotTemplateId,
    });
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

/**
 * 格式化 Date 为本地时间字符串（带日期）。
 * 例：2026-07-28 08:00
 */
function formatLocalDateTime(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

// 获取当前模板列表 + 设置（需认证）
app.get("/api/settings", requireAuth, (req, res) => {
  const settings = getSettings();
  const templates = listTemplates();
  const templateIds = templates.map((t) => t.id);
  // 校验当前调度配置
  const scheduleValidation = validateSchedule(
    settings.schedule || [],
    templateIds
  );
  // 计算当前生效模板
  const now = new Date();
  const currentHour = now.getHours();
  const schedule = Array.isArray(settings.schedule) ? settings.schedule : [];
  const activeFromSchedule = getActiveTemplateByHour(schedule, currentHour);
  const isMultiMode = schedule.length > 0;
  const effectiveTemplateId = isMultiMode
    ? activeFromSchedule || settings.activeTemplate
    : settings.activeTemplate;

  // 计算下次定时生成时间
  let nextRun = null; // 字符串，供卡片摘要显示
  let nextRunISO = null; // ISO 字符串，供排序/格式化
  let activeCron = null; // 当前生效模板的 cron
  const slotNextRuns = []; // 多时段模式下每个 slot 的下次运行时间

  if (isMultiMode) {
    // 多时段模式：每个 slot 计算自己的下次"真正生成"时间
    // - 当前生效的 slot：用 cron 计算下次触发
    // - 非当前生效的 slot：用下次进入该 slot 的边界时间（startHour:00）
    let earliestNext = null;
    for (let i = 0; i < schedule.length; i++) {
      const entry = schedule[i];
      const cronExpr = getCronForTemplate(entry.templateId);
      const startHour = Number(entry.startHour);
      const endHour = Number(entry.endHour);
      const isActiveNow =
        currentHour >= startHour && currentHour < endHour;
      let next = null;
      if (isActiveNow) {
        // 当前生效 slot：cron 下次触发
        next = getNextRun(cronExpr, now);
      } else {
        // 非生效 slot：下次进入该 slot 的边界时间
        // 今天 startHour:00（若尚未到），否则明天 startHour:00
        const today = new Date(now);
        today.setHours(startHour, 0, 0, 0);
        if (today > now) {
          next = today;
        } else {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          next = tomorrow;
        }
      }
      slotNextRuns.push({
        templateId: entry.templateId,
        startHour,
        endHour,
        cron: cronExpr,
        nextRun: formatLocalDateTime(next),
        nextRunISO: next ? next.toISOString() : null,
        isActiveNow,
      });
      if (next && (!earliestNext || next < earliestNext)) {
        earliestNext = next;
      }
    }
    if (earliestNext) {
      nextRun = formatLocalDateTime(earliestNext);
      nextRunISO = earliestNext.toISOString();
    }
    activeCron = getCronForTemplate(effectiveTemplateId);
  } else {
    // 单模板模式
    activeCron = getCronForTemplate(effectiveTemplateId);
    const next = getNextRun(activeCron, now);
    if (next) {
      nextRun = formatLocalDateTime(next);
      nextRunISO = next.toISOString();
    }
  }

  // 上次生成图片的时间（文件 mtime）
  let lastGeneratedAt = null;
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      lastGeneratedAt = formatLocalDateTime(
        new Date(fs.statSync(OUTPUT_FILE).mtime)
      );
    }
  } catch (e) {
    // ignore
  }

  res.json({
    settings,
    templates,
    nextRun,
    nextRunISO,
    activeCron,
    scheduleValidation,
    effectiveTemplateId,
    isMultiMode,
    currentHour,
    slotNextRuns,
    lastGeneratedAt,
    serverTime: formatLocalDateTime(now),
  });
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
    schedule,
  } = req.body || {};
  const current = getSettings();
  const templates = listTemplates();
  const templateIds = templates.map((t) => t.id);
  // 若调用方传了 schedule，先校验
  let scheduleToSave = current.schedule || [];
  if (schedule !== undefined) {
    if (!Array.isArray(schedule)) {
      return res
        .status(400)
        .json({ ok: false, error: "schedule 必须是数组" });
    }
    const { valid, errors } = validateSchedule(schedule, templateIds);
    if (!valid) {
      return res
        .status(400)
        .json({ ok: false, error: "调度配置校验失败", details: errors });
    }
    scheduleToSave = schedule;
  }
  const updated = saveSettings({
    activeTemplate: activeTemplate || current.activeTemplate,
    openclaw: openclaw || current.openclaw,
    weather: weather || current.weather,
    notion: notion || current.notion,
    finance: finance || current.finance,
    financeTrend: financeTrend || current.financeTrend,
    cronByTemplate: cronByTemplate || current.cronByTemplate,
    schedule: scheduleToSave,
  });
  // 保存后重新调度定时任务（activeTemplate / cron / schedule 可能变更）
  rescheduleAllTasks();
  res.json({ ok: true, settings: updated });
});

// 测试某个模板的数据获取（需认证）
app.get("/api/test/:templateId", requireAuth, async (req, res) => {
  try {
    const template = getTemplate(req.params.templateId);
    const settings = getSettings();
    const data = await template.fetchData(settings);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 重新调度所有定时任务。
 *
 * 调度策略：
 *   - 若 settings.schedule 非空：进入多时段模式
 *       1) 为每个调度项注册一个 cron 任务（cron 取自 cronByTemplate[templateId]）
 *          任务回调中先校验当前小时是否落在 [startHour, endHour) 内，是则用该模板生成
 *       2) 额外注册一个每分钟的"边界检查任务"，当当前小时对应的模板与上次生成的不一致时
 *          立即生成一次，确保时段切换时 Kindle 上的画面能及时更新
 *   - 若 settings.schedule 为空：回退到单一 activeTemplate 模式（向后兼容）
 *       仅注册一个 cron 任务，按 activeTemplate 的 cron 调度
 */
function rescheduleAllTasks() {
  // 停止旧任务
  stopAllTasks();

  const settings = getSettings();
  const schedule = Array.isArray(settings.schedule) ? settings.schedule : [];

  if (schedule.length === 0) {
    // ===== 单一模板模式 =====
    const cronExpr = getCronForTemplate(settings.activeTemplate);
    if (!cron.validate(cronExpr)) {
      console.error(
        `Invalid cron expression for template "${settings.activeTemplate}": ${cronExpr}, skipping schedule`
      );
      return;
    }
    const task = cron.schedule(cronExpr, async () => {
      console.log(
        `[${nowLocalISO()}] Generating dashboard (template: ${settings.activeTemplate})...`
      );
      try {
        await generateDashboard();
        lastGeneratedTemplateId = settings.activeTemplate;
        console.log("Dashboard generated.");
      } catch (err) {
        console.error("Generation failed:", err.message);
      }
    });
    activeScheduledTasks.push({
      cron: cronExpr,
      task,
      templateId: settings.activeTemplate,
      startHour: 0,
      endHour: 24,
    });
    console.log(
      `[single-mode] Scheduled cron for template "${settings.activeTemplate}": ${cronExpr}`
    );
    return;
  }

  // ===== 多时段调度模式 =====
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i] || {};
    const { templateId, startHour, endHour } = entry;
    const cronExpr = getCronForTemplate(templateId);
    if (!cron.validate(cronExpr)) {
      console.error(
        `[schedule ${i + 1}] Invalid cron for template "${templateId}": ${cronExpr}, skipped`
      );
      continue;
    }
    const task = cron.schedule(cronExpr, async () => {
      const hour = new Date().getHours();
      if (hour < Number(startHour) || hour >= Number(endHour)) {
        // 不在当前调度项的时段内，跳过（让对应时段的 cron 任务来生成）
        return;
      }
      console.log(
        `[${nowLocalISO()}] Generating dashboard (template: ${templateId}, slot ${startHour}-${endHour})...`
      );
      try {
        await generateDashboard(templateId);
        lastGeneratedTemplateId = templateId;
        console.log("Dashboard generated.");
      } catch (err) {
        console.error("Generation failed:", err.message);
      }
    });
    activeScheduledTasks.push({
      cron: cronExpr,
      task,
      templateId,
      startHour: Number(startHour),
      endHour: Number(endHour),
    });
    console.log(
      `[schedule ${i + 1}] template="${templateId}" slot=${startHour}-${endHour} cron=${cronExpr}`
    );
  }

  // 边界检查任务：每分钟检查当前小时对应的模板是否与上次生成的不一致
  boundaryTask = cron.schedule("* * * * *", async () => {
    const now = new Date();
    const hour = now.getHours();
    const activeId = getActiveTemplateByHour(schedule, hour);
    if (!activeId) {
      // 当前小时无调度项覆盖，保持上一次画面，不生成
      return;
    }
    if (lastGeneratedTemplateId !== activeId) {
      console.log(
        `[${nowLocalISO()}] Slot boundary detected: switching to template "${activeId}" (was ${lastGeneratedTemplateId})`
      );
      try {
        await generateDashboard(activeId);
        lastGeneratedTemplateId = activeId;
        console.log("Dashboard generated (boundary switch).");
      } catch (err) {
        console.error(
          "Generation failed during boundary switch:",
          err.message
        );
      }
    }
  });
  console.log(
    `[schedule-mode] ${activeScheduledTasks.length} cron task(s) + 1 boundary checker registered`
  );
}

function stopAllTasks() {
  for (const { task, cron: c, templateId } of activeScheduledTasks) {
    try {
      task.stop();
      console.log(`Stopped cron task: ${c} (template: ${templateId})`);
    } catch (e) {
      console.error("Failed to stop task:", e.message);
    }
  }
  activeScheduledTasks = [];
  if (boundaryTask) {
    try {
      boundaryTask.stop();
      console.log("Stopped boundary checker task");
    } catch (e) {
      console.error("Failed to stop boundary task:", e.message);
    }
    boundaryTask = null;
  }
}

async function main() {
  if (RUN_ONCE) {
    console.log("Generating dashboard once...");
    // 单次模式：若有多时段调度，按当前小时对应的模板生成
    const settings = getSettings();
    const schedule = Array.isArray(settings.schedule) ? settings.schedule : [];
    const currentHour = new Date().getHours();
    const slotTemplateId =
      getActiveTemplateByHour(schedule, currentHour) || settings.activeTemplate;
    await generateDashboard(slotTemplateId);
    lastGeneratedTemplateId = slotTemplateId;
    console.log("Done.");
    process.exit(0);
  }

  // 启动时先生成一次（根据当前生效的模板）
  const settings = getSettings();
  const schedule = Array.isArray(settings.schedule) ? settings.schedule : [];
  const currentHour = new Date().getHours();
  const slotTemplateId =
    getActiveTemplateByHour(schedule, currentHour) || settings.activeTemplate;
  console.log(
    `Generating initial dashboard (template: ${slotTemplateId})...`
  );
  try {
    await generateDashboard(slotTemplateId);
    lastGeneratedTemplateId = slotTemplateId;
  } catch (err) {
    console.error("Initial generation failed:", err.message);
  }

  // 启动定时任务（基于 schedule / activeTemplate 的 cron 配置）
  rescheduleAllTasks();

  // 启动 HTTP 服务
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kindle dash server listening on http://0.0.0.0:${PORT}`);
    console.log(`  Dashboard PNG: http://localhost:${PORT}/dash.png`);
    console.log(`  Admin page:    http://localhost:${PORT}/admin`);
    console.log(`  Health check:  http://localhost:${PORT}/health`);
    const s = getSettings();
    if (schedule.length > 0) {
      console.log(
        `  Mode: multi-schedule (${schedule.length} slot(s), current=${slotTemplateId})`
      );
    } else {
      console.log(
        `  Mode: single-template (active: ${s.activeTemplate}, cron: ${getCronForTemplate(
          s.activeTemplate
        )})`
      );
    }
  });
}

main();
