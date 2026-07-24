const https = require("https");

/**
 * wttr.in 天气代码 -> 中文描述映射表。
 * 参考：https://www.weatherapi.com/docs/weather_conditions.json
 */
const WEATHER_CODE_ZH = {
  113: "晴", 116: "多云", 119: "阴", 122: "阴", 143: "薄雾",
  176: "小雨", 179: "雨夹雪", 182: "雨夹雪", 185: "雨夹雪",
  200: "雷阵雨", 227: "小雪", 230: "暴雪",
  248: "雾", 260: "冻雾", 263: "毛毛雨", 266: "毛毛雨",
  281: "小雨", 284: "冻雨", 293: "小雨", 296: "小雨",
  299: "中雨", 302: "中雨", 305: "大雨", 308: "大雨",
  311: "暴雨", 314: "暴雨", 317: "雨夹雪", 320: "雨夹雪",
  323: "小雪", 326: "小雪", 329: "中雪", 332: "中雪",
  335: "大雪", 338: "大雪", 350: "冻雨", 353: "小阵雨",
  356: "阵雨", 359: "暴雨", 362: "雨夹雪", 365: "雨夹雪",
  368: "小雪", 371: "大雪", 374: "冻雨", 377: "冻雨",
  386: "雷阵雨", 389: "雷暴", 392: "雷阵雪", 395: "雷暴雪",
};

function weatherCodeToZh(code) {
  return WEATHER_CODE_ZH[parseInt(code, 10)] || "";
}

/**
 * 使用 wttr.in 免费 API 获取天气数据（无需 API key）。
 * 文档：https://wttr.in/:help
 */
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "Accept-Language": "zh-CN,zh;q=0.9" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Weather API returned ${res.statusCode}`));
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Failed to parse weather JSON: " + e.message));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error("Weather request timeout"));
    });
  });
}

/**
 * 获取指定城市的天气数据，返回标准化结构。
 */
async function fetchWeather(city) {
  const targetCity = city || "武汉";
  // wttr.in 支持中文城市名，用 encodeURI 编码
  const url = `https://wttr.in/${encodeURIComponent(
    targetCity
  )}?format=j1&lang=zh`;

  console.log(`Fetching weather for: ${targetCity}`);
  const raw = await httpGetJson(url);

  const current = (raw.current_condition && raw.current_condition[0]) || {};
  const today = (raw.weather && raw.weather[0]) || {};
  const area =
    (raw.nearest_area && raw.nearest_area[0]) || {};

  // 天气描述：优先使用中文映射表，回退到 lang_zh / weatherDesc
  const codeZh = weatherCodeToZh(current.weatherCode);
  const descArr = current.lang_zh || current.weatherDesc || [];
  const desc = codeZh || (descArr.length > 0 ? descArr[0].value : "");

  const areaName =
    area.areaName && area.areaName[0] ? area.areaName[0].value : targetCity;

  return {
    // 城市名优先用用户输入（通常是中文），API 返回的 areaName 是英文
    city: targetCity,
    current: {
      tempC: parseInt(current.temp_C, 10) || 0,
      feelsLikeC: parseInt(current.FeelsLikeC, 10) || 0,
      desc: desc,
      humidity: parseInt(current.humidity, 10) || 0,
      windKmph: parseInt(current.windspeedKmph, 10) || 0,
      windDir: current.winddir16Point || "",
      visibility: parseInt(current.visibility, 10) || 0,
      code: parseInt(current.weatherCode, 10) || 0,
    },
    today: {
      minTemp: parseInt(today.mintempC, 10) || 0,
      maxTemp: parseInt(today.maxtempC, 10) || 0,
      // 取白天时段的预报（12:00）作为白天描述
      hourly: (today.hourly || []).map((h) => ({
        time: h.time,
        tempC: parseInt(h.tempC, 10) || 0,
        desc: weatherCodeToZh(h.weatherCode) ||
          ((h.lang_zh && h.lang_zh[0] && h.lang_zh[0].value) || ""),
        chanceOfRain: parseInt(h.chanceofrain, 10) || 0,
      })),
    },
    forecast: (raw.weather || []).slice(0, 3).map((d) => ({
      date: d.date,
      minTemp: parseInt(d.mintempC, 10) || 0,
      maxTemp: parseInt(d.maxtempC, 10) || 0,
      desc:
        (d.hourly &&
          d.hourly[4] &&
          d.hourly[4].lang_zh &&
          d.hourly[4].lang_zh[0] &&
          d.hourly[4].lang_zh[0].value) ||
        "",
    })),
  };
}

module.exports = { fetchWeather };
