# Attendance calculation v1 — first IN / last OUT

## Rule

For each mapped employee and Asia/Kolkata calendar date:

- Sort the original BioMax events by timestamp.
- Earliest event becomes derived `first_in_at`.
- Latest event becomes derived `last_out_at` only when there are at least two events with distinct timestamps.
- Events between the first and last remain in the raw event table and are counted as intermediate punches; they are not discarded.
- A date with one punch has `first_in_at` set, `last_out_at = null`, status `incomplete`, and issue `MISSING_OUT`.
- Multiple events at the exact same timestamp do not create a fabricated OUT; the date remains `incomplete` with `NON_DISTINCT_PUNCH_TIMES`.
- For the current India-local date, summaries remain `pending` with `CURRENT_DAY_PROVISIONAL`.

The BioMax `inOut` / `raw_in_out` field is preserved for audit, but is not used to derive IN/OUT in this rule.

## Deliberate limits

- Grouping is by employee and local calendar date, not by an assigned shift window. Overnight shifts are not supported in v1.
- `working_minutes`, `late_minutes`, and `early_leave_minutes` remain null. First-to-last span is diagnostic only; it is not net working time and does not deduct breaks.
- No absence rows are generated. Absence requires an approved schedule/shift, weekly-off and holiday calendar.
- Days with approved adjustments are protected from recalculation. Existing `leave`, `weekly_off`, and `holiday` summaries, and summaries with finalized metrics, are protected.
- Unmapped users (including BioMax administrator ID `0000`) are returned separately and are not assigned to an employee.
- No employee with no punch on a date is presumed absent.

## Supabase function

`attendance-recalculate` is Admin-only. Its default action is `preview`; previews never write. The `apply` action requires the exact confirmation value `REBUILD_DERIVED_SUMMARIES` and writes only derived summaries. Raw biometric events are never updated or deleted.

Preview request:

```json
{
  "start_date": "2025-12-23",
  "end_date": "2026-11-02",
  "action": "preview"
}
```

Apply request (only after raw import and preview validation):

```json
{
  "start_date": "2025-12-23",
  "end_date": "2026-11-02",
  "action": "apply",
  "confirm_apply": "REBUILD_DERIVED_SUMMARIES"
}
```

## Historical preview result

The supplied export contains 8,396 rows: 8,380 punches for the 32 mapped employees and 16 punches for BioMax account `0000` (ADMIN). The 8,380 employee punches produce 4,490 employee-days:

- 758 days with one punch (no OUT)
- 3,605 days with two punches
- 127 days with 3–5 punches

This is an offline preview only. No raw punches or summaries have been inserted into Supabase.
