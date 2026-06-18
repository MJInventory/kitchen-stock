export function createHttpHelpers({
  verifySession
}) {
  function bearerUser(req) {
    const header = req.headers.authorization || "";
    const tokenValue = header.startsWith("Bearer ") ? header.slice(7) : "";
    return verifySession(tokenValue);
  }

  function send(res, status, body, contentType = "application/json; charset=utf-8") {
    res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
    if (Buffer.isBuffer(body) || typeof body === "string") {
      res.end(body);
    } else {
      res.end(JSON.stringify(body));
    }
  }

  function requireUser(req, res, options = {}) {
    const user = bearerUser(req);
    if (!user) {
      send(res, 401, { error: "Login required." });
      return null;
    }
    if (user.mustChangePassword && !options.allowPasswordChange) {
      send(res, 403, { error: "Password change required.", code: "PASSWORD_CHANGE_REQUIRED" });
      return null;
    }
    return user;
  }

  function requireRole(user, res, predicate, message) {
    if (predicate(user)) return true;
    send(res, 403, { error: message || "You do not have permission for this action." });
    return false;
  }

  async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    return body ? JSON.parse(body) : {};
  }

  return {
    bearerUser,
    requireUser,
    requireRole,
    send,
    readJson
  };
}
