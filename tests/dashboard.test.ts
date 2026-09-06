import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const prototypeRoot = resolve(__dirname, "..");
const htmlPath = resolve(prototypeRoot, "index.html");
const scriptPath = resolve(prototypeRoot, "dashboard.js");
const logoPath = resolve(prototypeRoot, "assets", "gente-digital-logo.jpg");

type DashboardModel = {
  formatCurrency?: (value: number) => string;
  mergeMonthlySeries?: (
    monthly: Record<string, Record<string, unknown>> | undefined,
    snapshots: Record<string, unknown>[],
  ) => Record<string, { activations: number; cancellations: number }>;
  filterAlerts?: <T extends { severity: string; title: string }>(
    alerts: T[],
    severity: string,
    query?: string,
  ) => T[];
  getComparisonNotice?: (currentPeriod: string, comparisonPeriod: string) => string;
  formatAuthError?: (error: unknown, fallback: string) => string;
  getArpuPresentation?: (snapshot: Record<string, unknown>) => { label: string; copy: string };
  fetchSnapshots?: (window: Window, options?: { year?: number; limit?: number }) => Promise<Record<string, unknown>[]>;
  initDashboard?: (document: Document, window: Window) => void;
};

function loadModel(): DashboardModel {
  if (!existsSync(scriptPath)) return {};
  delete require.cache[scriptPath];
  return require(scriptPath) as DashboardModel;
}

function loadPrototype() {
  const html = existsSync(htmlPath)
    ? readFileSync(htmlPath, "utf8")
    : "<!doctype html><html><body></body></html>";
  const dom = new JSDOM(html, { url: "https://painel.local/" });
  const model = loadModel();
  model.initDashboard?.(dom.window.document, dom.window as unknown as Window);
  return { dom, model };
}

describe("contrato do Painel de Resultados", () => {
  it("entrega um HTML local e um controlador reutilizável", () => {
    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("usa o arquivo oficial da marca com texto alternativo", () => {
    const { dom } = loadPrototype();
    const logo = dom.window.document.querySelector<HTMLImageElement>("[data-company-logo]");

    expect(existsSync(logoPath)).toBe(true);
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("src")).toBe("assets/gente-digital-logo.jpg");
    expect(logo?.getAttribute("alt")).toBe("Gente Digital");
  });

  it("não anuncia integrações reais antes de existir um snapshot", () => {
    const { dom } = loadPrototype();
    const document = dom.window.document;

    expect(document.querySelector("[data-live-ixc-status]")?.textContent).toContain("Aguardando");
    expect(document.querySelector("[data-live-n8n-status]")?.textContent).toContain("Aguardando");
    expect(document.querySelector("[data-live-supabase-status]")?.textContent).toContain("Aguardando");
    expect(document.querySelector("[data-live-ixc-read]")?.textContent).toBe("—");
    expect(document.querySelector("[data-live-supabase-write]")?.textContent).toBe("—");
    expect(document.querySelector("[data-live-sync-mini-status]")?.textContent).toContain("Aguardando");
    expect(document.querySelector("[data-live-sync-mini-age]")?.textContent).toBe("—");
    expect(document.querySelector(".freshness-stamp .status-light")?.classList.contains("status-light--warning")).toBe(true);
  });

  it("orienta o acesso pelo link de uso único enviado pelo Supabase", () => {
    const { dom } = loadPrototype();
    const document = dom.window.document;

    expect(document.querySelector("[data-login-submit]")?.textContent).toContain("Entrar com senha");
    expect(document.querySelector("[data-login-link]")?.textContent).toContain("Enviar link");
    expect(document.querySelector("#login-password")).not.toBeNull();
    expect(document.querySelector(".login-footnote")?.textContent).toContain("link de uso único");
    expect(document.querySelector(".login-footnote")?.textContent).toContain("Senha");
  });

  it("traduz erros de credencial e de limite de e-mail", () => {
    const model = loadModel();

    expect(model.formatAuthError).toBeTypeOf("function");
    expect(model.formatAuthError?.({ message: "Invalid login credentials" }, "fallback")).toBe(
      "E-mail ou senha inválidos.",
    );
    expect(model.formatAuthError?.({ message: "email rate limit exceeded" }, "fallback")).toContain(
      "limite de envio",
    );
  });

  it("formata valores monetários no padrão brasileiro", () => {
    const model = loadModel();
    expect(model.formatCurrency).toBeTypeOf("function");
    expect(model.formatCurrency?.(63023.61)).toBe("R$ 63.023,61");
    expect(model.formatCurrency?.(-1521.95)).toBe("-R$ 1.521,95");
  });

  it("identifica o valor por contrato de uma competência parcial sem chamá-lo de ticket ativado", () => {
    const model = loadModel();

    expect(model.getArpuPresentation).toBeTypeOf("function");
    expect(model.getArpuPresentation?.({
      period_end: "2026-09-30",
      data_quality: { coverage_end: "2026-09-02" },
    })).toEqual({
      label: "Recebido por contrato",
      copy: "acumulado até 02/09/2026",
    });
  });

  it("completa a série mensal usando snapshots anuais quando o breakdown vem parcial", () => {
    const model = loadModel();
    expect(model.mergeMonthlySeries).toBeTypeOf("function");

    const series = model.mergeMonthlySeries?.(
      { "2026-08": { activations: 4, cancellations: 1 } },
      [
        { period_start: "2026-01-01", activations: 1, cancellations: 0 },
        { period_start: "2026-02-01", activations: 2, cancellations: 1 },
        { period_start: "2026-08-01", activations: 8, cancellations: 2 },
      ],
    );

    expect(Object.keys(series || {})).toEqual(["2026-01", "2026-02", "2026-08"]);
    expect(series?.["2026-01"]).toEqual({ activations: 1, cancellations: 0 });
    // A competência persistida prevalece sobre um breakdown divergente.
    expect(series?.["2026-08"]).toEqual({ activations: 8, cancellations: 2 });
  });

  it("filtra alertas por severidade e busca sem diferenciar maiúsculas", () => {
    const model = loadModel();
    const alerts = [
      { severity: "critico", title: "Sincronização do IXC atrasada" },
      { severity: "atencao", title: "Downgrades acima de upgrades" },
      { severity: "critico", title: "Divergência financeira" },
    ];

    expect(model.filterAlerts).toBeTypeOf("function");
    expect(model.filterAlerts?.(alerts, "critico", "ixc")).toEqual([alerts[0]]);
    expect(model.filterAlerts?.(alerts, "todos", "FINANCEIRA")).toEqual([alerts[2]]);
  });

  it("impede uma comparação silenciosa entre períodos não equivalentes", () => {
    const model = loadModel();
    expect(model.getComparisonNotice).toBeTypeOf("function");
    expect(model.getComparisonNotice?.("2026-jul", "2025-completo")).toContain(
      "períodos diferentes",
    );
    expect(model.getComparisonNotice?.("2026-jul", "2025-jul")).toBe("");
  });

  it("navega entre módulos e atualiza o estado acessível do menu", () => {
    const { dom } = loadPrototype();
    const { document } = dom.window;
    const financeLink = document.querySelector<HTMLElement>('[data-page-target="financeiro"]');

    expect(financeLink).not.toBeNull();
    financeLink?.click();

    expect(financeLink?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector<HTMLElement>('[data-page="financeiro"]')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-page="visao-geral"]')?.hidden).toBe(true);
    expect(document.title).toContain("Financeiro");
  });

  it("mantém os módulos limpos e reserva estados de cobertura para os próprios indicadores", () => {
    const { dom } = loadPrototype();
    const movementsLink = dom.window.document.querySelector<HTMLElement>('[data-page-target="movimentos"]');

    movementsLink?.click();

    const notice = dom.window.document.querySelector('[data-demo-data-notice]');
    expect(notice).toBeNull();
    expect(dom.window.document.querySelector(".filter-scope")?.textContent).toContain("todas as filiais autorizadas");
  });

  it("não publica nenhum bloco demonstrativo no escopo da CEO", () => {
    const { dom } = loadPrototype();
    const demoBlocks = [...dom.window.document.querySelectorAll<HTMLElement>("[data-demo-only]")];

    expect(demoBlocks).toHaveLength(0);
  });

  it("escuta a visibilidade no document para retomar a leitura live", () => {
    const source = readFileSync(scriptPath, "utf8");

    expect(source).toContain('document?.addEventListener?.("visibilitychange"');
    expect(source).not.toContain('window?.addEventListener?.("visibilitychange"');
  });

  it("abre e fecha a gaveta de evidências preservando aria-hidden", () => {
    const { dom } = loadPrototype();
    const { document } = dom.window;
    const openButton = document.querySelector<HTMLElement>("[data-open-drawer]");
    const drawer = document.querySelector<HTMLElement>("#detail-drawer");

    expect(openButton).not.toBeNull();
    expect(drawer).not.toBeNull();

    openButton?.click();
    expect(drawer?.getAttribute("aria-hidden")).toBe("false");
    expect(document.body.classList.contains("drawer-open")).toBe(true);

    document.querySelector<HTMLElement>("[data-close-drawer]")?.click();
    expect(drawer?.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.classList.contains("drawer-open")).toBe(false);
  });

  it("expõe somente as quatro seções executivas, sem páginas operacionais", () => {
    const { dom } = loadPrototype();
    const { document } = dom.window;

    expect(
      [...document.querySelectorAll<HTMLElement>(".sidebar-nav [data-page-target]")].map(
        (link) => link.dataset.pageTarget,
      ),
    ).toEqual(["visao-geral", "movimentos", "financeiro", "planos"]);
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-page]")].map((page) => page.dataset.page),
    ).toEqual(["visao-geral", "movimentos", "financeiro", "planos"]);
    for (const removed of ["retencao", "qualidade", "dados", "alertas", "integracoes", "administracao"]) {
      expect(document.querySelector(`[data-page="${removed}"]`)).toBeNull();
      expect(document.querySelector(`[data-page-target="${removed}"]`)).toBeNull();
    }
  });

  it("exporta as competências sincronizadas em CSV legível no Excel", () => {
    const model = loadModel() as DashboardModel & {
      buildPeriodCsv?: (rows: Record<string, unknown>[]) => string;
    };

    expect(model.buildPeriodCsv).toBeTypeOf("function");
    const csv = model.buildPeriodCsv?.([
      {
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        activations: 90,
        cancellations: 9,
        net_additions: 81,
        active_base: 244,
        due_amount: 125000,
        received_amount: 116250,
        outstanding_amount: 8750,
        upgrades: 9,
        downgrades: 3,
        sync_status: "partial",
      },
    ]);

    expect(csv?.split("\r\n")).toHaveLength(2);
    expect(csv).toContain("competencia;inicio;fim;ativacoes;cancelamentos");
    expect(csv).toContain("2026-09;2026-09-01;2026-09-30;90;9;81;244;125000,00;116250,00;8750,00;7,00%;9;3;partial");
  });

  it("abre a competência mais recente sem escolha persistida e preserva a troca manual", async () => {
    const html = readFileSync(htmlPath, "utf8");
    const dom = new JSDOM(html, { url: "https://painel.local/" });
    const model = loadModel();
    const snapshots = [
      {
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        snapshot_at: "2026-01-31T23:00:00Z",
        activations: 10,
        cancellations: 2,
        net_additions: 8,
        active_base: 100,
        plan_delta_amount: 20,
        upgrades: 2,
        downgrades: 1,
        data_quality: { records_received: 12, coverage_end: "2026-01-31" },
        financial_data_state: "unavailable",
        operational_data_state: "unavailable",
        sync_status: "partial",
        breakdown: { monthly: { "2026-01": { activations: 10, cancellations: 2 } } },
      },
      {
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        snapshot_at: "2026-07-31T23:00:00Z",
        activations: 70,
        cancellations: 7,
        net_additions: 63,
        active_base: 163,
        plan_delta_amount: -70,
        upgrades: 7,
        downgrades: 3,
        data_quality: { records_received: 73, coverage_end: "2026-07-31" },
        financial_data_state: "unavailable",
        operational_data_state: "unavailable",
        sync_status: "partial",
        breakdown: { monthly: { "2026-07": { activations: 70, cancellations: 7 } } },
      },
      {
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        snapshot_at: "2026-09-05T13:46:40Z",
        activations: 90,
        cancellations: 9,
        net_additions: 81,
        active_base: 244,
        plan_delta_amount: -90,
        upgrades: 9,
        downgrades: 3,
        data_quality: { records_received: 93, coverage_end: "2026-09-05" },
        financial_data_state: "unavailable",
        operational_data_state: "unavailable",
        sync_status: "partial",
        breakdown: { monthly: { "2026-09": { activations: 90, cancellations: 9 } } },
      },
    ];
    (dom.window as unknown as { PAINEL_SUPABASE_CONFIG: unknown }).PAINEL_SUPABASE_CONFIG = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      requireAuth: true,
      sessionStorageKey: "session",
    };
    dom.window.sessionStorage.setItem("session", JSON.stringify({ access_token: "access-token" }));
    const urls: string[] = [];
    (dom.window as unknown as { fetch: typeof fetch }).fetch = async (url) => {
      urls.push(String(url));
      return { ok: true, json: async () => snapshots } as Response;
    };

    model.initDashboard?.(dom.window.document, dom.window as unknown as Window);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const periodSelect = dom.window.document.querySelector<HTMLSelectElement>("[data-period-select]");
    expect(urls[0]).toContain("period_start=gte.2026-01-01");
    expect(periodSelect?.value).toBe("2026-09");
    expect(periodSelect?.options.length).toBe(3);
    expect(dom.window.document.querySelector("[data-live-activations]")?.textContent).toBe("90");
    expect(dom.window.document.querySelector("[data-live-plan-delta]")?.textContent).toBe("-R$ 90,00");

    if (periodSelect) {
      periodSelect.value = "2026-07";
      periodSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(urls).toHaveLength(1);
    expect(dom.window.document.querySelector("[data-live-activations]")?.textContent).toBe("70");
    expect(dom.window.document.querySelector("[data-period-label]")?.textContent).toContain("julho");
  });

  it("deduplica snapshots da mesma competência antes de renderizar a série", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://painel.local/" });
    const model = loadModel();
    (dom.window as unknown as { PAINEL_SUPABASE_CONFIG: unknown }).PAINEL_SUPABASE_CONFIG = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      requireAuth: false,
    };
    const snapshots = [
      { period_start: "2026-01-01", period_end: "2026-01-31", snapshot_at: "2026-01-31T10:00:00Z", activations: 1 },
      { period_start: "2026-01-01", period_end: "2026-01-31", snapshot_at: "2026-01-31T12:00:00Z", activations: 4 },
      { period_start: "2026-02-01", period_end: "2026-02-28", snapshot_at: "2026-02-28T12:00:00Z", activations: 2 },
    ];
    (dom.window as unknown as { fetch: typeof fetch }).fetch = async () => ({
      ok: true,
      json: async () => snapshots,
    }) as Response;

    const rows = await model.fetchSnapshots?.(dom.window as unknown as Window, { year: 2026, limit: 12 });

    expect(rows).toHaveLength(2);
    expect(rows?.[0].period_start).toBe("2026-01-01");
    expect(rows?.[0].activations).toBe(4);
  });

  it("prioriza o snapshot mensal canônico sobre um snapshot cumulativo mais recente", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://painel.local/" });
    const model = loadModel();
    (dom.window as unknown as { PAINEL_SUPABASE_CONFIG: unknown }).PAINEL_SUPABASE_CONFIG = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      requireAuth: false,
    };
    const snapshots = [
      {
        period_start: "2026-01-01",
        period_end: "2026-08-28",
        snapshot_at: "2026-08-27T12:00:00Z",
        active_base: 884,
        sync_status: "success",
      },
      {
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        snapshot_at: "2026-08-28T12:00:00Z",
        active_base: 250,
        sync_status: "partial",
      },
    ];
    (dom.window as unknown as { fetch: typeof fetch }).fetch = async () => ({
      ok: true,
      json: async () => snapshots,
    }) as Response;

    const rows = await model.fetchSnapshots?.(dom.window as unknown as Window, { year: 2026, limit: 12 });

    expect(rows).toHaveLength(1);
    expect(rows?.[0].period_end).toBe("2026-01-31");
    expect(rows?.[0].active_base).toBe(250);
  });

  it("não escolhe snapshot ainda em execução quando existe uma versão concluída", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://painel.local/" });
    const model = loadModel();
    (dom.window as unknown as { PAINEL_SUPABASE_CONFIG: unknown }).PAINEL_SUPABASE_CONFIG = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      requireAuth: false,
    };
    const snapshots = [
      {
        period_start: "2026-02-01",
        period_end: "2026-02-28",
        snapshot_at: "2026-08-29T12:00:00Z",
        sync_status: "running",
        active_base: 999,
      },
      {
        period_start: "2026-02-01",
        period_end: "2026-02-28",
        snapshot_at: "2026-08-28T12:00:00Z",
        sync_status: "partial",
        active_base: 250,
      },
    ];
    (dom.window as unknown as { fetch: typeof fetch }).fetch = async () => ({
      ok: true,
      json: async () => snapshots,
    }) as Response;

    const rows = await model.fetchSnapshots?.(dom.window as unknown as Window, { year: 2026, limit: 12 });

    expect(rows).toHaveLength(1);
    expect(rows?.[0].sync_status).toBe("partial");
    expect(rows?.[0].active_base).toBe(250);
  });

  it("cria posições suficientes para todos os meses recebidos", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div data-live-chart><div class="chart-month"><div class="bars"><i class="bar--activation"></i><i class="bar--cancellation"></i></div><span></span><small></small></div></div>
      <span data-live-ixc-status></span><span data-live-n8n-status></span><span data-live-supabase-status></span>
      <span data-live-badge></span><span data-live-updated></span><span data-live-sync-age></span><span data-live-records></span><span data-live-n8n-run></span><span data-live-n8n-state></span><span data-live-supabase-write></span><span data-live-finance-detail-state></span><span data-live-period-state></span><span data-live-plan-transition-state></span><div data-live-plan-transitions></div>
      <strong data-live-active-base></strong><strong data-live-activations></strong><strong data-live-cancellations></strong><strong data-live-net-additions></strong><strong data-live-churn></strong><strong data-live-collection-rate></strong><strong data-live-overdue-titles></strong><strong data-live-open-operations></strong><strong data-live-overdue-operations></strong><strong data-live-service-open></strong><strong data-live-support-open></strong><strong data-live-plan-delta></strong><strong data-live-upgrades></strong><strong data-live-downgrades></strong>
    </body></html>`);
    const model = loadModel() as DashboardModel & { applyLiveSnapshot?: (document: Document, snapshot: Record<string, unknown>, snapshots?: Record<string, unknown>[]) => unknown };
    const monthly = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      return [`2026-${month}`, { activations: index + 1, cancellations: 0 }];
    }));

    model.applyLiveSnapshot?.(dom.window.document, {
      period_end: "2026-08-27",
      period_start: "2026-01-01",
      snapshot_at: "2026-08-27T12:00:00Z",
      active_base: 100,
      activations: 36,
      cancellations: 0,
      net_additions: 36,
      breakdown: { monthly },
      data_quality: { movement_data_state: "complete", plan_data_state: "complete", contracts_received: 100 },
      financial_data_state: "unavailable",
      operational_data_state: "unavailable",
      sync_status: "success",
    });

    expect(dom.window.document.querySelectorAll("[data-live-chart] .chart-month")).toHaveLength(8);
  });
});
