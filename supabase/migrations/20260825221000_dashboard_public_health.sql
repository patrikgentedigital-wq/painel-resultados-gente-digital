-- A view pública agregada pode consultar a saúde da sincronização sem abrir
-- leitura direta de sync_runs ou ixc_events para anon/authenticated.
-- Os campos expostos abaixo não contêm payload bruto, CPF, telefone ou cliente.

create or replace view public.dashboard_latest
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

comment on view public.dashboard_latest is
  'View pública somente com agregados do painel e saúde da última sincronização. As tabelas de eventos e controle continuam sem leitura pública direta.';
