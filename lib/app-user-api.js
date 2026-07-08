export function createAppUserApi({
  bcrypt,
  hasPostgres,
  pushEnabled,
  vapidPublicKey,
  readJson,
  send,
  requireUser,
  requireRole,
  storeSession,
  publicUser,
  publicUserForAdmin,
  canChangeAppUserRole,
  canDeleteAppUserRecord,
  findAppUserByName,
  changeOwnPassword,
  refreshUserFromDirectory,
  pgRecordSuccessfulLogin,
  pgGetOwnSettings,
  pgUpdateOwnSettings,
  pgSavePushSubscription,
  pgRemovePushSubscription,
  getAppUsers,
  createAppUser,
  findAppUserById,
  updateAppUser,
  deleteAppUser
}) {
  return async function handleAppUserApi(req, res) {
    if (req.method === "POST" && req.url === "/api/login") {
      const payload = await readJson(req);
      const name = String(payload.username || "").trim();
      const password = String(payload.password || "").trim();
      const user = await findAppUserByName(name);

      let validPassword = false;
      if (user) {
        if (user.passwordHash) {
          validPassword = await bcrypt.compare(password, user.passwordHash);
        } else {
          validPassword = user.password === password;
        }
      }

      if (!user || !validPassword) {
        send(res, 401, { error: "Invalid username or password." });
        return true;
      }

      if (hasPostgres() && user.id) {
        user.lastLoginAt = await pgRecordSuccessfulLogin(user.id);
      }

      send(res, 200, storeSession(user));
      return true;
    }

    if (req.method === "POST" && req.url === "/api/change-password") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return true;
      const payload = await readJson(req);
      const updatedUser = await changeOwnPassword(user.name, payload.currentPassword, payload.newPassword, {
        forceChange: Boolean(user.mustChangePassword)
      });
      send(res, 200, storeSession(updatedUser));
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/me")) {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return true;
      const freshUser = await refreshUserFromDirectory(user);
      if (freshUser.active === false) {
        send(res, 403, { error: "This user is no longer active." });
        return true;
      }
      send(res, 200, storeSession(freshUser));
      return true;
    }

    if (req.method === "GET" && req.url === "/api/user-settings") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return true;
      const settings = hasPostgres()
        ? await pgGetOwnSettings(user.name)
        : publicUser(user).settings;
      send(res, 200, { settings });
      return true;
    }

    if (req.method === "PATCH" && req.url === "/api/user-settings") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return true;
      const payload = await readJson(req);
      const settings = hasPostgres()
        ? await pgUpdateOwnSettings(user.name, payload)
        : publicUser(user).settings;
      send(res, 200, { settings });
      return true;
    }

    if (req.method === "GET" && req.url === "/api/push/public-key") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return true;
      send(res, 200, { enabled: pushEnabled, publicKey: pushEnabled ? vapidPublicKey : "" });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/push/subscribe") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return true;
      const payload = await readJson(req);
      const result = hasPostgres()
        ? await pgSavePushSubscription(user.name, payload.subscription || {}, req.headers["user-agent"] || "")
        : { ok: false };
      send(res, 200, result);
      return true;
    }

    if (req.method === "DELETE" && req.url === "/api/push/subscribe") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return true;
      const payload = await readJson(req);
      const result = hasPostgres()
        ? await pgRemovePushSubscription(user.name, payload.endpoint || "")
        : { ok: false, removed: 0 };
      send(res, 200, result);
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/app-users")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return true;
      send(res, 200, { users: (await getAppUsers()).map((appUser) => publicUserForAdmin(appUser, user)) });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/app-users") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return true;
      const payload = await readJson(req);
      if (!canChangeAppUserRole(user, { role: "user" }, payload.role)) {
        send(res, 403, { error: "Only God can create admin, Security Admin, or God users." });
        return true;
      }
      const created = await createAppUser(payload, user.name);
      send(res, 201, { user: publicUserForAdmin(created, user) });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/app-users/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return true;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const target = await findAppUserById(recordId);
      if (!target) {
        send(res, 404, { error: "User was not found." });
        return true;
      }
      if (!canChangeAppUserRole(user, target, payload.role)) {
        send(res, 403, { error: "Only God can change admin and Security Admin roles. Admins can manage power users, staff, and users only." });
        return true;
      }
      const updated = await updateAppUser(recordId, payload, user.name);
      send(res, 200, { user: publicUserForAdmin(updated, user) });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/app-users/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return true;
      const recordId = req.url.split("/")[3];
      const target = await findAppUserById(recordId);
      if (!target) {
        send(res, 404, { error: "User was not found." });
        return true;
      }
      if (String(target.name || "").toLowerCase() === String(user.name || "").toLowerCase()) {
        send(res, 403, { error: "You cannot delete your own user." });
        return true;
      }
      if (!canDeleteAppUserRecord(user, target)) {
        send(res, 403, { error: "Only God can delete admin and Security Admin users. Admins can delete power users, staff, and users only." });
        return true;
      }
      const result = await deleteAppUser(recordId, user.name);
      send(res, 200, { result });
      return true;
    }

    return false;
  };
}
