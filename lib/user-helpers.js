import crypto from "node:crypto";

export function createUserHelpers({
  userConfig,
  editableUserSources,
  gotoMenuOptions,
  backofficeMenuOptions,
  authSecret,
  sessionMaxAgeMs,
  clampOpenOrderDays,
  normalizeHiddenMenuItems
}) {
  function normalizeRole(role) {
    const cleaned = String(role || "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
    if (cleaned === "god") return "god";
    if (cleaned === "admin") return "admin";
    if (cleaned === "security-admin" || cleaned === "securityadmin" || cleaned === "security") return "security-admin";
    if (cleaned === "power-user" || cleaned === "poweruser" || cleaned === "power") return "power-user";
    if (cleaned === "staff") return "staff";
    return "user";
  }

  function userPermissions(role, user = {}) {
    const normalized = normalizeRole(role);
    const isGod = normalized === "god";
    const isSecurityAdmin = normalized === "security-admin";
    const isAdmin = normalized === "admin" || isSecurityAdmin || isGod;
    const isPower = normalized === "power-user";
    const isStaff = normalized === "staff";
    const kitchenNotifyFlag =
      user?.notifyAreas?.kitchen ??
      user?.notify_area_kitchen ??
      false;
    const hasKitchenAccess = Boolean(
      kitchenNotifyFlag ||
      user?.isKitchenStaff ||
      user?.is_kitchen_staff
    );
    return {
      canAdminUsers: isAdmin,
      canManageAdminRoles: isGod,
      canManageSecurityRole: isGod,
      canViewInternalData: isSecurityAdmin || isGod,
      canDeleteAdmins: isGod,
      canManageKitchenRoster: isGod || isAdmin,
      canViewKitchenRoster: isGod || isAdmin || hasKitchenAccess,
      canAddInventoryItems: isAdmin || isPower,
      canDeleteAnyOrder: isAdmin || isPower,
      canUseInvoices: isAdmin || isPower,
      canSendInvoiceToAccounting: isAdmin,
      canUseSupplierOrdering: !isStaff,
      canPlaceInternalOrders: isStaff || isAdmin || isPower,
      canPickInternalOrders: isAdmin || isPower
    };
  }

  function presentUserName(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw !== raw.toLowerCase()) return raw;
    return raw
      .split(/\s+/)
      .map((part) => part
        .split("-")
        .map((piece) => piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece)
        .join("-"))
      .join(" ");
  }

  function publicUser(user) {
    const role = normalizeRole(user?.role);
    const permissions = userPermissions(role, user || {});
    const notifyAreas = {
      bar: user?.notifyAreas?.bar ?? user?.notify_area_bar ?? false,
      foh: user?.notifyAreas?.foh ?? user?.notify_area_foh ?? false,
      kitchen: user?.notifyAreas?.kitchen ?? user?.notify_area_kitchen ?? false,
      general: user?.notifyAreas?.general ?? user?.notify_area_general ?? false
    };
    if (Boolean(user?.isPicker) || Boolean(user?.is_picker)) {
      permissions.canPickInternalOrders = true;
    }
    return {
      name: presentUserName(user?.name || ""),
      role,
      theme: user?.theme === "light" ? "light" : "dark",
      active: user?.active !== false,
      mustChangePassword: Boolean(user?.mustChangePassword),
      isKitchenStaff: Boolean(user?.isKitchenStaff || user?.is_kitchen_staff),
      kitchenFunction: String(user?.kitchenFunction || user?.kitchen_function || ""),
      notifyAreas,
      source: user?.source || "airtable",
      settings: {
        openOrderDays: clampOpenOrderDays(user?.openOrderDays ?? user?.open_order_days),
        desktopIdleTimeoutEnabled: user?.desktopIdleTimeoutEnabled ?? user?.desktop_idle_timeout_enabled !== false,
        hiddenGotoMenu: normalizeHiddenMenuItems(user?.hiddenGotoMenu ?? user?.hidden_goto_menu, gotoMenuOptions),
        hiddenBackofficeMenu: normalizeHiddenMenuItems(user?.hiddenBackofficeMenu ?? user?.hidden_backoffice_menu, backofficeMenuOptions)
      },
      permissions
    };
  }

  function mapPgAppUserRow(row) {
    return {
      id: row.id,
      name: presentUserName(row.display_name || row.username),
      username: row.username,
      lastLoginAt: row.last_login_at || "",
      role: normalizeRole(row.role),
      theme: row.theme === "light" ? "light" : "dark",
      active: row.active !== false,
      isDriver: Boolean(row.is_driver),
      isPicker: Boolean(row.is_picker),
      isKitchenStaff: Boolean(row.is_kitchen_staff),
      kitchenFunction: String(row.kitchen_function || ""),
      mustChangePassword: Boolean(row.must_change_password),
      notifyOnNewOrders: Boolean(row.notify_on_new_orders),
      notifyOnDelivery: row.notify_on_delivery !== false,
      notifyAreas: {
        bar: row.notify_area_bar !== false,
        foh: row.notify_area_foh !== false,
        kitchen: row.notify_area_kitchen !== false,
        general: row.notify_area_general !== false
      },
      openOrderDays: clampOpenOrderDays(row.open_order_days),
      desktopIdleTimeoutEnabled: row.desktop_idle_timeout_enabled !== false,
      hiddenGotoMenu: normalizeHiddenMenuItems(row.hidden_goto_menu, gotoMenuOptions),
      hiddenBackofficeMenu: normalizeHiddenMenuItems(row.hidden_backoffice_menu, backofficeMenuOptions),
      source: row.source || "postgres"
    };
  }

  function parseUsers() {
    return new Map(
      userConfig
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [name, password, roleValue] = entry.split(":");
          const role = normalizeRole(roleValue || (String(name || "").trim().toLowerCase() === "enno" ? "god" : "user"));
          return [String(name || "").trim().toLowerCase(), {
            name: String(name || "").trim(),
            password: String(password || "").trim(),
            role,
            active: true,
            mustChangePassword: false,
            source: "env"
          }];
        })
        .filter(([name, user]) => name && user.password)
    );
  }

  function base64url(value) {
    return Buffer.from(value).toString("base64url");
  }

  function sign(value) {
    return crypto.createHmac("sha256", authSecret).update(value).digest("base64url");
  }

  function createSession(user) {
    const safeUser = publicUser(user);
    const payload = JSON.stringify({
      user: safeUser.name,
      role: safeUser.role,
      isPicker: Boolean(user?.isPicker || user?.is_picker),
      isKitchenStaff: Boolean(user?.isKitchenStaff || user?.is_kitchen_staff),
      kitchenFunction: String(user?.kitchenFunction || user?.kitchen_function || ""),
      notifyAreas: safeUser.notifyAreas,
      mustChangePassword: Boolean(safeUser.mustChangePassword),
      exp: Date.now() + sessionMaxAgeMs
    });
    const encoded = base64url(payload);
    return `${encoded}.${sign(encoded)}`;
  }

  function verifySession(tokenValue) {
    if (!tokenValue || !tokenValue.includes(".")) return null;

    const [encoded, signature] = tokenValue.split(".");
    const expected = sign(encoded);

    if (signature.length !== expected.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (!payload.user || !payload.exp || Date.now() > payload.exp) return null;
      return publicUser({
        name: payload.user,
        role: payload.role || "user",
        isPicker: Boolean(payload.isPicker),
        isKitchenStaff: Boolean(payload.isKitchenStaff),
        kitchenFunction: String(payload.kitchenFunction || ""),
        notifyAreas: {
          bar: Boolean(payload.notifyAreas?.bar),
          foh: Boolean(payload.notifyAreas?.foh),
          kitchen: Boolean(payload.notifyAreas?.kitchen),
          general: Boolean(payload.notifyAreas?.general)
        },
        active: true,
        mustChangePassword: Boolean(payload.mustChangePassword)
      });
    } catch {
      return null;
    }
  }

  function storeSession(user) {
    return { token: createSession(user), user: publicUser(user) };
  }

  return {
    editableUserSources,
    normalizeRole,
    userPermissions,
    presentUserName,
    publicUser,
    mapPgAppUserRow,
    parseUsers,
    createSession,
    verifySession,
    storeSession
  };
}
