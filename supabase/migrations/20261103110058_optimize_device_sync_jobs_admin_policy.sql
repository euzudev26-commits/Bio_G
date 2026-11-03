drop policy if exists device_sync_jobs_admin_read on public.device_sync_jobs;

create policy device_sync_jobs_admin_read
  on public.device_sync_jobs
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
