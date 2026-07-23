const axios = require("axios");

const OPENCLAW_BASE_URL =
  process.env.OPENCLAW_BASE_URL || "http://127.0.0.1:18789";
// OpenClaw 只有单一凭证，没有用户名概念。
// gateway.auth.mode 可为：token | password | trusted-proxy | none
//   - token / password 模式：使用 Authorization: Bearer <value> 认证
//   - none 模式：无需认证（仅限 loopback/私有网络）
const OPENCLAW_AUTH_MODE =
  (process.env.OPENCLAW_AUTH_MODE || "password").toLowerCase();
const OPENCLAW_CREDENTIAL = process.env.OPENCLAW_CREDENTIAL || "";
const OPENCLAW_USAGE_ENDPOINT =
  process.env.OPENCLAW_USAGE_ENDPOINT || "/api/usage";
const FETCH_MODE = process.env.FETCH_MODE || "api";

/**
 * 构建认证 header。
 *
 * OpenClaw 的认证取决于 gateway.auth.mode 配置：
 *   - token / password：Authorization: Bearer <token-or-password>
 *   - none：无认证头（仅限 loopback）
 *
 * 不论是 token 还是 password，凭证都放在 OPENCLAW_CREDENTIAL 一个变量里，
 * 通过 OPENCLAW_AUTH_MODE 声明模式（仅用于日志/校验，对请求头格式无影响）。
 */
function buildAuthHeader() {
  if (OPENCLAW_AUTH_MODE === "none") {
    return {};
  }

  if (!OPENCLAW_CREDENTIAL) {
    console.warn(
      `OPENCLAW_AUTH_MODE=${OPENCLAW_AUTH_MODE} but OPENCLAW_CREDENTIAL is empty. ` +
        "Set it to your gateway token or password."
    );
    return {};
  }

  return { Authorization: `Bearer ${OPENCLAW_CREDENTIAL}` };
}

/**
 * 通过 OpenClaw REST API 抓取 usage 数据。
 *
 * 注意：OpenClaw 的 API 端点可能因版本而异。如果你的版本没有
 * /api/usage 端点，请通过环境变量 OPENCLAW_USAGE_ENDPOINT 指向正确的路径，
 * 或者设置 FETCH_MODE=mock 先跑通流程再调整。
 */
async function fetchFromApi() {
  const url = `${OPENCLAW_BASE_URL}${OPENCLAW_USAGE_ENDPOINT}`;
  console.log(
    `Fetching usage from: ${url} (auth: ${OPENCLAW_AUTH_MODE || "none"})`
  );

  const response = await axios.get(url, {
    headers: buildAuthHeader(),
    timeout: 10000,
  });

  return response.data;
}

/**
 * Mock 数据，用于测试和开发。
 * 设置 FETCH_MODE=mock 启用。
 */
function getMockData() {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalRequests: 1234,
      totalTokens: 456789,
      totalCost: 12.34,
      activeSessions: 5,
      onlineChannels: 3,
      offlineChannels: 1,
    },
    topModels: [
      { name: "GPT-4", requests: 523, tokens: 234000 },
      { name: "Claude-3", requests: 312, tokens: 156000 },
      { name: "GPT-3.5", requests: 198, tokens: 45000 },
      { name: "Gemini-Pro", requests: 45, tokens: 12000 },
      { name: "Other", requests: 20, tokens: 9789 },
    ],
    channels: [
      { name: "Telegram", status: "online" },
      { name: "WhatsApp", status: "online" },
      { name: "Discord", status: "offline" },
      { name: "Slack", status: "online" },
    ],
    hourlyTrend: [
      12, 23, 45, 67, 89, 56, 34, 23, 45, 78, 90, 56,
      34, 23, 12, 34, 56, 78, 90, 67, 45, 34, 23, 12,
    ],
  };
}

/**
 * 将 API 返回的原始数据转换为仪表盘所需的统一格式。
 *
 * 如果你的 OpenClaw 版本返回的数据结构与下方不同，
 * 请修改此函数中的字段映射逻辑。
 */
function normalizeData(raw) {
  // 如果数据已经包含所需字段，直接返回
  if (raw.summary && raw.topModels && raw.channels) {
    return raw;
  }

  // 否则尝试从常见字段名中提取
  return {
    timestamp: raw.timestamp || new Date().toISOString(),
    summary: {
      totalRequests: raw.totalRequests || raw.total_requests || 0,
      totalTokens: raw.totalTokens || raw.total_tokens || 0,
      totalCost: raw.totalCost || raw.total_cost || 0,
      activeSessions: raw.activeSessions || raw.active_sessions || 0,
      onlineChannels: raw.onlineChannels || raw.online_channels || 0,
      offlineChannels: raw.offlineChannels || raw.offline_channels || 0,
    },
    topModels: raw.topModels || raw.top_models || [],
    channels: raw.channels || [],
    hourlyTrend: raw.hourlyTrend || raw.hourly_trend || [],
  };
}

async function fetchUsage() {
  if (FETCH_MODE === "mock") {
    console.log("Using mock data");
    return getMockData();
  }

  try {
    const raw = await fetchFromApi();
    return normalizeData(raw);
  } catch (err) {
    console.error(`API fetch failed: ${err.message}`);
    console.error(
      "Falling back to mock data. Set FETCH_MODE=mock to silence this warning."
    );
    return getMockData();
  }
}

module.exports = { fetchUsage };
