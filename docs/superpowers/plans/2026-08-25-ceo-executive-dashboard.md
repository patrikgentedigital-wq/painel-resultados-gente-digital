# CEO Executive Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute this plan.

**Goal:** Transform the existing Gente Digital results panel into a CEO-oriented executive cockpit backed by IXC Soft, n8n and Supabase, with explicit data-quality states, financial/operational KPIs, authenticated aggregate access and a separately validated synchronization workflow.

**Architecture:** IXC remains the operational source of truth. A new read-only n8n workflow collects the documented IXC list endpoints, normalizes records into a narrow KPI contract, writes a sync audit row plus aggregate snapshots to Supabase, and exposes only the authenticated aggregate view to the browser. The old MVP workflow remains active until the new workflow has completed a real validation run; the browser never receives IXC credentials or a Supabase service-role key.

**Tech Stack:** Static HTML/CSS/JavaScript, Vitest, Supabase Postgres/RLS/REST/Auth, n8n REST/UI, IXC Soft documented GET endpoints, PowerShell helper scripts.

**Spec:** `docs/superpowers/specs/2026-08-25-ceo-executive-dashboard-design.md`

## Global Constraints

- Work only inside `prototipos/painel-resultados` for application changes; preserve unrelated parent-repository work.
- Use `apply_patch` for source edits and migrations. Use the Supabase CLI to create migration filenames before editing them.
- Follow TDD for executable application logic: add a failing test, run it red, implement the smallest change, then run the focused test and the full suite.
- IXC calls remain read-only GET list requests; do not introduce POST/PUT/DELETE calls to operational IXC resources.
- Do not expose `service_role`, IXC Basic Auth, n8n API keys, or CEO credentials in browser code, committed files, logs, or final responses.
- Keep the existing active MVP workflow intact until the CEO workflow has passed a real execution and Supabase verification.
- Treat “profit” as unavailable until a cost source is connected; show data states instead of inventing zeroes.
- Do not claim production readiness from a build alone; verify browser -> REST/Auth -> Supabase data and n8n execution evidence.

## Task 1: Lock the data contract with regression tests

**Files:** `tests/ceo-dashboard.test.ts`, `tests/dashboard.test.ts`

1. Add failing tests for the executive snapshot contract: active base, churn, collection rate, overdue titles, open/overdue O.S., open/overdue support, `financial_data_state`, `operational_data_state`, and data-quality messaging.
2. Add a failing test for the empty/partial state: financial and operational cards must say unavailable/awaiting source rather than display a misleading `R$ 0,00` or `0%`.
3. Run the focused Vitest file and record the expected red failure.

## Task 2: Extend Supabase additively and secure the aggregate surface

**Files:** `supabase/migrations/<generated>_ceo_executive_snapshot.sql`, `tests/sql/ceo_snapshot_contract.sql`

1. Create the migration filename using `npx.cmd --yes supabase@latest migration new ceo_executive_snapshot`.
2. Add the CEO KPI columns and constraints to `public.kpi_snapshots` without dropping or renaming existing columns, including explicit state fields and source-quality metadata.
3. Add indexes needed for latest-period reads and sync audit inspection.
4. Replace the public aggregate policy/view with an authenticated-only aggregate surface. Keep raw `sync_runs`, `ixc_events` and `kpi_snapshots` inaccessible to anonymous browser reads; grant only the minimum authenticated SELECT needed by the panel.
5. Apply the migration to the already-confirmed Supabase project `miedecilmohgpmckrxnr`, then run the SQL contract checks and an authenticated/anonymous REST smoke test.

## Task 3: Implement the executive snapshot presentation through tests

**Files:** `dashboard.js`, `index.html`, `styles.css` or the existing stylesheet file, `app-config.js`, `tests/ceo-dashboard.test.ts`

1. Implement the smallest pure mapping/formatting helpers required by the new tests.
2. Replace demo values in the primary CEO view with live aggregate fields and explicit empty/partial/error states.
3. Add the active-base/churn, collection/overdue, and operation backlog signals without turning the page into a dense operational dashboard.
4. Keep the Gente Digital logo and black/white/yellow identity; preserve focus states, responsive layout, reduced-motion behavior, and the existing secondary pages.
5. Add a real email OTP login flow against Supabase Auth: request OTP, exchange the returned session, refresh on reload, sign out, and handle expired/invalid sessions. Do not add password login or a public user-creation form.
6. Make the app fail closed when the aggregate view requires authentication; do not silently fall back to demo data after an authenticated production error.
7. Run focused tests, `node --check dashboard.js`, and the complete Vitest suite.

## Task 4: Build the separate CEO n8n workflow

**Files:** `tools/create-ixc-ceo-workflow.ps1`, `README.md`

1. Add a helper that creates `PAINEL - CEO Sync IXC para Supabase (v1)` only when it does not already exist, using the existing verified IXC credential and Supabase service credential IDs without printing secrets.
2. Include documented read-only IXC GET sources for clients/contracts/logs, receivables, receipts, O.S. and support tickets, with bounded date/window parameters and the existing pagination safeguards.
3. Normalize the source responses into the new contract, including base/churn derivation, financial completeness state, operational backlog state, monthly breakdown and sanitized diagnostics; never persist PII.
4. Preserve idempotency by source/window and close failed/partial runs with an explicit error state where the n8n node semantics permit it.
5. Configure a validation schedule of five minutes only for the validation window; document the intended production interval of thirty minutes.
6. Run static checks over the generated workflow payload and confirm the old workflow remains active.

## Task 5: Publish and validate the workflow through the authenticated n8n UI

**Files:** no committed source change; update `README.md` with evidence

1. Create the new workflow through the n8n API/helper and open it in the authenticated n8n UI.
2. Publish it through the UI, because the current n8n API token can read/create but the activation/publish mutation is forbidden.
3. Run one manual execution and wait for completion.
4. Verify n8n execution status, Supabase `sync_runs`, snapshot counts/fields, and the authenticated aggregate endpoint. If the workflow fails, leave the old MVP active and diagnose before switching.
5. Only after a successful real run, set the new workflow as the operational workflow and deactivate the old schedule through the UI; do not leave two production schedules active.

## Task 6: Verify, document and prepare release

**Files:** `README.md`, `docs/CEO-OPERACAO.md`, `tests/`

1. Add the CEO operating guide: KPI definitions, source limitations, financial/operational data states, sync cadence, alert interpretation, auth onboarding, rollback and known pending integrations.
2. Run the complete verification set: unit tests, syntax checks, Supabase SQL/REST smoke tests, n8n execution evidence, and a browser smoke test of login -> dashboard -> refresh -> logout.
3. Inspect the final diff and ensure no secret, PII, demo credential or unrelated parent-repository file entered the panel repository.
4. Commit only the panel-repository changes with a focused message after verification; push/deploy only the verified panel branch and report GitHub/hosting evidence separately from local evidence.

## Self-review checklist

- [ ] The CEO view answers growth, retention, money and operation questions in the first screen.
- [ ] No unsupported profit or ARPU number is shown as if it were real.
- [ ] Anonymous REST reads do not expose raw or aggregate data after the auth migration.
- [ ] The service role appears only in the n8n credential, never in frontend/config/git output.
- [ ] The new workflow has a real successful execution before replacing the MVP schedule.
- [ ] Partial, stale, empty and failed states are visibly distinct.
- [ ] Tests cover the new mappings and the previous dashboard tests remain green.
