-- Give the authenticated Data API role the table privileges needed to reach
-- the existing employee Admin-only RLS policies.
-- Intentionally do not grant DELETE or access to anon/service_role.
GRANT INSERT, UPDATE ON TABLE public.employees TO authenticated;
