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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanUserSnapshot(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as JsonObject;
  const clean: JsonObject = {};
  for (const key of ["userId", "user_id", "biomax_user_id", "pin", "name", "full_name", "userName"]) {
    const item = source[key];
    if (item !== undefined && item !== null) clean[key] = String(item).slice(0, 160);
  }
  return clean;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "POST required" }, 405);

  const token = request.headers.get("x-gsons-collector-token") ?? "";
  if (token.length < 40 || token.length > 256) return reply({ error: "Collector authentication required" }, 401);

  let body: JsonObject;
  try { body = await request.json() as JsonObject; }
  catch { return reply({ error: "Request body must be JSON" }, 400); }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      const rawKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
      if (rawKeys) { try { serviceKey = JSON.parse(rawKeys)?.default; } catch { /* explicit error below */ } }
    }
    if (!url || !serviceKey) throw new Error("Supabase server credentials are not configured");

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
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

    const serial = String(body.device_serial ?? "").trim();
    if (!serial) return reply({ error: "device_serial is required" }, 400);
    const { data: device, error: deviceError } = await admin
      .from("attendance_devices")
      .select("id, serial_number, is_active")
      .eq("id", tokenRow.device_id)
      .eq("serial_number", serial)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device || !device.is_active) return reply({ error: "Device is inactive or token is assigned to another device" }, 403);

    const now = new Date().toISOString();
    await admin.from("collector_api_tokens").update({ last_used_at: now }).eq("id", tokenRow.id);
    await admin.from("attendance_devices").update({ last_seen_at: now }).eq("id", device.id);

    const action = String(body.action ?? "");
    if (action === "heartbeat") {
      return reply({ ok: true, device: serial, heartbeat: true, server_time: now });
    }

    if (action === "claim_jobs") {
      const limit = Number.isInteger(body.limit) ? Number(body.limit) : 10;
      const workerId = String(body.worker_id ?? "gsons-biomax-collector").slice(0, 120);
      const { data, error } = await admin.rpc("claim_device_sync_jobs", {
        p_device_id: device.id, p_worker_id: workerId, p_limit: Math.max(1, Math.min(limit, 50)),
      });
      if (error) throw error;
      return reply({
        ok: true,
        device: serial,
        jobs: data ?? [],
        note: "A worker must execute and acknowledge a supported BioMax command before reporting a job as completed.",
      });
    }

    if (action === "finish_job") {
      const jobId = String(body.job_id ?? "");
      const status = String(body.status ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(jobId) || !["completed", "failed", "blocked"].includes(status)) {
        return reply({ error: "A valid job_id and status are required" }, 400);
      }
      const { data, error } = await admin.rpc("finish_device_sync_job", {
        p_device_id: device.id,
        p_job_id: jobId,
        p_status: status,
        p_message: String(body.message ?? "").slice(0, 2000) || null,
        p_result: body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result : {},
      });
      if (error) throw error;
      return reply(data as JsonObject);
    }

    if (action === "import_employee") {
      const snapshot = cleanUserSnapshot(body.employee);
      const userId = String(snapshot.userId ?? snapshot.user_id ?? snapshot.biomax_user_id ?? snapshot.pin ?? "").trim();
      const fullName = String(snapshot.full_name ?? snapshot.name ?? snapshot.userName ?? "").trim();
      if (!userId || !fullName) return reply({ error: "Employee import requires BioMax user ID and full name" }, 400);
      const { data, error } = await admin.rpc("apply_biomax_employee", {
        p_device_serial: serial, p_biomax_user_id: userId, p_full_name: fullName, p_raw_payload: snapshot,
      });
      if (error) {
        const conflict = error.message.toLowerCase().includes("already belongs to another profile");
        return reply({ error: error.message }, conflict ? 409 : 400);
      }
      return reply(data as JsonObject);
    }

    return reply({ error: "Unsupported device sync action" }, 400);
  } catch (error) {
    console.error("biomax-device-sync failed", error);
    return reply({ error: error instanceof Error ? error.message : "BioMax synchronization request failed" }, 500);
  }
});
