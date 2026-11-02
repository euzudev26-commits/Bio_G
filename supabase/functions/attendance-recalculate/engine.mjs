export const COMPANY_TIME_ZONE = "Asia/Kolkata";
export const CALCULATION_VERSION = 1;

const dateFormatterCache = new Map();

function getDateFormatter(timeZone) {
  if (!dateFormatterCache.has(timeZone)) {
    dateFormatterCache.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }));
  }
  return dateFormatterCache.get(timeZone);
}

export function localDateOf(value, timeZone = COMPANY_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid event timestamp: " + value);
  const parts = getDateFormatter(timeZone).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function normalizeEvent(event, timeZone) {
  const biomaxUserId = String(event.biomax_user_id ?? event.userId ?? "").trim();
  if (!biomaxUserId) throw new Error("Punch event is missing biomax_user_id");

  const timestampValue = event.occurred_at ?? event.device_time_local ?? event.time;
  let timestamp;
  if (typeof timestampValue === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestampValue)) {
    timestamp = new Date(timestampValue.replace(" ", "T") + "+05:30");
  } else {
    timestamp = new Date(timestampValue);
  }
  if (Number.isNaN(timestamp.getTime())) throw new Error("Invalid event timestamp for BioMax ID " + biomaxUserId);

  return {
    ...event,
    biomax_user_id: biomaxUserId,
    occurred_at: timestamp.toISOString(),
    local_date: localDateOf(timestamp, timeZone),
    raw_in_out: String(event.raw_in_out ?? event.in_out_raw ?? event.inOut ?? "").trim().toUpperCase() || null,
  };
}

/**
 * Earliest event is the derived IN, latest distinct event is the derived OUT.
 * This is calendar-day grouping and intentionally does not pair overnight shifts.
 */
export function deriveDailySummaries(events, employees, options = {}) {
  const timeZone = options.timeZone ?? COMPANY_TIME_ZONE;
  const todayLocalDate = options.todayLocalDate ?? null;
  const employeeByBiomaxId = new Map();
  const employeeById = new Map();

  for (const employee of employees ?? []) {
    const biomaxId = String(employee.biomax_user_id ?? "").trim();
    if (biomaxId) employeeByBiomaxId.set(biomaxId, employee);
    if (employee.id != null) employeeById.set(String(employee.id), employee);
  }

  const grouped = new Map();
  const unassignedEvents = [];
  const invalidEvents = [];

  for (const rawEvent of events ?? []) {
    let event;
    try {
      event = normalizeEvent(rawEvent, timeZone);
    } catch (error) {
      invalidEvents.push({ event: rawEvent, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const byBiomax = employeeByBiomaxId.get(event.biomax_user_id);
    const byEmployeeId = event.employee_id != null ? employeeById.get(String(event.employee_id)) : null;
    const employee = byEmployeeId ?? byBiomax;
    if (!employee) {
      unassignedEvents.push({
        biomax_user_id: event.biomax_user_id,
        occurred_at: event.occurred_at,
        raw_in_out: event.raw_in_out,
        reason: "NO_EMPLOYEE_MAPPING",
      });
      continue;
    }

    const employeeId = String(employee.id ?? employee.employee_code ?? employee.biomax_user_id);
    const key = employeeId + "|" + event.local_date;
    if (!grouped.has(key)) grouped.set(key, { employee, attendanceDate: event.local_date, events: [] });
    grouped.get(key).events.push(event);
  }

  const summaries = [];
  for (const group of grouped.values()) {
    const sorted = group.events.slice().sort((a, b) => {
      const delta = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
      if (delta !== 0) return delta;
      return String(a.id ?? a.row_number ?? "").localeCompare(String(b.id ?? b.row_number ?? ""));
    });

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const sameFirstLastInstant = sorted.length > 1 && first.occurred_at === last.occurred_at;
    const hasReliableOut = sorted.length > 1 && !sameFirstLastInstant;
    const issueCodes = [];
    if (!hasReliableOut) issueCodes.push(sameFirstLastInstant ? "NON_DISTINCT_PUNCH_TIMES" : "MISSING_OUT");
    if (sorted.length > 2) issueCodes.push("INTERMEDIATE_PUNCHES_RETAINED");
    if (todayLocalDate && group.attendanceDate === todayLocalDate) issueCodes.push("CURRENT_DAY_PROVISIONAL");

    const firstMs = Date.parse(first.occurred_at);
    const lastMs = Date.parse(last.occurred_at);
    const spanMinutes = hasReliableOut ? Math.round((lastMs - firstMs) / 60000) : null;
    const rawDirections = [...new Set(sorted.map((event) => event.raw_in_out).filter(Boolean))];
    const ioModes = [...new Set(sorted.map((event) => event.io_mode ?? event.ioMode).filter((value) => value != null).map(String))];

    summaries.push({
      employee_id: group.employee.id ?? null,
      employee_code: group.employee.employee_code ?? null,
      employee_name: group.employee.full_name ?? group.employee.name ?? null,
      biomax_user_id: String(group.employee.biomax_user_id ?? first.biomax_user_id),
      attendance_date: group.attendanceDate,
      punch_count: sorted.length,
      first_in_at: first.occurred_at,
      last_out_at: hasReliableOut ? last.occurred_at : null,
      intermediate_punch_count: Math.max(0, sorted.length - (hasReliableOut ? 2 : 1)),
      first_to_last_span_minutes: spanMinutes,
      raw_direction_values: rawDirections.join("|") || null,
      io_mode_values: ioModes.join("|") || null,
      status: todayLocalDate === group.attendanceDate ? "pending" : (hasReliableOut ? "present" : "incomplete"),
      issue_codes: issueCodes,
      working_minutes: null,
      late_minutes: null,
      early_leave_minutes: null,
      calculation_version: CALCULATION_VERSION,
      rule: "FIRST_PUNCH_IN_LAST_PUNCH_OUT",
      day_is_provisional: Boolean(todayLocalDate && group.attendanceDate === todayLocalDate),
    });
  }

  summaries.sort((a, b) => a.attendance_date.localeCompare(b.attendance_date)
    || a.biomax_user_id.localeCompare(b.biomax_user_id, undefined, { numeric: true }));

  return {
    time_zone: timeZone,
    calculation_version: CALCULATION_VERSION,
    rule: "FIRST_PUNCH_IN_LAST_PUNCH_OUT",
    grouping: "EMPLOYEE_AND_COMPANY_LOCAL_CALENDAR_DATE",
    summaries,
    unassigned_events: unassignedEvents,
    invalid_events: invalidEvents,
    totals: {
      input_events: (events ?? []).length,
      valid_employee_events: summaries.reduce((sum, row) => sum + row.punch_count, 0),
      employee_days: summaries.length,
      present_days: summaries.filter((row) => row.status === "present").length,
      incomplete_days: summaries.filter((row) => row.status === "incomplete").length,
      pending_current_days: summaries.filter((row) => row.status === "pending").length,
      days_with_intermediate_punches: summaries.filter((row) => row.punch_count > 2).length,
      unassigned_events: unassignedEvents.length,
      invalid_events: invalidEvents.length,
    },
  };
}
