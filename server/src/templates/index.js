const openclaw = require("./openclaw");
const calendarWeatherTodo = require("./calendar-weather-todo");

const TEMPLATES = {
  [openclaw.id]: openclaw,
  [calendarWeatherTodo.id]: calendarWeatherTodo,
};

function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES["openclaw"];
}

function listTemplates() {
  return Object.values(TEMPLATES).map((t) => ({ id: t.id, name: t.name }));
}

module.exports = { getTemplate, listTemplates };
