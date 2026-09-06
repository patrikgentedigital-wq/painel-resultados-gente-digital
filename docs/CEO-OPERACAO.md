# Operação do painel executivo

## Verificação de 05/09/2026 — publicação e dados

Estado confirmado nesta revisão (substitui as observações históricas abaixo):

- Frontend repaginado publicado em produção, deployment dpl_2swhkpqz3oU5Axd4c8wWDvPUcxWq. HTML, CSS e JavaScript do domínio público conferidos por SHA-256 contra o checkout.
- Visualização autenticada confirmada nas abas Visão geral, Comercial e Financeiro. Layout reorganizado, resumos duplicados removidos, cobertura expansível e transição entre páginas de 240 ms, respeitando redução de movimento.
- Comparação financeira mensal usa somente snapshots até a competência selecionada e mantém valores parciais indisponíveis. Catálogo oficial aparece antes das migrações.
- 306 testes passaram em 23 arquivos. Build do workspace passou. Verificação local em 1440 e 390 pixels, sem erros de JavaScript ou transbordamento horizontal após a adaptação.
- Workflow canônico j7DowsRt4EWNb02H com 36 nodes, ativo=false. Atualização remota confirmada em 2026-09-06T01:03:57.059Z. Coleta de contratos abrange todos os status; base ativa é contada separadamente.
- sync_run 851 concluído como partial; painel autenticado exibiu 12.249 contratos recebidos, 5.561 ativos, 24 ativações e 5 cancelamentos em setembro até 05/09. Financeiro mensal e catálogo de 124 planos recebidos.
- Correção de integridade: foi retirada a inferência reversa de base histórica. Datas de ativação/cancelamento não comprovam todas as reativações e transições. Snapshots de janeiro a agosto do run 851 tiveram active_base, churn_rate e arpu_amount anulados; setembro preservado. Proveniência registra a correção. Guard equivalente confirmado no produtor remoto.
- Permanecem condicionados: base histórica auditável, upgrades/downgrades e prazos operacionais. A agenda não foi ativada. Coleta completa da API não constitui reconciliação com um relatório do IXC de filtros idênticos.

## Histórico das revisões anteriores

### Estado observado anteriormente

O único workflow operacional é:

- `PAINEL - CEO Sync IXC para Supabase (v1)`;
- n8n ID `PDcyHWm8vXlcIdwC`;
- agenda atual de validação: 5 minutos;
- Supabase ref `miedecilmohgpmckrxnr`.

Os itens acima descrevem o estado remoto observado em 27/08/2026, antes da
publicação do artefato mensal.
O produtor local em `tools/create-ixc-ceo-workflow.ps1` usa uma carga diária às
06:00 (`TRIG - CEO diario`), consulta o ano vigente e ainda não foi publicado,
importado ou ativado no n8n remoto.

O workflow `PAINEL - Sync IXC para Supabase (MVP)` foi arquivado e está
inativo. O histórico dele permanece disponível para rollback, mas ele não deve
ser reativado enquanto o workflow CEO estiver operando. O builder legado foi
protegido para não publicar sem a chave `-Apply`.

Frontend em produção:
[`painel-resultados-gente-digital.vercel.app`](https://painel-resultados-gente-digital.vercel.app)

## Ordem obrigatória dos dados

```text
IXC → n8n → Supabase → painel
```

O n8n consulta as fontes IXC, calcula o snapshot e grava:

- `sync_runs`: uma linha por execução, com início, fim, status e diagnóstico;
- `ixc_events`: eventos sanitizados, com upsert idempotente por recurso e ID
  externo;
- `kpi_snapshots`: o retrato agregado do período, com upsert por período.

O navegador nunca grava esses dados. Ele usa a sessão Supabase e lê somente a
view agregada `dashboard_latest`. A migration local mais recente mantém uma
linha vigente por competência e libera ao painel apenas o status sanitizado da
execução; ela ainda precisa ser aplicada no projeto remoto.

## Estados que o CEO pode ver

- `complete`: fonte respondeu e os campos necessários foram encontrados;
- `partial`: a fonte respondeu, mas alguns campos não permitem cálculo completo;
- `unavailable`: nenhum dado confiável foi retornado no período;
- `error`: a consulta ou a transformação apresentou erro.

Financeiro `unavailable` não significa receita zero. Significa que o painel não
tem evidência suficiente para afirmar o valor.

## Migration mensal aplicada

A migration `monthly_snapshot_contract` foi aplicada no projeto Supabase
`miedecilmohgpmckrxnr` e registrada remotamente como
`20260826193802_monthly_snapshot_contract`. A verificação confirmou:

- campos executivos anuláveis quando uma fonte não permite cálculo confiável;
- `sync_runs.status` aceitando `running`, `success`, `partial` e `error`;
- índice por competência mensal;
- `dashboard_latest` concedendo somente `SELECT` a `authenticated`;
- tabelas brutas sem privilégio de leitura para `anon`/`authenticated`.

A migration seguinte, `20260827130544_dashboard_latest_dedupe.sql`, corrige dois
problemas que ainda não estão refletidos no banco remoto observado: duplicidade
de snapshots do mesmo `period_start` e perda do status final de `sync_runs`.
Ela habilita RLS em `kpi_snapshots`, mantém uma única versão vigente por
competência e libera somente `id`, `status` e `finished_at` de `sync_runs` para
o join do painel. Até sua aplicação, considere a view remota antiga como
pendente de hardening.

O advisor de segurança ainda classifica a view como `SECURITY DEFINER`. Esse
é o mecanismo adotado para expor os agregados sem abrir as tabelas brutas; a
decisão deve ser revisada em um hardening posterior caso seja possível migrar
para uma função ou tabela de projeção com o mesmo isolamento.

## Homologação remota anterior

A última execução validada do workflow CEO terminou com `success` e percorreu
todos os nós, incluindo:

1. janela de sincronização;
2. consultas IXC;
3. normalização e cálculo;
4. upsert de eventos;
5. upsert de KPI;
6. finalização do `sync_run`.

Consulta direta ao banco confirmou que o snapshot mais recente tem (a base
abaixo é parcial porque o workflow remoto trouxe somente o primeiro lote de
1.000 contratos):

- período de `2026-01-01` a `2026-08-27`;
- `active_base = 885` dentro dos `1.000` contratos recebidos;
- `activations = 1`;
- `cancellations = 0`;
- `financial_data_state = unavailable`;
- `operational_data_state = complete`;
- `sync_status = success`, embora esse status legado não comprove cobertura
  completa.

Na mesma leitura, `breakdown.monthly` continha somente a competência
`2026-08`, e `plan_data_state` não estava presente. Isso confirma que o
workflow remoto ainda não entrega a série histórica mês a mês nem os planos;
esses dados continuam condicionados à importação e homologação do produtor
mensal local. O painel local já trata esse cenário como parcial e mostra a
cobertura recebida em vez de apresentar `885` como base completa.

Esses números são evidência da carga atual, não uma regra fixa do negócio. A
próxima sincronização pode alterá-los.

## Acesso do CEO

1. Criar o usuário do CEO no Supabase Auth com o e-mail corporativo correto.
2. Manter `requireAuth: true` em `app-config.js`.
3. Abrir o painel e informar o e-mail.
4. Entrar com o e-mail e a senha configurados no Supabase Auth; ou solicitar o link de acesso.
5. Se usar o link, abrir o e-mail “Your sign-in link” e clicar em `Sign in`.
6. Confirmar que a tela carrega o snapshot e a data da última sincronização.

`create_user=false` é usado no pedido do link. Isso impede que qualquer e-mail
crie uma conta automaticamente. A senha, quando usada, é validada diretamente
no Supabase Auth; o navegador não a grava nem a envia para o n8n. O link de uso
único permanece como alternativa.

## Rollback

Se o workflow CEO apresentar erro de fonte ou dados incorretos:

1. pausar o workflow CEO no n8n;
2. revisar `sync_runs` e a execução correspondente;
3. somente se necessário, desarquivar e reativar o MVP antigo;
4. não manter os dois gatilhos ativos simultaneamente;
5. corrigir e validar novamente o fluxo CEO antes de voltar à operação normal.

## Agenda

A agenda remota de 5 minutos existe apenas para homologação e observação
anterior. Com a migration mensal já aplicada, o artefato local foi desenhado
para carga diária às 06:00,
porque uma execução histórica anual a cada 5 minutos repete chamadas e escritas
desnecessárias. Depois da revisão do payload e de uma execução de homologação,
a equipe pode ajustar a frequência conforme a
necessidade operacional.

## Pendências externas

- substituir o workflow ativo `PDcyHWm8vXlcIdwC`: a tentativa automatizada de
  `PUT` em 27/08/2026 retornou HTTP 403 (`Forbidden`) para a chave disponível;
  a leitura posterior confirmou que o workflow não foi alterado;
- aplicar a migration `20260827130544_dashboard_latest_dedupe.sql` no Supabase e
  confirmar a leitura autenticada da view;
- revisar os campos de pagamento e plano devolvidos pelo IXC e importar o
  payload do produtor mensal no n8n antes de publicar/ativar; o builder legado
  agora bloqueia execução sem `-Apply`;
- importar separadamente `workflows/ixc-relatorio-adimplentes.json`, vincular a
  credencial IXC e a credencial SMTP/remetente verificado, executar uma
  homologação para `patrikgentedigital@gmail.com` e só então ativar o envio;
- validação do link de acesso no e-mail real do CEO;
- domínio personalizado, caso a empresa queira substituir o endereço Vercel;
- validação dos indicadores com a área financeira e operacional;
- eventual integração futura com Opa Suite, WhatsApp ou monitoramento;
- fonte de custos caso o painel passe a exibir lucro.
