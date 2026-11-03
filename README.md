# GSONS Attendance Management

A responsive React + TypeScript web application for GSONS Industries Private Limited, with separate Admin/HR and Employee portals. The UI uses a light theme and Asia/Kolkata as the company timezone.

## Current implementation status

### Live application and Supabase

- Production application: https://gsons-attendance-management.vercel.app
- Supabase project: `qwjxoncytsiioexwllky`
- Supabase URL: `https://qwjxoncytsiioexwllky.supabase.co`
- Supabase region: `eu-west-1`

The connected database contains employee master data, registered BioMax device information, original punch events, derived daily summaries, correction requests, approved attendance adjustments, collector sync history and an audit log. Row Level Security is enabled on the exposed application tables.

Latest verified project data during development:
- 32 employee profiles.
- 8,436 original raw BioMax punch events.
- 4,511 derived daily attendance summaries.
- One registered active BioMax device: HO_GSONS.

The `attendance-actions` Edge Function is deployed with JWT verification enabled. It supports employee correction submission, Admin/HR approval/rejection, server-side atomic workflows and audit entries. Approved adjustments update derived attendance summaries; they do not mutate original BioMax raw punch events.

The `attendance-recalculate` Edge Function is deployed with Admin-only access. It supports a preview followed by explicit apply confirmation and rebuilds derived summaries only.

### BioMax collector status

The Windows `GSONS-BioMax-Collector V1.1.2` is present on the office PC and has verified read-only access to the registered terminal:
- Device: N-MULTIBIO900 / Multibio 900
- Serial: `AMDB25093800050`
- Firmware: `K8D_3Y3Kbio030_3.2`
- Local address: `192.168.1.241:5005`
- Historical command verified: `GetLogDataPage`
- Real-time event observed: `POST /AIData.aspx` with `request_code: realtime_glog` and `trans_id: RTLogSend`

The installed collector currently downloads historical/rolling punch records and sends them to the existing `biomax-ingest` Edge Function. It is not yet the outbound employee-command worker and does not yet claim or execute the new `device_sync_jobs` queue.

### Two-way synchronization foundation

The Supabase migration `biomax_two_way_sync_foundation` and the follow-up `refine_biomax_employee_sync_field_handling` are applied.

- `device_sync_jobs` stores queued, processing, completed, failed and blocked sync work.
- Changes to employee fields create audited outbound jobs. A stable BioMax PIN and display-name updates are the currently supported USERINFO field scope.
- Changes to application-only fields (employee code, department, designation, email, phone, joining date) are explicitly shown as GSONS-only rather than reported as terminal updates.
- BioMax PIN changes and employment-status changes are blocked for manual review so the system does not delete or recreate users and risk biometric templates.
- A protected server-side import function updates basic employee identity from BioMax and suppresses echo jobs.
- The collector-facing `biomax-device-sync` Edge Function source is in the current feature branch; it must be deployed and connected to a new collector release before outbound jobs can execute on the terminal.

**Important device limitation:** The verified PUSH SDK describes USERINFO update commands, but the attendance-log commands found for this protocol include query and whole-log clear, not individual ATTLOG modification. Approved attendance corrections therefore remain in the GSONS adjustment/audit ledger and are explicitly marked blocked for device write. Never use whole-log clear to simulate a single punch correction.

**Transport safety:** The existing TCP JSON interface on port 5005 has only been verified for read commands such as `GetDeviceInfo` and `GetLogDataPage`. The PUSH command channel is a separate HTTP polling/command-response transport. The current Indigo real-time destination at `192.168.20.252:8092` has not been changed.

### Still required for full two-way device operation

- Deploy the new `biomax-device-sync` Edge Function.
- Update the Windows collector to poll the secure sync API, claim jobs, issue supported USERINFO commands over the correct PUSH transport, and acknowledge jobs only after a successful device response.
- Safely test the PUSH channel on this exact model/firmware while preserving the existing Indigo event route and a rollback plan.
- Add a verified BioMax user-list read/import cycle so additions or name changes made on the terminal are reflected in GSONS.
- Confirm by a controlled test that a GSONS employee-name change appears on the BioMax terminal.
- Provision employee Auth accounts separately; employee master records do not automatically create login accounts.

Until the collector worker and controlled hardware test are complete, the current work is the synchronization foundation—not end-to-end two-way device synchronization.

## Local setup

Requirements: Node.js 22.12+ (or current supported LTS), npm 10+, and an internet connection for the first dependency install.

1. Extract the repository.
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

The SQL source is under `supabase/migrations/`. Applied migrations for the connected project are recorded in Supabase. Do not re-run applied migrations against production; use a separate development project for experiments.

The current sequence includes the initial schema, RLS tuning, correction workflows, collector authentication, shift/manual-break policy, reconciliation source-channel allowance, employee write grants, BioMax two-way sync foundation, and the follow-up employee-sync field handling.

## Authentication and roles

Authorization uses Supabase Auth `app_metadata.role` only. Supported values are `admin` and `employee`. Do not put role claims in user-editable `user_metadata`.

Employee accounts must have `app_metadata.role = 'employee'` and an `employees` row whose `auth_user_id` points to that Auth user. Employee master creation does not create or grant a login account. Do not create a user-facing role editor.

## Project structure

- `src/` — React application, Supabase client and styles.
- `supabase/migrations/` — database migrations.
- `supabase/functions/attendance-actions/` — correction submission/review workflow.
- `supabase/functions/attendance-recalculate/` — derived attendance summary processor.
- `supabase/functions/biomax-ingest/` — device-scoped punch ingestion endpoint.
- `supabase/functions/biomax-device-sync/` — token-authenticated employee-sync queue/import API foundation.
- `database/schema.sql` — consolidated schema reference.
- `docs/` — onboarding and integration notes.
- `docs/biomax-two-way-sync.md` — synchronization design and verified device limits.
- `design-prototype.html` — original clickable design prototype.
