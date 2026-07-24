const express = require("express");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
require("dotenv").config();

const { generateDashboard } = require("./screenshot");
const { fetchUsage } = require("./fetch-usage");

const PORT = process.env.PORT || 3000;
const OUTPUT_FILE = path.resolve(process.env.OUTPUT_FILE || "public/dash.png");
const GENERATE_CRON = process.env.GENERATE_CRON || "*/5 * * * *";
const RUN_ONCE = process.argv.includes("--once");

const app = express();
const PUBLIC_DIR = path.dirname(OUTPUT_FILE);

fs.mkdirSync(PUBLIC_DIR, { recursive: true });

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
    const data = await fetchUsage();
    res.json(data);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
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
    console.log(`  Health check:  http://localhost:${PORT}/health`);
    console.log(`  Debug data:    http://localhost:${PORT}/debug`);
    console.log(`  Cron schedule: ${GENERATE_CRON}`);
  });
}

main();
