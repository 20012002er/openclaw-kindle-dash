const https = require("https");

/**
 * 从 Notion「每日待办」数据库获取今天的待办 + 重要的未完成项。
 * 移植自用户的 Python 脚本逻辑。
 */

function httpsPostJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            let errMsg = `Notion API returned ${res.statusCode}`;
            try {
              const errBody = JSON.parse(chunks);
              errMsg += `: ${errBody.message || errBody.code || chunks.slice(0, 200)}`;
            } catch (_) {
              errMsg += `: ${chunks.slice(0, 200)}`;
            }
            return reject(new Error(errMsg));
          }
          try {
            resolve(JSON.parse(chunks));
          } catch (e) {
            reject(new Error("Failed to parse Notion response: " + e.message));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("Notion request timeout"));
    });
    req.write(data);
    req.end();
  });
}

/**
 * 获取今天的待办事项。
 * @param {string} apiKey Notion API key
 * @param {string} dbId Notion database ID
 * @returns {Promise<{todayTodos: Array, importantTodos: Array, date: string}>}
 */
async function fetchTodos(apiKey, dbId) {
  if (!apiKey || !dbId) {
    console.log("Notion API key or DB ID not configured, skipping todos");
    return { todayTodos: [], importantTodos: [], date: new Date().toISOString().slice(0, 10) };
  }

  const today = new Date().toISOString().slice(0, 10);

  // 计算上月第一天
  const now = new Date();
  const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDayLastMonth = new Date(
    firstDayThisMonth.getMonth() === 0
      ? firstDayThisMonth.getFullYear() - 1
      : firstDayThisMonth.getFullYear(),
    firstDayThisMonth.getMonth() === 0 ? 11 : firstDayThisMonth.getMonth() - 1,
    1
  );
  const filterStart = firstDayLastMonth.toISOString().slice(0, 10);

  console.log(`Fetching Notion todos since ${filterStart}, today=${today}`);

  const result = await httpsPostJson(
    `https://api.notion.com/v1/databases/${dbId}/query`,
    {
      page_size: 100,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      filter: {
        timestamp: "created_time",
        created_time: { on_or_after: filterStart },
      },
    },
    {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
    }
  );

  const todayTodos = [];
  const importantTodos = [];

  for (const page of result.results || []) {
    const props = page.properties || {};
    let title = "";
    let dateVal = "";
    let important = false;
    let urgent = false;
    let statusName = "";

    for (const [k, v] of Object.entries(props)) {
      if (v.type === "title" && v.title) {
        title = v.title.map((r) => r.plain_text).join("");
      }
      if (v.type === "date" && v.date) {
        dateVal = v.date.start || "";
      }
      if (v.type === "checkbox") {
        if (k === "重要否") important = v.checkbox;
        if (k === "紧急否") urgent = v.checkbox;
      }
      if (v.type === "status" && v.status) {
        statusName = v.status.name || "";
      }
    }

    if (!title) continue;
    // 只要未完成的状态
    if (statusName.includes("已完成")) continue;

    const todo = { title, important, urgent, date: dateVal, status: statusName };

    if (dateVal === today) {
      todayTodos.push(todo);
    } else if (important) {
      importantTodos.push(todo);
    }
  }

  console.log(
    `Notion todos: today=${todayTodos.length}, important=${importantTodos.length}`
  );

  return { todayTodos, importantTodos, date: today };
}

module.exports = { fetchTodos };
