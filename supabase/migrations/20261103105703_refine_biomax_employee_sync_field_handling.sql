-- Refine employee-to-BioMax queue decisions.
-- A name update is a supported USERINFO update even for an already registered
-- inactive employee. GSONS-only field edits are recorded as blocked, not lost.

create or replace function public.enqueue_biomax_employee_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_device_id uuid;
  v_status text := 'pending';
  v_error text := null;
  v_payload jsonb;
  v_existing_job uuid;
  v_changed_fields text[];
  v_supported_changed boolean;
begin
  if current_setting('gsons.sync_origin', true) = 'biomax' then
    return new;
  end if;

  v_changed_fields := array_remove(array[
    case when tg_op = 'INSERT' or old.employee_code is distinct from new.employee_code then 'employee_code' end,
    case when tg_op = 'INSERT' or old.full_name is distinct from new.full_name then 'full_name' end,
    case when tg_op = 'INSERT' or old.biomax_user_id is distinct from new.biomax_user_id then 'biomax_user_id' end,
    case when tg_op = 'INSERT' or old.department is distinct from new.department then 'department' end,
    case when tg_op = 'INSERT' or old.designation is distinct from new.designation then 'designation' end,
    case when tg_op = 'INSERT' or old.email is distinct from new.email then 'email' end,
    case when tg_op = 'INSERT' or old.phone is distinct from new.phone then 'phone' end,
    case when tg_op = 'INSERT' or old.joined_on is distinct from new.joined_on then 'joined_on' end,
    case when tg_op = 'INSERT' or old.employment_status is distinct from new.employment_status then 'employment_status' end
  ], null);

  if coalesce(cardinality(v_changed_fields), 0) = 0 then
    return new;
  end if;

  v_supported_changed :=
    tg_op = 'INSERT'
    or old.full_name is distinct from new.full_name
    or old.biomax_user_id is distinct from new.biomax_user_id;

  select d.id into v_device_id
  from public.attendance_devices d
  where d.serial_number = 'AMDB25093800050'
    and d.is_active
  order by d.created_at
  limit 1;

  if nullif(btrim(coalesce(new.biomax_user_id, '')), '') is null then
    v_status := 'blocked';
    v_error := 'BioMax user ID is required before this employee can be created or updated on the terminal.';
  elsif tg_op = 'UPDATE' and old.biomax_user_id is distinct from new.biomax_user_id then
    v_status := 'blocked';
    v_error := 'BioMax user ID changed. Automatic PIN migration is disabled because removing the old user can delete biometric templates.';
  elsif tg_op = 'UPDATE' and old.employment_status is distinct from new.employment_status then
    v_status := 'blocked';
    v_error := 'Employment status changes are not translated into device deletion or privilege changes. Review on the terminal to preserve biometric enrollment.';
  elsif not v_supported_changed then
    v_status := 'blocked';
    v_error := 'Only GSONS application fields changed. Department, designation, email, phone, joining date and employee code are not BioMax USERINFO fields; those values are saved in GSONS only.';
  elsif tg_op = 'INSERT' and new.employment_status <> 'active' then
    v_status := 'blocked';
    v_error := 'A newly created inactive employee is not automatically registered on BioMax.';
  elsif v_device_id is null then
    v_status := 'blocked';
    v_error := 'No active registered BioMax device was found for this synchronization job.';
  end if;

  v_payload := jsonb_build_object(
    'biomax_user_id', nullif(btrim(coalesce(new.biomax_user_id, '')), ''),
    'full_name', left(btrim(new.full_name), 160),
    'privilege', 0,
    'supported_device_fields', jsonb_build_array('PIN', 'Name', 'Pri'),
    'changed_fields', to_jsonb(v_changed_fields),
    'application_only_fields', jsonb_build_array('employee_code', 'department', 'designation', 'email', 'phone', 'joined_on', 'employment_status'),
    'device_model', 'N-MULTIBIO900',
    'device_serial', 'AMDB25093800050'
  );

  select j.id into v_existing_job
  from public.device_sync_jobs j
  where j.entity_type = 'employee'
    and j.entity_id = new.id
    and j.operation = 'upsert_userinfo'
    and j.status in ('pending', 'blocked')
    and j.device_id is not distinct from v_device_id
  order by j.created_at desc
  limit 1
  for update;

  if v_existing_job is not null then
    update public.device_sync_jobs
    set status = v_status,
        payload = v_payload,
        last_error = v_error,
        available_at = now(),
        updated_at = now(),
        result = null
    where id = v_existing_job;
  else
    insert into public.device_sync_jobs (
      device_id, direction, entity_type, entity_id, operation,
      status, payload, last_error
    ) values (
      v_device_id, 'to_device', 'employee', new.id, 'upsert_userinfo',
      v_status, v_payload, v_error
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists employees_enqueue_biomax_sync on public.employees;
create trigger employees_enqueue_biomax_sync
  after insert or update of employee_code, full_name, biomax_user_id, department, designation, employment_status, email, phone, joined_on
  on public.employees
  for each row
  execute function public.enqueue_biomax_employee_sync();
