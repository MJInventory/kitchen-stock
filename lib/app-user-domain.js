import bcrypt from "bcryptjs";

export function createAppUserDomain({
  assertPostgresSchemaReady,
  db,
  cache,
  isValidId,
  mapPgAppUserRow,
  normalizeRole,
  clampOpenOrderDays,
  normalizeHiddenMenuItems,
  gotoMenuOptions,
  backofficeMenuOptions,
  publicUser,
  auditChanged,
  pgRecordAuditEntry,
  presentUserName,
  todayIso
}) {
  function normalizeLegacyAppUser(record) {
    const fields = record.fields || {};
    const name = String(fields.Name || fields.Username || "").trim();
    return {
      id: record.id,
      name,
      password: String(fields.Password || "").trim(),
      role: name.toLowerCase() === "enno" ? "god" : normalizeRole(fields.Role || "user"),
      theme: String(fields.Theme || "dark").trim().toLowerCase() === "light" ? "light" : "dark",
      active: fields.Active !== false,
      mustChangePassword: Boolean(fields["Force Password Change"]),
      source: "airtable"
    };
  }

  function legacyAppUserFields(payload, schema = null) {
    const name = String(payload.name || "").trim();
    const password = String(payload.password || "").trim();
    const role = normalizeRole(payload.role);
    const theme = "Light";
    const active = payload.active !== false;
    const mustChangePassword = Boolean(payload.mustChangePassword);

    if (!name) throw new Error("User name is required.");
    if (!password) throw new Error("Password is required.");
    const fields = {
      Name: name,
      Password: password,
      Role: role === "god"
        ? "God"
        : role === "admin"
          ? "Admin"
          : role === "power-user"
            ? "Power User"
            : role === "staff"
              ? "Staff"
              : "User"
    };
    if (!schema || schema.appUsers.hasTheme) fields.Theme = theme;
    if (!schema || schema.appUsers.hasActive) fields.Active = active;
    if (!schema || schema.appUsers.hasForcePasswordChange) fields["Force Password Change"] = mustChangePassword;
    return fields;
  }

  function legacyAppUserUpdateFields(payload, currentUser, schema = null) {
    const name = String(payload.name || currentUser?.name || "").trim();
    const role = normalizeRole(payload.role || currentUser?.role || "user");
    const theme = "Light";
    const active = payload.active !== false;
    const mustChangePassword = Boolean(payload.mustChangePassword);
    const password = String(payload.password || "").trim();

    if (!name) throw new Error("User name is required.");
    const fields = {
      Name: name,
      Role: role === "god"
        ? "God"
        : role === "admin"
          ? "Admin"
          : role === "power-user"
            ? "Power User"
            : role === "staff"
              ? "Staff"
              : "User"
    };
    if (password) fields.Password = password;
    if (!schema || schema.appUsers.hasTheme) fields.Theme = theme;
    if (!schema || schema.appUsers.hasActive) fields.Active = active;
    if (!schema || schema.appUsers.hasForcePasswordChange) fields["Force Password Change"] = mustChangePassword;
    return fields;
  }

  function canChangeAppUserRole(actor, target, nextRole) {
    const actorRole = normalizeRole(actor?.role);
    const targetRole = normalizeRole(target?.role);
    const wantedRole = normalizeRole(nextRole);
    const actorIsGod = actorRole === "god";
    const actorIsAdmin = actorRole === "admin";
    if (actorIsGod) return true;
    if (!actorIsAdmin) return false;
    if (targetRole === "admin" || targetRole === "god") return false;
    if (wantedRole === "admin" || wantedRole === "god") return false;
    return true;
  }

  function canDeleteAppUserRecord(actor, target) {
    const actorRole = normalizeRole(actor?.role);
    const targetRole = normalizeRole(target?.role);
    if (actorRole === "god") return true;
    if (actorRole !== "admin") return false;
    return targetRole === "power-user" || targetRole === "staff" || targetRole === "user";
  }

  const kitchenFunctions = new Set([
    "Chef",
    "Sous-Chef",
    "Line Cook",
    "Kitchen Helper",
    "Dishwasher",
    "Pickup Waiter",
    "Other"
  ]);

  function normalizeKitchenFunction(value) {
    const raw = String(value || "").trim();
    return kitchenFunctions.has(raw) ? raw : "";
  }

  async function pgListAppUsers() {
    assertPostgresSchemaReady();
    const result = await db().query(`
      select id, username, display_name, role, theme, active, must_change_password,
             is_driver, is_picker, is_kitchen_staff, kitchen_function,
             notify_on_new_orders, notify_on_delivery,
             notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
             open_order_days, hidden_goto_menu, hidden_backoffice_menu,
             source, last_login_at
      from app_users
      order by case lower(role)
                 when 'god' then 0
                 when 'admin' then 1
                 when 'power-user' then 2
                 when 'staff' then 3
                 when 'user' then 4
                 else 9
               end,
               lower(coalesce(nullif(display_name, ''), username)),
               lower(username)
    `);
    return result.rows.map(mapPgAppUserRow);
  }

  async function pgFindAppUserByName(name) {
    assertPostgresSchemaReady();
    const normalized = String(name || "").trim().toLowerCase();
    if (!normalized) return null;
    const result = await db().query(`
      select id, username, display_name, password_hash, role, theme, active, must_change_password,
             is_driver, is_picker, is_kitchen_staff, kitchen_function,
             notify_on_new_orders, notify_on_delivery,
             notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
             open_order_days, hidden_goto_menu, hidden_backoffice_menu,
             source, last_login_at
      from app_users
      where lower(username) = $1 or lower(display_name) = $1
      limit 1
    `, [normalized]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      passwordHash: row.password_hash,
      ...mapPgAppUserRow(row)
    };
  }

  async function pgCreateAppUser(payload, actorUsername = "") {
    assertPostgresSchemaReady();
    const username = String(payload.name || payload.username || "").trim().toLowerCase();
    const displayName = String(payload.name || payload.username || "").trim();
    const password = String(payload.password || "").trim();
    if (!username) throw new Error("User name is required.");
    if (!password) throw new Error("Password is required.");
    const role = normalizeRole(payload.role);
    const theme = "light";
    const passwordHash = await bcrypt.hash(password, 10);
    const notifyAreas = payload.notifyAreas || {};
    const wantsDriver = Boolean(payload.isDriver);
    const wantsPicker = Boolean(payload.isPicker);
    const wantsKitchenStaff = Boolean(payload.isKitchenStaff);
    const kitchenFunction = normalizeKitchenFunction(payload.kitchenFunction);
    const openOrderDays = clampOpenOrderDays(payload.openOrderDays);
    const hiddenGotoMenu = normalizeHiddenMenuItems(payload.hiddenGotoMenu, gotoMenuOptions);
    const hiddenBackofficeMenu = normalizeHiddenMenuItems(payload.hiddenBackofficeMenu, backofficeMenuOptions);
    const result = await db().query(`
      insert into app_users (
        username, display_name, password_hash, role, theme, active, must_change_password,
        is_driver, is_picker, is_kitchen_staff, kitchen_function,
        notify_on_new_orders, notify_on_delivery,
        notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
        open_order_days, hidden_goto_menu, hidden_backoffice_menu,
        source
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, 'postgres')
      returning id, username, display_name, role, theme, active, must_change_password,
                is_driver, is_picker, is_kitchen_staff, kitchen_function,
                notify_on_new_orders, notify_on_delivery,
                notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
                open_order_days, hidden_goto_menu, hidden_backoffice_menu,
                source, last_login_at
    `, [
      username,
      displayName,
      passwordHash,
      role,
      theme,
      payload.active !== false,
      Boolean(payload.mustChangePassword),
      wantsDriver,
      wantsPicker,
      wantsKitchenStaff,
      kitchenFunction,
      Boolean(payload.notifyOnNewOrders),
      payload.notifyOnDelivery !== false,
      notifyAreas.bar !== false,
      notifyAreas.foh !== false,
      notifyAreas.kitchen !== false,
      notifyAreas.general !== false,
      openOrderDays,
      JSON.stringify(hiddenGotoMenu),
      JSON.stringify(hiddenBackofficeMenu)
    ]);
    const createdId = result.rows[0]?.id || "";
    if (wantsDriver && createdId) {
      await db().query(`
        update app_users
        set is_driver = case when id = $1 then true else false end,
            updated_at = now()
        where is_driver = true or id = $1
      `, [createdId]);
    }
    const refreshed = createdId ? await db().query(`
      select id, username, display_name, role, theme, active, must_change_password,
             is_driver, is_picker, is_kitchen_staff, kitchen_function,
             notify_on_new_orders, notify_on_delivery,
             notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
             open_order_days, hidden_goto_menu, hidden_backoffice_menu,
             source, last_login_at
      from app_users
      where id = $1
    `, [createdId]) : { rows: result.rows };
    const row = refreshed.rows[0];
    cache.appUsers.expiresAt = 0;
    const saved = mapPgAppUserRow(row);
    await pgRecordAuditEntry({
      actionType: "add",
      entityType: "app-user",
      entityId: saved.id,
      entityName: saved.name || saved.displayName || username,
      actorUsername,
      reasonCode: "user-create",
      after: saved
    });
    return saved;
  }

  async function pgUpdateAppUser(recordId, payload, actorUsername = "") {
    assertPostgresSchemaReady();
    if (!isValidId(recordId)) throw new Error("Invalid app user record.");
    const current = await db().query(`
      select id, username, display_name, role, theme, active, must_change_password,
             is_driver, is_picker, is_kitchen_staff, kitchen_function,
             notify_on_new_orders, notify_on_delivery,
             notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
             open_order_days, hidden_goto_menu, hidden_backoffice_menu,
             source, last_login_at
      from app_users
      where id = $1
    `, [recordId]);
    const user = current.rows[0];
    if (!user) throw new Error("User was not found.");
    const before = mapPgAppUserRow(user);
    const nextName = String(payload.name || user.display_name || user.username).trim();
    const nextUsername = nextName.toLowerCase();
    const nextRole = normalizeRole(payload.role || user.role);
    const nextTheme = "light";
    const nextActive = payload.active !== false;
    const nextMustChange = Boolean(payload.mustChangePassword);
    const nextNotifyOnNewOrders = Boolean(payload.notifyOnNewOrders);
    const nextNotifyOnDelivery = payload.notifyOnDelivery !== false;
    const notifyAreas = payload.notifyAreas || {};
    const nextNotifyAreaBar = notifyAreas.bar !== false;
    const nextNotifyAreaFoh = notifyAreas.foh !== false;
    const nextNotifyAreaKitchen = notifyAreas.kitchen !== false;
    const nextNotifyAreaGeneral = notifyAreas.general !== false;
    const nextOpenOrderDays = Object.prototype.hasOwnProperty.call(payload, "openOrderDays")
      ? clampOpenOrderDays(payload.openOrderDays)
      : clampOpenOrderDays(user.open_order_days);
    const nextHiddenGotoMenu = Object.prototype.hasOwnProperty.call(payload, "hiddenGotoMenu")
      ? normalizeHiddenMenuItems(payload.hiddenGotoMenu, gotoMenuOptions)
      : normalizeHiddenMenuItems(user.hidden_goto_menu, gotoMenuOptions);
    const nextHiddenBackofficeMenu = Object.prototype.hasOwnProperty.call(payload, "hiddenBackofficeMenu")
      ? normalizeHiddenMenuItems(payload.hiddenBackofficeMenu, backofficeMenuOptions)
      : normalizeHiddenMenuItems(user.hidden_backoffice_menu, backofficeMenuOptions);
    const nextIsDriver = Object.prototype.hasOwnProperty.call(payload, "isDriver")
      ? Boolean(payload.isDriver)
      : Boolean(user.is_driver);
    const nextIsPicker = Object.prototype.hasOwnProperty.call(payload, "isPicker")
      ? Boolean(payload.isPicker)
      : Boolean(user.is_picker);
    const nextIsKitchenStaff = Object.prototype.hasOwnProperty.call(payload, "isKitchenStaff")
      ? Boolean(payload.isKitchenStaff)
      : Boolean(user.is_kitchen_staff);
    const nextKitchenFunction = Object.prototype.hasOwnProperty.call(payload, "kitchenFunction")
      ? normalizeKitchenFunction(payload.kitchenFunction)
      : normalizeKitchenFunction(user.kitchen_function);
    let passwordSql = "";
    const values = [
      recordId, nextUsername, nextName, nextRole, nextTheme, nextActive, nextMustChange, nextIsDriver, nextIsPicker,
      nextIsKitchenStaff, nextKitchenFunction,
      nextNotifyOnNewOrders, nextNotifyOnDelivery, nextNotifyAreaBar, nextNotifyAreaFoh, nextNotifyAreaKitchen, nextNotifyAreaGeneral,
      nextOpenOrderDays, JSON.stringify(nextHiddenGotoMenu), JSON.stringify(nextHiddenBackofficeMenu)
    ];
    if (String(payload.password || "").trim()) {
      const passwordHash = await bcrypt.hash(String(payload.password).trim(), 10);
      values.push(passwordHash);
      passwordSql = `, password_hash = $${values.length}`;
    }
    const result = await db().query(`
      update app_users
      set username = $2,
          display_name = $3,
          role = $4,
          theme = $5,
          active = $6,
          must_change_password = $7,
          is_driver = $8,
          is_picker = $9,
          is_kitchen_staff = $10,
          kitchen_function = $11,
          notify_on_new_orders = $12,
          notify_on_delivery = $13,
          notify_area_bar = $14,
          notify_area_foh = $15,
          notify_area_kitchen = $16,
          notify_area_general = $17,
          open_order_days = $18,
          hidden_goto_menu = $19::jsonb,
          hidden_backoffice_menu = $20::jsonb,
          updated_at = now()
          ${passwordSql}
      where id = $1
      returning id, username, display_name, role, theme, active, must_change_password,
                is_driver, is_picker, is_kitchen_staff, kitchen_function,
                notify_on_new_orders, notify_on_delivery,
                notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
                open_order_days, hidden_goto_menu, hidden_backoffice_menu,
                source, last_login_at
    `, values);
    const updatedId = result.rows[0]?.id || recordId;
    if (nextIsDriver && updatedId) {
      await db().query(`
        update app_users
        set is_driver = case when id = $1 then true else false end,
            updated_at = now()
        where is_driver = true or id = $1
      `, [updatedId]);
    }
    const refreshed = await db().query(`
      select id, username, display_name, role, theme, active, must_change_password,
             is_driver, is_picker, is_kitchen_staff, kitchen_function,
             notify_on_new_orders, notify_on_delivery,
             notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
             open_order_days, hidden_goto_menu, hidden_backoffice_menu,
             source, last_login_at
      from app_users
      where id = $1
    `, [updatedId]);
    const row = refreshed.rows[0];
    cache.appUsers.expiresAt = 0;
    const saved = mapPgAppUserRow(row);
    if (auditChanged(before, saved)) {
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "app-user",
        entityId: saved.id,
        entityName: saved.name || saved.displayName || nextUsername,
        actorUsername,
        reasonCode: "user-update",
        before,
        after: saved
      });
    }
    return saved;
  }

  async function pgDeleteAppUser(recordId, actorUsername = "") {
    const current = await db().query(`
      select id, username, display_name, role, theme, active, must_change_password,
             is_driver, is_picker, is_kitchen_staff, kitchen_function,
             notify_on_new_orders, notify_on_delivery,
             notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
             open_order_days, hidden_goto_menu, hidden_backoffice_menu,
             source, last_login_at
      from app_users
      where id = $1
    `, [recordId]);
    const before = current.rows[0] ? mapPgAppUserRow(current.rows[0]) : null;
    const result = await db().query(`delete from app_users where id = $1 returning id`, [recordId]);
    cache.appUsers.expiresAt = 0;
    if (before) {
      await pgRecordAuditEntry({
        actionType: "delete",
        entityType: "app-user",
        entityId: recordId,
        entityName: before.name || before.displayName || "",
        actorUsername,
        reasonCode: "user-delete",
        before
      });
    }
    return { id: result.rows[0]?.id || recordId, deleted: Boolean(result.rowCount) };
  }

  async function pgChangeOwnPassword(userName, currentPassword, newPassword, options = {}) {
    const user = await pgFindAppUserByName(userName);
    if (!user) throw new Error("User was not found.");
    const currentOk = options.forceChange || await bcrypt.compare(String(currentPassword || ""), user.passwordHash || "");
    if (!currentOk) throw new Error("Current password is not correct.");
    if (String(newPassword || "").trim().length < 2) throw new Error("New password is too short.");
    const passwordHash = await bcrypt.hash(String(newPassword).trim(), 10);
    const result = await db().query(`
      update app_users
      set password_hash = $2, must_change_password = false, updated_at = now()
      where id = $1
      returning id, username, display_name, role, theme, active, must_change_password,
                is_driver, is_picker, is_kitchen_staff, kitchen_function,
                notify_on_new_orders, notify_on_delivery,
                notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
                open_order_days, hidden_goto_menu, hidden_backoffice_menu,
                source, last_login_at
    `, [user.id, passwordHash]);
    const row = result.rows[0];
    cache.appUsers.expiresAt = 0;
    const saved = mapPgAppUserRow(row);
    await pgRecordAuditEntry({
      actionType: "change",
      entityType: "app-user",
      entityId: saved.id,
      entityName: saved.name || saved.displayName || userName,
      actorUsername: saved.name || userName,
      reasonCode: options.forceChange ? "password-reset" : "password-change",
      note: options.forceChange ? "Password reset through admin or forced change flow." : "User changed password."
    });
    return saved;
  }

  async function pgGetOwnSettings(userName) {
    const user = await pgFindAppUserByName(userName);
    if (!user) throw new Error("User was not found.");
    return publicUser(user).settings;
  }

  async function pgUpdateOwnSettings(userName, payload = {}) {
    const user = await pgFindAppUserByName(userName);
    if (!user?.id) throw new Error("User was not found.");
    const theme = "light";
    const openOrderDays = clampOpenOrderDays(payload.openOrderDays ?? user.openOrderDays);
    const hiddenGotoMenu = normalizeHiddenMenuItems(payload.hiddenGotoMenu ?? user.hiddenGotoMenu, gotoMenuOptions);
    const hiddenBackofficeMenu = normalizeHiddenMenuItems(payload.hiddenBackofficeMenu ?? user.hiddenBackofficeMenu, backofficeMenuOptions);
    const result = await db().query(`
      update app_users
      set theme = $2,
          open_order_days = $3,
          hidden_goto_menu = $4::jsonb,
          hidden_backoffice_menu = $5::jsonb,
          updated_at = now()
      where id = $1
      returning id, username, display_name, role, theme, active, must_change_password,
                is_driver, is_picker, is_kitchen_staff, kitchen_function,
                notify_on_new_orders, notify_on_delivery,
                notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general,
                open_order_days, hidden_goto_menu, hidden_backoffice_menu,
                source, last_login_at
    `, [user.id, theme, openOrderDays, JSON.stringify(hiddenGotoMenu), JSON.stringify(hiddenBackofficeMenu)]);
    cache.appUsers.expiresAt = 0;
    return publicUser(mapPgAppUserRow(result.rows[0])).settings;
  }

  async function pgRecordSuccessfulLogin(userId) {
    if (!isValidId(userId)) return "";
    const result = await db().query(`
      update app_users
      set last_login_at = now(), updated_at = now()
      where id = $1
      returning last_login_at
    `, [userId]);
    cache.appUsers.expiresAt = 0;
    return result.rows[0]?.last_login_at || "";
  }

  async function pgGetDedicatedDriverName() {
    assertPostgresSchemaReady();
    const result = await db().query(`
      select display_name, username
      from app_users
      where active = true and is_driver = true
      order by updated_at desc, username
      limit 1
    `);
    const row = result.rows[0];
    return presentUserName(row?.display_name || row?.username || "");
  }

  async function pgGetAssignedDriverName(date) {
    assertPostgresSchemaReady();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    const result = await db().query(`
      select driver_username
      from driver_sheet_assignments
      where sheet_date = $1::date
      limit 1
    `, [selectedDate]);
    return presentUserName(result.rows[0]?.driver_username || "");
  }

  async function pgResolveDriverName(date) {
    const assigned = await pgGetAssignedDriverName(date);
    if (assigned) return assigned;
    return pgGetDedicatedDriverName();
  }

  return {
    normalizeLegacyAppUser,
    legacyAppUserFields,
    legacyAppUserUpdateFields,
    canChangeAppUserRole,
    canDeleteAppUserRecord,
    pgListAppUsers,
    pgFindAppUserByName,
    pgCreateAppUser,
    pgUpdateAppUser,
    pgDeleteAppUser,
    pgChangeOwnPassword,
    pgGetOwnSettings,
    pgUpdateOwnSettings,
    pgRecordSuccessfulLogin,
    pgGetDedicatedDriverName,
    pgGetAssignedDriverName,
    pgResolveDriverName
  };
}
