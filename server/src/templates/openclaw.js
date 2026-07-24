const { fetchUsage } = require("../fetch-usage");
const { renderDashboard } = require("../render-dashboard");

module.exports = {
  id: "openclaw",
  name: "OpenClaw Usage",
  fetchData: async () => {
    return await fetchUsage();
  },
  render: (data) => {
    return renderDashboard(data);
  },
};
