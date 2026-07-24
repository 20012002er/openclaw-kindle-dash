const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

function login(req, res) {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authed = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "用户名或密码错误" });
  }
}

function logout(req, res) {
  req.session && req.session.destroy();
  res.json({ ok: true });
}

module.exports = { requireAuth, login, logout };
