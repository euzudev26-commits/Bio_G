import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Server configuration is incomplete");

    const authClient = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid or expired session" }, 401);

    const user = authData.user;
    const role = user.app_metadata?.role;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const body = await request.json();

    if (body?.action === "submit-correction") {
      if (role !== "employee" && role !== "admin") return json({ error: "Account is not authorised" }, 403);
      const date = String(body.attendance_date ?? "");
      const punch = String(body.target_punch ?? "").toUpperCase();
      const requested = String(body.requested_time ?? "");
      const reason = String(body.reason ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["IN", "OUT"].includes(punch) || Number.isNaN(Date.parse(requested)) || reason.length < 5 || reason.length > 500) {
        return json({ error: "Please provide a valid date, punch, time and reason (5–500 characters)." }, 400);
      }
      const { data: employee, error: employeeError } = await admin.from("employees").select("id").eq("auth_user_id", user.id).eq("employment_status", "active").maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return json({ error: "No active employee profile is linked to this login." }, 403);
      const { data, error } = await admin.rpc("submit_attendance_correction", {
        p_employee_id: employee.id, p_submitted_by: user.id, p_attendance_date: date,
        p_target_punch: punch, p_requested_time: requested, p_reason: reason,
      });
      if (error) throw error;
      return json({ ok: true, request_id: data });
    }

    if (body?.action === "review-correction") {
      if (role !== "admin") return json({ error: "Only Admin / HR can review requests." }, 403);
      const requestId = String(body.request_id ?? "");
      const decision = String(body.decision ?? "").toLowerCase();
      const note = String(body.admin_note ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(requestId) || !["approved", "rejected"].includes(decision) || (decision === "rejected" && note.length < 3) || note.length > 500) {
        return json({ error: "Please provide a valid request, decision and review note." }, 400);
      }
      const { data, error } = await admin.rpc("review_attendance_correction", {
        p_request_id: requestId, p_reviewer_id: user.id, p_decision: decision, p_admin_note: note || null,
      });
      if (error) throw error;
      return json({ ok: true, decision, result_id: data });
    }
    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("attendance-actions failed", error);
    return json({ error: error instanceof Error ? error.message : "The attendance action could not be completed." }, 500);
  }
});
