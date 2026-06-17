export function createNotificationDomain({
  ensurePostgresSchemaUpgrades,
  db,
  isValidId,
  pushEnabled,
  webpush,
  pgFindAppUserByName,
  normalizeNotificationAreaName
}) {
  async function pgListNotificationsForUser(userName, limit = 20) {
    await ensurePostgresSchemaUpgrades();
    const user = await pgFindAppUserByName(userName);
    if (!user?.id) return [];
    const result = await db().query(`
      select id, notification_type, title, body, related_request_id, related_standing_order_id,
             related_standing_order_run_id, is_read, created_at, read_at
      from app_notifications
      where user_id = $1
      order by is_read asc, created_at desc
      limit $2
    `, [user.id, Math.min(Math.max(Number(limit) || 20, 1), 100)]);
    return result.rows.map((row) => ({
      id: row.id,
      type: row.notification_type || "info",
      title: row.title || "",
      body: row.body || "",
      relatedRequestId: row.related_request_id || "",
      relatedStandingOrderId: row.related_standing_order_id || "",
      relatedStandingOrderRunId: row.related_standing_order_run_id || "",
      isRead: Boolean(row.is_read),
      createdAt: row.created_at || "",
      readAt: row.read_at || ""
    }));
  }

  async function pgMarkNotificationsRead(userName, notificationIds = []) {
    await ensurePostgresSchemaUpgrades();
    const user = await pgFindAppUserByName(userName);
    if (!user?.id) return { updated: 0 };
    const cleanIds = (Array.isArray(notificationIds) ? notificationIds : [])
      .map((id) => String(id || "").trim())
      .filter((id) => isValidId(id));
    const result = cleanIds.length
      ? await db().query(`
          update app_notifications
          set is_read = true, read_at = now()
          where user_id = $1 and id = any($2::uuid[])
        `, [user.id, cleanIds])
      : await db().query(`
          update app_notifications
          set is_read = true, read_at = now()
          where user_id = $1 and is_read = false
        `, [user.id]);
    return { updated: result.rowCount || 0 };
  }

  async function pgListPushSubscriptionsForUserId(userId) {
    await ensurePostgresSchemaUpgrades();
    if (!isValidId(userId)) return [];
    const result = await db().query(`
      select id, endpoint, p256dh, auth
      from push_subscriptions
      where user_id = $1
      order by updated_at desc
    `, [userId]);
    return result.rows;
  }

  async function pushNotificationToUser(userId, payload = {}) {
    if (!pushEnabled || !isValidId(userId)) return;
    const subscriptions = await pgListPushSubscriptionsForUserId(userId);
    if (!subscriptions.length) return;
    const body = JSON.stringify({
      title: String(payload.title || "MJ Stock Magic"),
      body: String(payload.body || ""),
      url: String(payload.url || "/"),
      tag: String(payload.type || "info"),
      data: {
        id: String(payload.id || ""),
        url: String(payload.url || "/"),
        createdAt: String(payload.createdAt || "")
      }
    });
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        }, body);
      } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await db().query(`delete from push_subscriptions where id = $1`, [subscription.id]);
          return;
        }
        console.error("Push notification failed:", error?.message || error);
      }
    }));
  }

  async function pgCreateNotificationsForUsers(userNames, payload = {}) {
    await ensurePostgresSchemaUpgrades();
    const normalizedNames = [...new Set((Array.isArray(userNames) ? userNames : [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean))];
    if (!normalizedNames.length) return 0;
    const usersResult = await db().query(`
      select id
      from app_users
      where active = true
        and lower(username) = any($1::text[])
    `, [normalizedNames]);
    if (!usersResult.rows.length) return 0;
    const type = String(payload.type || "info").trim() || "info";
    const title = String(payload.title || "").trim();
    const body = String(payload.body || "").trim();
    const relatedRequestId = isValidId(payload.relatedRequestId) ? String(payload.relatedRequestId) : null;
    const relatedStandingOrderId = isValidId(payload.relatedStandingOrderId) ? String(payload.relatedStandingOrderId) : null;
    const relatedStandingOrderRunId = isValidId(payload.relatedStandingOrderRunId) ? String(payload.relatedStandingOrderRunId) : null;
    const inserted = [];
    for (const row of usersResult.rows) {
      const result = await db().query(`
        insert into app_notifications (
          user_id, notification_type, title, body, related_request_id,
          related_standing_order_id, related_standing_order_run_id
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning id, user_id, notification_type, title, body, created_at
      `, [row.id, type, title, body, relatedRequestId, relatedStandingOrderId, relatedStandingOrderRunId]);
      inserted.push(result.rows[0]);
    }
    if (pushEnabled && inserted.length) {
      await Promise.all(inserted.map((notification) => pushNotificationToUser(notification.user_id, {
        id: notification.id,
        type: notification.notification_type,
        title: notification.title,
        body: notification.body,
        createdAt: notification.created_at,
        url: String(payload.url || "/")
      })));
    }
    return usersResult.rows.length;
  }

  async function pgSavePushSubscription(userName, subscription = {}, userAgent = "") {
    await ensurePostgresSchemaUpgrades();
    if (!pushEnabled) throw new Error("Push notifications are not configured yet.");
    const user = await pgFindAppUserByName(userName);
    if (!user?.id) throw new Error("User not found.");
    const endpoint = String(subscription.endpoint || "").trim();
    const p256dh = String(subscription.keys?.p256dh || "").trim();
    const auth = String(subscription.keys?.auth || "").trim();
    if (!endpoint || !p256dh || !auth) throw new Error("Push subscription is incomplete.");
    await db().query(`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      values ($1, $2, $3, $4, $5)
      on conflict (endpoint) do update
        set user_id = excluded.user_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            user_agent = excluded.user_agent,
            updated_at = now()
    `, [user.id, endpoint, p256dh, auth, String(userAgent || "").slice(0, 400)]);
    return { ok: true };
  }

  async function pgRemovePushSubscription(userName, endpoint = "") {
    await ensurePostgresSchemaUpgrades();
    const user = await pgFindAppUserByName(userName);
    if (!user?.id) throw new Error("User not found.");
    const cleaned = String(endpoint || "").trim();
    if (!cleaned) return { ok: true, removed: 0 };
    const result = await db().query(`
      delete from push_subscriptions
      where user_id = $1 and endpoint = $2
    `, [user.id, cleaned]);
    return { ok: true, removed: result.rowCount || 0 };
  }

  async function pgNotificationUsers(kind, excludeUserName = "", areas = []) {
    await ensurePostgresSchemaUpgrades();
    const exclude = String(excludeUserName || "").trim().toLowerCase();
    const column = kind === "delivery" ? "notify_on_delivery" : "notify_on_new_orders";
    const normalizedAreas = [...new Set((Array.isArray(areas) ? areas : []).map(normalizeNotificationAreaName).filter(Boolean))];
    const result = await db().query(`
      select username, notify_area_bar, notify_area_foh, notify_area_kitchen, notify_area_general
      from app_users
      where active = true and ${column} = true
      order by username
    `);
    return result.rows
      .filter((row) => {
        if (!normalizedAreas.length) return true;
        return normalizedAreas.some((area) => {
          if (area === "bar") return row.notify_area_bar !== false;
          if (area === "foh") return row.notify_area_foh !== false;
          if (area === "kitchen") return row.notify_area_kitchen !== false;
          if (area === "general") return row.notify_area_general !== false;
          return false;
        });
      })
      .map((row) => String(row.username || "").trim())
      .filter((name) => name && name.toLowerCase() !== exclude);
  }

  async function pgAreasForInventoryItemIds(itemIds = []) {
    const cleanIds = [...new Set((Array.isArray(itemIds) ? itemIds : []).filter((itemId) => isValidId(String(itemId || ""))))];
    if (!cleanIds.length) return [];
    const result = await db().query(`
      select distinct ia.name as inventory_area
      from inventory_items i
      left join inventory_areas ia on ia.id = i.inventory_area_id
      where i.id = any($1::uuid[])
    `, [cleanIds]);
    return [...new Set(result.rows.map((row) => normalizeNotificationAreaName(row.inventory_area)).filter(Boolean))];
  }

  return {
    pgListNotificationsForUser,
    pgMarkNotificationsRead,
    pgCreateNotificationsForUsers,
    pgListPushSubscriptionsForUserId,
    pgSavePushSubscription,
    pgRemovePushSubscription,
    pushNotificationToUser,
    pgNotificationUsers,
    pgAreasForInventoryItemIds
  };
}
