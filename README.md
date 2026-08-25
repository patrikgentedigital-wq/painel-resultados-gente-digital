# Painel de Resultados · Gente Digital

Protótipo local de um painel operacional para acompanhar resultados comerciais,
financeiros e de atendimento de uma provedora regional.

## Abrir localmente

Abra `index.html` no navegador ou sirva esta pasta com um servidor HTTP local.

O protótipo usa o logo oficial em `assets/gente-digital-logo.jpg` e mantém a
identidade visual da Gente Digital, com preto, branco e amarelo institucional.

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
- Dados demonstrativos baseados no período de 2026 até julho.

As integrações com IXC Soft, n8n, Supabase, Opa Suite, WhatsApp e ferramentas de
monitoramento ainda não estão conectadas. O painel representa seus estados e o
fluxo esperado, mas não envia credenciais nem realiza chamadas externas.

## Próxima fase

Implementar autenticação, banco histórico, RLS, sincronização idempotente pelo
n8n e leitura autorizada da API do IXC antes de substituir os dados demonstrativos.
