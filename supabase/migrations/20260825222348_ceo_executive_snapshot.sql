-- CEO executive snapshot contract.
--
-- This migration is additive. The browser receives only the aggregate view;
-- IXC payloads, sync metadata and normalized events remain server-side.

alter table public.kpi_snapshots
  add column if not exists active_base integer,
  add column if not exists churn_rate numeric(10, 6),
  add column if not exists collection_rate numeric(10, 6),
  add column if not exists overdue_title_count integer not null default 0,
  add column if not exists arpu_amount numeric(14, 2),
  add column if not exists financial_data_state text not null default 'unavailable',
  add column if not exists service_open_count integer not null default 0,
  add column if not exists service_overdue_count integer not null default 0,
  add column if not exists support_open_count integer not null default 0,
  add column if not exists support_overdue_count integer not null default 0,
  add column if not exists operational_data_state text not null default 'unavailable',
  add column if not exists sync_status text not null default 'success',
  add column if not exists sync_finished_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_active_base_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_active_base_check
      check (active_base is null or active_base >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_churn_rate_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_churn_rate_check
      check (churn_rate is null or (churn_rate >= 0 and churn_rate <= 1));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_collection_rate_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_collection_rate_check
      check (collection_rate is null or (collection_rate >= 0 and collection_rate <= 1));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_overdue_title_count_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_overdue_title_count_check
      check (overdue_title_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_service_open_count_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_service_open_count_check
      check (service_open_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_service_overdue_count_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_service_overdue_count_check
      check (service_overdue_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_support_open_count_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_support_open_count_check
      check (support_open_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_support_overdue_count_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_support_overdue_count_check
      check (support_overdue_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_financial_state_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_financial_state_check
      check (financial_data_state in ('complete', 'partial', 'unavailable', 'error'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_operational_state_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_operational_state_check
      check (operational_data_state in ('complete', 'partial', 'unavailable', 'error'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kpi_snapshots_sync_status_check'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_sync_status_check
      check (sync_status in ('running', 'success', 'partial', 'error'));
  end if;
end
$$;

create index if not exists kpi_snapshots_period_latest_idx
  on public.kpi_snapshots (period_end desc, snapshot_at desc);

-- The aggregate view is intentionally owner-secured: base table SELECT is not
-- granted to browser roles, while the view exposes only non-PII KPI columns.
drop policy if exists kpi_snapshots_public_read on public.kpi_snapshots;
drop policy if exists kpi_snapshots_authenticated_read on public.kpi_snapshots;
alter table public.kpi_snapshots enable row level security;

revoke all on table public.sync_runs from anon, authenticated;
revoke all on table public.ixc_events from anon, authenticated;
revoke all on table public.kpi_snapshots from anon, authenticated;
revoke all on table public.dashboard_latest from anon, authenticated;

drop view if exists public.dashboard_latest;

create view public.dashboard_latest
with (security_invoker = false)
as
select
  k.id,
  k.period_start,
  k.period_end,
  k.snapshot_at,
  k.activations,
  k.cancellations,
  k.net_additions,
  k.active_base,
  k.churn_rate,
  k.due_amount,
  k.received_amount,
  k.outstanding_amount,
  k.collection_rate,
  k.overdue_title_count,
  k.arpu_amount,
  k.activation_ticket,
  k.cancellation_ticket,
  k.upgrades,
  k.downgrades,
  k.plan_delta_amount,
  k.service_open_count,
  k.service_overdue_count,
  k.support_open_count,
  k.support_overdue_count,
  k.breakdown,
  k.data_quality,
  k.financial_data_state,
  k.operational_data_state,
  k.sync_status,
  k.sync_finished_at
from public.kpi_snapshots k
order by k.period_end desc, k.snapshot_at desc;

grant select on public.dashboard_latest to authenticated;

comment on view public.dashboard_latest is
  'Aggregate CEO cockpit view. Authenticated access only; raw IXC events and sync audit data remain server-side.';
