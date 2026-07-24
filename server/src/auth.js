const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "admin").trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "admin").trim();

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

function login(req, res) {
  const username = (req.body && req.body.username || "").trim();
  const password = (req.body && req.body.password || "").trim();
  console.log("Login attempt:", {
    inputUsername: JSON.stringify(username),
    inputPasswordLen: password.length,
    expectedUsername: JSON.stringify(ADMIN_USERNAME),
    expectedPasswordLen: ADMIN_PASSWORD.length,
    usernameMatch: username === ADMIN_USERNAME,
    passwordMatch: password === ADMIN_PASSWORD,
    bodyKeys: req.body ? Object.keys(req.body) : "no body",
  });
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
