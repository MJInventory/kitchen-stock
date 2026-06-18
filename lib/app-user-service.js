export function createAppUserService({
  appUsersTableIdFromEnv,
  airtable,
  cache,
  cached,
  getSchema,
  hasPostgres,
  normalizeLegacyAppUser,
  legacyAppUserUpdateFields,
  pgListAppUsers,
  pgFindAppUserByName,
  pgCreateAppUser,
  pgUpdateAppUser,
  pgDeleteAppUser,
  pgChangeOwnPassword
}) {
  async function getAppUsersTableId() {
    if (appUsersTableIdFromEnv) return appUsersTableIdFromEnv;
    const schema = await getSchema();
    return schema.tables.appUsers || "";
  }

  async function listAppUsers() {
    return pgListAppUsers();
  }

  async function getAppUsers() {
    return cached("appUsers", 30 * 1000, listAppUsers);
  }

  async function findAppUserByName(name) {
    const normalized = String(name || "").trim().toLowerCase();
    const user = await pgFindAppUserByName(normalized);
    return user && user.active !== false ? user : null;
  }

  async function refreshUserFromDirectory(user) {
    const freshUser = await findAppUserByName(user?.name);
    if (!freshUser) return user;
    return freshUser;
  }

  async function findAppUserById(recordId) {
    const appUsers = await getAppUsers();
    return appUsers.find((user) => user.id === recordId);
  }

  async function createAppUser(payload, actorUsername = "") {
    return pgCreateAppUser(payload, actorUsername);
  }

  async function changeOwnPassword(userName, currentPassword, newPassword, options = {}) {
    return pgChangeOwnPassword(userName, currentPassword, newPassword, options);
  }

  async function updateAppUser(recordId, payload, actorUsername = "") {
    if (hasPostgres()) {
      return pgUpdateAppUser(recordId, payload, actorUsername);
    }
    const tableId = await getAppUsersTableId();
    if (!tableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid app user record.");

    const schema = await getSchema();
    const currentUser = await findAppUserById(recordId);
    if (!currentUser) throw new Error("User was not found.");
    const fields = legacyAppUserUpdateFields(payload, currentUser, schema);
    const record = await airtable(`${tableId}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields, typecast: true })
    });
    cache.appUsers.expiresAt = 0;
    return normalizeLegacyAppUser(record);
  }

  async function deleteAppUser(recordId, actorUsername = "") {
    if (hasPostgres()) {
      return pgDeleteAppUser(recordId, actorUsername);
    }
    const tableId = await getAppUsersTableId();
    if (!tableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid app user record.");
    const result = await airtable(`${tableId}/${recordId}`, { method: "DELETE" });
    cache.appUsers.expiresAt = 0;
    return { id: result.id || recordId, deleted: Boolean(result.deleted) };
  }

  return {
    getAppUsersTableId,
    listAppUsers,
    getAppUsers,
    findAppUserByName,
    refreshUserFromDirectory,
    findAppUserById,
    createAppUser,
    changeOwnPassword,
    updateAppUser,
    deleteAppUser
  };
}
