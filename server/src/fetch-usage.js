const WebSocket = require("ws");

const ENV_BASE_URL = process.env.OPENCLAW_BASE_URL || "http://127.0.0.1:18789";
const ENV_CREDENTIAL = process.env.OPENCLAW_CREDENTIAL || "";
const ENV_AUTH_MODE = process.env.OPENCLAW_AUTH_MODE || "password";
const FETCH_MODE = process.env.FETCH_MODE || "api";

/**
 * 将 http(s):// 转为 ws(s)://
 */
function getWsUrl(baseUrl) {
  return baseUrl.replace(/^http/, "ws");
}

let _msgId = 0;
function nextId() {
  return String(++_msgId);
}

/**
 * 发送一个 WS RPC 请求并等待对应 id 的响应。
 */
function wsRpc(ws, method, params, timeout = 15000) {
  const id = nextId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`RPC timeout: ${method} (id=${id})`));
    }, timeout);

    const handler = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.off("message", handler);
      if (msg.error) {
        reject(new Error(`RPC error (${method}): ${JSON.stringify(msg.error)}`));
      } else {
        resolve(msg.result !== undefined ? msg.result : msg.payload || msg);
      }
    };

    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "req", id, method, params: params || {} }));
  });
}

/**
 * 连接 OpenClaw Gateway WebSocket 并完成握手认证。
 * @param {WebSocket} ws
 * @param {{authMode:string, credential:string}} connConfig
 */
async function connectGateway(ws, connConfig) {
  const params = {
    minProtocol: 4,
    maxProtocol: 4,
    role: "operator",
    scopes: ["operator.read"],
    client: {
      id: "cli",
      version: "1.0.0",
      platform: "linux",
      mode: "cli",
    },
  };
  const cred = (connConfig && connConfig.credential || "").trim();
  const mode = (connConfig && connConfig.authMode || "password").trim();
  if (cred && mode !== "none") {
    // token 模式用 auth.token，password 模式用 auth.password
    if (mode === "token") {
      params.auth = { token: cred };
    } else {
      params.auth = { password: cred };
    }
  }
  const result = await wsRpc(ws, "connect", params, 10000);
  return result;
}

/**
 * 通过 WebSocket RPC 抓取 usage 数据。
 * 调用 sessions.usage（会话级用量）和 usage.status（provider 配额）。
 */
async function fetchFromApi(connConfig) {
  const baseUrl = (connConfig && connConfig.baseUrl || ENV_BASE_URL).trim();
  const wsUrl = getWsUrl(baseUrl);
  console.log(`Connecting to OpenClaw gateway WS: ${wsUrl} (auth: ${connConfig && connConfig.authMode || ENV_AUTH_MODE})`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const connectTimeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("WebSocket connection timeout"));
    }, 15000);

    ws.on("open", async () => {
      clearTimeout(connectTimeout);
      try {
        console.log("WS connected, authenticating...");
        await connectGateway(ws, connConfig);
        console.log("Authenticated, fetching usage data...");

        // 并行调用 sessions.usage 和 usage.status
        const [sessionsResult, statusResult] = await Promise.all([
          wsRpc(ws, "sessions.usage", { agentScope: "all" }, 15000).catch((e) => {
            console.warn("sessions.usage failed:", e.message);
            return null;
          }),
          wsRpc(ws, "usage.status", {}, 15000).catch((e) => {
            console.warn("usage.status failed:", e.message);
            return null;
          }),
        ]);

        ws.close();
        resolve({
          sessions: sessionsResult,
          status: statusResult,
        });
      } catch (err) {
        try { ws.close(); } catch {}
        reject(err);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(connectTimeout);
      reject(new Error(`WebSocket error: ${err.message}`));
    });
  });
}

function getMockData() {
  return {
    timestamp: require("./lib/local-time").nowLocalISO(),
    summary: {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      activeSessions: 0,
      onlineChannels: 0,
      offlineChannels: 0,
    },
    topModels: [],
    channels: [],
    providers: [],
    hourlyTrend: [],
  };
}

/**
 * 将 OpenClaw WS RPC 返回的数据标准化为仪表盘格式。
 *
 * sessions.usage 返回结构（基于实际导出 JSON）：
 *   { totals: {...}, sessions: [{ key, scope, channel, origin, modelProvider, model,
 *     usage: { totalTokens, totalCost, messageCounts, modelUsage,
 *              utcQuarterHourTokenUsage, firstActivity, lastActivity } }] }
 *
 * usage.status 返回 provider 级别的配额/剩余信息。
 */
function normalizeData(raw) {
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  // sessions.usage 的返回可能直接包含 sessions 数组，也可能整体就是
  const sessionsRaw = raw.sessions;
  const sessions = Array.isArray(sessionsRaw)
    ? sessionsRaw
    : Array.isArray(sessionsRaw?.sessions)
    ? sessionsRaw.sessions
    : [];
  const totals = sessionsRaw?.totals || raw.totals || {};

  // totalTokens/totalCost 优先用 totals（OpenClaw 自己的汇总，稳定）
  // messages 只能从 sessions 累加（totals 里没有此字段）
  const hasTotals = totals && totals.totalTokens != null;
  let totalTokens = hasTotals ? totals.totalTokens : 0;
  let totalCost = hasTotals ? totals.totalCost || 0 : 0;
  let totalMessages = 0;

  sessions.forEach((s) => {
    const u = s.usage || {};
    totalMessages += u.messageCounts?.total || 0;
    if (!hasTotals) {
      totalTokens += u.totalTokens || 0;
      totalCost += u.totalCost || 0;
    }
  });

  // 调试：打印第一个 session 的 modelUsage 结构（已确认，可按需关闭）
  if (sessions.length > 0 && sessions[0].usage?.modelUsage) {
    const sample = sessions[0].usage.modelUsage[0];
    console.log("Sample modelUsage entry:", JSON.stringify(sample));
  }

  const modelAgg = {};
  const channelAgg = {};

  sessions.forEach((s) => {
    const u = s.usage || {};

    const chName =
      s.origin?.provider || s.origin?.label || s.channel || "direct";
    if (!channelAgg[chName]) {
      channelAgg[chName] = { name: chName, online: false, lastActivity: 0 };
    }
    if (u.lastActivity && u.lastActivity > channelAgg[chName].lastActivity) {
      channelAgg[chName].lastActivity = u.lastActivity;
    }

    if (Array.isArray(u.modelUsage)) {
      u.modelUsage.forEach((m) => {
        const label = m.model || m.provider || "unknown";
        if (!modelAgg[label]) modelAgg[label] = { name: label, tokens: 0, requests: 0 };
        // 尝试多种可能的 token 字段路径
        const tokens =
          m.totals?.totalTokens ||
          m.totalTokens ||
          m.tokens ||
          m.totals?.tokens ||
          0;
        modelAgg[label].tokens += tokens;
        modelAgg[label].requests += m.count || m.requests || 0;
      });
    }
  });

  let activeSessions = 0;
  let onlineChannels = 0;
  let offlineChannels = 0;
  Object.values(channelAgg).forEach((c) => {
    const isActive = c.lastActivity && now - c.lastActivity < THIRTY_MINUTES;
    c.online = isActive;
    if (isActive) onlineChannels++;
    else offlineChannels++;
  });

  sessions.forEach((s) => {
    const u = s.usage || {};
    if (u.lastActivity && now - u.lastActivity < TWO_HOURS) activeSessions++;
  });

  const topModels = Object.values(modelAgg)
    .filter((m) => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 6);

  const channels = Object.values(channelAgg).sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.lastActivity - a.lastActivity;
  });

  // 解析 usage.status 中的 provider 配额信息
  // 实际结构: { updatedAt, providers: [{ provider, displayName, windows:[{label,usedPercent,resetAt}], billing:[{type,amount,unit}], summary }] }
  const providers = [];
  const statusRaw = raw.status;
  if (statusRaw && Array.isArray(statusRaw.providers)) {
    statusRaw.providers.forEach((p) => {
      // 取第一个 billing 条目作为余额
      const billing = Array.isArray(p.billing) ? p.billing[0] : null;
      // 取 usedPercent 最大的 window 作为当前用量百分比
      let maxUsedPercent = 0;
      let activeWindowLabel = "";
      if (Array.isArray(p.windows)) {
        p.windows.forEach((w) => {
          if ((w.usedPercent || 0) > maxUsedPercent) {
            maxUsedPercent = w.usedPercent || 0;
            activeWindowLabel = w.label || "";
          }
        });
      }
      providers.push({
        name: p.displayName || p.provider || "unknown",
        balance: billing ? `${billing.amount} ${billing.unit || ""}`.trim() : "",
        summary: p.summary || "",
        usedPercent: maxUsedPercent,
        windowLabel: activeWindowLabel,
      });
    });
  }

  // 聚合 quarter-hour token 使用为每小时趋势
  const qhMap = new Map();
  sessions.forEach((s) => {
    const arr = s.usage?.utcQuarterHourTokenUsage;
    if (!Array.isArray(arr)) return;
    arr.forEach((q) => {
      const key = (q.date || "") + "_" + (q.quarterIndex ?? 0);
      const existing =
        qhMap.get(key) ||
        { date: q.date, quarterIndex: q.quarterIndex || 0, tokens: 0 };
      existing.tokens += q.totalTokens || 0;
      qhMap.set(key, existing);
    });
  });

  let hourlyTrend = [];
  const qhSorted = Array.from(qhMap.values()).sort((a, b) => {
    const ka = a.date + "_" + String(a.quarterIndex).padStart(3, "0");
    const kb = b.date + "_" + String(b.quarterIndex).padStart(3, "0");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (qhSorted.length > 0) {
    const last24h = qhSorted.slice(-96);
    const hourly = [];
    for (let i = 0; i < last24h.length; i += 4) {
      const bucket = last24h.slice(i, i + 4);
      hourly.push(bucket.reduce((acc, b) => acc + (b.tokens || 0), 0));
    }
    hourlyTrend = hourly;
  }

  // 顶部时间戳用当前生成时间（每次都更新）
  const generatedAt = require("./lib/local-time").nowLocalISO();

  return {
    timestamp: generatedAt,
    summary: {
      totalRequests: totalMessages,
      totalTokens,
      totalCost,
      activeSessions,
      onlineChannels,
      offlineChannels,
    },
    topModels,
    channels,
    providers,
    hourlyTrend,
  };
}

async function fetchUsage(settings) {
  // 优先使用 settings 中的 openclaw 配置，回退到环境变量
  const connConfig = settings && settings.openclaw
    ? {
        baseUrl: settings.openclaw.baseUrl || ENV_BASE_URL,
        authMode: settings.openclaw.authMode || ENV_AUTH_MODE,
        credential: settings.openclaw.credential || ENV_CREDENTIAL,
      }
    : {
        baseUrl: ENV_BASE_URL,
        authMode: ENV_AUTH_MODE,
        credential: ENV_CREDENTIAL,
      };

  if (FETCH_MODE === "mock") {
    console.log("Using mock data");
    return getMockData();
  }
  try {
    const raw = await fetchFromApi(connConfig);
    return normalizeData(raw);
  } catch (err) {
    console.error(`WS fetch failed: ${err.message}`);
    console.error("Falling back to empty data. Check openclaw settings in admin page.");
    return getMockData();
  }
}

module.exports = { fetchUsage, normalizeData };
