import { createRequire } from "node:module";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const model = require("../dashboard.js") as {
  deriveExecutiveMetrics?: (snapshot: Record<string, unknown>) => Record<string, unknown>;
  applyLiveSnapshot?: (document: Document, snapshot: Record<string, unknown>) => string | null;
};

describe("contrato executivo do painel", () => {
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

  it("renderiza estados parciais sem transformar dado ausente em zero", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html><body>
        <strong data-live-active-base></strong>
        <strong data-live-churn></strong>
        <strong data-live-collection-rate></strong>
        <strong data-live-overdue-titles></strong>
        <strong data-live-open-operations></strong>
        <strong data-live-overdue-operations></strong>
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
      financial_data_state: "unavailable",
      operational_data_state: "unavailable",
    });

    expect(dom.window.document.querySelector("[data-live-active-base]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-churn]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-collection-rate]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-overdue-titles]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-open-operations]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-overdue-operations]")?.textContent).toBe("—");
    expect(dom.window.document.querySelector("[data-live-financial-state]")?.textContent).toContain("indispon");
    expect(dom.window.document.querySelector("[data-live-operational-state]")?.textContent).toContain("indispon");
  });
});
