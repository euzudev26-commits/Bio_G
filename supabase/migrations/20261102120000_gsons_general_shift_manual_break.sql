-- GSONS GS-01 general shift and auditable manual break entry
-- Effective from 2025-12-23. Does not populate employees.joined_on.
-- Manual break is never auto-deducted; manual_break_minutes remains NULL until HR records it.

begin;

alter table public.shifts
  add column if not exists scheduled_break_minutes integer not null default 0,
  add column if not exists break_deduction_mode text not null default 'automatic',
  add column if not exists working_days smallint[] not null default array[1,2,3,4,5,6]::smallint[],
  add column if not exists weekly_off_days smallint[] not null default array[7]::smallint[];

alter table public.shifts
  drop constraint if exists shifts_scheduled_break_minutes_check,
  add constraint shifts_scheduled_break_minutes_check check (scheduled_break_minutes between 0 and 720),
  drop constraint if exists shifts_break_deduction_mode_check,
  add constraint shifts_break_deduction_mode_check check (break_deduction_mode in ('automatic','manual')),
  drop constraint if exists shifts_working_week_days_check,
  add constraint shifts_working_week_days_check check (
    cardinality(working_days) > 0
    and working_days <@ array[1,2,3,4,5,6,7]::smallint[]
    and weekly_off_days <@ array[1,2,3,4,5,6,7]::smallint[]
    and not (working_days && weekly_off_days)
  );

alter table public.attendance_daily_summaries
  add column if not exists manual_break_minutes integer,
  add column if not exists manual_break_recorded_by uuid references auth.users(id),
  add column if not exists manual_break_recorded_at timestamptz,
  add column if not exists manual_break_note text;

alter table public.attendance_daily_summaries
  drop constraint if exists attendance_daily_summaries_manual_break_minutes_check,
  add constraint attendance_daily_summaries_manual_break_minutes_check check (
    manual_break_minutes is null or manual_break_minutes between 0 and 720
  ),
  drop constraint if exists attendance_daily_summaries_manual_break_note_check,
  add constraint attendance_daily_summaries_manual_break_note_check check (
    manual_break_note is null or char_length(manual_break_note) <= 500
  );

create or replace function public.record_manual_break(
  p_employee_id uuid,
  p_attendance_date date,
  p_break_minutes integer,
  p_note text,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_old public.attendance_daily_summaries%rowtype;
  v_new public.attendance_daily_summaries%rowtype;
  v_gross_minutes integer;
  v_working_minutes integer;
  v_clean_note text;
begin
  if p_break_minutes is null or p_break_minutes < 0 or p_break_minutes > 720 then
    raise exception 'Break minutes must be between 0 and 720';
  end if;
  if p_actor_user_id is null then
    raise exception 'An authenticated HR/Admin actor is required';
  end if;

  v_clean_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_clean_note is not null and char_length(v_clean_note) > 500 then
    raise exception 'Break note must be 500 characters or fewer';
  end if;

  select * into v_old
  from public.attendance_daily_summaries
  where employee_id = p_employee_id
    and attendance_date = p_attendance_date
  for update;

  if not found then
    raise exception 'Daily attendance summary not found';
  end if;
  if v_old.status in ('leave','weekly_off','holiday') then
    raise exception 'Manual break cannot be recorded for leave, weekly off, or holiday';
  end if;
  if v_old.first_in_at is null or v_old.last_out_at is null then
    raise exception 'Both IN and OUT punches are required before recording a manual break';
  end if;

  v_gross_minutes := floor(extract(epoch from (v_old.last_out_at - v_old.first_in_at)) / 60)::integer;
  if v_gross_minutes < 0 or p_break_minutes > v_gross_minutes then
    raise exception 'Manual break cannot exceed the first-to-last punch span';
  end if;
  v_working_minutes := v_gross_minutes - p_break_minutes;

  update public.attendance_daily_summaries
  set manual_break_minutes = p_break_minutes,
      manual_break_recorded_by = p_actor_user_id,
      manual_break_recorded_at = now(),
      manual_break_note = v_clean_note,
      working_minutes = v_working_minutes,
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  insert into public.attendance_audit_log (
    actor_user_id, employee_id, action, entity_table, entity_id,
    old_values, new_values, note
  ) values (
    p_actor_user_id, p_employee_id, 'manual_break_recorded',
    'attendance_daily_summaries', v_old.id,
    jsonb_build_object(
      'manual_break_minutes', v_old.manual_break_minutes,
      'working_minutes', v_old.working_minutes,
      'manual_break_note', v_old.manual_break_note
    ),
    jsonb_build_object(
      'manual_break_minutes', v_new.manual_break_minutes,
      'working_minutes', v_new.working_minutes,
      'manual_break_note', v_new.manual_break_note,
      'attendance_date', v_new.attendance_date
    ),
    coalesce(v_clean_note, 'Manual break recorded by Admin / HR')
  );

  return jsonb_build_object(
    'employee_id', v_new.employee_id,
    'attendance_date', v_new.attendance_date,
    'manual_break_minutes', v_new.manual_break_minutes,
    'working_minutes', v_new.working_minutes,
    'manual_break_recorded_at', v_new.manual_break_recorded_at
  );
end;
$function$;

revoke all on function public.record_manual_break(uuid,date,integer,text,uuid) from public, anon, authenticated;
grant execute on function public.record_manual_break(uuid,date,integer,text,uuid) to service_role;

insert into public.shifts (
  shift_code, shift_name, start_time, end_time, crosses_midnight,
  grace_minutes, break_minutes, scheduled_break_minutes,
  break_deduction_mode, working_days, weekly_off_days, is_active
) values (
  'GS-01', 'General Day Shift', time '09:30', time '18:30', false,
  10, 0, 60, 'manual',
  array[1,2,3,4,5,6]::smallint[],
  array[7]::smallint[],
  true
)
on conflict (shift_code) do update set
  shift_name = excluded.shift_name,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  crosses_midnight = excluded.crosses_midnight,
  grace_minutes = excluded.grace_minutes,
  break_minutes = 0,
  scheduled_break_minutes = excluded.scheduled_break_minutes,
  break_deduction_mode = excluded.break_deduction_mode,
  working_days = excluded.working_days,
  weekly_off_days = excluded.weekly_off_days,
  is_active = true;

-- Insert only if no existing assignment already covers the effective date.
-- All 32 mapped BioMax profiles receive GS-01; employee joining dates remain unchanged.
with selected_shift as (
  select id from public.shifts where shift_code = 'GS-01'
)
insert into public.employee_shift_assignments (employee_id, shift_id, effective_from, effective_to)
select e.id, s.id, date '2025-12-23', null
from public.employees e
cross join selected_shift s
where e.biomax_user_id is not null
  and not exists (
    select 1
    from public.employee_shift_assignments a
    where a.employee_id = e.id
      and a.effective_from <= date '2025-12-23'
      and (a.effective_to is null or a.effective_to >= date '2025-12-23')
  );

-- Late and early-out minutes are independent of break duration.
-- Net working minutes stay NULL until HR enters an actual manual break.
update public.attendance_daily_summaries d
set late_minutes = case
      when d.first_in_at is null then null
      else greatest(0, floor(extract(epoch from (
        d.first_in_at - ((d.attendance_date + s.start_time + make_interval(mins => s.grace_minutes)) at time zone 'Asia/Kolkata')
      )) / 60)::integer)
    end,
    early_leave_minutes = case
      when d.last_out_at is null then null
      else greatest(0, floor(extract(epoch from (
        ((d.attendance_date + s.end_time) at time zone 'Asia/Kolkata') - d.last_out_at
      )) / 60)::integer)
    end,
    updated_at = now()
from public.employee_shift_assignments a
join public.shifts s on s.id = a.shift_id
where a.employee_id = d.employee_id
  and a.effective_from <= d.attendance_date
  and (a.effective_to is null or a.effective_to >= d.attendance_date)
  and s.shift_code = 'GS-01';

commit;
