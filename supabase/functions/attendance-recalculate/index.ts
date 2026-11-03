import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { deriveDailySummaries, localDateOf } from "./engine.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gsons-collector-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}

function getNamedKey(name: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS"): string {
  const parsed = JSON.parse(requiredEnv(name));
  const key = parsed.default ?? Object.values(parsed)[0];
  if (typeof key !== "string" || !key) throw new Error("No default key configured in " + name);
  return key;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function indiaMidnightUtc(date: string): string {
  return new Date(new Date(date + "T00:00:00.000+05:30").getTime()).toISOString();
}

function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.getUTCFullYear() + "-" + String(next.getUTCMonth() + 1).padStart(2, "0")
    + "-" + String(next.getUTCDate()).padStart(2, "0");
}

async function fetchAllPages<T>(makeQuery: () => any): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
    if (offset >= 100000) throw new Error("Query exceeds the safe 100,000-row processing limit");
  }
  return rows;
}

function shiftTimestamp(date: string, time: string, crossesMidnight = false): number {
  const clock = String(time).slice(0, 8);
  const effectiveDate = crossesMidnight ? nextCalendarDate(date) : date;
  return new Date(`${effectiveDate}T${clock}+05:30`).getTime();
}

function positiveWholeMinutes(later: string | number, earlier: number): number {
  const laterMs = typeof later === "number" ? later : Date.parse(later);
  return Math.max(0, Math.floor((laterMs - earlier) / 60000));
}

function policyFields(row: Record<string, any>, assignments: Record<string, any>[], shiftsById: Map<string, Record<string, any>>, existing: Record<string, any> | undefined) {
  const assignment = assignments.find((item) =>
    item.employee_id === row.employee_id
    && item.effective_from <= row.attendance_date
    && (!item.effective_to || item.effective_to >= row.attendance_date)
  );
  const shift = assignment ? shiftsById.get(assignment.shift_id) : undefined;
  let lateMinutes: number | null = null;
  let earlyLeaveMinutes: number | null = null;

  if (shift && row.first_in_at) {
    const start = shiftTimestamp(row.attendance_date, shift.start_time, false);
    lateMinutes = positiveWholeMinutes(row.first_in_at, start + Number(shift.grace_minutes ?? 0) * 60000);
  }
  if (shift && row.last_out_at) {
    const end = shiftTimestamp(row.attendance_date, shift.end_time, Boolean(shift.crosses_midnight));
    earlyLeaveMinutes = positiveWholeMinutes(end, Date.parse(row.last_out_at));
  }

  const manualBreak = existing?.manual_break_minutes ?? null;
  let workingMinutes: number | null = null;
  if (manualBreak != null && row.first_in_at && row.last_out_at) {
    const gross = positiveWholeMinutes(row.last_out_at, Date.parse(row.first_in_at));
    workingMinutes = Math.max(0, gross - Number(manualBreak));
  }

  return {
    ...row,
    late_minutes: lateMinutes,
    early_leave_minutes: earlyLeaveMinutes,
    manual_break_minutes: manualBreak,
    working_minutes: workingMinutes,
    shift_code: shift?.shift_code ?? null,
    break_deduction_mode: shift?.break_deduction_mode ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const publishableKey = getNamedKey("SUPABASE_PUBLISHABLE_KEYS");
    const secretKey = getNamedKey("SUPABASE_SECRET_KEYS");
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: any;
    try {
      body = await req.json();
    } catch {
      return response({ error: "Request body must be valid JSON" }, 400);
    }
    const startDate = body?.start_date;
    const endDate = body?.end_date;
    const action = String(body?.action ?? "preview").toLowerCase();
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      return response({ error: "Provide valid start_date and end_date in YYYY-MM-DD format" }, 400);
    }
    if (action !== "preview" && action !== "apply") {
      return response({ error: "action must be preview or apply" }, 400);
    }
    if (action === "apply" && body?.confirm_apply !== "REBUILD_DERIVED_SUMMARIES") {
      return response({ error: "Applying summaries requires confirm_apply: REBUILD_DERIVED_SUMMARIES" }, 400);
    }

    // Admin users authenticate with their Supabase access token. The collector path
    // is separately authenticated using the device-scoped hashed collector token.
    const collectorToken = req.headers.get("x-gsons-collector-token") ?? "";
    if (collectorToken) {
      if (collectorToken.length < 40 || collectorToken.length > 256) {
        return response({ error: "Invalid collector authentication" }, 401);
      }
      const tokenHash = await sha256Hex(collectorToken);
      const { data: tokenRow, error: tokenError } = await adminClient
        .from("collector_api_tokens")
        .select("id, device_id")
        .eq("token_hash", tokenHash)
        .eq("is_active", true)
        .is("revoked_at", null)
        .maybeSingle();
      if (tokenError) throw tokenError;
      if (!tokenRow) return response({ error: "Collector token is not recognised or has been revoked" }, 401);

      const sourceChannel = String(body?.source_channel ?? "");
      if (!["reconciliation", "realtime_push"].includes(sourceChannel)) {
        return response({ error: "Collector-triggered recalculation is restricted to reconciliation and realtime_push" }, 403);
      }
      if (action !== "apply") {
        return response({ error: "Collector authentication may only apply a completed ingestion refresh" }, 403);
      }
      const deviceSerial = String(body?.device_serial ?? "").trim();
      if (!deviceSerial) return response({ error: "device_serial is required for collector recalculation" }, 400);
      const { data: device, error: deviceError } = await adminClient
        .from("attendance_devices")
        .select("id, serial_number, is_active")
        .eq("id", tokenRow.device_id)
        .eq("serial_number", deviceSerial)
        .maybeSingle();
      if (deviceError) throw deviceError;
      if (!device || !device.is_active) {
        return response({ error: "Collector token is not assigned to this active device" }, 403);
      }

      const [sy, sm, sd] = startDate.split("-").map(Number);
      const [ey, em, ed] = endDate.split("-").map(Number);
      const rangeDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
      if (rangeDays > 31) {
        return response({ error: "Collector-triggered recalculation is limited to 31 calendar days per request" }, 400);
      }
    } else {
      const authHeader = req.headers.get("Authorization") ?? "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) return response({ error: "Authentication required" }, 401);
      const token = match[1];
      const authClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: "Bearer " + token } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData, error: authError } = await authClient.auth.getUser(token);
      if (authError || !authData.user) return response({ error: "Invalid or expired session" }, 401);
      if (authData.user.app_metadata?.role !== "admin") {
        return response({ error: "Only Admin / HR can recalculate attendance" }, 403);
      }
    }

    const { data: employees, error: employeeError } = await adminClient
      .from("employees")
      .select("id, employee_code, biomax_user_id, full_name, employment_status")
      .not("biomax_user_id", "is", null);
    if (employeeError) throw employeeError;

    const rangeStart = indiaMidnightUtc(startDate);
    const rangeEnd = indiaMidnightUtc(nextCalendarDate(endDate));
    const events: Record<string, unknown>[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await adminClient
        .from("raw_punch_events")
        .select("id, employee_id, biomax_user_id, occurred_at, raw_in_out, io_mode")
        .gte("occurred_at", rangeStart)
        .lt("occurred_at", rangeEnd)
        .order("occurred_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      events.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
      if (offset >= 100000) throw new Error("Date range exceeds the safe 100,000-event processing limit");
    }

    const todayLocalDate = localDateOf(new Date(), "Asia/Kolkata");
    const result = deriveDailySummaries(events, employees ?? [], { todayLocalDate });

    const [assignmentRows, shiftRows, adjustmentRows, existingRows] = await Promise.all([
      fetchAllPages<Record<string, any>>(() => adminClient.from("employee_shift_assignments")
        .select("employee_id, shift_id, effective_from, effective_to")
        .lte("effective_from", endDate)
        .or(`effective_to.is.null,effective_to.gte.${startDate}`)),
      fetchAllPages<Record<string, any>>(() => adminClient.from("shifts")
        .select("id, shift_code, start_time, end_time, crosses_midnight, grace_minutes, scheduled_break_minutes, break_deduction_mode, working_days, weekly_off_days")),
      fetchAllPages<Record<string, any>>(() => adminClient.from("attendance_adjustments")
        .select("employee_id, attendance_date, target_punch")
        .gte("attendance_date", startDate)
        .lte("attendance_date", endDate)),
      fetchAllPages<Record<string, any>>(() => adminClient.from("attendance_daily_summaries")
        .select("employee_id, attendance_date, status, working_minutes, late_minutes, early_leave_minutes, manual_break_minutes")
        .gte("attendance_date", startDate)
        .lte("attendance_date", endDate)),
    ]);

    const shiftsById = new Map((shiftRows ?? []).map((shift) => [String(shift.id), shift]));
    const existingByDay = new Map((existingRows ?? []).map((row) => [row.employee_id + "|" + row.attendance_date, row]));
    const policySummaries = result.summaries.map((row: Record<string, any>) =>
      policyFields(row, assignmentRows ?? [], shiftsById, existingByDay.get(row.employee_id + "|" + row.attendance_date))
    );

    if (action === "preview") {
      return response({
        ok: true,
        action: "preview",
        persisted: false,
        date_range: { start_date: startDate, end_date: endDate },
        rule: result.rule,
        time_zone: result.time_zone,
        grouping: result.grouping,
        calculation_version: result.calculation_version,
        totals: result.totals,
        shift_policy: {
          shift_code: "GS-01",
          start_time: "09:30",
          end_time: "18:30",
          grace_minutes: 10,
          scheduled_break_minutes: 60,
          break_deduction_mode: "manual",
          working_days: "Monday-Saturday",
          weekly_off: "Sunday",
        },
        preview_rows: policySummaries.slice(0, 100),
        preview_rows_limit: 100,
        unassigned_event_samples: result.unassigned_events.slice(0, 25),
        invalid_event_samples: result.invalid_events.slice(0, 10),
        note: "Preview only. Raw events were not changed and daily summaries were not written. Net working minutes remain NULL until Admin / HR records an actual manual break.",
      });
    }

    if (result.invalid_events.length > 0) {
      return response({
        error: "Apply stopped because one or more raw events have invalid timestamps or missing identifiers. Review the preview before applying.",
        invalid_event_count: result.invalid_events.length,
      }, 409);
    }

    const protectedDays = new Set<string>();
    for (const row of adjustmentRows ?? []) {
      protectedDays.add(row.employee_id + "|" + row.attendance_date);
    }
    for (const row of existingRows ?? []) {
      if (["leave", "weekly_off", "holiday"].includes(row.status)
        || row.manual_break_minutes != null
        || row.working_minutes != null) {
        protectedDays.add(row.employee_id + "|" + row.attendance_date);
      }
    }

    const rowsToWrite = policySummaries
      .filter((row: Record<string, any>) => row.employee_id && !protectedDays.has(row.employee_id + "|" + row.attendance_date))
      .map((row: Record<string, any>) => ({
        employee_id: row.employee_id,
        attendance_date: row.attendance_date,
        first_in_at: row.first_in_at,
        last_out_at: row.last_out_at,
        working_minutes: row.working_minutes,
        late_minutes: row.late_minutes,
        early_leave_minutes: row.early_leave_minutes,
        status: row.status,
        issue_codes: row.issue_codes,
        calculation_version: row.calculation_version,
        recalculated_at: new Date().toISOString(),
      }));

    let written = 0;
    for (let offset = 0; offset < rowsToWrite.length; offset += 500) {
      const batch = rowsToWrite.slice(offset, offset + 500);
      const { data, error } = await adminClient
        .from("attendance_daily_summaries")
        .upsert(batch, { onConflict: "employee_id,attendance_date" })
        .select("id");
      if (error) throw error;
      written += data?.length ?? batch.length;
    }

    return response({
      ok: true,
      action: "apply",
      persisted: true,
      date_range: { start_date: startDate, end_date: endDate },
      totals: result.totals,
      summaries_written: written,
      protected_days_skipped: protectedDays.size,
      working_minutes_calculated: false,
      note: "Only derived daily summaries were written. Raw biometric events were not changed.",
    });
  } catch (error) {
    console.error("attendance-recalculate failed", error instanceof Error ? error.message : "Unknown error");
    return response({ error: "Attendance recalculation could not be completed. Check the date range and try again." }, 500);
  }
});
