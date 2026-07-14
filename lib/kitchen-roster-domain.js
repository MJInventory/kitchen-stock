export function createKitchenRosterDomain({
  assertPostgresSchemaReady,
  db,
  todayIso,
  presentUserName,
  pgRecordAuditEntry
}) {
  const BASE_SHIFT_COLOR_OPTIONS = [
    { value: "#fff1b8", label: "Soft Gold" },
    { value: "#c7f9d4", label: "Mint" },
    { value: "#c7f3f8", label: "Aqua" },
    { value: "#d9ecff", label: "Sky" },
    { value: "#ffd9df", label: "Rose" },
    { value: "#ffe8c7", label: "Peach" },
    { value: "#e9defa", label: "Lavender" },
    { value: "#e5ffc7", label: "Lime" },
    { value: "#e5e7eb", label: "Light Grey" },
    { value: "#ffffff", label: "White" },
    { value: "#fde68a", label: "Honey" },
    { value: "#bfdbfe", label: "Powder Blue" },
    { value: "#fecdd3", label: "Blush" }
  ];
  const SHIFT_GROUPS = new Set(["kitchen", "foh", "bar", "other"]);

  function normalizeHexColor(value) {
    const color = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
  }

  function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const c = (1 - Math.abs((2 * l) - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - (c / 2);
    let red = 0;
    let green = 0;
    let blue = 0;
    if (hue < 60) [red, green, blue] = [c, x, 0];
    else if (hue < 120) [red, green, blue] = [x, c, 0];
    else if (hue < 180) [red, green, blue] = [0, c, x];
    else if (hue < 240) [red, green, blue] = [0, x, c];
    else if (hue < 300) [red, green, blue] = [x, 0, c];
    else [red, green, blue] = [c, 0, x];
    const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  }

  function generatedSpareColor(index) {
    return hslToHex((index * 47) % 360, 68, 88);
  }

  function buildShiftColorOptions(shiftTypes = [], spareCount = 3) {
    const paletteMap = new Map(
      BASE_SHIFT_COLOR_OPTIONS.map((entry) => [normalizeHexColor(entry.value), { value: normalizeHexColor(entry.value), label: entry.label }])
    );
    const usedColors = [];
    const usedKeys = new Set();

    for (const shift of shiftTypes) {
      const color = normalizeHexColor(shift?.color);
      if (!color || usedKeys.has(color)) continue;
      usedKeys.add(color);
      const paletteEntry = paletteMap.get(color);
      usedColors.push({ value: color, label: paletteEntry?.label || color.toUpperCase() });
    }

    const spares = [];
    for (const entry of BASE_SHIFT_COLOR_OPTIONS) {
      const color = normalizeHexColor(entry.value);
      if (!color || usedKeys.has(color)) continue;
      spares.push({ value: color, label: entry.label });
      usedKeys.add(color);
      if (spares.length >= spareCount) break;
    }

    let generatedIndex = 0;
    while (spares.length < spareCount) {
      const color = generatedSpareColor(generatedIndex++);
      if (!color || usedKeys.has(color)) continue;
      spares.push({ value: color, label: `Spare ${spares.length + 1}` });
      usedKeys.add(color);
    }

    return [...usedColors, ...spares];
  }

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

  function normalizeShiftCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  function normalizeShiftGroup(value) {
    const key = String(value || "").trim().toLowerCase();
    return SHIFT_GROUPS.has(key) ? key : "kitchen";
  }

  function normalizeShiftColor(value, fallback = "#c7f9d4") {
    return normalizeHexColor(value) || fallback;
  }

  async function ensureRosterWeek(weekStart, actorName) {
    assertPostgresSchemaReady();
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
    const [week, shiftTypes, staff, shifts] = await Promise.all([
      db().query(`
        select locked, locked_by_username, locked_at
        from kitchen_roster_weeks
        where week_start = $1::date
      `, [weekStart]),
      db().query(`
        select id, code, label, color, shift_group
        from kitchen_shift_type_admin_vw
        where active = true
          and shift_group = 'kitchen'
        order by sort_order, label
      `),
      db().query(`
        select user_id as id, username, display_name, kitchen_function, function_sort
        from kitchen_staff_vw
        order by function_sort, lower(display_name), lower(username)
      `),
      db().query(`
        select week_start, shift_date, user_id, username, display_name,
               kitchen_function, shift_type_id, shift_code, shift_label, shift_color, shift_group, notes
        from kitchen_roster_shift_vw
        where week_start = $1::date
        order by function_sort, lower(display_name), shift_date
      `, [weekStart])
    ]);
    return {
      weekStart,
      weekEnd: addDaysIso(weekStart, 6),
      locked: Boolean(week.rows[0]?.locked),
      lockedBy: week.rows[0]?.locked_by_username || "",
      lockedAt: week.rows[0]?.locked_at || null,
      days: rosterDays(weekStart),
      shiftTypes: shiftTypes.rows,
      staff: staff.rows,
      shifts: shifts.rows
    };
  }

  async function pgSaveKitchenRoster(payload, user = {}) {
    const weekStart = weekStartIso(payload.weekStart || payload.date);
    await ensureRosterWeek(weekStart, user.name);
    const week = await db().query(`
      select locked from kitchen_roster_weeks where week_start = $1::date
    `, [weekStart]);
    if (week.rows[0]?.locked) {
      throw new Error("Roster week is locked. Unlock it before saving changes.");
    }
    const actor = presentUserName(user.name || "System") || "System";
    const shifts = Array.isArray(payload.shifts) ? payload.shifts : [];
    const allowedDates = new Set(rosterDays(weekStart).map((day) => day.date));
    const existing = await db().query(`
      select user_id::text as user_id,
             shift_date::text as shift_date,
             shift_type_id::text as shift_type_id,
             notes
      from kitchen_roster_shifts
      where week_start = $1::date
    `, [weekStart]);
    const existingByCell = new Map(existing.rows.map((row) => [
      `${row.user_id}|${row.shift_date}`,
      {
        userId: String(row.user_id || ""),
        shiftDate: String(row.shift_date || "").slice(0, 10),
        shiftTypeId: String(row.shift_type_id || ""),
        notes: String(row.notes || "")
      }
    ]));
    const changedCells = [];

    for (const shift of shifts) {
      const userId = String(shift.userId || "").trim();
      const shiftTypeId = String(shift.shiftTypeId || "").trim();
      const shiftDate = normalizeRosterDate(shift.shiftDate, weekStart);
      if (!userId || !shiftTypeId || !allowedDates.has(shiftDate)) continue;
      const nextCell = {
        userId,
        shiftDate,
        shiftTypeId,
        notes: String(shift.notes || "").trim()
      };
      const beforeCell = existingByCell.get(`${userId}|${shiftDate}`) || null;
      if (!beforeCell || beforeCell.shiftTypeId !== nextCell.shiftTypeId || beforeCell.notes !== nextCell.notes) {
        changedCells.push({ before: beforeCell, after: nextCell });
      }
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
        nextCell.notes,
        actor
      ]);
    }

    if (changedCells.length) {
      await pgRecordAuditEntry?.({
        actionType: "change",
        entityType: "kitchen-schedule",
        entityId: weekStart,
        entityName: `Kitchen schedule ${weekStart} to ${addDaysIso(weekStart, 6)}`,
        actorUsername: actor,
        reasonCode: "kitchen-roster-update",
        note: `${changedCells.length} schedule ${changedCells.length === 1 ? "cell" : "cells"} changed.`,
        before: { weekStart, cells: changedCells.map((entry) => entry.before) },
        after: { weekStart, cells: changedCells.map((entry) => entry.after) }
      });
    }

    return pgListKitchenRoster(weekStart, user);
  }

  async function pgSetKitchenRosterLocked(payload, user = {}) {
    const weekStart = weekStartIso(payload.weekStart || payload.date);
    await ensureRosterWeek(weekStart, user.name);
    const locked = Boolean(payload.locked);
    const actor = presentUserName(user.name || "System") || "System";
    const previous = await db().query(`
      select locked, locked_by_username, locked_at
      from kitchen_roster_weeks
      where week_start = $1::date
    `, [weekStart]);
    await db().query(`
      update kitchen_roster_weeks
      set locked = $2,
          locked_by_username = case when $2 then $3 else '' end,
          locked_at = case when $2 then now() else null end,
          updated_at = now()
      where week_start = $1::date
    `, [weekStart, locked, actor]);
    const wasLocked = Boolean(previous.rows[0]?.locked);
    if (wasLocked !== locked) {
      await pgRecordAuditEntry?.({
        actionType: "change",
        entityType: "kitchen-schedule",
        entityId: weekStart,
        entityName: `Kitchen schedule ${weekStart} to ${addDaysIso(weekStart, 6)}`,
        actorUsername: actor,
        reasonCode: locked ? "kitchen-roster-lock" : "kitchen-roster-unlock",
        note: locked ? "Kitchen schedule locked." : "Kitchen schedule unlocked.",
        before: {
          weekStart,
          locked: wasLocked,
          lockedBy: previous.rows[0]?.locked_by_username || "",
          lockedAt: previous.rows[0]?.locked_at || null
        },
        after: { weekStart, locked, lockedBy: locked ? actor : "" }
      });
    }
    return pgListKitchenRoster(weekStart, user);
  }

  async function pgListKitchenShiftTypesAdmin() {
    assertPostgresSchemaReady();
    const result = await db().query(`
      select id, code, label, color, shift_group, sort_order, active
      from kitchen_shift_type_admin_vw
      order by sort_order, lower(label), lower(code)
    `);
    return {
      shiftTypes: result.rows,
      colorOptions: buildShiftColorOptions(result.rows)
    };
  }

  async function pgSaveKitchenShiftType(payload, user = {}) {
    assertPostgresSchemaReady();
    const actor = presentUserName(user.name || "System") || "System";
    const id = String(payload.id || "").trim();
    const label = String(payload.label || "").trim();
    const shiftCode = normalizeShiftCode(payload.code || label);
    const shiftGroup = normalizeShiftGroup(payload.shiftGroup);
    const color = normalizeShiftColor(payload.color);
    const sortOrder = Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0;
    const active = payload.active !== false;

    if (!label) throw new Error("Shift label is required.");
    if (!shiftCode) throw new Error("Shift code is required.");

    const result = await db().query(`
      insert into kitchen_shift_types (
        id, shift_code, label, color, shift_group, sort_order, active, updated_at
      )
      values (
        coalesce(nullif($1, '')::uuid, gen_random_uuid()),
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        now()
      )
      on conflict (id) do update
      set shift_code = excluded.shift_code,
          label = excluded.label,
          color = excluded.color,
          shift_group = excluded.shift_group,
          sort_order = excluded.sort_order,
          active = excluded.active,
          updated_at = now()
      returning id
    `, [id, shiftCode, label, color, shiftGroup, sortOrder, active]);

    await db().query(`
      update kitchen_roster_shifts
      set updated_by_username = $2,
          updated_at = now()
      where shift_type_id = $1::uuid
    `, [result.rows[0].id, actor]);

    return pgListKitchenShiftTypesAdmin();
  }

  return {
    pgListKitchenRoster,
    pgSaveKitchenRoster,
    pgSetKitchenRosterLocked,
    pgListKitchenShiftTypesAdmin,
    pgSaveKitchenShiftType
  };
}
