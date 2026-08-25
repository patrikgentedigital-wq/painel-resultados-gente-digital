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
  filterAlerts?: <T extends { severity: string; title: string }>(
    alerts: T[],
    severity: string,
    query?: string,
  ) => T[];
  getComparisonNotice?: (currentPeriod: string, comparisonPeriod: string) => string;
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

  it("formata valores monetários no padrão brasileiro", () => {
    const model = loadModel();
    expect(model.formatCurrency).toBeTypeOf("function");
    expect(model.formatCurrency?.(63023.61)).toBe("R$ 63.023,61");
    expect(model.formatCurrency?.(-1521.95)).toBe("-R$ 1.521,95");
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

  it("filtra os cartões de alerta pela severidade escolhida", () => {
    const { dom } = loadPrototype();
    const { document } = dom.window;
    const criticalFilter = document.querySelector<HTMLElement>('[data-alert-filter="critico"]');

    expect(criticalFilter).not.toBeNull();
    criticalFilter?.click();

    const visibleCards = [...document.querySelectorAll<HTMLElement>("[data-alert-card]")].filter(
      (card) => !card.hidden,
    );
    expect(visibleCards.length).toBeGreaterThan(0);
    expect(visibleCards.every((card) => card.dataset.severity === "critico")).toBe(true);
    expect(criticalFilter?.getAttribute("aria-pressed")).toBe("true");
  });
});
