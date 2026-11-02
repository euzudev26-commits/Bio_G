import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { deriveDailySummaries, localDateOf } from "./engine.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return response({ error: "Authentication required" }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const publishableKey = getNamedKey("SUPABASE_PUBLISHABLE_KEYS");
    const secretKey = getNamedKey("SUPABASE_SECRET_KEYS");
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

    const body = await req.json();
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

    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
        preview_rows: result.summaries.slice(0, 100),
        preview_rows_limit: 100,
        unassigned_event_samples: result.unassigned_events.slice(0, 25),
        invalid_event_samples: result.invalid_events.slice(0, 10),
        note: "Preview only. Raw events were not changed and daily summaries were not written.",
      });
    }

    // Never overwrite an explicit leave/weekly-off/holiday or an approved correction.
    if (result.invalid_events.length > 0) {
      return response({
        error: "Apply stopped because one or more raw events have invalid timestamps or missing identifiers. Review the preview before applying.",
        invalid_event_count: result.invalid_events.length,
      }, 409);
    }

    const [adjustmentRows, existingRows] = await Promise.all([
      fetchAllPages<Record<string, any>>(() => adminClient.from("attendance_adjustments")
        .select("employee_id, attendance_date, target_punch")
        .gte("attendance_date", startDate)
        .lte("attendance_date", endDate)),
      fetchAllPages<Record<string, any>>(() => adminClient.from("attendance_daily_summaries")
        .select("employee_id, attendance_date, status, working_minutes, late_minutes, early_leave_minutes")
        .gte("attendance_date", startDate)
        .lte("attendance_date", endDate)),
    ]);

    const protectedDays = new Set<string>();
    for (const row of adjustmentRows) {
      protectedDays.add(row.employee_id + "|" + row.attendance_date);
    }
    for (const row of existingRows) {
      if (["leave", "weekly_off", "holiday"].includes(row.status)
        || row.working_minutes != null
        || row.late_minutes != null
        || row.early_leave_minutes != null) {
        protectedDays.add(row.employee_id + "|" + row.attendance_date);
      }
    }

    const rowsToWrite = result.summaries
      .filter((row: Record<string, any>) => row.employee_id && !protectedDays.has(row.employee_id + "|" + row.attendance_date))
      .map((row: Record<string, any>) => ({
        employee_id: row.employee_id,
        attendance_date: row.attendance_date,
        first_in_at: row.first_in_at,
        last_out_at: row.last_out_at,
        working_minutes: null,
        late_minutes: null,
        early_leave_minutes: null,
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
