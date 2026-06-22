export function createKitchenRosterDomain({
  ensurePostgresSchemaUpgrades,
  db,
  todayIso,
  presentUserName
}) {
  function addDaysIso(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function weekStartIso(value) {
    const raw = String(value || "").trim();
    const source = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayIso();
    const date = new Date(`${source}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return weekStartIso(todayIso());
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return date.toISOString().slice(0, 10);
  }

  function normalizeRosterDate(value, fallback) {
    const raw = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
  }

  async function ensureRosterWeek(weekStart, actorName) {
    await ensurePostgresSchemaUpgrades();
    const actor = presentUserName(actorName || "System") || "System";
    await db().query(`
      insert into kitchen_roster_weeks (week_start, created_by_username)
      values ($1::date, $2)
      on conflict (week_start) do update set updated_at = now()
    `, [weekStart, actor]);

    const existing = await db().query(`
      select count(*)::int as count
      from kitchen_roster_shifts
      where week_start = $1::date
    `, [weekStart]);

    if (!Number(existing.rows[0]?.count || 0)) {
      await db().query(`
        insert into kitchen_roster_shifts (
          week_start, user_id, shift_date, shift_type_id, notes, updated_by_username
        )
        select $1::date,
               prev.user_id,
               ($1::date + ((prev.shift_date - prev.week_start)::int)),
               prev.shift_type_id,
               prev.notes,
               $2
        from kitchen_roster_shifts prev
        where prev.week_start = ($1::date - interval '7 days')::date
        on conflict (week_start, user_id, shift_date) do nothing
      `, [weekStart, actor]);
    }

    await db().query(`
      insert into kitchen_roster_shifts (
        week_start, user_id, shift_date, shift_type_id, notes, updated_by_username
      )
      select $1::date,
             staff.user_id,
             ($1::date + gs.day_offset::int),
             off_shift.id,
             '',
             $2
      from kitchen_staff_vw staff
      cross join generate_series(0, 6) as gs(day_offset)
      cross join lateral (
        select id from kitchen_shift_types where shift_code = 'OFF' limit 1
      ) off_shift
      on conflict (week_start, user_id, shift_date) do nothing
    `, [weekStart, actor]);
  }

  function rosterDays(weekStart) {
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return names.map((label, index) => ({
      label,
      date: addDaysIso(weekStart, index)
    }));
  }

  async function pgListKitchenRoster(date, user = {}) {
    const weekStart = weekStartIso(date);
    await ensureRosterWeek(weekStart, user.name);
    const [shiftTypes, staff, shifts] = await Promise.all([
      db().query(`
        select id, shift_code as code, label, color
        from kitchen_shift_types
        where active = true
        order by sort_order, label
      `),
      db().query(`
        select user_id as id, username, display_name, kitchen_function, function_sort
        from kitchen_staff_vw
        order by function_sort, lower(display_name), lower(username)
      `),
      db().query(`
        select week_start, shift_date, user_id, username, display_name,
               kitchen_function, shift_type_id, shift_code, shift_label, shift_color, notes
        from kitchen_roster_shift_vw
        where week_start = $1::date
        order by function_sort, lower(display_name), shift_date
      `, [weekStart])
    ]);
    return {
      weekStart,
      weekEnd: addDaysIso(weekStart, 6),
      days: rosterDays(weekStart),
      shiftTypes: shiftTypes.rows,
      staff: staff.rows,
      shifts: shifts.rows
    };
  }

  async function pgSaveKitchenRoster(payload, user = {}) {
    const weekStart = weekStartIso(payload.weekStart || payload.date);
    await ensureRosterWeek(weekStart, user.name);
    const actor = presentUserName(user.name || "System") || "System";
    const shifts = Array.isArray(payload.shifts) ? payload.shifts : [];
    const allowedDates = new Set(rosterDays(weekStart).map((day) => day.date));

    for (const shift of shifts) {
      const userId = String(shift.userId || "").trim();
      const shiftTypeId = String(shift.shiftTypeId || "").trim();
      const shiftDate = normalizeRosterDate(shift.shiftDate, weekStart);
      if (!userId || !shiftTypeId || !allowedDates.has(shiftDate)) continue;
      await db().query(`
        insert into kitchen_roster_shifts (
          week_start, user_id, shift_date, shift_type_id, notes, updated_by_username
        )
        values ($1::date, $2::uuid, $3::date, $4::uuid, $5, $6)
        on conflict (week_start, user_id, shift_date) do update
        set shift_type_id = excluded.shift_type_id,
            notes = excluded.notes,
            updated_by_username = excluded.updated_by_username,
            updated_at = now()
      `, [
        weekStart,
        userId,
        shiftDate,
        shiftTypeId,
        String(shift.notes || "").trim(),
        actor
      ]);
    }

    return pgListKitchenRoster(weekStart, user);
  }

  return {
    pgListKitchenRoster,
    pgSaveKitchenRoster
  };
}
