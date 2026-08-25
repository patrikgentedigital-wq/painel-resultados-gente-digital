-- Views receive a PUBLIC SELECT grant by default in PostgreSQL. The previous
-- migration restricted anon/authenticated but did not remove that inherited
-- grant, so PostgREST could still expose the aggregate view anonymously.
revoke all on table public.dashboard_latest from public;
revoke all on table public.dashboard_latest from anon;
revoke all on table public.dashboard_latest from authenticated;
grant select on table public.dashboard_latest to authenticated;
