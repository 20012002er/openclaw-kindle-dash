const { fetchUsage } = require("../fetch-usage");
const { renderDashboard } = require("../render-dashboard");

module.exports = {
  id: "openclaw",
  name: "OpenClaw Usage",
  fetchData: async (settings) => {
    return await fetchUsage(settings);
  },
  render: (data) => {
    return renderDashboard(data);
  },
};
