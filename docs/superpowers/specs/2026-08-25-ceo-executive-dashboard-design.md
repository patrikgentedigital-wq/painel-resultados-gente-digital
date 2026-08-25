# Painel Executivo do CEO — Design

## Objetivo

Transformar o protótipo do Painel de Resultados em um cockpit executivo da Gente Digital. O CEO deve conseguir responder, em poucos segundos, se a empresa está crescendo, recebendo, retendo clientes e mantendo a operação saudável, com evidência atualizada pelo IXC Soft via n8n.

## Decisões de produto

- A tela inicial é executiva: números agregados, variação, tendência, qualidade do dado e alertas de decisão.
- O IXC é a fonte operacional; o n8n consulta, pagina, normaliza e calcula; o Supabase persiste snapshots idempotentes; o navegador lê apenas a view agregada.
- Não será exibido “lucro” sem uma fonte de custos. Receita prevista, recebida e em aberto serão identificadas separadamente.
- “Zero registros retornados” não será exibido como zero financeiro saudável. A interface apresentará estado de dados (`ok`, `empty`, `error`, `not_configured`).
- O painel usará dados demonstrativos apenas quando não existir snapshot; quando houver snapshot, cada valor live substituirá o fallback e exibirá a data da origem.
- A autenticação será passwordless por e-mail/OTP, com criação automática de usuário desabilitada. O acesso dependerá de uma conta Supabase já cadastrada; a service role nunca vai para o browser.

## KPIs do Executive Snapshot v1

### Crescimento

- `active_base`: contratos ativos na janela de referência.
- `activations`: ativações identificadas em `ixc_logs`.
- `cancellations`: cancelamentos identificados em `ixc_logs`.
- `net_additions`: ativações menos cancelamentos.
- `churn_rate`: cancelamentos dividido pela base ativa de referência, em percentual.

### Financeiro

- `due_amount`: títulos previstos no período.
- `received_amount`: valor recebido/baixado no período.
- `outstanding_amount`: previsto menos recebido, limitado a zero.
- `collection_rate`: recebido dividido pelo previsto, em percentual.
- `overdue_title_count`: quantidade de títulos vencidos ainda não recebidos.
- `financial_data_state`: estado explícito da consulta financeira.
- `arpu_amount`: recebido dividido pela base ativa quando os dois dados estiverem disponíveis; nulo quando a base financeira não for confiável.

### Operação

- `service_open_count`: O.S. de cliente abertas.
- `service_overdue_count`: O.S. abertas fora da janela esperada quando o IXC fornecer vencimento/status suficiente.
- `support_open_count`: atendimentos de cliente abertos.
- `support_overdue_count`: atendimentos abertos fora da janela esperada quando o IXC fornecer os campos necessários.
- `operational_data_state`: `ok`, `empty`, `error` ou `not_configured`.

### Contexto

- `breakdown.monthly`: ativações, cancelamentos, previsto e recebido por mês.
- `breakdown.alerts`: alertas determinísticos com severidade, título, evidência, área e métrica.
- `data_quality`: contagens por recurso, período consultado, observações e campos ausentes.

## Fontes IXC e escopo de leitura

O workflow usa somente requisições `GET` de listagem documentadas:

- `cliente` para referência de clientes;
- `cliente_contrato` para base ativa e plano/valor quando presente;
- `ixc_logs` para eventos de ativação, cancelamento e alteração;
- `fn_areceber` para títulos previstos e situação de recebimento;
- `fn_movim_finan` para recebimentos/baixas quando disponíveis;
- `su_oss_chamado` para ordens de serviço de cliente;
- `su_ticket` para atendimentos de cliente.

Os campos variam conforme a configuração do IXC. O normalizador usará listas explícitas de aliases, registrará campos ausentes em `data_quality` e nunca converterá uma consulta sem dados em um indicador positivo.

## Segurança e operação

- `sync_runs` e `ixc_events` continuam sem leitura pública direta.
- `dashboard_latest` expõe somente agregados e saúde da última sincronização para `authenticated`.
- O workflow novo será criado como `PAINEL - CEO Sync IXC para Supabase (v1)` e testado sem desativar o `MVP` atual.
- Falhas antes da finalização devem fechar a execução como `error` ou gerar alerta, sem deixar `running` órfão.
- A agenda de validação permanece curta somente até a homologação; depois será ampliada para 30 minutos.
- Falhas e dados incompletos serão visíveis no painel, mas payload bruto e dados pessoais não serão expostos.

## Interface

O overview terá uma composição executiva “Pulso da empresa”:

1. Cabeçalho com período, última sincronização, qualidade da carga e estado do dado.
2. Faixa de tese executiva: crescimento, caixa/recebimento, retenção e operação.
3. Oito cartões de KPI com valor, comparação, estado e origem.
4. Gráfico de tendência mensal real, sem série ilustrativa quando houver breakdown.
5. Fila “Prioridades para decisão” com alertas derivados do snapshot.
6. Páginas secundárias mantidas para financeiro, movimentos, planos, qualidade, alertas e integrações.

A direção visual preserva a marca existente: preto, branco e amarelo institucional, com o amarelo reservado a decisão/ênfase e uma assinatura visual de “linha de pulso” que representa a evolução da base ao longo do tempo.

## Critérios de aceite

- Uma execução do workflow novo grava um snapshot com os novos campos sem quebrar a tabela existente.
- O painel substitui o fallback demonstrativo pelos valores live e mostra “sem dados retornados” quando a consulta financeira vier vazia.
- A view pública retorna o snapshot somente para uma sessão autenticada; tabelas brutas continuam sem leitura direta.
- Um erro de consulta não deixa `sync_runs` em `running` sem diagnóstico.
- Testes do painel cobrem o cálculo/estado de KPI, autenticação OTP em modo controlado, empty state financeiro e alertas.
- A primeira execução real do workflow novo é validada no n8n e no Supabase antes de qualquer troca de workflow ativo.
