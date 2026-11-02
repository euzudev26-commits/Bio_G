import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Missing " + name);
  return value;
}

function getNamedKey(name: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS"): string {
  const parsed = JSON.parse(requiredEnv(name));
  const key = parsed.default ?? Object.values(parsed)[0];
  if (typeof key !== "string" || !key) throw new Error("No configured key in " + name);
  return key;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!bearer) return response({ error: "Authentication required" }, 401);

    const url = requiredEnv("SUPABASE_URL");
    const publishableKey = getNamedKey("SUPABASE_PUBLISHABLE_KEYS");
    const secretKey = getNamedKey("SUPABASE_SECRET_KEYS");
    const token = bearer[1];

    const authClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Invalid or expired session" }, 401);
    if (authData.user.app_metadata?.role !== "admin") {
      return response({ error: "Only Admin / HR can record manual breaks" }, 403);
    }

    const body = await req.json();
    const employeeId = String(body?.employee_id ?? "");
    const attendanceDate = body?.attendance_date;
    const breakMinutes = body?.manual_break_minutes;
    const note = body?.note == null ? null : String(body.note).trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)) {
      return response({ error: "Valid employee_id is required" }, 400);
    }
    if (!validDate(attendanceDate)) return response({ error: "Valid attendance_date is required (YYYY-MM-DD)" }, 400);
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720) {
      return response({ error: "manual_break_minutes must be an integer from 0 to 720" }, 400);
    }
    if (note && note.length > 500) return response({ error: "Note must be 500 characters or fewer" }, 400);

    const admin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("record_manual_break", {
      p_employee_id: employeeId,
      p_attendance_date: attendanceDate,
      p_break_minutes: breakMinutes,
      p_note: note,
      p_actor_user_id: authData.user.id,
    });
    if (error) return response({ error: error.message || "Unable to record manual break" }, 422);

    return response({ ok: true, result: data, message: "Manual break recorded and audit entry created." });
  } catch (error) {
    console.error("attendance-manual-break error", error instanceof Error ? error.message : "Unknown error");
    return response({ error: "Manual break could not be saved. Check your input and try again." }, 500);
  }
});