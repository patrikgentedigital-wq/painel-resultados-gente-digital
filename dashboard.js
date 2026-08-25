(function attachDashboard(globalScope, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.DashboardModel = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createDashboardModel() {
  "use strict";

  const PAGE_TITLES = {
    "visao-geral": "Visão Geral",
    movimentos: "Ativações e Cancelamentos",
    financeiro: "Financeiro",
    retencao: "Retenção",
    planos: "Planos",
    qualidade: "Qualidade da Conexão",
    dados: "Qualidade dos Dados",
    alertas: "Alertas",
    integracoes: "Integrações e Sincronização",
    administracao: "Administração",
  };

  const PERIODS = {
    "2026-jul": {
      label: "2026 até julho",
      scope: "jan-jul",
      freshness: "Dados demonstrativos",
    },
    "2025-jul": {
      label: "2025 até julho",
      scope: "jan-jul",
      freshness: "Período equivalente",
    },
    "2025-completo": {
      label: "2025 completo",
      scope: "ano-completo",
      freshness: "Ano fechado",
    },
  };

  function formatCurrency(value) {
    const numericValue = Number(value) || 0;
    const absoluteValue = Math.abs(numericValue);
    const formatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(absoluteValue)
      .replace(/\u00a0/g, " ");

    return numericValue < 0 ? `-${formatted}` : formatted;
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  }

  function filterAlerts(alerts, severity, query) {
    const normalizedSeverity = normalizeSearch(severity || "todos");
    const normalizedQuery = normalizeSearch(query);

    return alerts.filter((alert) => {
      const severityMatches =
        normalizedSeverity === "todos" ||
        normalizeSearch(alert.severity) === normalizedSeverity;
      const queryMatches =
        !normalizedQuery || normalizeSearch(alert.title).includes(normalizedQuery);

      return severityMatches && queryMatches;
    });
  }

  function getComparisonNotice(currentPeriod, comparisonPeriod) {
    const current = PERIODS[currentPeriod];
    const comparison = PERIODS[comparisonPeriod];

    if (!current || !comparison || current.scope === comparison.scope) return "";

    return "Atenção: períodos diferentes. Ative a comparação equivalente para interpretar a tendência corretamente.";
  }

  function toNullableNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function deriveExecutiveMetrics(snapshot) {
    const source = snapshot || {};
    const activeBase = toNullableNumber(source.active_base);
    const activations = toNullableNumber(source.activations);
    const cancellations = toNullableNumber(source.cancellations);
    const dueAmount = toNullableNumber(source.due_amount);
    const receivedAmount = toNullableNumber(source.received_amount);
    const outstandingAmount = toNullableNumber(source.outstanding_amount);
    const serviceOpenCount = toNullableNumber(source.service_open_count);
    const serviceOverdueCount = toNullableNumber(source.service_overdue_count);
    const supportOpenCount = toNullableNumber(source.support_open_count);
    const supportOverdueCount = toNullableNumber(source.support_overdue_count);
    const financialState = String(
      source.financial_data_state || (dueAmount === null && receivedAmount === null ? "unavailable" : "partial"),
    );
    const operationalState = String(
      source.operational_data_state ||
        (serviceOpenCount === null && supportOpenCount === null ? "unavailable" : "partial"),
    );
    const netAdditions =
      toNullableNumber(source.net_additions) ??
      (activations !== null && cancellations !== null ? activations - cancellations : null);
    const churnRate =
      toNullableNumber(source.churn_rate) ??
      (activeBase !== null && activeBase > 0 && cancellations !== null ? cancellations / activeBase : null);
    const collectionRate =
      toNullableNumber(source.collection_rate) ??
      (dueAmount !== null && dueAmount > 0 && receivedAmount !== null ? receivedAmount / dueAmount : null);
    const delinquencyRate =
      dueAmount !== null && dueAmount > 0 && outstandingAmount !== null
        ? outstandingAmount / dueAmount
        : null;
    const operationalBacklog =
      serviceOpenCount === null && supportOpenCount === null
        ? null
        : (serviceOpenCount || 0) + (supportOpenCount || 0);
    const operationalOverdue =
      serviceOverdueCount === null && supportOverdueCount === null
        ? null
        : (serviceOverdueCount || 0) + (supportOverdueCount || 0);

    return {
      activeBase,
      activations,
      cancellations,
      netAdditions,
      churnRate,
      dueAmount,
      receivedAmount,
      outstandingAmount,
      collectionRate,
      delinquencyRate,
      overdueTitleCount: toNullableNumber(source.overdue_title_count),
      arpuAmount: toNullableNumber(source.arpu_amount),
      serviceOpenCount,
      serviceOverdueCount,
      supportOpenCount,
      supportOverdueCount,
      operationalBacklog,
      operationalOverdue,
      financialState,
      operationalState,
    };
  }

  const DATA_STATE_LABELS = {
    complete: "Dados completos",
    partial: "Dados parciais",
    unavailable: "Dados indisponíveis",
    error: "Erro na fonte",
  };

  function formatDataState(state) {
    return DATA_STATE_LABELS[String(state)] || "Estado não informado";
  }

  function getSupabaseConfig(window) {
    const config = window?.PAINEL_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey) return null;
    return {
      url: String(config.url).replace(/\/$/, ""),
      anonKey: String(config.anonKey),
      requireAuth: config.requireAuth !== false,
      sessionStorageKey: String(config.sessionStorageKey || "painel-resultados-session"),
    };
  }

  function readStoredSession(window) {
    const config = getSupabaseConfig(window);
    if (!config || !window?.sessionStorage) return null;
    try {
      const raw = window.sessionStorage.getItem(config.sessionStorageKey);
      if (!raw) return null;
      const session = JSON.parse(raw);
      return session?.access_token ? session : null;
    } catch {
      return null;
    }
  }

  function storeSession(window, session) {
    const config = getSupabaseConfig(window);
    if (!config || !session?.access_token || !window?.sessionStorage) return;
    window.sessionStorage.setItem(config.sessionStorageKey, JSON.stringify(session));
  }

  function clearStoredSession(window) {
    const config = getSupabaseConfig(window);
    if (!config || !window?.sessionStorage) return;
    window.sessionStorage.removeItem(config.sessionStorageKey);
  }

  async function readAuthError(response) {
    try {
      const body = await response.json();
      return body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  async function requestAuth(window, endpoint, body, accessToken) {
    const config = getSupabaseConfig(window);
    if (!config || typeof window?.fetch !== "function") throw new Error("Supabase Auth não configurado.");
    const headers = {
      apikey: config.anonKey,
      "Content-Type": "application/json",
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await window.fetch(`${config.url}/auth/v1/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await readAuthError(response));
    return response.status === 204 ? null : response.json();
  }

  async function resolveSession(window) {
    const config = getSupabaseConfig(window);
    if (!config) return null;

    const hash = String(window?.location?.hash || "").replace(/^#/, "");
    if (hash) {
      const params = new URLSearchParams(hash);
      if (params.get("access_token")) {
        const session = {
          access_token: params.get("access_token"),
          refresh_token: params.get("refresh_token"),
          expires_in: Number(params.get("expires_in")) || undefined,
          token_type: params.get("token_type") || "bearer",
        };
        storeSession(window, session);
        window.history?.replaceState?.(null, "", `${window.location.pathname}${window.location.search}`);
        return session;
      }
    }

    const stored = readStoredSession(window);
    if (!stored) return null;
    if (!stored.refresh_token) return stored;

    try {
      const refreshed = await requestAuth(window, "token?grant_type=refresh_token", {
        refresh_token: stored.refresh_token,
      });
      if (refreshed?.access_token) {
        storeSession(window, refreshed);
        return refreshed;
      }
    } catch {
      clearStoredSession(window);
    }
    return null;
  }

  async function fetchLatestSnapshot(window) {
    const config = getSupabaseConfig(window);
    if (!config || typeof window?.fetch !== "function") return null;

    const session = await resolveSession(window);
    const bearer = session?.access_token || (config.requireAuth ? null : config.anonKey);
    if (!bearer) {
      const error = new Error("AUTH_REQUIRED");
      error.code = "AUTH_REQUIRED";
      throw error;
    }

    const query = new URLSearchParams({
      select:
        "period_start,period_end,snapshot_at,activations,cancellations,net_additions,active_base,churn_rate,due_amount,received_amount,outstanding_amount,collection_rate,overdue_title_count,arpu_amount,upgrades,downgrades,plan_delta_amount,service_open_count,service_overdue_count,support_open_count,support_overdue_count,breakdown,data_quality,financial_data_state,operational_data_state,sync_status,sync_finished_at",
      order: "period_end.desc,snapshot_at.desc",
      limit: "1",
    });
    const response = await window.fetch(`${config.url}/rest/v1/dashboard_latest?${query}`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${bearer}`,
      },
    });

    if (!response.ok) throw new Error(`Supabase respondeu HTTP ${response.status}.`);
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  function formatInteger(value, signed = false) {
    const number = Number(value) || 0;
    const formatted = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(number);
    return signed && number > 0 ? `+${formatted}` : formatted;
  }

  function formatIntegerOrDash(value, signed = false) {
    const number = toNullableNumber(value);
    return number === null ? "—" : formatInteger(number, signed);
  }

  function formatRate(value) {
    const number = toNullableNumber(value);
    return number === null
      ? "—"
      : `${(number * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  }

  function formatCompactCurrency(value) {
    const number = Number(value) || 0;
    const absolute = Math.abs(number);
    const sign = number < 0 ? "-" : "";
    if (absolute >= 1000000) {
      return `${sign}R$ ${(absolute / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
    }
    if (absolute >= 1000) {
      return `${sign}R$ ${(absolute / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
    }
    return formatCurrency(number);
  }

  function formatCompactCurrencyOrDash(value) {
    return toNullableNumber(value) === null ? "—" : formatCompactCurrency(value);
  }

  function formatRelativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "data indisponível";
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "agora";
    if (minutes === 1) return "há 1 min";
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return "há 1 h";
    if (hours < 24) return `há ${hours} h`;
    return `há ${Math.floor(hours / 24)} d`;
  }

  function formatPeriodLabel(periodEnd) {
    const date = new Date(`${periodEnd}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    const month = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(date);
    return `${date.getUTCFullYear()} até ${month}`;
  }

  function applyLiveSnapshot(document, snapshot) {
    if (!snapshot) return null;

    const setText = (selector, value) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.textContent = String(value);
      });
    };
    const metrics = deriveExecutiveMetrics(snapshot);
    const activations = metrics.activations;
    const cancellations = metrics.cancellations;
    const netAdditions = metrics.netAdditions;
    const upgrades = toNullableNumber(snapshot.upgrades);
    const downgrades = toNullableNumber(snapshot.downgrades);
    const planDelta = toNullableNumber(snapshot.plan_delta_amount);
    const financialKnown = ["complete", "partial"].includes(metrics.financialState);
    const due = financialKnown ? metrics.dueAmount : null;
    const received = financialKnown ? metrics.receivedAmount : null;
    const outstanding = financialKnown ? metrics.outstandingAmount : null;
    const quality = snapshot.data_quality || {};
    const records = toNullableNumber(quality.records_received);
    const syncAt = snapshot.sync_finished_at || snapshot.snapshot_at;

    setText("[data-live-active-base]", formatIntegerOrDash(metrics.activeBase));
    setText("[data-live-churn]", formatRate(metrics.churnRate));
    setText("[data-live-activations]", formatIntegerOrDash(activations));
    setText("[data-live-cancellations]", formatIntegerOrDash(cancellations));
    setText("[data-live-net-additions]", formatIntegerOrDash(netAdditions, true));
    setText("[data-live-received-money]", formatCompactCurrencyOrDash(received));
    setText("[data-live-delinquency]", formatRate(metrics.delinquencyRate));
    setText("[data-live-collection-rate]", formatRate(financialKnown ? metrics.collectionRate : null));
    setText("[data-live-overdue-titles]", formatIntegerOrDash(financialKnown ? metrics.overdueTitleCount : null));
    setText("[data-live-open-operations]", formatIntegerOrDash(metrics.operationalBacklog));
    setText("[data-live-overdue-operations]", formatIntegerOrDash(metrics.operationalOverdue));
    setText("[data-live-financial-state]", formatDataState(metrics.financialState));
    setText("[data-live-operational-state]", formatDataState(metrics.operationalState));
    setText("[data-live-received]", formatCompactCurrencyOrDash(received));
    setText("[data-live-outstanding-money]", formatCompactCurrencyOrDash(outstanding));
    setText("[data-live-upgrades]", formatIntegerOrDash(upgrades));
    setText("[data-live-downgrades]", formatIntegerOrDash(downgrades));
    setText(
      "[data-live-movement-copy]",
      `${formatIntegerOrDash(activations)} ativações · ${formatIntegerOrDash(cancellations)} cancelamentos`,
    );
    setText("[data-live-activation-copy]", `${formatIntegerOrDash(activations)} no período sincronizado.`);
    setText("[data-live-cancellation-copy]", `${formatIntegerOrDash(cancellations)} no período sincronizado.`);
    setText(
      "[data-live-finance-copy]",
      financialKnown ? `${formatCompactCurrencyOrDash(received)} recebidos no período` : formatDataState(metrics.financialState),
    );
    setText(
      "[data-live-due-copy]",
      financialKnown ? `de ${formatCompactCurrencyOrDash(due)} previstos.` : "Aguardando leitura financeira do IXC.",
    );
    setText(
      "[data-live-outstanding-copy]",
      financialKnown ? `${formatCompactCurrencyOrDash(outstanding)} não recebidos.` : "Sem base financeira confiável.",
    );
    setText(
      "[data-live-plan-copy]",
      `${formatIntegerOrDash(upgrades)} upgrades · ${formatIntegerOrDash(downgrades)} downgrades.`,
    );
    setText("[data-live-updated]", syncAt ? new Date(syncAt).toLocaleString("pt-BR") : "snapshot disponível");
    setText("[data-live-sync-age]", formatRelativeTime(syncAt));
    setText("[data-live-badge]", "DADOS DO IXC");
    setText("[data-live-ixc-status]", "Conectado · real");
    setText("[data-live-n8n-status]", "Recebido via n8n");
    setText("[data-live-supabase-status]", "RLS · leitura OK");
    setText("[data-live-ixc-read]", formatRelativeTime(syncAt));
    setText("[data-live-records]", formatIntegerOrDash(records));
    setText("[data-live-n8n-run]", formatRelativeTime(syncAt));
    setText("[data-live-n8n-state]", snapshot.sync_status || "concluído");
    setText("[data-live-supabase-write]", formatRelativeTime(snapshot.snapshot_at));

    const receivedStack = document.querySelector("[data-live-received-stack]");
    const pendingStack = document.querySelector("[data-live-pending-stack]");
    const collectionRate = financialKnown ? metrics.collectionRate : null;
    if (receivedStack && pendingStack && collectionRate !== null) {
      receivedStack.style.width = `${Math.max(0, Math.min(100, collectionRate * 100))}%`;
      pendingStack.style.width = `${Math.max(0, Math.min(100, (1 - collectionRate) * 100))}%`;
    } else if (receivedStack && pendingStack) {
      receivedStack.style.width = "0%";
      pendingStack.style.width = "0%";
    }

    const monthly = snapshot.breakdown?.monthly || {};
    const months = Object.entries(monthly).sort(([left], [right]) => left.localeCompare(right));
    const chartMonths = [...document.querySelectorAll("[data-live-chart] .chart-month")];
    const maximum = Math.max(1, ...months.flatMap(([, value]) => [Number(value.activations) || 0, Number(value.cancellations) || 0]));
    chartMonths.forEach((chartMonth, index) => {
      const entry = months[index];
      if (!entry) {
        chartMonth.hidden = true;
        return;
      }
      chartMonth.hidden = false;
      const [key, value] = entry;
      const activationValue = Number(value.activations) || 0;
      const cancellationValue = Number(value.cancellations) || 0;
      const activationBar = chartMonth.querySelector(".bar--activation");
      const cancellationBar = chartMonth.querySelector(".bar--cancellation");
      activationBar?.style.setProperty("--height", `${Math.max(3, (activationValue / maximum) * 100)}%`);
      cancellationBar?.style.setProperty("--height", `${Math.max(3, (cancellationValue / maximum) * 100)}%`);
      const label = chartMonth.querySelector("span");
      const netLabel = chartMonth.querySelector("small");
      const monthDate = new Date(`${key}-01T12:00:00Z`);
      if (label && !Number.isNaN(monthDate.getTime())) {
        label.textContent = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(monthDate).replace(".", "");
      }
      if (netLabel) netLabel.textContent = formatInteger(activationValue - cancellationValue, true);
    });
    const chartNote = document.querySelector("[data-live-chart-note]");
    if (chartNote) chartNote.textContent = "Série mensal calculada pelos eventos normalizados do IXC no Supabase.";
    return formatPeriodLabel(snapshot.period_end);
  }

  function markLiveUnavailable(document, reason) {
    document.querySelectorAll("[data-live-supabase-status]").forEach((element) => {
      element.textContent = reason;
    });
  }

  function initDashboard(document, window) {
    if (!document || document.documentElement.dataset.dashboardReady === "true") return;
    document.documentElement.dataset.dashboardReady = "true";

    const body = document.body;
    const pageTargets = [...document.querySelectorAll("[data-page-target]")];
    const pages = [...document.querySelectorAll("[data-page]")];
    const pageTitle = document.querySelector("[data-current-page-title]");
    const sidebarToggle = document.querySelector("[data-sidebar-toggle]");

    function activatePage(pageId, options) {
      if (!PAGE_TITLES[pageId]) return;

      pages.forEach((page) => {
        page.hidden = page.dataset.page !== pageId;
      });

      pageTargets.forEach((target) => {
        const active = target.dataset.pageTarget === pageId;
        const isNavigationControl =
          target.classList.contains("nav-item") || Boolean(target.closest(".mobile-nav"));
        if (active && isNavigationControl) target.setAttribute("aria-current", "page");
        else target.removeAttribute("aria-current");
      });

      if (pageTitle) pageTitle.textContent = PAGE_TITLES[pageId];
      document.title = `${PAGE_TITLES[pageId]} · Painel de Resultados`;
      body.dataset.activePage = pageId;

      if (!options?.skipHash && window?.history?.replaceState) {
        window.history.replaceState(null, "", `#${pageId}`);
      }

      if (!options?.skipFocus) {
        document.querySelector("#main-content")?.focus({ preventScroll: true });
      }
    }

    pageTargets.forEach((target) => {
      target.addEventListener("click", () => activatePage(target.dataset.pageTarget));
    });

    sidebarToggle?.addEventListener("click", () => {
      const collapsed = body.classList.toggle("sidebar-collapsed");
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    });

    const initialHash = window?.location?.hash?.replace("#", "");
    activatePage(PAGE_TITLES[initialHash] ? initialHash : "visao-geral", {
      skipHash: true,
      skipFocus: true,
    });

    const drawer = document.querySelector("#detail-drawer");
    const drawerTitle = document.querySelector("[data-drawer-title]");
    const drawerCopy = document.querySelector("[data-drawer-copy]");
    let drawerTrigger = null;

    function openDrawer(trigger) {
      if (!drawer) return;
      drawerTrigger = trigger;
      if (drawerTitle) {
        drawerTitle.textContent = trigger.dataset.drawerTitle || "Evidências do indicador";
      }
      if (drawerCopy) {
        drawerCopy.textContent =
          trigger.dataset.drawerCopy ||
          "Os registros abaixo são demonstrativos e serão substituídos pela trilha sincronizada do IXC.";
      }
      drawer.setAttribute("aria-hidden", "false");
      body.classList.add("drawer-open");
      drawer.querySelector("[data-close-drawer]")?.focus();
    }

    function closeDrawer() {
      if (!drawer) return;
      drawer.setAttribute("aria-hidden", "true");
      body.classList.remove("drawer-open");
      drawerTrigger?.focus?.();
    }

    document.querySelectorAll("[data-open-drawer]").forEach((trigger) => {
      trigger.addEventListener("click", () => openDrawer(trigger));
    });
    document.querySelectorAll("[data-close-drawer]").forEach((trigger) => {
      trigger.addEventListener("click", closeDrawer);
    });

    const alertCards = [...document.querySelectorAll("[data-alert-card]")];
    const alertFilters = [...document.querySelectorAll("[data-alert-filter]")];
    const alertSearch = document.querySelector("[data-alert-search]");
    const alertEmpty = document.querySelector("[data-alert-empty]");
    let selectedAlertSeverity = "todos";

    function applyAlertFilters() {
      const query = alertSearch?.value || "";
      const alerts = alertCards.map((card) => ({
        severity: card.dataset.severity,
        title: card.dataset.alertTitle || card.textContent || "",
        card,
      }));
      const visibleAlerts = filterAlerts(alerts, selectedAlertSeverity, query);
      const visibleSet = new Set(visibleAlerts.map((alert) => alert.card));

      alertCards.forEach((card) => {
        card.hidden = !visibleSet.has(card);
      });
      if (alertEmpty) alertEmpty.hidden = visibleAlerts.length !== 0;
    }

    alertFilters.forEach((filter) => {
      filter.addEventListener("click", () => {
        selectedAlertSeverity = filter.dataset.alertFilter || "todos";
        alertFilters.forEach((item) => {
          item.setAttribute("aria-pressed", String(item === filter));
        });
        applyAlertFilters();
      });
    });
    alertSearch?.addEventListener("input", applyAlertFilters);

    const periodSelect = document.querySelector("[data-period-select]");
    const comparisonSelect = document.querySelector("[data-comparison-select]");
    const comparisonNotice = document.querySelector("[data-comparison-notice]");
    let livePeriodLabel = null;

    function updatePeriod() {
      const period = PERIODS[periodSelect?.value] || PERIODS["2026-jul"];
      document.querySelectorAll("[data-period-label]").forEach((label) => {
        label.textContent = periodSelect?.value === "2026-jul" && livePeriodLabel ? livePeriodLabel : period.label;
      });
      document.querySelectorAll("[data-period-freshness]").forEach((label) => {
        label.textContent = period.freshness;
      });

      if (comparisonNotice) {
        const notice = getComparisonNotice(
          periodSelect?.value || "2026-jul",
          comparisonSelect?.value || "2025-jul",
        );
        comparisonNotice.textContent = notice;
        comparisonNotice.hidden = !notice;
      }
    }

    periodSelect?.addEventListener("change", updatePeriod);
    comparisonSelect?.addEventListener("change", updatePeriod);
    updatePeriod();

    const exportModal = document.querySelector("#export-modal");
    let modalTrigger = null;

    function openExportModal(trigger) {
      if (!exportModal) return;
      modalTrigger = trigger;
      exportModal.hidden = false;
      body.classList.add("modal-open");
      exportModal.querySelector("[data-close-export]")?.focus();
    }

    function closeExportModal() {
      if (!exportModal) return;
      exportModal.hidden = true;
      body.classList.remove("modal-open");
      modalTrigger?.focus?.();
    }

    document.querySelectorAll("[data-open-export]").forEach((trigger) => {
      trigger.addEventListener("click", () => openExportModal(trigger));
    });
    document.querySelectorAll("[data-close-export]").forEach((trigger) => {
      trigger.addEventListener("click", closeExportModal);
    });

    const toast = document.querySelector("#app-toast");
    let toastTimeout;

    function showToast(message) {
      if (!toast) return;
      toast.textContent = message;
      toast.hidden = false;
      window?.clearTimeout?.(toastTimeout);
      toastTimeout = window?.setTimeout?.(() => {
        toast.hidden = true;
      }, 3200);
    }

    document.querySelectorAll("[data-toast-message]").forEach((trigger) => {
      trigger.addEventListener("click", () => showToast(trigger.dataset.toastMessage));
    });

    async function loadLiveSnapshot() {
      if (!getSupabaseConfig(window)) return;
      try {
        const snapshot = await fetchLatestSnapshot(window);
        if (!snapshot) {
          markLiveUnavailable(document, "Conectado · sem snapshot");
          return;
        }
        livePeriodLabel = applyLiveSnapshot(document, snapshot);
        updatePeriod();
        showToast("Painel atualizado com o último snapshot do IXC.");
      } catch (error) {
        if (error?.code === "AUTH_REQUIRED") {
          showLogin();
          return;
        }
        markLiveUnavailable(document, "Leitura indisponível");
        document.querySelectorAll("[data-live-n8n-state]").forEach((element) => {
          element.textContent = "aguardando sincronização";
        });
        if (window?.console?.warn) window.console.warn("Falha ao ler snapshot do painel.", error);
      }
    }

    const loginView = document.querySelector("#login-view");
    const appShell = document.querySelector("#dashboard-shell");
    const loginForm = document.querySelector("#login-form");
    const loginError = document.querySelector("[data-login-error]");
    const loginStatus = document.querySelector("[data-login-status]");
    const loginCodeGroup = document.querySelector("#login-code-group");
    const loginCode = document.querySelector("#login-code");
    const loginSubmit = document.querySelector("[data-login-submit]");
    let loginStep = "email";
    let pendingEmail = "";

    function setLoginError(message) {
      if (!loginError) return;
      loginError.textContent = message || "";
      loginError.hidden = !message;
    }

    function setLoginStatus(message) {
      if (!loginStatus) return;
      loginStatus.textContent = message || "";
      loginStatus.hidden = !message;
    }

    function showLogin() {
      document.body.dataset.authState = "signed-out";
      if (loginView) loginView.hidden = false;
      if (appShell) appShell.hidden = true;
      loginStep = "email";
      pendingEmail = "";
      if (loginCodeGroup) loginCodeGroup.hidden = true;
      if (loginCode) loginCode.value = "";
      if (loginSubmit) loginSubmit.textContent = "Enviar código";
      setLoginError("");
      setLoginStatus("");
    }

    function showAuthenticatedApp() {
      document.body.dataset.authState = "authenticated";
      if (loginView) loginView.hidden = true;
      if (appShell) appShell.hidden = false;
      void loadLiveSnapshot();
    }

    async function bootstrapAuth() {
      const config = getSupabaseConfig(window);
      if (!config || !config.requireAuth) {
        if (loginView) loginView.hidden = true;
        if (appShell) appShell.hidden = false;
        document.body.dataset.authState = "local-preview";
        void loadLiveSnapshot();
        return;
      }

      showLogin();
      const session = await resolveSession(window);
      if (session?.access_token) {
        showAuthenticatedApp();
      } else {
        document.querySelector("#login-email")?.focus();
      }
    }

    document.querySelector("[data-logout]")?.addEventListener("click", () => {
      const session = readStoredSession(window);
      clearStoredSession(window);
      if (session?.access_token) {
        void requestAuth(window, "logout", {}, session.access_token).catch(() => undefined);
      }
      showLogin();
      document.querySelector("#login-email")?.focus();
    });

    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.querySelector("#login-email")?.value?.trim();
      const code = loginCode?.value?.trim();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setLoginError("Informe um e-mail corporativo válido.");
        return;
      }

      setLoginError("");
      if (loginStep === "email") {
        try {
          if (loginSubmit) loginSubmit.disabled = true;
          await requestAuth(window, "otp", {
            email,
            create_user: false,
          });
          pendingEmail = email;
          loginStep = "code";
          if (loginCodeGroup) loginCodeGroup.hidden = false;
          if (loginSubmit) loginSubmit.textContent = "Confirmar código";
          setLoginStatus("Código enviado. Confira o e-mail corporativo e informe os seis dígitos.");
          loginCode?.focus();
        } catch (error) {
          setLoginError(`Não foi possível enviar o código: ${error?.message || "tente novamente"}`);
        } finally {
          if (loginSubmit) loginSubmit.disabled = false;
        }
        return;
      }

      if (!code || code.length < 6) {
        setLoginError("Informe o código recebido por e-mail.");
        return;
      }

      try {
        if (loginSubmit) loginSubmit.disabled = true;
        const session = await requestAuth(window, "verify", {
          type: "email",
          email: pendingEmail || email,
          token: code,
        });
        if (!session?.access_token) throw new Error("A sessão não foi retornada pelo Supabase.");
        storeSession(window, session);
        setLoginStatus("");
        showAuthenticatedApp();
      } catch (error) {
        setLoginError(`Código inválido ou expirado: ${error?.message || "tente novamente"}`);
      } finally {
        if (loginSubmit) loginSubmit.disabled = false;
      }
    });

    void bootstrapAuth();

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (body.classList.contains("drawer-open")) closeDrawer();
      else if (body.classList.contains("modal-open")) closeExportModal();
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => initDashboard(document, window));
    } else {
      initDashboard(document, window);
    }
  }

  return {
    PAGE_TITLES,
    PERIODS,
    applyLiveSnapshot,
    deriveExecutiveMetrics,
    fetchLatestSnapshot,
    filterAlerts,
    formatCurrency,
    getComparisonNotice,
    initDashboard,
  };
});
