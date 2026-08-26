# Operação do painel executivo

## Estado de produção da integração

O único workflow operacional é:

- `PAINEL - CEO Sync IXC para Supabase (v1)`;
- n8n ID `PDcyHWm8vXlcIdwC`;
- agenda atual de validação: 5 minutos;
- Supabase ref `miedecilmohgpmckrxnr`.

O workflow `PAINEL - Sync IXC para Supabase (MVP)` foi arquivado e está
inativo. O histórico dele permanece disponível para rollback, mas ele não deve
ser reativado enquanto o workflow CEO estiver operando.

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
view agregada `dashboard_latest`.

## Estados que o CEO pode ver

- `complete`: fonte respondeu e os campos necessários foram encontrados;
- `partial`: a fonte respondeu, mas alguns campos não permitem cálculo completo;
- `unavailable`: nenhum dado confiável foi retornado no período;
- `error`: a consulta ou a transformação apresentou erro.

Financeiro `unavailable` não significa receita zero. Significa que o painel não
tem evidência suficiente para afirmar o valor.

## Homologação realizada

A última execução validada do workflow CEO terminou com `success` e percorreu
todos os nós, incluindo:

1. janela de sincronização;
2. consultas IXC;
3. normalização e cálculo;
4. upsert de eventos;
5. upsert de KPI;
6. finalização do `sync_run`.

Consulta direta ao banco confirmou que o snapshot atual tem:

- período de `2026-01-01` a `2026-08-25`;
- `active_base = 887`;
- `activations = 7`;
- `cancellations = 0`;
- `financial_data_state = unavailable`;
- `operational_data_state = complete`;
- `sync_status = success`.

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

A agenda de 5 minutos existe apenas para homologação e observação inicial. Após
confirmar a estabilidade durante o período combinado, ampliar para 30 minutos
reduz chamadas desnecessárias ao IXC e mantém o painel suficientemente atual
para uma visão executiva.

## Pendências externas

- validação do link de acesso no e-mail real do CEO;
- domínio personalizado, caso a empresa queira substituir o endereço Vercel;
- validação dos indicadores com a área financeira e operacional;
- eventual integração futura com Opa Suite, WhatsApp ou monitoramento;
- fonte de custos caso o painel passe a exibir lucro.
