-- GSONS BioMax synchronization foundation.
-- Creates an auditable outbox and trusted import/claim RPCs. No device command
-- is sent by this migration; the local collector must execute acknowledged jobs.

begin;

create table if not exists public.device_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.attendance_devices(id) on delete set null,
  direction text not null check (direction in ('to_device', 'from_device')),
  entity_type text not null check (entity_type in ('employee', 'attendance_adjustment')),
  entity_id uuid,
  operation text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'blocked', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists device_sync_jobs_queue_idx
  on public.device_sync_jobs (device_id, direction, status, available_at, created_at);
create index if not exists device_sync_jobs_entity_idx
  on public.device_sync_jobs (entity_type, entity_id, created_at desc);

alter table public.device_sync_jobs enable row level security;
drop policy if exists device_sync_jobs_admin_read on public.device_sync_jobs;
create policy device_sync_jobs_admin_read on public.device_sync_jobs
  for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant select on public.device_sync_jobs to authenticated;
revoke insert, update, delete on public.device_sync_jobs from anon, authenticated;

create or replace function public.enqueue_biomax_employee_sync()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_device_id uuid;
  v_status text := 'pending';
  v_error text := null;
  v_payload jsonb;
  v_existing_job uuid;
begin
  if current_setting('gsons.sync_origin', true) = 'biomax' then return new; end if;

  if tg_op = 'UPDATE'
     and old.full_name is not distinct from new.full_name
     and old.biomax_user_id is not distinct from new.biomax_user_id
     and old.employment_status is not distinct from new.employment_status then
    return new;
  end if;

  select d.id into v_device_id
  from public.attendance_devices d
  where d.serial_number = 'AMDB25093800050' and d.is_active
  order by d.created_at limit 1;

  if nullif(btrim(coalesce(new.biomax_user_id, '')), '') is null then
    v_status := 'blocked';
    v_error := 'BioMax user ID is required before this employee can be created on the terminal.';
  elsif tg_op = 'UPDATE' and old.biomax_user_id is distinct from new.biomax_user_id then
    v_status := 'blocked';
    v_error := 'BioMax user ID changed. Automatic PIN migration is disabled because removing the old user can delete biometric templates.';
  elsif tg_op = 'UPDATE' and old.employment_status is distinct from new.employment_status then
    v_status := 'blocked';
    v_error := 'Employment status changes are not translated into device deletion. Review on the terminal to preserve biometric enrollment.';
  elsif new.employment_status <> 'active' then
    v_status := 'blocked';
    v_error := 'Only active employees are eligible for a new BioMax user-information update.';
  elsif v_device_id is null then
    v_status := 'blocked';
    v_error := 'No active registered BioMax device was found for this synchronization job.';
  end if;

  v_payload := jsonb_build_object(
    'biomax_user_id', nullif(btrim(coalesce(new.biomax_user_id, '')), ''),
    'full_name', left(btrim(new.full_name), 160),
    'privilege', 0,
    'supported_device_fields', jsonb_build_array('PIN', 'Name', 'Pri'),
    'application_only_fields', jsonb_build_array('employee_code', 'department', 'designation', 'email', 'phone', 'joined_on', 'employment_status'),
    'device_model', 'N-MULTIBIO900',
    'device_serial', 'AMDB25093800050'
  );

  select j.id into v_existing_job
  from public.device_sync_jobs j
  where j.entity_type = 'employee' and j.entity_id = new.id
    and j.operation = 'upsert_userinfo' and j.status in ('pending', 'blocked')
    and j.device_id is not distinct from v_device_id
  order by j.created_at desc limit 1 for update;

  if v_existing_job is not null then
    update public.device_sync_jobs
    set status = v_status, payload = v_payload, last_error = v_error,
        available_at = now(), updated_at = now(), result = null
    where id = v_existing_job;
  else
    insert into public.device_sync_jobs (
      device_id, direction, entity_type, entity_id, operation, status, payload, last_error
    ) values (
      v_device_id, 'to_device', 'employee', new.id, 'upsert_userinfo', v_status, v_payload, v_error
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.enqueue_biomax_employee_sync() from public, anon, authenticated;

drop trigger if exists employees_enqueue_biomax_sync on public.employees;
create trigger employees_enqueue_biomax_sync
  after insert or update of full_name, biomax_user_id, employment_status
  on public.employees for each row
  execute function public.enqueue_biomax_employee_sync();

create or replace function public.record_biomax_attendance_sync_limit()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_device_id uuid;
begin
  select d.id into v_device_id from public.attendance_devices d
  where d.serial_number = 'AMDB25093800050' order by d.created_at limit 1;

  insert into public.device_sync_jobs (
    device_id, direction, entity_type, entity_id, operation, status, payload, last_error
  ) values (
    v_device_id, 'to_device', 'attendance_adjustment', new.id, 'attendance_log_correction', 'blocked',
    jsonb_build_object(
      'employee_id', new.employee_id,
      'attendance_date', new.attendance_date,
      'target_punch', new.target_punch,
      'previous_time', new.previous_time,
      'approved_time', new.approved_time,
      'reason', new.reason,
      'approved_by', new.approved_by
    ),
    'Not sent to BioMax: the verified PUSH SDK command set documents ATTLOG query and whole-log clear, but not an individual ATTLOG update. The approved correction remains active in GSONS.'
  );
  return new;
end;
$function$;
revoke all on function public.record_biomax_attendance_sync_limit() from public, anon, authenticated;

drop trigger if exists attendance_adjustments_biomax_sync_limit on public.attendance_adjustments;
create trigger attendance_adjustments_biomax_sync_limit
  after insert on public.attendance_adjustments for each row
  execute function public.record_biomax_attendance_sync_limit();

create or replace function public.apply_biomax_employee(
  p_device_serial text,
  p_biomax_user_id text,
  p_full_name text,
  p_raw_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_device_id uuid;
  v_employee public.employees%rowtype;
  v_employee_code text;
  v_old_values jsonb;
  v_created boolean := false;
begin
  if p_device_serial <> 'AMDB25093800050' then raise exception 'Unrecognised BioMax device serial'; end if;
  if nullif(btrim(coalesce(p_biomax_user_id, '')), '') is null
     or length(btrim(p_biomax_user_id)) > 64 or btrim(p_biomax_user_id) = '0000' then
    raise exception 'Missing or reserved BioMax user ID';
  end if;
  if nullif(btrim(coalesce(p_full_name, '')), '') is null or length(btrim(p_full_name)) > 160 then
    raise exception 'A valid employee full name is required';
  end if;

  select d.id into v_device_id from public.attendance_devices d
  where d.serial_number = p_device_serial and d.is_active limit 1;
  if v_device_id is null then raise exception 'BioMax device is not registered and active'; end if;

  perform set_config('gsons.sync_origin', 'biomax', true);
  select * into v_employee from public.employees
  where biomax_user_id = btrim(p_biomax_user_id) for update;

  if found then
    v_old_values := jsonb_build_object('full_name', v_employee.full_name, 'employee_code', v_employee.employee_code);
    if v_employee.full_name is distinct from btrim(p_full_name) then
      update public.employees set full_name = btrim(p_full_name)
      where id = v_employee.id returning * into v_employee;
    end if;
  else
    v_employee_code := 'BM-' || btrim(p_biomax_user_id);
    if exists (
      select 1 from public.employees
      where employee_code = v_employee_code and biomax_user_id is distinct from btrim(p_biomax_user_id)
    ) then
      raise exception 'Employee code % already belongs to another profile; manual matching is required', v_employee_code;
    end if;
    insert into public.employees (employee_code, full_name, biomax_user_id, employment_status)
    values (v_employee_code, btrim(p_full_name), btrim(p_biomax_user_id), 'active')
    returning * into v_employee;
    v_created := true;
    v_old_values := null;
  end if;

  insert into public.attendance_audit_log (
    actor_user_id, employee_id, action, entity_table, entity_id, old_values, new_values, note
  ) values (
    null, v_employee.id,
    case when v_created then 'biomax_employee_imported' else 'biomax_employee_refreshed' end,
    'employees', v_employee.id, v_old_values,
    jsonb_build_object('employee_code', v_employee.employee_code, 'full_name', v_employee.full_name, 'biomax_user_id', v_employee.biomax_user_id),
    'Basic employee identity synchronized from BioMax device ' || p_device_serial
  );

  update public.attendance_devices set last_seen_at = now() where id = v_device_id;
  return jsonb_build_object(
    'ok', true, 'employee_id', v_employee.id, 'employee_code', v_employee.employee_code,
    'biomax_user_id', v_employee.biomax_user_id, 'full_name', v_employee.full_name, 'created', v_created
  );
end;
$function$;
revoke all on function public.apply_biomax_employee(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_biomax_employee(text, text, text, jsonb) to service_role;

create or replace function public.claim_device_sync_jobs(
  p_device_id uuid, p_worker_id text default 'gsons-biomax-collector', p_limit integer default 10
) returns setof public.device_sync_jobs
language sql security definer
set search_path = public, pg_temp
as $function$
  with candidates as (
    select j.id from public.device_sync_jobs j
    where j.device_id = p_device_id and j.direction = 'to_device'
      and j.status in ('pending', 'failed') and j.available_at <= now() and j.attempt_count < 8
    order by j.created_at for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.device_sync_jobs j
  set status = 'processing', attempt_count = j.attempt_count + 1,
      claimed_at = now(), claimed_by = left(coalesce(p_worker_id, 'gsons-biomax-collector'), 120),
      updated_at = now()
  from candidates c where j.id = c.id
  returning j.*;
$function$;
revoke all on function public.claim_device_sync_jobs(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_device_sync_jobs(uuid, text, integer) to service_role;

create or replace function public.finish_device_sync_job(
  p_device_id uuid, p_job_id uuid, p_status text,
  p_message text default null, p_result jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_job public.device_sync_jobs%rowtype;
begin
  if p_status not in ('completed', 'failed', 'blocked') then raise exception 'Invalid device synchronization result status'; end if;
  update public.device_sync_jobs
  set status = p_status,
      result = coalesce(p_result, '{}'::jsonb),
      last_error = case when p_status = 'completed' then null else left(coalesce(p_message, 'Device synchronization did not complete'), 2000) end,
      available_at = case when p_status = 'failed' then now() + make_interval(secs => least(900, greatest(60, attempt_count * 60))) else available_at end,
      claimed_at = null, claimed_by = null,
      completed_at = case when p_status = 'completed' then now() else null end,
      updated_at = now()
  where id = p_job_id and device_id = p_device_id and status = 'processing'
  returning * into v_job;
  if not found then raise exception 'No processing synchronization job matches this device and job ID'; end if;
  return jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', v_job.status, 'attempt_count', v_job.attempt_count);
end;
$function$;
revoke all on function public.finish_device_sync_job(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_device_sync_job(uuid, uuid, text, text, jsonb) to service_role;

commit;
