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

- Visão Geral (estado da operação, fila de decisão, movimento mensal e procedência).
- Comercial (ativações, cancelamentos e crescimento da base).
- Financeiro (previsão, recebimento e inadimplência da competência).
- Planos (upgrades, downgrades, migrações e catálogo do IXC).
- Exportação real das competências sincronizadas em CSV (pt-BR, com BOM).
- Nenhum bloco demonstrativo publicado: sem snapshot válido, os valores
  aparecem como indisponíveis em vez de zero ou estimativa.
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
O contrato mensal, o estado `partial` de `sync_runs` e o índice por competência
estão em `supabase/migrations/20260826120000_monthly_snapshot_contract.sql`.
O deduplicador da view, a política RLS do snapshot e a leitura restrita do status
de execução estão em `supabase/migrations/20260827130544_dashboard_latest_dedupe.sql`.

## Integração confirmada

Projeto Supabase: `miedecilmohgpmckrxnr` (`sa-east-1`).

Definição operacional verificada no n8n em 31/08/2026:

- nome: `PAINEL - CEO Sync IXC para Supabase (v1)`;
- ID autorizado: `j7DowsRt4EWNb02H`;
- estado: `active=false`; a agenda permanece desativada enquanto a carga
  pós-correção não for homologada;
- export remoto: `36` nós, paginação com Merges em `append`, verificação de
  gravação de KPI e cache de competências financeiras fechadas;
- consulta baseada na [documentação da API do IXC Provedor](https://documenter.getpostman.com/view/40255984/2sAYBbe9Ma).

A definição foi atualizada pela Public API às `09:32:50` no fuso local e a
resposta remota confirmou o mesmo ID, `active=false` e `36` nós. Isso confirma a
publicação da definição; o `sync_run 820` foi validado separadamente no
Supabase e ainda pertence à execução anterior à última atualização do
normalizador.

A tentativa controlada de iniciar a definição pelo endpoint interno do n8n
continua recusada com `401 Unauthorized` e não devolve `executionId`. Ainda
assim, existe uma execução produtiva comprovada no Supabase como `sync_run 820`,
finalizada em `31/08/2026 08:50:23` no fuso local, com estado `partial` e
`writes_verified=true`. Ela trouxe `5.531` contratos com cobertura confirmada,
`36.667` títulos e `121.332` movimentos financeiros, mas os `135` logs de
contrato não continham transição de status comprovável. Portanto, a base atual
é um dado confirmado, enquanto ativações, cancelamentos e o financeiro agregado
continuam corretamente indisponíveis até a nova definição ser executada e
homologada.

No painel, estados `partial`, `unavailable`, `running` e `error` não são
convertidos em KPIs definitivos. Os módulos sem fonte live continuam
identificados como demonstrativos.

### Incidente de infraestrutura — 31/08/2026

Na tentativa de execução manual, a interface do n8n exibiu `Lost connection to
the server`. O navegador registrou queda do WebSocket (`1006`) e respostas
`502` no proxy de telemetria; a API HTTP e o health check oscilaram entre
indisponível e disponível. O canal da interface não permitiu obter um
`executionId`; o `sync_run 820` foi confirmado separadamente no Supabase, não
por esse toast. Esse incidente é do serviço/reverse proxy do n8n e deve ser
resolvido antes de repetir a carga histórica.

### Estado da revisão da leitura executiva — 31/08/2026

- A classificação financeira passou a ser feita por competência: um mês com
  taxa inválida fica `partial` sem invalidar automaticamente os meses que
  possuem totalização válida. O snapshot novo também mantém `sync_run_id` e a
  origem da cobertura para auditoria.
- O painel não mostra mais coortes, filas, tabelas de clientes, regiões,
  motivos ou alertas inventados no HTML como se fossem registros do IXC. Esses
  blocos ficam ocultos até existir um renderer live com evidência; a tela
  apresenta indisponibilidade em vez de zero ou valor ilustrativo.
- A validação local desta revisão terminou em `274/274` testes, build dos dois
  workspaces sem erro, `git diff --check` sem falhas e export do workflow com
  `36` nós, `35` origens de conexão e todos os Code nodes compiláveis.
- A revisão remota do workflow foi reaplicada às `09:32:50` no fuso local com
  export UTF-8 sem mojibake, preservando `active=false`. O frontend local ainda não foi publicado no
  Vercel; portanto, o domínio hospedado pode continuar exibindo a versão
  anterior até um deploy autorizado.

## Artefato aprovado para carga mensal

`tools/create-ixc-ceo-workflow.ps1` prepara o workflow com sete fontes IXC,
listagens `POST` paginadas, janela de 1º de janeiro até o momento da execução,
deduplicação de recebimentos, snapshots mensais em `kpi_snapshots` e contagens
de upgrades, downgrades, saldo e transições de plano em
`breakdown.monthly[YYYY-MM]`. O painel consulta a série do ano vigente e
seleciona a competência mensal pela coluna `period_start`.

O script continua deliberadamente separado da publicação: sem `-Apply`, ele
faz apenas uma consulta de existência e imprime o próximo passo; com um
workflow já existente, também exige `-UpdateExisting`. Ele exige as variáveis
de ambiente da API do n8n e a sessão do Supabase CLI antes de montar o payload.
Antes de executá-lo em homologação, confira os campos reais de pagamento/plano
retornados pelo IXC e revise o payload sanitizado. Não coloque tokens, senhas
ou dados pessoais no arquivo.

O relatório de clientes adimplentes fica separado em
`workflows/ixc-relatorio-adimplentes.json`: ele filtra títulos de mensalidade
pagos até o vencimento, converte datas/valores do formato do IXC, gera XLSX e
prepara o envio para `patrikgentedigital@gmail.com`. O export permanece
`active: false` e ainda exige credenciais IXC/SMTP e um endereço remetente
verificado no n8n antes de qualquer envio real.

Frontend remoto previamente publicado (evidência anterior a esta rodada):
[`painel-resultados-gente-digital.vercel.app`](https://painel-resultados-gente-digital.vercel.app)

O deploy anterior foi verificado com estado `Ready`, contendo o guard de
cobertura de contratos, a consulta mensal e o aviso de fonte. Esta rodada
alterou o código local, incluindo a remoção dos blocos demonstrativos da
leitura visível, mas não publicou um novo deploy web. A migration de
deduplicação/RLS continua pendente de confirmação remota no Supabase. A
tentativa histórica de atualização do workflow em 27/08/2026 foi rejeitada
pelo n8n com HTTP 403 (`Forbidden`) no `PUT` do workflow
`PDcyHWm8vXlcIdwC`; isso não representa o estado atual do workflow
`j7DowsRt4EWNb02H`.

## Limitações conhecidas

- Não há cálculo de lucro: o IXC atual não fornece uma fonte de custos
  confiável para esse indicador.
- A conta do CEO precisa existir no Supabase Auth para a senha ou o link
  funcionarem; sem o e-mail real do usuário não é possível validar a entrega.
- Opa Suite, WhatsApp e ferramentas de monitoramento ainda não estão
  integrados; o painel representa esses módulos como não configurados.
- O artefato local consulta clientes para diagnóstico e reconciliação, mas não
  envia CPF, telefone, e-mail ou payload bruto ao navegador.
- A competência atual pode ser parcial: o indicador usa
  `data_quality.coverage_end` e o painel mostra “Dados parciais” ou “Mês
  parcial” em vez de completar silenciosamente o mês.
- A migration mensal já está aplicada no projeto Supabase remoto; a próxima
  etapa de produção é homologar o payload real do IXC no n8n e revisar os
  avisos de hardening antes de publicar o produtor.
- Retenção, qualidade da conexão/dados, alertas, integrações e administração
  foram removidos do escopo da CEO; o painel publica somente as quatro
  seções executivas com dados do snapshot.
- O detalhamento por título, coortes e tabelas por cliente permanece fora
  desta entrega; o contrato cobre os agregados mensais e a qualidade das fontes.

## Verificação local

Na raiz do workspace:

```powershell
npx.cmd vitest run prototipos/painel-resultados/tests/dashboard.test.ts prototipos/painel-resultados/tests/ceo-dashboard.test.ts
npx.cmd vitest run tools/ixc-ceo-normalizer.test.ts prototipos/painel-resultados/tests/monthly-snapshot-contract.test.ts
node --check prototipos/painel-resultados/dashboard.js

# Apenas depois da revisão humana e com a migration mensal já aplicada:
# powershell.exe -ExecutionPolicy Bypass -File tools/create-ixc-ceo-workflow.ps1
```

Para a operação detalhada, consulte
[`docs/CEO-OPERACAO.md`](docs/CEO-OPERACAO.md).
