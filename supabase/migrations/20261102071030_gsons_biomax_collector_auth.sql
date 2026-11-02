create table if not exists public.collector_api_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists collector_api_tokens_device_idx
  on public.collector_api_tokens(device_id);

alter table public.collector_api_tokens enable row level security;

revoke all on public.collector_api_tokens from public, anon, authenticated;
grant select, insert, update on public.collector_api_tokens to service_role;
