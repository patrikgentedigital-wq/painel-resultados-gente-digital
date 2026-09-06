import { createRequire } from "node:module";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const model = require("../dashboard.js") as {
  deriveExecutiveMetrics?: (snapshot: Record<string, unknown>) => Record<string, unknown>;
  getContractDataState?: (snapshot: Record<string, unknown>) => string;
  applyLiveSnapshot?: (document: Document, snapshot: Record<string, unknown>) => string | null;
  renderLiveDecisionQueue?: (document: Document, snapshot: Record<string, unknown>) => void;
  renderLiveCancellationReasons?: (document: Document, snapshot: Record<string, unknown>) => void;
  renderLiveAlerts?: (document: Document, snapshot: Record<string, unknown>) => void;
  buildSnapshotQuery?: (options?: { year?: number; monthKey?: string; limit?: number }) => URLSearchParams;
  fetchSnapshots?: (window: Window, options?: { year?: number; monthKey?: string; limit?: number }) => Promise<Record<string, unknown>[]>;
  fetchLatestSnapshot?: (window: Window, options?: { year?: number; monthKey?: string; limit?: number }) => Promise<Record<string, unknown> | null>;
  markLiveUnavailable?: (document: Document, reason?: string) => void;
  getSnapshotFreshness?: (snapshot: Record<string, unknown>) => string;
  getLiveSourceNotice?: (snapshot: Record<string, unknown>) => string;
};

describe("contrato executivo do painel", () => {
  it("limita o histórico financeiro ao corte selecionado e não exibe totais de fonte parcial", () => {
    const dom = new JSDOM('<div data-financial-history></div>');
    const selected = { period_start: "2026-02-01", period_end: "2026-02-28", sync_status: "partial", financial_data_state: "partial", received_amount: 999 };
    model.applyLiveSnapshot?.(dom.window.document, selected, [
      { period_start: "2026-01-01", period_end: "2026-01-31", sync_status: "success", financial_data_state: "complete", due_amount: 100, received_amount: 80, outstanding_amount: 20, collection_rate: .8 },
      selected,
      { period_start: "2026-03-01", period_end: "2026-03-31", financial_data_state: "complete", received_amount: 200 },
    ]);
    const rows = [...dom.window.document.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('80,00');
    expect(rows[1].textContent).not.toContain('999');
    expect(rows[1].querySelectorAll('td')[1].textContent).toBe('—');
    model.markLiveUnavailable?.(dom.window.document, 'Falha de leitura');
    expect(dom.window.document.querySelector('table')).toBeNull();
  });
  it("mostra cancelamentos comprovados mesmo sem logs de ativação e filtra meses por plano oficial", () => {
    const snapshot = {
      period_start: "2026-09-01", period_end: "2026-09-30", cancellations: 5, activations: null, sync_status: "partial",
      data_quality: { movement_data_state: "partial", cancellations_data_state: "complete", coverage_end: "2026-09-05" },
      breakdown: {
        plan_catalog: [{ id: "154", name: "COMBO GENTE AMIGO" }, { id: "155", name: "COMBO GENTE ULTRA" }],
        monthly: {
          "2026-08": { cancellations: 37, cancellations_data_state: "complete", cancellation_by_plan: { "154": 20, "155": 17 } },
          "2026-09": { cancellations: 5, cancellations_data_state: "complete", cancellation_by_plan: { "154": 3, "155": 2 } },
        },
      },
    };
    expect(model.deriveExecutiveMetrics?.(snapshot)).toMatchObject({ cancellations: 5, activations: null, netAdditions: null });
    const dom = new JSDOM('<strong data-live-cancellations></strong><select data-live-plan-filter></select><div data-live-cancellation-history></div>');
    model.applyLiveSnapshot?.(dom.window.document, snapshot);
    expect(dom.window.document.querySelector('[data-live-cancellations]')?.textContent).toBe('5');
    const select = dom.window.document.querySelector('select')!;
    expect(select.disabled).toBe(false);
    expect(select.options[1].textContent).toBe('COMBO GENTE AMIGO');
    select.value = '154'; select.dispatchEvent(new dom.window.Event('change'));
    const cells = [...dom.window.document.querySelectorAll('tbody tr')].map(row => row.textContent);
    expect(cells).toEqual(['08/202620Mês encerrado', '09/20263Até 05/09/2026']);
  });

  it("deriva os indicadores que o CEO precisa para decidir", () => {
    expect(model.deriveExecutiveMetrics).toBeTypeOf("function");

    const metrics = model.deriveExecutiveMetrics?.({
      active_base: 12840,
      activations: 410,
      cancellations: 128,
      net_additions: 282,
      due_amount: 125000,
      received_amount: 116250,
      outstanding_amount: 8750,
      overdue_title_count: 31,
      service_open_count: 44,
      service_overdue_count: 9,
      support_open_count: 86,
      support_overdue_count: 14,
      financial_data_state: "complete",
      operational_data_state: "partial",
      data_quality: { operational_overdue_data_state: "complete" },
    });

    expect(metrics).toMatchObject({
      activeBase: 12840,
      collectionRate: 0.93,
      overdueTitleCount: 31,
      operationalBacklog: 130,
      operationalOverdue: 23,
      financialState: "complete",
      operationalState: "partial",
    });
    expect(metrics?.churnRate as number).toBeCloseTo(128 / 12840, 8);
  });

  it("não apresenta base ativa quando a coleta de contratos está limitada a um lote sem paginação", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      active_base: 885,
      data_quality: { contracts_received: 1000 },
    });

    expect(metrics?.activeBase).toBeNull();
    expect(metrics?.baseDataState).toBe("partial");
  });

  it("não apresenta base ativa quando a fonte trouxe contratos mas não conseguiu calcular o status", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      active_base: 885,
      data_quality: {
        contracts_received: 885,
        active_contracts_current: null,
      },
    });

    expect(metrics?.activeBase).toBeNull();
    expect(metrics?.baseDataState).toBe("partial");
  });

  it("não apresenta base ativa quando a fonte legada informa zero contratos sem snapshot confiável", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      active_base: null,
      data_quality: { contracts_received: 0 },
    });

    expect(metrics?.activeBase).toBeNull();
    expect(metrics?.baseDataState).toBe("unavailable");
  });

  it("não confirma uma página cheia sem a prova explícita de cobertura concluída", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      active_base: 250,
      data_quality: {
        contracts_received: 250,
        active_contracts_current: 250,
        pagination: {
          cliente_contrato: {
            page_count: 1,
            last_page_count: 250,
            truncated: false,
          },
        },
      },
    });

    expect(metrics?.activeBase).toBeNull();
    expect(metrics?.baseDataState).toBe("partial");
  });

  it("confirma a base somente quando o produtor marca coverage_confirmed", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      active_base: 250,
      data_quality: {
        contracts_received: 250,
        active_contracts_current: 250,
        pagination: {
          cliente_contrato: {
            page_count: 2,
            last_page_count: 1,
            truncated: false,
            coverage_confirmed: true,
          },
        },
      },
    });

    expect(metrics?.activeBase).toBe(250);
    expect(metrics?.baseDataState).toBe("complete");
  });

  it("expõe a cobertura real dos contratos no aviso do painel", () => {
    expect(model.getLiveSourceNotice).toBeTypeOf("function");

    const notice = model.getLiveSourceNotice?.({
      active_base: 885,
      sync_status: "partial",
      data_quality: {
        contracts_received: 1000,
        active_contracts_current: null,
        pagination: { cliente_contrato: { truncated: true } },
        financial_data_state: "unavailable",
      },
      financial_data_state: "unavailable",
    });

    expect(notice).toContain("cobertura parcial");
    expect(notice).toContain("1.000 contratos");
    expect(notice).toContain("base ativa não foi confirmada");
  });

  it("mostra contratos recebidos na integração, não a soma de todas as fontes", () => {
    const dom = new JSDOM(`<!doctype html><html><body><span data-live-records></span></body></html>`);

    model.applyLiveSnapshot?.(dom.window.document, {
      active_base: null,
      data_quality: { records_received: 4136, contracts_received: 1000 },
    });

    expect(dom.window.document.querySelector("[data-live-records]")?.textContent).toBe("1.000");
  });

  it("não rotula uma fonte com erro como conectada com dados parciais", () => {
    const dom = new JSDOM(`<!doctype html><html><body><span data-live-ixc-status></span></body></html>`);

    model.applyLiveSnapshot?.(dom.window.document, {
      active_base: null,
      data_quality: {
        source_states: { cliente_contrato: "error" },
        source_errors: ["cliente_contrato: resposta inválida"],
      },
      sync_status: "error",
    });

    expect(dom.window.document.querySelector("[data-live-ixc-status]")?.textContent).toContain("erro");
    expect(dom.window.document.querySelector("[data-live-ixc-status]")?.textContent).not.toContain("parciais");
  });

  it("usa o erro da fonte mesmo quando o produtor não envia source_states", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      active_base: 885,
      data_quality: { contracts_received: 1000, source_errors: ["cliente_contrato"] },
    });

    expect(metrics?.baseDataState).toBe("error");
    expect(metrics?.activeBase).toBeNull();
  });

  it("renderiza estados parciais sem transformar dado ausente em zero", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html><body>
        <strong data-live-active-base></strong>
        <strong data-live-churn></strong>
        <strong data-live-received-money></strong>
        <strong data-live-due-summary></strong>
        <strong data-live-outstanding-money></strong>
        <strong data-live-collection-rate></strong>
        <strong data-live-overdue-titles></strong>
        <strong data-live-open-operations></strong>
        <strong data-live-overdue-operations></strong>
        <strong data-live-service-open></strong>
        <strong data-live-support-open></strong>
        <strong data-live-financial-state></strong>
        <strong data-live-operational-state></strong>
      </body></html>
    `);

    model.applyLiveSnapshot?.(dom.window.document, {
      active_base: null,
      activations: 12,
      cancellations: 3,
      due_amount: 0,
      received_amount: 0,
      outstanding_amount: 0,
      financial_data_state: "partial",
      operational_data_state: "unavailable",
    });

    expect(dom.window.document.querySelector("[data-live-active-base]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-churn]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-received-money]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-due-summary]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-outstanding-money]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-collection-rate]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-overdue-titles]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-open-operations]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-overdue-operations]")?.textContent).toBe("Não calculado");
    expect(dom.window.document.querySelector("[data-live-service-open]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-support-open]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-financial-state]")?.textContent).toContain("parciais");
    expect(dom.window.document.querySelector("[data-live-operational-state]")?.textContent).toContain("indispon");
  });

  it("remove prioridades e motivos demonstrativos quando o snapshot não traz evidência", () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <div data-live-priority-list>
          <button class="priority-item">Downgrades acima de upgrades —R$ 1.521,95</button>
        </div>
        <div data-live-cancellation-reasons>
          <div class="rank-row">Inadimplência Principal</div>
        </div>
      </body></html>
    `);

    expect(model.renderLiveDecisionQueue).toBeTypeOf("function");
    expect(model.renderLiveCancellationReasons).toBeTypeOf("function");
    model.renderLiveDecisionQueue?.(dom.window.document, {
      sync_status: "partial",
      financial_data_state: "partial",
      operational_data_state: "unavailable",
      data_quality: {
        movement_data_state: "partial",
        unknown_movement_semantics: 135,
      },
    });
    model.renderLiveCancellationReasons?.(dom.window.document, {
      sync_status: "partial",
      data_quality: { movement_data_state: "partial" },
    });

    const priorityText = dom.window.document.querySelector("[data-live-priority-list]")?.textContent || "";
    const reasonText = dom.window.document.querySelector("[data-live-cancellation-reasons]")?.textContent || "";
    expect(priorityText).toContain("Prioridades indisponíveis");
    expect(priorityText).not.toContain("1.521");
    expect(reasonText).toContain("Motivos indisponíveis");
    expect(reasonText).not.toContain("Inadimplência");
  });

  it("renderiza somente alertas presentes no snapshot live", () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <div data-live-alert-list>
          <article data-alert-card>Alerta demonstrativo</article>
        </div>
        <div data-alert-empty hidden></div>
      </body></html>
    `);

    expect(model.renderLiveAlerts).toBeTypeOf("function");
    model.renderLiveAlerts?.(dom.window.document, {
      breakdown: {
        alerts: [
          { severity: "critico", title: "Fonte IXC incompleta", area: "Integrações", evidence: "Logs sem transição comprovada." },
        ],
      },
    });

    const card = dom.window.document.querySelector<HTMLElement>("[data-alert-card]");
    expect(card).not.toBeNull();
    expect(card?.dataset.severity).toBe("critico");
    expect(card?.textContent).toContain("Fonte IXC incompleta");
    expect(card?.textContent).not.toContain("demonstrativo");
    expect(dom.window.document.querySelector<HTMLElement>("[data-alert-empty]")?.hidden).toBe(true);
  });

  it("mostra estado vazio quando o snapshot não traz alertas", () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <div data-live-alert-list></div>
        <div data-alert-empty hidden></div>
      </body></html>
    `);

    model.renderLiveAlerts?.(dom.window.document, { breakdown: { alerts: [] } });

    expect(dom.window.document.querySelector("[data-live-alert-list]")?.textContent).toContain(
      "Nenhum alerta informado",
    );
    expect(dom.window.document.querySelector<HTMLElement>("[data-alert-empty]")?.hidden).toBe(false);
  });

  it("não exibe backlog zero quando o estado operacional está indisponível", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html><body>
        <strong data-live-open-operations></strong>
        <strong data-live-overdue-operations></strong>
      </body></html>
    `);

    model.applyLiveSnapshot?.(dom.window.document, {
      service_open_count: 0,
      service_overdue_count: 0,
      support_open_count: 0,
      support_overdue_count: 0,
      operational_data_state: "unavailable",
    });

    expect(dom.window.document.querySelector("[data-live-open-operations]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-overdue-operations]")?.textContent).toBe("Não calculado");
  });

  it("não trata o zero do backlog vencido como cálculo válido sem prazo homologado", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html><body>
        <strong data-live-overdue-operations></strong>
        <p data-live-overdue-operations-copy></p>
      </body></html>
    `);

    model.applyLiveSnapshot?.(dom.window.document, {
      service_overdue_count: 0,
      support_overdue_count: 0,
      operational_data_state: "partial",
      data_quality: { operational_overdue_data_state: "unavailable" },
    });

    expect(dom.window.document.querySelector("[data-live-overdue-operations]")?.textContent).toBe("Não calculado");
    expect(dom.window.document.querySelector("[data-live-overdue-operations-copy]")?.textContent).toContain("não calculado");
  });

  it("renderiza o saldo financeiro das mudanças de plano", () => {
    const dom = new JSDOM(`<!doctype html><html><body><strong data-live-plan-delta></strong></body></html>`);

    model.applyLiveSnapshot?.(dom.window.document, {
      plan_delta_amount: -1521.95,
      financial_data_state: "complete",
    });

    expect(dom.window.document.querySelector("[data-live-plan-delta]")?.textContent).toBe("-R$ 1.521,95");
  });

  it("monta filtro mensal ou série anual sem trocar apenas o rótulo", () => {
    expect(model.buildSnapshotQuery).toBeTypeOf("function");

    const monthQuery = model.buildSnapshotQuery?.({ year: 2026, monthKey: "2026-07" });
    expect(monthQuery?.get("period_start")).toBe("eq.2026-07-01");
    expect(monthQuery?.get("limit")).toBe("1");

    const yearQuery = model.buildSnapshotQuery?.({ year: 2026, limit: 12 });
    expect(yearQuery?.get("period_start")).toBe("gte.2026-01-01");
    expect(yearQuery?.get("period_end")).toBe("lt.2027-01-01");
    expect(yearQuery?.get("limit")).toBe("12");
  });

  it("mantém fetchLatestSnapshot compatível com o último mês do ano", async () => {
    expect(model.fetchLatestSnapshot).toBeTypeOf("function");
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://painel.local/" });
    (dom.window as unknown as { PAINEL_SUPABASE_CONFIG: unknown }).PAINEL_SUPABASE_CONFIG = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      requireAuth: true,
      sessionStorageKey: "session",
    };
    dom.window.sessionStorage.setItem("session", JSON.stringify({ access_token: "access-token" }));
    const requests: string[] = [];
    (dom.window as unknown as { fetch: typeof fetch }).fetch = async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        json: async () => [{ period_start: "2026-07-01", period_end: "2026-07-31" }],
      } as Response;
    };

    await model.fetchLatestSnapshot?.(dom.window as unknown as Window, { year: 2026 });

    expect(requests[0]).toContain("period_start=gte.2026-01-01");
    expect(requests[0]).toContain("order=period_start.desc%2Csnapshot_at.desc");
    expect(requests[0]).toContain("limit=1");
  });

  it("sinaliza quando o snapshot ainda está sendo finalizado", () => {
    expect(model.getSnapshotFreshness).toBeTypeOf("function");
    expect(model.getSnapshotFreshness?.({ sync_status: "running" })).toBe("Sincronização em andamento");
  });

  it("mantém a indicação de parcialidade quando a qualidade de planos diverge do status legado", () => {
    expect(model.getSnapshotFreshness?.({
      sync_status: "success",
      data_quality: { plan_data_state: "partial" },
    })).toBe("Dados parciais");
  });

  it("consulta somente a view agregada autenticada do mês solicitado", async () => {
    expect(model.fetchSnapshots).toBeTypeOf("function");
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://painel.local/" });
    (dom.window as unknown as { PAINEL_SUPABASE_CONFIG: unknown }).PAINEL_SUPABASE_CONFIG = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      requireAuth: true,
      sessionStorageKey: "session",
    };
    dom.window.sessionStorage.setItem("session", JSON.stringify({ access_token: "access-token" }));
    const requests: Array<{ url: string; init: RequestInit }> = [];
    (dom.window as unknown as { fetch: typeof fetch }).fetch = async (url, init) => {
      requests.push({ url: String(url), init: init || {} });
      return {
        ok: true,
        json: async () => [{ period_start: "2026-07-01", period_end: "2026-07-31" }],
      } as Response;
    };

    const rows = await model.fetchSnapshots?.(dom.window as unknown as Window, { year: 2026, monthKey: "2026-07" });

    expect(rows).toHaveLength(1);
    expect(requests[0]?.url).toContain("/rest/v1/dashboard_latest?");
    expect(requests[0]?.url).toContain("period_start=eq.2026-07-01");
    expect(requests[0]?.url).toContain("limit=1");
    expect(requests[0]?.url).toContain("sync_run_id");
    expect(requests[0]?.url).not.toContain("service_overdue_data_state");
    expect(requests[0]?.url).not.toContain("support_overdue_data_state");
    expect(requests[0]?.url).not.toContain("operational_overdue_data_state");
    expect(requests[0]?.init.headers).toMatchObject({ Authorization: "Bearer access-token", apikey: "anon-key" });
  });

  it("mantém leitura compatível enquanto a view remota ainda não tem sync_run_id", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://painel.local/" });
    (dom.window as unknown as { PAINEL_SUPABASE_CONFIG: unknown }).PAINEL_SUPABASE_CONFIG = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      requireAuth: false,
    };
    const requests: string[] = [];
    (dom.window as unknown as { fetch: typeof fetch }).fetch = async (url) => {
      const requestUrl = String(url);
      requests.push(requestUrl);
      if (requestUrl.includes("sync_run_id")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ message: "column dashboard_latest.sync_run_id does not exist" }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => [{ period_start: "2026-07-01", period_end: "2026-07-31" }],
      } as Response;
    };

    const rows = await model.fetchSnapshots?.(dom.window as unknown as Window, { year: 2026, monthKey: "2026-07" });

    expect(rows).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toContain("sync_run_id");
    expect(rows?.[0].sync_run_id).toBeNull();
  });

  it("preserva a proveniência do snapshot no painel", () => {
    const dom = new JSDOM(`<!doctype html><html><body><span data-live-sync-run-id>—</span></body></html>`);

    model.applyLiveSnapshot?.(dom.window.document, {
      sync_run_id: 815,
      financial_data_state: "unavailable",
    });

    expect(dom.window.document.querySelector("[data-live-sync-run-id]")?.textContent).toBe("815");
  });

  it("renderiza as transições de plano da competência selecionada", () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <span data-live-plan-transition-state></span>
        <div data-live-plan-transitions></div>
      </body></html>
    `);

    model.applyLiveSnapshot?.(dom.window.document, {
      period_start: "2026-02-01",
      plan_delta_amount: 20,
      breakdown: {
        monthly: {
          "2026-02": { plan_transitions: { "100 Mega -> 200 Mega": 2 } },
        },
      },
    });

    expect(dom.window.document.querySelector("[data-live-plan-transition-state]")?.textContent).toBe(
      "2 transições do IXC",
    );
    expect(dom.window.document.querySelector("[data-live-plan-transitions]")?.textContent).toContain(
      "100 Mega -> 200 Mega",
    );
  });

  it("não exibe zero quando movimentação e planos estão indisponíveis", () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <strong data-live-activations></strong>
        <strong data-live-cancellations></strong>
        <strong data-live-upgrades></strong>
        <strong data-live-plan-delta></strong>
        <span data-live-plan-transition-state></span>
        <div data-live-plan-transitions></div>
      </body></html>
    `);

    model.applyLiveSnapshot?.(dom.window.document, {
      activations: 0,
      cancellations: 0,
      upgrades: 0,
      downgrades: 0,
      plan_delta_amount: 0,
      data_quality: {
        movement_data_state: "unavailable",
        plan_data_state: "unavailable",
      },
    });

    expect(dom.window.document.querySelector("[data-live-activations]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-cancellations]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-upgrades]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-plan-delta]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-plan-transition-state]")?.textContent).toContain(
      "indisponíveis",
    );
  });

  it("não exibe KPI de uma linha cujo sync terminou com erro", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      sync_status: "error",
      active_base: 250,
      activations: 2,
      cancellations: 1,
      due_amount: 100,
      received_amount: 80,
      financial_data_state: "complete",
      operational_data_state: "complete",
      data_quality: {
        contracts_received: 250,
        active_contracts_current: 250,
        pagination: { cliente_contrato: { truncated: false, coverage_confirmed: true } },
        movement_data_state: "complete",
      },
    });

    expect(metrics?.activeBase).toBeNull();
    expect(metrics?.activations).toBeNull();
    expect(metrics?.receivedAmount).toBeNull();
    expect(metrics?.financialState).toBe("error");
  });

  it("não assume planos completos no snapshot legado sem campos de plano", () => {
    const metrics = model.deriveExecutiveMetrics?.({
      activations: 1,
      cancellations: 0,
      data_quality: { source_states: { ixc_logs: "complete" } },
    });

    expect(metrics?.planState).toBe("unavailable");
    expect(metrics?.planAvailable).toBe(false);
  });

  it("limpa valores demonstrativos quando não há snapshot", () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <strong data-live-records>2.814</strong>
        <span data-live-ixc-status>Conectado · demo</span>
        <span data-live-n8n-state>aguardando publicação</span>
        <span data-live-supabase-write>há 8 min</span>
        <span data-live-badge>DADOS DEMONSTRATIVOS</span>
        <span data-period-freshness>Dados demonstrativos</span>
      </body></html>
    `);

    model.markLiveUnavailable?.(dom.window.document, "Sem snapshot mensal");

    expect(dom.window.document.querySelector("[data-live-records]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-ixc-status]")?.textContent).toBe("Sem snapshot mensal");
    expect(dom.window.document.querySelector("[data-live-n8n-state]")?.textContent).toBe("Sem snapshot mensal");
    expect(dom.window.document.querySelector("[data-live-supabase-write]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-badge]")?.textContent).toBe("SEM SNAPSHOT");
    expect(dom.window.document.querySelector("[data-period-freshness]")?.textContent).toBe("Sem snapshot mensal");
  });
});
