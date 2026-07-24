const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { getSettings } = require("./settings");
const { getTemplate } = require("./templates");

const SCREEN_WIDTH = parseInt(process.env.SCREEN_WIDTH || "1072", 10);
const SCREEN_HEIGHT = parseInt(process.env.SCREEN_HEIGHT || "1448", 10);
const OUTPUT_FILE = path.resolve(
  process.env.OUTPUT_FILE || "public/dash.png"
);
const PAGE_RENDER_DELAY = parseInt(
  process.env.PAGE_RENDER_DELAY || "1000",
  10
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 完整的仪表盘生成流程：
 *   1. 读取设置，选择活跃模板
 *   2. 用模板获取数据
 *   3. 用模板渲染 HTML
 *   4. 用 Puppeteer 截图
 *   5. 转为灰度 PNG（e-ink 屏幕要求）
 */
async function generateDashboard() {
  // 1. 读取设置，选择模板
  const settings = getSettings();
  const template = getTemplate(settings.activeTemplate);
  console.log(`Using template: ${template.name} (${template.id})`);

  // 2. 获取数据
  const data = await template.fetchData(settings);
  console.log(
    "Data fetched:",
    JSON.stringify(data.summary || data.timestamp || "ok").slice(0, 200)
  );

  // 3. 渲染 HTML
  const htmlPath = template.render(data);
  console.log("HTML rendered:", htmlPath);

  // 3. Puppeteer 截图
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      deviceScaleFactor: 1,
    });

    const fileUrl = `file://${htmlPath}`;
    await page.goto(fileUrl, { waitUntil: "networkidle0" });

    // 额外等待，确保字体/布局渲染完成
    await sleep(PAGE_RENDER_DELAY);

    const tmpPng = OUTPUT_FILE + ".tmp";
    await page.screenshot({
      path: tmpPng,
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
      },
    });

    // 4. 转灰度（e-ink 需要：无 alpha 通道的灰度 PNG）
    await convertToGrayscale(tmpPng, OUTPUT_FILE);
    fs.unlinkSync(tmpPng);

    console.log("Dashboard PNG generated:", OUTPUT_FILE);
  } finally {
    await browser.close();
  }
}

/**
 * 将 PNG 转为灰度（colorType: 0 表示 8-bit 灰度，无 alpha）。
 * 这是 Kindle e-ink 屏幕的要求。
 */
function convertToGrayscale(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(new PNG({ colorType: 0 }))
      .on("parsed", function () {
        this.pack()
          .pipe(fs.createWriteStream(outputPath))
          .on("finish", resolve)
          .on("error", reject);
      })
      .on("error", reject);
  });
}

module.exports = { generateDashboard };
