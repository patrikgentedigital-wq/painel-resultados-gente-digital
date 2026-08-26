# Painel Executivo · Gente Digital

Painel executivo para o CEO acompanhar crescimento, retenção, recebimentos e
capacidade operacional da Gente Digital. O IXC Soft é a fonte operacional, o
n8n faz a coleta e normalização, o Supabase persiste os snapshots e o navegador
apenas lê os agregados autorizados.

## Abrir localmente

Abra `index.html` no navegador ou sirva esta pasta com um servidor HTTP local.

O protótipo usa o logo oficial em `assets/gente-digital-logo.jpg` e mantém a
identidade visual da Gente Digital, com preto, branco e amarelo institucional.

## Fluxo de dados

```text
IXC Soft → n8n → Supabase → Painel do CEO
```

O painel não grava indicadores e não consulta o IXC diretamente. A cada
sincronização, o n8n grava `sync_runs`, atualiza os eventos idempotentes em
`ixc_events` e atualiza o snapshot do período em `kpi_snapshots`. O frontend
consulta somente `dashboard_latest` depois que a persistência é confirmada.

## Escopo atual

- Visão Geral.
- Ativações e Cancelamentos.
- Financeiro.
- Retenção.
- Planos.
- Qualidade da Conexão.
- Qualidade dos Dados.
- Alertas.
- Integrações e Sincronização.
- Administração.
- Navegação responsiva para desktop, tablet e celular.
- Estados explícitos de dado completo, parcial, indisponível ou com erro;
  consulta sem registros não é transformada em um zero financeiro positivo.
- Login por e-mail e senha no Supabase Auth, com link de uso único como
  alternativa; a criação automática de usuários está desabilitada.
- Leitura somente da view agregada `dashboard_latest` para sessões autenticadas;
  o navegador não recebe a service role, não grava tabelas e não recebe payload
  bruto do IXC.

O schema mínimo do Supabase está em `supabase/migrations/20260825195000_dashboard_sync.sql`.
A correção de saúde pública da view está em
`supabase/migrations/20260825221000_dashboard_public_health.sql`.
Os campos executivos, os estados de qualidade e o fechamento de sincronização
estão em `supabase/migrations/20260825222348_ceo_executive_snapshot.sql`.
O bloqueio explícito do privilégio herdado da view está em
`supabase/migrations/20260825232028_revoke_dashboard_public_grant.sql`.

## Integração confirmada

Projeto Supabase: `miedecilmohgpmckrxnr` (`sa-east-1`).

Workflow operacional no n8n:

- nome: `PAINEL - CEO Sync IXC para Supabase (v1)`;
- ID: `PDcyHWm8vXlcIdwC`;
- estado: ativo;
- agenda de validação: a cada 5 minutos;
- fontes: `ixc_logs`, `fn_areceber`, `cliente_contrato`,
  `fn_movim_finan`, `su_oss_chamado` e `su_ticket`;
- consulta baseada na [documentação da API do IXC Provedor](https://documenter.getpostman.com/view/40255984/2sAYBbe9Ma).

O workflow MVP anterior foi arquivado e está com `active=false`; ele permanece
disponível para rollback sem disputar a agenda com o fluxo definitivo.

A execução real de homologação mais recente terminou com `success`. A
verificação no banco confirmou sincronizações finalizadas, snapshot do período
`2026-01-01` a `2026-08-25`, base ativa de 887 e estado operacional completo.
No período consultado, o IXC não retornou dados financeiros utilizáveis; o
painel exibe isso como `unavailable`, sem apresentar `R$ 0,00` como se fosse
resultado financeiro confirmado.

Frontend publicado em produção:
[`painel-resultados-gente-digital.vercel.app`](https://painel-resultados-gente-digital.vercel.app)

O deploy de produção foi verificado com HTTP 200 e corresponde ao commit
`22dfa86`.

## Limitações conhecidas

- Não há cálculo de lucro: o IXC atual não fornece uma fonte de custos
  confiável para esse indicador.
- A conta do CEO precisa existir no Supabase Auth para a senha ou o link
  funcionarem; sem o e-mail real do usuário não é possível validar a entrega.
- Opa Suite, WhatsApp e ferramentas de monitoramento ainda não estão
  integrados; o painel representa esses módulos como não configurados.
- A consulta de clientes foi mantida fora do primeiro fluxo executivo porque
  não é necessária para os KPIs e o nó opcional ainda não faz parte do
  workflow publicado.

## Verificação local

Na raiz do workspace:

```powershell
npx.cmd vitest run prototipos/painel-resultados/tests/dashboard.test.ts prototipos/painel-resultados/tests/ceo-dashboard.test.ts
node --check prototipos/painel-resultados/dashboard.js
```

Para a operação detalhada, consulte
[`docs/CEO-OPERACAO.md`](docs/CEO-OPERACAO.md).
