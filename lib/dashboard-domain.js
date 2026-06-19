export function createDashboardDomain({
  ensurePostgresSchemaUpgrades,
  db
}) {
  async function pgGetDashboardSummary(user = {}, options = {}) {
    await ensurePostgresSchemaUpgrades();
    const userName = String(user.name || "").trim().toLowerCase();
    const openOrderDays = Math.max(1, Number(user.settings?.openOrderDays || 7));
    const unreadCount = Math.max(0, Number(options.unreadCount || 0));

    const [requestCountsResult, belowMinimumResult, standingDueResult] = await Promise.all([
      db().query(`
        select
          count(*) filter (
            where request_date = current_date
              and is_standing = false
          ) as dashboard_today_active,
          count(*) filter (
            where requested_by_key = $1
              and is_standing = false
          ) as dashboard_my_open,
          count(*) filter (
            where is_standing = false
              and (
                partial_receipt = true
                or (
                  scheduled_delivery_future = false
                  and request_age_days >= $2
                )
              )
          ) as dashboard_older_open,
          count(*) filter (
            where requested_by_key = $1
              and is_standing = false
          ) as ordering_my_open,
          count(*) filter (
            where requested_by_key <> $1
              and is_standing = false
          ) as ordering_team_open,
          count(*) filter (
            where is_standing = false
              and (
                partial_receipt = true
                or (
                  scheduled_delivery_future = false
                  and request_age_days >= $2
                )
              )
          ) as ordering_older_open
        from order_request_attention_vw
      `, [userName, openOrderDays]),
      db().query(`
        select count(*)::integer as count
        from inventory_below_minimum_vw
      `),
      db().query(`
        select count(*)::integer as count
        from standing_order_due_vw
      `)
    ]);

    const requestCounts = requestCountsResult.rows[0] || {};
    const belowMinimumCount = Number(belowMinimumResult.rows[0]?.count || 0);
    const standingDueCount = Number(standingDueResult.rows[0]?.count || 0);

    return {
      dashboard: {
        today: Number(requestCounts.dashboard_today_active || 0),
        mine: Number(requestCounts.dashboard_my_open || 0),
        older: Number(requestCounts.dashboard_older_open || 0),
        below: belowMinimumCount,
        standing: standingDueCount,
        unread: unreadCount
      },
      ordering: {
        mine: Number(requestCounts.ordering_my_open || 0),
        team: Number(requestCounts.ordering_team_open || 0),
        older: Number(requestCounts.ordering_older_open || 0),
        below: belowMinimumCount,
        standing: standingDueCount
      }
    };
  }

  return {
    pgGetDashboardSummary
  };
}
