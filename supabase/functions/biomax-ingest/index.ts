import { createClient } from "npm:@supabase/supabase-js@2.118.0";

type JsonObject = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-gsons-collector-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function cleanPayload(value: JsonObject): JsonObject {
  const clean: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower.includes("photo") || lower.includes("image") || lower.includes("template") || lower.includes("fingerprint")) continue;
    if (typeof item === "string" && item.length > 100_000) continue;
    clean[key] = item;
  }
  return clean;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function localDeviceTime(value: unknown): { raw: string; iso: string } {
  const text = String(value ?? "").trim();
  if (/^\d{14}$/.test(text)) {
    const y = Number(text.slice(0, 4)), mo = Number(text.slice(4, 6)), d = Number(text.slice(6, 8));
    const h = Number(text.slice(8, 10)), mi = Number(text.slice(10, 12)), s = Number(text.slice(12, 14));
    const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) throw new Error("Invalid device timestamp");
    return { raw: text, iso: new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30, s)).toISOString() };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error("Unrecognised device timestamp");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(parsed);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
  const raw = `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
  return { raw, iso: parsed.toISOString() };
}

function normaliseUserId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!id || id.length > 64) throw new Error("Missing or invalid BioMax user ID");
  return id;
}

function directionFromRaw(value: unknown): "IN" | "OUT" | null {
  const v = String(value ?? "").trim().toUpperCase();
  if (["IN", "CHECK_IN", "CHECK-IN", "0_IN"].includes(v)) return "IN";
  if (["OUT", "CHECK_OUT", "CHECK-OUT", "1_OUT"].includes(v)) return "OUT";
  // Numeric and bitmask values are deliberately preserved as raw values until confirmed on this exact device.
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).slice(0, 120);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);

  const token = req.headers.get("x-gsons-collector-token") ?? "";
  if (token.length < 40 || token.length > 256) return reply({ error: "Collector authentication required" }, 401);

  let body: JsonObject;
  try {
    body = await req.json() as JsonObject;
  } catch {
    return reply({ error: "Request body must be JSON" }, 400);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      const rawKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
      if (rawKeys) {
        try { serviceKey = JSON.parse(rawKeys)?.default; } catch { /* use clear error below */ }
      }
    }
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const tokenHash = await sha256Hex(token);
    const { data: tokenRow, error: tokenError } = await admin
      .from("collector_api_tokens")
      .select("id, device_id")
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .is("revoked_at", null)
      .maybeSingle();
    if (tokenError) throw tokenError;
    if (!tokenRow) return reply({ error: "Collector token is not recognised or has been revoked" }, 401);

    const deviceSerial = String(body.device_serial ?? "").trim();
    if (!deviceSerial) return reply({ error: "device_serial is required" }, 400);
    const { data: device, error: deviceError } = await admin
      .from("attendance_devices")
      .select("id, serial_number, is_active")
      .eq("id", tokenRow.device_id)
      .eq("serial_number", deviceSerial)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device || !device.is_active) return reply({ error: "Device is not active or token is assigned to another device" }, 403);

    const source = String(body.source_channel ?? "historical_import");
    if (!["historical_import", "realtime_push", "manual_import", "reconciliation"].includes(source)) {
      return reply({ error: "Invalid source_channel" }, 400);
    }

    // Heartbeats prove the collector is online without inserting a fake punch or
    // generating a collector_sync_runs row every polling interval.
    if (body.heartbeat === true) {
      if (source !== "reconciliation") return reply({ error: "Heartbeat is reserved for the reconciliation collector" }, 400);
      const now = new Date().toISOString();
      const { error: heartbeatError } = await admin
        .from("attendance_devices")
        .update({ last_seen_at: now })
        .eq("id", device.id);
      if (heartbeatError) throw heartbeatError;
      const { error: tokenTouchError } = await admin
        .from("collector_api_tokens")
        .update({ last_used_at: now })
        .eq("id", tokenRow.id);
      if (tokenTouchError) throw tokenTouchError;
      return reply({ ok: true, heartbeat: true, device: deviceSerial, server_time: now });
    }

    const incoming = Array.isArray(body.events) ? body.events : [body.event ?? body];
    if (!incoming.length || incoming.length > 500) return reply({ error: "Send between 1 and 500 events per batch" }, 400);

    const { data: employeeRows, error: employeesError } = await admin
      .from("employees")
      .select("id, biomax_user_id")
      .not("biomax_user_id", "is", null);
    if (employeesError) throw employeesError;
    const employeeMap = new Map<string, string>();
    for (const e of employeeRows ?? []) {
      const key = String(e.biomax_user_id ?? "").trim();
      if (key) employeeMap.set(key, e.id);
      if (/^\d+$/.test(key)) employeeMap.set(key.replace(/^0+(?=\d)/, ""), e.id);
    }

    const rows: JsonObject[] = [];
    let failed = 0;
    let unmatchedEmployees = 0;
    const errors: string[] = [];

    for (const [index, value] of incoming.entries()) {
      try {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Event must be an object");
        const raw = value as JsonObject;
        const userId = normaliseUserId(raw.userId ?? raw.user_id ?? raw.biomax_user_id ?? raw.pin);
        const time = localDeviceTime(raw.time ?? raw.io_time ?? raw.timestamp ?? raw.occurred_at);
        const rawInOut = raw.inOut ?? raw.in_out ?? raw.punch_direction ?? null;
        const ioMode = numberOrNull(raw.ioMode ?? raw.io_mode);
        const verifyMode = textOrNull(raw.verifyMode ?? raw.verify_mode);
        const doorMode = textOrNull(raw.doorMode ?? raw.door_mode);
        const employeeId = employeeMap.get(userId) ?? employeeMap.get(userId.replace(/^0+(?=\d)/, "")) ?? null;
        if (!employeeId) unmatchedEmployees++;

        const clean = cleanPayload(raw);
        const identity = [
          deviceSerial, userId, time.raw, String(rawInOut ?? ""), String(ioMode ?? ""),
          String(verifyMode ?? ""), String(doorMode ?? ""),
        ].join("|");
        const fingerprint = await sha256Hex(identity);
        const payloadHash = await sha256Hex(JSON.stringify(clean));

        rows.push({
          device_id: device.id,
          device_serial: deviceSerial,
          biomax_user_id: userId,
          employee_id: employeeId,
          device_time_raw: time.raw,
          occurred_at: time.iso,
          source_timezone: "Asia/Kolkata",
          raw_in_out: rawInOut === null ? null : String(rawInOut).slice(0, 120),
          punch_direction: directionFromRaw(rawInOut),
          io_mode: ioMode,
          verify_mode: verifyMode,
          door_mode: doorMode,
          source_channel: source,
          event_fingerprint: fingerprint,
          payload_sha256: payloadHash,
          raw_payload: clean,
        });
      } catch (error) {
        failed++;
        if (errors.length < 10) errors.push(`event ${index + 1}: ${error instanceof Error ? error.message : "invalid event"}`);
      }
    }

    const runType = source === "realtime_push" ? "realtime_forward" : source === "reconciliation" ? "reconciliation" : "historical_import";
    const { data: run, error: runError } = await admin
      .from("collector_sync_runs")
      .insert({ device_id: device.id, run_type: runType, status: "running", records_seen: incoming.length })
      .select("id").single();
    if (runError) throw runError;

    let inserted = 0;
    let insertError: string | null = null;
    if (rows.length) {
      const { count, error } = await admin.from("raw_punch_events")
        .upsert(rows, { onConflict: "event_fingerprint", ignoreDuplicates: true, count: "exact" });
      if (error) insertError = error.message;
      else inserted = count ?? 0;
    }
    if (insertError) failed += rows.length;

    await admin.from("attendance_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
    await admin.from("collector_api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tokenRow.id);

    const duplicateCount = insertError ? 0 : Math.max(0, rows.length - inserted);
    const status = failed ? (inserted || duplicateCount ? "partial" : "failed") : "completed";
    const { error: finishError } = await admin.from("collector_sync_runs").update({
      completed_at: new Date().toISOString(), status,
      records_seen: incoming.length, records_inserted: inserted,
      records_duplicate: duplicateCount, records_failed: failed,
      last_error: insertError ?? (errors.length ? errors.join("; ").slice(0, 2000) : null),
    }).eq("id", run.id);
    if (finishError) throw finishError;

    return reply({
      ok: !insertError && failed === 0,
      device: deviceSerial,
      run_id: run.id,
      records_seen: incoming.length,
      records_valid: rows.length,
      records_inserted: inserted,
      records_duplicate: duplicateCount,
      records_failed: failed,
      employees_unmatched: unmatchedEmployees,
      direction_mapping: "Only explicit IN/OUT text is classified. Numeric and bitmask modes are stored unchanged pending a device-specific verification.",
      errors,
      ...(insertError ? { insert_error: insertError } : {}),
    }, insertError ? 500 : failed ? 422 : 200);
  } catch (error) {
    console.error("biomax-ingest error", error);
    return reply({ error: error instanceof Error ? error.message : "Collector ingestion failed" }, 500);
  }
});
