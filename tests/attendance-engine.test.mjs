import test from "node:test";
import assert from "node:assert/strict";
import { deriveDailySummaries, localDateOf } from "../supabase/functions/attendance-recalculate/engine.mjs";

const employee = { id: "emp-1", employee_code: "BM-10010", biomax_user_id: "10010", full_name: "Chitra" };
const event = (id, time, extra = {}) => ({
  id,
  employee_id: "emp-1",
  biomax_user_id: "10010",
  occurred_at: time,
  raw_in_out: "IN",
  io_mode: 10,
  ...extra,
});

test("earliest punch is IN and latest is OUT; raw IN label is not trusted", () => {
  const result = deriveDailySummaries([
    event("2", "2026-10-30T12:15:00+05:30"),
    event("1", "2026-10-30T09:00:00+05:30"),
  ], [employee]);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.summaries[0].first_in_at, "2026-10-30T03:30:00.000Z");
  assert.equal(result.summaries[0].last_out_at, "2026-10-30T06:45:00.000Z");
  assert.equal(result.summaries[0].status, "present");
  assert.equal(result.summaries[0].raw_direction_values, "IN");
  assert.equal(result.summaries[0].working_minutes, null);
});

test("intermediate punches are retained", () => {
  const result = deriveDailySummaries([
    event("1", "2026-10-30T09:00:00+05:30"),
    event("2", "2026-10-30T12:00:00+05:30"),
    event("3", "2026-10-30T13:00:00+05:30"),
    event("4", "2026-10-30T18:00:00+05:30"),
  ], [employee]);
  assert.equal(result.summaries[0].punch_count, 4);
  assert.equal(result.summaries[0].intermediate_punch_count, 2);
  assert.ok(result.summaries[0].issue_codes.includes("INTERMEDIATE_PUNCHES_RETAINED"));
});

test("one punch produces no OUT", () => {
  const result = deriveDailySummaries([event("1", "2026-10-30T09:00:00+05:30")], [employee]);
  assert.equal(result.summaries[0].status, "incomplete");
  assert.equal(result.summaries[0].last_out_at, null);
  assert.ok(result.summaries[0].issue_codes.includes("MISSING_OUT"));
});

test("India local date grouping handles UTC midnight", () => {
  assert.equal(localDateOf("2026-10-29T18:45:00.000Z"), "2026-10-30");
  const result = deriveDailySummaries([
    event("1", "2026-10-29T18:45:00.000Z"),
    event("2", "2026-10-30T12:00:00.000Z"),
  ], [employee]);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.summaries[0].attendance_date, "2026-10-30");
});

test("same timestamp events do not fabricate OUT", () => {
  const result = deriveDailySummaries([
    event("1", "2026-10-30T09:00:00+05:30"),
    event("2", "2026-10-30T09:00:00+05:30"),
  ], [employee]);
  assert.equal(result.summaries[0].last_out_at, null);
  assert.equal(result.summaries[0].status, "incomplete");
  assert.ok(result.summaries[0].issue_codes.includes("NON_DISTINCT_PUNCH_TIMES"));
});

test("unmapped device punches are returned separately", () => {
  const result = deriveDailySummaries([
    event("1", "2026-10-30T09:00:00+05:30", { biomax_user_id: "0000", employee_id: null }),
  ], [employee]);
  assert.equal(result.summaries.length, 0);
  assert.equal(result.unassigned_events.length, 1);
});

test("current date is provisional", () => {
  const result = deriveDailySummaries([
    event("1", "2026-11-02T09:00:00+05:30"),
    event("2", "2026-11-02T11:00:00+05:30"),
  ], [employee], { todayLocalDate: "2026-11-02" });
  assert.equal(result.summaries[0].status, "pending");
  assert.equal(result.summaries[0].day_is_provisional, true);
});
