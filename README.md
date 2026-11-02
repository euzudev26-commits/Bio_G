# GSONS Attendance Management

A responsive React + TypeScript web application for GSONS Industries Private Limited, with separate Admin/HR and Employee portals. The UI uses a light theme and Asia/Kolkata as the company timezone.

## Current implementation status

### Connected to Supabase

Project: `qwjxoncytsiioexwllky`  
URL: `https://qwjxoncytsiioexwllky.supabase.co`  
Region: `eu-west-1`

The following database tables have been created and verified with Row Level Security enabled:

- `employees`
- `attendance_devices`
- `shifts`
- `employee_shift_assignments`
- `raw_punch_events`
- `attendance_daily_summaries`
- `attendance_correction_requests`
- `attendance_adjustments`
- `collector_sync_runs`
- `attendance_audit_log`

The `attendance-actions` Edge Function is deployed with JWT verification enabled. It supports:

- Employee correction submission (employee profile is resolved from the authenticated user; clients cannot choose another employee).
- Admin-only correction approval/rejection.
- Server-side atomic database workflows and audit entries.
- Approved adjustments update the derived daily summary, not the original BioMax raw event.

Security verification completed: Supabase security advisor returned no findings. The performance advisor's remaining messages are unused-index informational notices because the new tables currently contain no production rows.

### Not yet complete

- No employee or admin users have been provisioned in Supabase Auth. The known BioMax HO_GSONS device has been registered in the device table.
- 32 provisional employee profiles have been created from BioMax user IDs and device names, using generated `BM-` employee codes. Department and designation remain blank.
- No historical raw punch rows or daily attendance summaries have been imported yet.
- The initial admin account must be set up before the login can be used.
- Employee creation/invitation UI is not yet connected.
- The Windows BioMax collector is not yet built or installed.
- The full BioMax historical export was read locally: 8,396 events across 280 pages. The offline first/last-punch preview maps 8,380 events to 32 employees; 16 `0000` ADMIN events remain unassigned. The preview produces 4,490 employee-days and is not imported.
- The `attendance-recalculate` Edge Function is deployed with JWT verification and Admin-only access. Default action is preview; apply requires explicit confirmation. It writes derived daily summaries only and never mutates raw events.
- Calculation v1 derives earliest punch as IN and latest distinct punch as OUT for each Asia/Kolkata calendar date. Single-punch dates have no OUT. Working minutes, late/early status, absences and overnight shifts are not calculated until shift/break policies are agreed.
- Attendance rules (shift times, weekly off, grace, break and overtime) are not yet configured.
- The app has not been deployed to Vercel or another web host.

Do not treat the current UI as a production-ready attendance system until onboarding, collector integration, shift policies and end-to-end testing are completed.

## Local setup

Requirements: Node.js 22.12+ (or current supported LTS), npm 10+, and an internet connection for the first dependency install.

1. Extract this ZIP.
2. Open a terminal in the project folder.
3. Copy `.env.example` to `.env.local`.
4. Install dependencies:

   ```powershell
   npm install
   ```

5. Start the local web server:

   ```powershell
   npm run dev
   ```

6. Open the local URL printed by Vite (normally `http://localhost:5173`).

Production build:

```powershell
npm run build
```

The publishable key in `.env.example` is browser-safe. Never put a Supabase secret/service-role key in any `VITE_` variable or browser bundle.

## Supabase migrations

The SQL source is under `supabase/migrations/`. It records the schema and follow-up hardening migrations that are already applied to the connected project. `database/schema.sql` is a consolidated schema reference. Do not re-run the migrations against the already-configured project unless you intentionally reset a separate development database.

The migration sequence is:

1. `gsons_attendance_initial_schema`
2. `gsons_attendance_policy_index_hardening`
3. `gsons_attendance_rls_policy_tuning`
4. `gsons_attendance_correction_workflows`
5. `gsons_attendance_apply_approved_adjustment`
6. `gsons_attendance_seed_hogsons_device`
7. `gsons_attendance_lockdown_browser_writes`

## Authentication and roles

Authorization uses Supabase Auth `app_metadata.role` only. Supported values are `admin` and `employee`. Do not put role claims in user-editable `user_metadata`.

Before first login:

1. Create the initial administrator user from Supabase Dashboard → Authentication → Users.
2. In the SQL Editor, assign that Auth user's trusted `app_metadata.role` to `admin` using the email address you created (see `docs/first-admin-setup.md`).
3. Sign in to the app using that administrator account.

Employee accounts must also have `app_metadata.role = 'employee'` and an `employees` row whose `auth_user_id` points to that Auth user. The employee onboarding UI/API is a follow-up build item; do not create a user-facing role editor.

## BioMax facts captured during discovery

- Device name: `HO_GSONS`
- Serial/Cloud ID: `AMDB25093800050`
- Model: `N-MULTIBIO900` / Multibio 900
- Firmware: `K8D_3Y3Kbio030_3.2`
- Local IP observed: `192.168.1.241`
- Historical records: device command `GetLogDataPage`
- Real-time push observed: `POST /AIData.aspx`, `request_code: realtime_glog`, `trans_id: RTLogSend`

The collector must preserve the original raw payload fields and timestamp, remove inline Base64 photo data before JSON storage, optionally upload photo bytes to a private Storage bucket, deduplicate by `event_fingerprint`, and avoid changing device records. The captured device token is intentionally not included in this source package.

## Project structure

- `src/` — React application, Supabase client and styles.
- `supabase/migrations/` — database migrations.
- `supabase/functions/attendance-actions/` — deployed correction workflow Edge Function source.
- `supabase/functions/attendance-recalculate/` — deployed first/last-punch derived-summary processor.
- `database/schema.sql` — consolidated schema reference.
- `docs/` — onboarding and integration notes.
- `design-prototype.html` — original clickable design prototype.
