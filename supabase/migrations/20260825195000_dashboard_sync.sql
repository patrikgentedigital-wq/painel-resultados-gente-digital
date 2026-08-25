-- Painel de Resultados: persistência mínima para IXC -> n8n -> Supabase.
-- O n8n usa a chave server-side e o navegador só recebe snapshots agregados.

create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  source text not null default 'ixc' check (source in ('ixc')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  records_received integer not null default 0 check (records_received >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sync_runs_started_at_idx
  on public.sync_runs (started_at desc);

create table if not exists public.ixc_events (
  id bigint generated always as identity primary key,
  resource text not null,
  external_id text not null,
  event_type text,
  event_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  source_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sync_run_id bigint references public.sync_runs (id) on delete set null,
  constraint ixc_events_resource_external_id_key unique (resource, external_id)
);

create index if not exists ixc_events_event_at_idx
  on public.ixc_events (event_at desc);

create index if not exists ixc_events_resource_type_idx
  on public.ixc_events (resource, event_type);

create table if not exists public.kpi_snapshots (
  id bigint generated always as identity primary key,
  period_start date not null,
  period_end date not null,
  snapshot_at timestamptz not null default now(),
  activations integer not null default 0 check (activations >= 0),
  cancellations integer not null default 0 check (cancellations >= 0),
  net_additions integer not null default 0,
  due_amount numeric(14, 2) not null default 0,
  received_amount numeric(14, 2) not null default 0,
  outstanding_amount numeric(14, 2) not null default 0,
  activation_ticket numeric(14, 2),
  cancellation_ticket numeric(14, 2),
  upgrades integer not null default 0 check (upgrades >= 0),
  downgrades integer not null default 0 check (downgrades >= 0),
  plan_delta_amount numeric(14, 2) not null default 0,
  breakdown jsonb not null default '{}'::jsonb,
  data_quality jsonb not null default '{}'::jsonb,
  sync_run_id bigint references public.sync_runs (id) on delete set null,
  constraint kpi_snapshots_period_key unique (period_start, period_end),
  constraint kpi_snapshots_period_order check (period_end >= period_start)
);

create index if not exists kpi_snapshots_snapshot_at_idx
  on public.kpi_snapshots (snapshot_at desc);

alter table public.sync_runs enable row level security;
alter table public.ixc_events enable row level security;
alter table public.kpi_snapshots enable row level security;

-- A primeira versão do site é um painel interno sem autenticação Supabase.
-- Somente os agregados do dashboard ficam disponíveis para a chave publicável;
-- eventos brutos e detalhes de execução permanecem server-side.
drop policy if exists kpi_snapshots_public_read on public.kpi_snapshots;
create policy kpi_snapshots_public_read
  on public.kpi_snapshots
  for select
  to anon, authenticated
  using (true);

create or replace view public.dashboard_latest
with (security_invoker = true)
as
select
  k.id,
  k.period_start,
  k.period_end,
  k.snapshot_at,
  k.activations,
  k.cancellations,
  k.net_additions,
  k.due_amount,
  k.received_amount,
  k.outstanding_amount,
  k.activation_ticket,
  k.cancellation_ticket,
  k.upgrades,
  k.downgrades,
  k.plan_delta_amount,
  k.breakdown,
  k.data_quality,
  s.status as sync_status,
  s.finished_at as sync_finished_at
from public.kpi_snapshots k
left join public.sync_runs s on s.id = k.sync_run_id
order by k.period_end desc, k.snapshot_at desc;

grant select on public.dashboard_latest to anon, authenticated;

comment on table public.ixc_events is
  'Eventos normalizados do IXC; leitura somente server-side via n8n/service key.';
comment on table public.kpi_snapshots is
  'Snapshots agregados consumidos pelo painel. Não armazenar CPF, telefone ou payload bruto aqui.';
