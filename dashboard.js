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
    movimentos: "Comercial",
    financeiro: "Financeiro",
    planos: "Planos",
  };

  const PERIODS = {
    "2026-jul": {
      label: "2026 até julho",
      scope: "jan-jul",
      freshness: "Aguardando snapshot",
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

  const SNAPSHOT_SELECT =
    "period_start,period_end,snapshot_at,sync_run_id,activations,cancellations,net_additions,active_base,churn_rate,due_amount,received_amount,outstanding_amount,collection_rate,overdue_title_count,arpu_amount,upgrades,downgrades,plan_delta_amount,service_open_count,service_overdue_count,support_open_count,support_overdue_count,breakdown,data_quality,financial_data_state,operational_data_state,sync_status,sync_finished_at";
  const SNAPSHOT_SELECT_LEGACY = SNAPSHOT_SELECT.replace("sync_run_id,", "");

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

  function toCsvInteger(value) {
    const number = toNullableNumber(value);
    return number === null ? "" : String(Math.trunc(number));
  }

  function toCsvMoney(value) {
    const number = toNullableNumber(value);
    return number === null ? "" : number.toFixed(2).replace(".", ",");
  }

  function toCsvRate(value) {
    const number = toNullableNumber(value);
    return number === null ? "" : `${(number * 100).toFixed(2).replace(".", ",")}%`;
  }

  function buildPeriodCsv(rows) {
    const header = [
      "competencia",
      "inicio",
      "fim",
      "ativacoes",
      "cancelamentos",
      "crescimento_liquido",
      "base_ativa",
      "previsto_rs",
      "recebido_rs",
      "nao_recebido_rs",
      "inadimplencia",
      "upgrades",
      "downgrades",
      "estado",
    ];
    const lines = (Array.isArray(rows) ? rows : []).map((row) => {
      const due = toNullableNumber(row?.due_amount);
      const outstanding = toNullableNumber(row?.outstanding_amount);
      const delinquency = due !== null && due > 0 && outstanding !== null ? outstanding / due : null;
      return [
        String(row?.period_start || "").slice(0, 7),
        String(row?.period_start || "").slice(0, 10),
        String(row?.period_end || "").slice(0, 10),
        toCsvInteger(row?.activations),
        toCsvInteger(row?.cancellations),
        toCsvInteger(row?.net_additions),
        toCsvInteger(row?.active_base),
        toCsvMoney(row?.due_amount),
        toCsvMoney(row?.received_amount),
        toCsvMoney(row?.outstanding_amount),
        toCsvRate(delinquency),
        toCsvInteger(row?.upgrades),
        toCsvInteger(row?.downgrades),
        String(row?.sync_status || ""),
      ].join(";");
    });
    return [header.join(";"), ...lines].join("\r\n");
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

  function getContractDataState(snapshot) {
    const quality = snapshot?.data_quality || {};
    const explicitState = quality.source_states?.cliente_contrato || quality.contract_data_state;
    const sourceErrors = Array.isArray(quality.source_errors)
      ? quality.source_errors.map(String)
      : [];
    if (
      sourceErrors.some((source) => source === "cliente_contrato" || source.startsWith("cliente_contrato:")) ||
      String(explicitState || "") === "error"
    ) {
      return "error";
    }
    const truncatedSources = Array.isArray(quality.pagination_truncated_sources)
      ? quality.pagination_truncated_sources.map(String)
      : [];
    if (truncatedSources.includes("cliente_contrato")) return "partial";

    const pagination = quality.pagination?.cliente_contrato;
    if (pagination && typeof pagination === "object") {
      if (pagination.truncated === true || String(pagination.truncated).toLowerCase() === "true") return "partial";
      const coverageConfirmed = pagination.coverage_confirmed === true ||
        String(pagination.coverage_confirmed).toLowerCase() === "true";
      if (coverageConfirmed && (pagination.truncated === false || String(pagination.truncated).toLowerCase() === "false")) {
        return "complete";
      }
      // `truncated=false` only says that the safety limit was not reached. It
      // does not prove that the IXC returned every page of the dataset.
      return "partial";
    }

    const contractsReceived = toNullableNumber(quality.contracts_received);
    const activeContractsCurrent = quality.active_contracts_current;
    const activeContractsCurrentMissing = activeContractsCurrent === null || activeContractsCurrent === undefined;
    if (contractsReceived !== null && contractsReceived > 0 && activeContractsCurrentMissing) return "partial";
    if (contractsReceived !== null && contractsReceived > 0 && snapshot?.active_base === null) return "partial";
    if (!explicitState && contractsReceived === 0 && activeContractsCurrentMissing && snapshot?.active_base === null) {
      return "unavailable";
    }
    if (explicitState) return String(explicitState);
    if (contractsReceived !== null && contractsReceived >= 1000) return "partial";
    return "complete";
  }

  function getLiveSourceNotice(snapshot) {
    if (!snapshot) return "Aguardando snapshot do IXC para confirmar a cobertura da base.";

    const quality = snapshot.data_quality || {};
    const contractsReceived = toNullableNumber(quality.contracts_received);
    const baseState = getContractDataState(snapshot);
    const parts = [];

    if (baseState === "partial") {
      const receivedLabel = contractsReceived === null
        ? "quantidade não informada"
        : `${formatInteger(contractsReceived)} contratos`;
      parts.push(`cobertura parcial: ${receivedLabel} recebidos; base ativa não foi confirmada`);
    } else if (baseState === "error") {
      parts.push("contratos indisponíveis por erro na fonte");
    } else if (baseState === "unavailable") {
      parts.push("contratos indisponíveis");
    } else if (contractsReceived !== null) {
      parts.push(`cobertura confirmada: ${formatInteger(contractsReceived)} contratos`);
    }

    const financialState = String(snapshot.financial_data_state || quality.financial_data_state || "");
    if (financialState === "unavailable") parts.push("financeiro indisponível");
    if (financialState === "partial") parts.push("financeiro parcial");

    const operationalState = String(snapshot.operational_data_state || quality.operational_data_state || "");
    if (operationalState === "unavailable") parts.push("operação indisponível");
    if (operationalState === "partial") parts.push("operação parcial");

    const sourceErrors = Array.isArray(quality.source_errors)
      ? quality.source_errors.map(String).filter(Boolean)
      : [];
    if (sourceErrors.length) parts.push(`erro na fonte: ${sourceErrors.slice(0, 2).join(", ")}`);

    if (!parts.length) {
      const state = String(snapshot.sync_status || "").toLowerCase();
      if (state === "running") return "Sincronização do IXC em andamento; aguarde a finalização.";
      if (state === "error") return "Sincronização do IXC com erro; os indicadores não devem ser usados como base completa.";
      return "Cobertura do IXC não informada neste snapshot.";
    }

    return `IXC: ${parts.join(" · ")}.`;
  }

  function getLiveIxcStatus(state) {
    switch (String(state || "")) {
      case "complete":
        return "Conectado · real";
      case "partial":
        return "Conectado · dados parciais";
      case "error":
        return "Conectado · erro na fonte";
      case "unavailable":
        return "Conectado · dados indisponíveis";
      default:
        return "Conectado · estado não confirmado";
    }
  }

  function deriveExecutiveMetrics(snapshot) {
    const source = snapshot || {};
    const syncStatus = String(source.sync_status || "").toLowerCase();
    const snapshotUsable = !["error", "running"].includes(syncStatus);
    const quality = source.data_quality || {};
    const sourceStates = quality.source_states || {};
    const hasMovementState = quality.movement_data_state || sourceStates.ixc_logs;
    const movementState = String(
      hasMovementState || (source.activations === undefined && source.cancellations === undefined ? "unavailable" : "complete"),
    );
    const monthlyPlanRows = source.breakdown?.monthly && typeof source.breakdown.monthly === "object"
      ? Object.values(source.breakdown.monthly)
      : [];
    const hasPlanFields = ["upgrades", "downgrades", "plan_delta_amount"].some((key) =>
      Object.prototype.hasOwnProperty.call(source, key),
    ) || monthlyPlanRows.some((row) => row && ["upgrades", "downgrades", "plan_delta_amount", "plan_transitions"].some((key) =>
      Object.prototype.hasOwnProperty.call(row, key),
    ));
    const planState = String(
      quality.plan_data_state || (hasPlanFields ? "complete" : "unavailable"),
    );
    const movementAvailable = snapshotUsable && movementState === "complete";
    const planAvailable = snapshotUsable && planState === "complete";
    const baseDataState = getContractDataState(source);
    const activeBase = snapshotUsable && baseDataState === "complete" ? toNullableNumber(source.active_base) : null;
    const activations = movementAvailable ? toNullableNumber(source.activations) : null;
    const cancellationState = quality.cancellations_data_state || source.cancellations_data_state || movementState;
    const cancellations = snapshotUsable && cancellationState === "complete" ? toNullableNumber(source.cancellations) : null;
    const dueAmount = snapshotUsable ? toNullableNumber(source.due_amount) : null;
    const receivedAmount = snapshotUsable ? toNullableNumber(source.received_amount) : null;
    const outstandingAmount = snapshotUsable ? toNullableNumber(source.outstanding_amount) : null;
    const serviceOpenCount = snapshotUsable ? toNullableNumber(source.service_open_count) : null;
    const rawServiceOverdueCount = snapshotUsable ? toNullableNumber(source.service_overdue_count) : null;
    const supportOpenCount = snapshotUsable ? toNullableNumber(source.support_open_count) : null;
    const rawSupportOverdueCount = snapshotUsable ? toNullableNumber(source.support_overdue_count) : null;
    const financialState = snapshotUsable
      ? String(source.financial_data_state || (dueAmount === null && receivedAmount === null ? "unavailable" : "partial"))
      : (syncStatus || "error");
    const operationalState = snapshotUsable
      ? String(source.operational_data_state || (serviceOpenCount === null && supportOpenCount === null ? "unavailable" : "partial"))
      : (syncStatus || "error");
    const explicitServiceOverdueState = source.service_overdue_data_state ?? quality.service_overdue_data_state;
    const explicitSupportOverdueState = source.support_overdue_data_state ?? quality.support_overdue_data_state;
    const explicitOperationalOverdueState = source.operational_overdue_data_state ?? quality.operational_overdue_data_state;
    const serviceOverdueDataState = explicitServiceOverdueState
      ? String(explicitServiceOverdueState)
      : (explicitOperationalOverdueState === "complete" || operationalState === "complete") && rawServiceOverdueCount !== null
        ? "complete"
        : "unavailable";
    const supportOverdueDataState = explicitSupportOverdueState
      ? String(explicitSupportOverdueState)
      : (explicitOperationalOverdueState === "complete" || operationalState === "complete") && rawSupportOverdueCount !== null
        ? "complete"
        : "unavailable";
    const operationalOverdueDataState = explicitOperationalOverdueState
      ? String(explicitOperationalOverdueState)
      : serviceOverdueDataState === "complete" && supportOverdueDataState === "complete"
        ? "complete"
        : serviceOverdueDataState === "unavailable" && supportOverdueDataState === "unavailable"
          ? "unavailable"
          : "partial";
    const serviceOverdueCount = snapshotUsable && serviceOverdueDataState === "complete" ? rawServiceOverdueCount : null;
    const supportOverdueCount = snapshotUsable && supportOverdueDataState === "complete" ? rawSupportOverdueCount : null;
    const netAdditions = movementAvailable
      ? toNullableNumber(source.net_additions) ??
        (activations !== null && cancellations !== null ? activations - cancellations : null)
      : null;
    const churnRate = movementAvailable && baseDataState === "complete"
      ? toNullableNumber(source.churn_rate) ??
        (activeBase !== null && activeBase > 0 && cancellations !== null ? cancellations / activeBase : null)
      : null;
    const collectionRate =
      toNullableNumber(source.collection_rate) ??
      (dueAmount !== null && dueAmount > 0 && receivedAmount !== null ? receivedAmount / dueAmount : null);
    const delinquencyRate =
      dueAmount !== null && dueAmount > 0 && outstandingAmount !== null
        ? outstandingAmount / dueAmount
        : null;
    const operationalAvailable = ["complete", "partial"].includes(operationalState);
    const operationalBacklog =
      !operationalAvailable || (serviceOpenCount === null && supportOpenCount === null)
        ? null
        : (serviceOpenCount || 0) + (supportOpenCount || 0);
    const operationalOverdue =
      operationalOverdueDataState !== "complete" || (serviceOverdueCount === null || supportOverdueCount === null)
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
      overdueTitleCount: snapshotUsable ? toNullableNumber(source.overdue_title_count) : null,
      arpuAmount: snapshotUsable ? toNullableNumber(source.arpu_amount) : null,
      serviceOpenCount,
      serviceOverdueCount,
      supportOpenCount,
      supportOverdueCount,
      operationalBacklog,
      operationalOverdue,
      serviceOverdueDataState,
      supportOverdueDataState,
      operationalOverdueDataState,
      financialState,
      operationalState,
      movementState,
      planState,
      baseDataState,
      movementAvailable,
      planAvailable,
      syncStatus,
      snapshotUsable,
    };
  }

  const DATA_STATE_LABELS = {
    complete: "Dados completos",
    partial: "Dados parciais",
    unavailable: "Dados indisponíveis",
    error: "Erro na fonte",
    running: "Sincronização em andamento",
  };

  function formatDataState(state) {
    return DATA_STATE_LABELS[String(state)] || "Estado não informado";
  }

  function setConfidenceState(document, key, state, detail) {
    const item = document.querySelector(`[data-confidence-item="${key}"]`);
    const value = document.querySelector(`[data-live-confidence-${key}]`);
    if (!item || !value) return;
    const normalized = String(state || "unavailable").toLowerCase();
    const tone = ["complete", "partial", "unavailable", "error"].includes(normalized) ? normalized : "unavailable";
    item.dataset.state = tone;
    value.textContent = detail || formatDataState(tone);
  }

  function getSupabaseConfig(window) {
    const config = window?.PAINEL_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey) return null;
    return {
      url: String(config.url).replace(/\/$/, ""),
      anonKey: String(config.anonKey),
      requireAuth: config.requireAuth !== false,
      sessionStorageKey: String(config.sessionStorageKey || "painel-resultados-session"),
      refreshIntervalMs: Number.isFinite(Number(config.refreshIntervalMs))
        ? Math.min(Math.max(Number(config.refreshIntervalMs), 0), 3600000)
        : 0,
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

  async function readResponseError(response) {
    try {
      const readable = typeof response?.clone === "function" ? response.clone() : response;
      const body = await readable.json();
      if (typeof body === "string") return body;
      return String(body?.message || body?.hint || body?.details || body?.code || "");
    } catch {
      return "";
    }
  }

  function formatAuthError(error, fallback) {
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
    if (message.includes("email rate limit exceeded")) {
      return "O limite de envio de links foi atingido. Use o último e-mail recebido ou aguarde a liberação automática.";
    }
    if (message.includes("user not found")) return "E-mail não autorizado para este painel.";
    return fallback;
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

  function buildSnapshotQuery(options = {}) {
    const requestedYear = Number(options.year);
    const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 9999
      ? requestedYear
      : new Date().getFullYear();
    const monthKey = String(options.monthKey || "");
    const latest = options.latest === true;
    const query = new URLSearchParams({
      select: options.includeSyncRunId === false ? SNAPSHOT_SELECT_LEGACY : SNAPSHOT_SELECT,
    });

    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      query.set("period_start", `eq.${monthKey}-01`);
      query.set("order", "period_end.desc,snapshot_at.desc");
      query.set("limit", "1");
      return query;
    }

    const limitValue = Number(options.limit);
    const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 12) : 12;
    query.set("period_start", `gte.${year}-01-01`);
    query.set("period_end", `lt.${year + 1}-01-01`);
    query.set("order", latest ? "period_start.desc,snapshot_at.desc" : "period_start.asc,snapshot_at.desc");
    query.set("limit", String(limit));
    return query;
  }

  async function getSnapshotFetchContext(window) {
    const config = getSupabaseConfig(window);
    if (!config || typeof window?.fetch !== "function") return null;

    const session = await resolveSession(window);
    const bearer = session?.access_token || (config.requireAuth ? null : config.anonKey);
    if (!bearer) {
      const error = new Error("AUTH_REQUIRED");
      error.code = "AUTH_REQUIRED";
      throw error;
    }

    return { config, bearer };
  }

  async function fetchSnapshots(window, options = {}) {
    const context = await getSnapshotFetchContext(window);
    if (!context) return [];

    const query = buildSnapshotQuery(options);
    const headers = {
      apikey: context.config.anonKey,
      Authorization: `Bearer ${context.bearer}`,
    };
    let response = await window.fetch(`${context.config.url}/rest/v1/dashboard_latest?${query}`, {
      headers: {
        ...headers,
      },
    });

    if (!response.ok) {
      const detail = await readResponseError(response);
      const isLegacyViewError = options.includeSyncRunId !== false &&
        response.status === 400 &&
        /sync_run_id|column|schema cache/i.test(detail);
      if (isLegacyViewError) {
        const legacyQuery = buildSnapshotQuery({ ...options, includeSyncRunId: false });
        response = await window.fetch(`${context.config.url}/rest/v1/dashboard_latest?${legacyQuery}`, {
          headers,
        });
        if (!response.ok) throw new Error(`Supabase respondeu HTTP ${response.status}.`);
        const legacyRows = await response.json();
        const normalizedRows = Array.isArray(legacyRows)
          ? legacyRows.map((row) => ({ ...row, sync_run_id: null }))
          : [];
        return dedupeSnapshots(normalizedRows);
      }
      throw new Error(`Supabase respondeu HTTP ${response.status}.`);
    }
    const rows = await response.json();
    return dedupeSnapshots(rows);
  }

  async function fetchLatestSnapshot(window, options = {}) {
    const rows = await fetchSnapshots(window, {
      ...options,
      limit: 1,
      latest: true,
    });
    return rows[0] || null;
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

  function formatOperationalOverdue(value, state) {
    return String(state || "") === "complete" ? formatIntegerOrDash(value) : "Não calculado";
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

  function formatCurrencyOrDash(value) {
    return toNullableNumber(value) === null ? "—" : formatCurrency(value);
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

  function formatShortDate(value) {
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(date);
  }

  function getArpuPresentation(snapshot) {
    const quality = snapshot?.data_quality || {};
    const coverageEnd = String(quality.coverage_end || "");
    const periodEnd = String(snapshot?.period_end || "");
    if (coverageEnd && periodEnd && coverageEnd < periodEnd) {
      return {
        label: "Recebido por contrato",
        copy: `acumulado até ${formatShortDate(coverageEnd) || coverageEnd}`,
      };
    }
    return {
      label: "ARPU recebido",
      copy: "média recebida por contrato no mês",
    };
  }

  function getSnapshotFreshness(snapshot) {
    if (!snapshot) return "Aguardando snapshot";
    const quality = snapshot.data_quality || {};
    const coverageEnd = String(quality.coverage_end || "");
    const periodEnd = String(snapshot.period_end || "");
    const baseDataState = getContractDataState(snapshot);
    const cancellationState = String(quality.cancellations_data_state || snapshot.cancellations_data_state || "");
    if (
      snapshot.sync_status === "error" ||
      quality.movement_data_state === "error" ||
      quality.plan_data_state === "error" ||
      cancellationState === "error" ||
      baseDataState === "error"
    ) return "Erro na sincronização";
    if (snapshot.sync_status === "running") return "Sincronização em andamento";
    if (
      snapshot.sync_status === "partial" ||
      snapshot.financial_data_state === "partial" ||
      snapshot.operational_data_state === "partial" ||
      quality.movement_data_state === "partial" ||
      quality.plan_data_state === "partial" ||
      cancellationState === "partial" ||
      baseDataState === "partial"
    ) {
      return "Dados parciais";
    }
    if (coverageEnd && periodEnd && coverageEnd < periodEnd) {
      const coverageLabel = formatShortDate(coverageEnd);
      return coverageLabel ? `Mês parcial · cobertura até ${coverageLabel}` : "Mês parcial";
    }
    return "Sincronizado via n8n";
  }

  function updateFreshnessLights(document, freshness) {
    const isGood = String(freshness) === "Sincronizado via n8n";
    document.querySelectorAll(".freshness-stamp .status-light, .sync-mini .status-light").forEach((element) => {
      element.classList.toggle("status-light--good", isGood);
      element.classList.toggle("status-light--warning", !isGood);
    });
  }

  function buildMonthlySeries(snapshots) {
    return (Array.isArray(snapshots) ? snapshots : []).reduce((series, row) => {
      const key = String(row?.period_start || "").slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key) || !row) return series;
      const metrics = deriveExecutiveMetrics(row);
      series[key] = { activations: metrics.activations, cancellations: metrics.cancellations };
      return series;
    }, {});
  }

  function isCanonicalMonthlySnapshot(snapshot) {
    const periodStart = String(snapshot?.period_start || "").slice(0, 10);
    const periodEnd = String(snapshot?.period_end || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return false;
    const [year, month] = periodStart.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return periodEnd === lastDay;
  }

  function compareSnapshotRecency(left, right) {
    const leftIsMonthly = isCanonicalMonthlySnapshot(left) ? 1 : 0;
    const rightIsMonthly = isCanonicalMonthlySnapshot(right) ? 1 : 0;
    if (leftIsMonthly !== rightIsMonthly) return leftIsMonthly - rightIsMonthly;
    const leftPeriodEnd = String(left?.period_end || "");
    const rightPeriodEnd = String(right?.period_end || "");
    if (leftPeriodEnd !== rightPeriodEnd) return leftPeriodEnd.localeCompare(rightPeriodEnd);
    const leftSnapshotAt = String(left?.snapshot_at || "");
    const rightSnapshotAt = String(right?.snapshot_at || "");
    if (leftSnapshotAt !== rightSnapshotAt) return leftSnapshotAt.localeCompare(rightSnapshotAt);
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  }

  function dedupeSnapshots(snapshots) {
    const byPeriod = new Map();
    (Array.isArray(snapshots) ? snapshots : []).forEach((row) => {
      if (!row || typeof row !== "object") return;
      if (String(row.sync_status || "").toLowerCase() === "running") return;
      const periodKey = String(row.period_start || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return;
      const current = byPeriod.get(periodKey);
      if (!current || compareSnapshotRecency(row, current) > 0) byPeriod.set(periodKey, row);
    });
    return [...byPeriod.values()].sort((left, right) =>
      String(left.period_start).localeCompare(String(right.period_start)),
    );
  }

  function mergeMonthlySeries(monthly, snapshots, movementState) {
    const fallback = buildMonthlySeries(snapshots);
    const supplied = monthly && typeof monthly === "object" ? monthly : {};
    const keys = [...new Set([...Object.keys(fallback), ...Object.keys(supplied)])]
      .filter((key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key))
      .sort();

    return keys.reduce((series, key) => {
      // The current monthly snapshot also carries that month's quality state.
      // Its nulls must not be replaced by an older aggregate's counts.
      if (Object.prototype.hasOwnProperty.call(fallback, key)) {
        series[key] = fallback[key];
        return series;
      }
      const value = supplied[key] && typeof supplied[key] === "object" ? supplied[key] : {};
      const metrics = deriveExecutiveMetrics({
        ...value,
        data_quality: {
          ...value.data_quality,
          movement_data_state: value.movement_data_state || value.data_quality?.movement_data_state || movementState,
        },
      });
      series[key] = { activations: metrics.activations, cancellations: metrics.cancellations };
      return series;
    }, {});
  }

  function createInlineDataState(document, title, copy) {
    const state = document.createElement("div");
    state.className = "data-empty-inline";
    const titleElement = document.createElement("strong");
    titleElement.textContent = title;
    const copyElement = document.createElement("span");
    copyElement.textContent = copy;
    state.append(titleElement, copyElement);
    return state;
  }

  function renderLiveDecisionQueue(document, snapshot) {
    const container = document.querySelector("[data-live-priority-list]");
    if (!container) return;

    container.replaceChildren();
    const metrics = deriveExecutiveMetrics(snapshot);
    const priorities = [];
    const addPriority = (severity, title, detail) => priorities.push({ severity, title, detail });

    if (metrics.movementAvailable && metrics.activations !== null && metrics.cancellations !== null && metrics.cancellations > metrics.activations) {
      addPriority(
        "warning",
        "Cancelamentos superam ativações",
        `${formatInteger(metrics.cancellations)} cancelamentos · ${formatInteger(metrics.activations)} ativações`,
      );
    }
    if (metrics.planAvailable) {
      const upgrades = toNullableNumber(snapshot?.upgrades);
      const downgrades = toNullableNumber(snapshot?.downgrades);
      if (upgrades !== null && downgrades !== null && downgrades > upgrades) {
        addPriority(
          "critical",
          "Downgrades acima de upgrades",
          `${formatInteger(downgrades)} downgrades · ${formatInteger(upgrades)} upgrades`,
        );
      }
    }
    if (metrics.financialState === "complete" && metrics.delinquencyRate !== null && metrics.delinquencyRate > 0.03) {
      addPriority(
        "warning",
        "Inadimplência acima de 3%",
        `${formatRate(metrics.delinquencyRate)} do previsto`,
      );
    }

    if (!priorities.length) {
      const hasIncompleteEvidence = [
        metrics.movementState,
        metrics.planState,
        metrics.financialState,
        metrics.operationalState,
      ].some((state) => ["partial", "unavailable", "error"].includes(String(state)));
      container.appendChild(createInlineDataState(
        document,
        hasIncompleteEvidence ? "Prioridades indisponíveis" : "Nenhuma prioridade calculada",
        hasIncompleteEvidence
          ? "O snapshot não trouxe evidência completa para classificar decisões executivas."
          : "Nenhum desvio foi calculado para a competência selecionada.",
      ));
      return;
    }

    priorities.forEach(({ severity, title, detail }) => {
      const item = document.createElement("div");
      item.className = "priority-item";
      const severityElement = document.createElement("span");
      severityElement.className = `severity severity--${severity}`;
      severityElement.textContent = severity === "critical" ? "Crítico" : "Atenção";
      const titleElement = document.createElement("strong");
      titleElement.textContent = title;
      const detailElement = document.createElement("small");
      detailElement.textContent = detail;
      item.append(severityElement, titleElement, detailElement);
      container.appendChild(item);
    });
  }

  function renderLiveCancellationReasons(document, snapshot) {
    const container = document.querySelector("[data-live-cancellation-reasons]");
    if (!container) return;

    const monthKey = String(snapshot?.period_start || "").slice(0, 7);
    const supplied = snapshot?.breakdown?.monthly?.[monthKey]?.cancellation_reasons ?? snapshot?.breakdown?.cancellation_reasons ?? snapshot?.cancellation_reasons;
    const rawEntries = Array.isArray(supplied)
      ? supplied
      : supplied && typeof supplied === "object"
        ? Object.entries(supplied).map(([reason, count]) => ({ reason, count }))
        : [];
    const entries = rawEntries
      .map((entry) => ({
        reason: String(entry?.reason ?? entry?.label ?? entry?.name ?? "").trim(),
        count: toNullableNumber(entry?.count ?? entry?.total ?? entry?.value),
      }))
      .filter((entry) => entry.reason && entry.count !== null && entry.count > 0)
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));

    container.replaceChildren();
    if (!entries.length) {
      container.appendChild(createInlineDataState(
        document,
        "Motivos indisponíveis",
        "O IXC não forneceu motivos de cancelamento neste snapshot.",
      ));
      return;
    }

    const maximum = Math.max(...entries.map((entry) => entry.count));
    entries.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "rank-row";
      const label = document.createElement("span");
      const position = document.createElement("b");
      position.textContent = String(index + 1).padStart(2, "0");
      label.append(position, document.createTextNode(` ${entry.reason}`));
      const track = document.createElement("div");
      track.className = "rank-track";
      const bar = document.createElement("i");
      bar.style.setProperty("--value", `${Math.max(8, Math.round((entry.count / maximum) * 100))}%`);
      track.appendChild(bar);
      const count = document.createElement("strong");
      count.textContent = formatInteger(entry.count);
      row.append(label, track, count);
      container.appendChild(row);
    });
  }

  function renderLiveAlerts(document, snapshot) {
    const container = document.querySelector("[data-live-alert-list]");
    if (!container) return;

    const supplied = snapshot?.breakdown?.alerts ?? snapshot?.alerts;
    const entries = (Array.isArray(supplied) ? supplied : [])
      .map((alert) => ({
        severity: String(alert?.severity || "atencao").toLowerCase(),
        title: String(alert?.title || "").trim().slice(0, 160),
        area: String(alert?.area || "Integrações").trim().slice(0, 80),
        evidence: String(alert?.evidence || "Evidência registrada no snapshot sincronizado.").trim().slice(0, 300),
      }))
      .filter((alert) => alert.title)
      .map((alert) => ({
        ...alert,
        severity: ["critico", "atencao", "estavel"].includes(alert.severity) ? alert.severity : "atencao",
      }))
      .slice(0, 20);

    container.replaceChildren();
    const empty = document.querySelector("[data-alert-empty]");
    if (!entries.length) {
      container.appendChild(createInlineDataState(
        document,
        "Nenhum alerta informado",
        "O snapshot não trouxe eventos que atendam às regras de alerta.",
      ));
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    const labels = { critico: "Crítico", atencao: "Atenção", estavel: "Estável" };
    const classes = { critico: "critical", atencao: "warning", estavel: "stable" };
    entries.forEach((alert) => {
      const card = document.createElement("article");
      card.className = "alert-card";
      card.dataset.alertCard = "true";
      card.dataset.severity = alert.severity;
      card.dataset.alertTitle = alert.title;

      const top = document.createElement("div");
      top.className = "alert-card__top";
      const severity = document.createElement("span");
      severity.className = `severity severity--${classes[alert.severity]}`;
      severity.textContent = labels[alert.severity];
      const source = document.createElement("span");
      source.className = "mono";
      source.textContent = "SNAPSHOT";
      top.append(severity, source);

      const title = document.createElement("h2");
      title.textContent = alert.title;
      const evidence = document.createElement("p");
      evidence.textContent = alert.evidence;
      const details = document.createElement("dl");
      const detail = document.createElement("div");
      const detailLabel = document.createElement("dt");
      detailLabel.textContent = "Área";
      const detailValue = document.createElement("dd");
      detailValue.textContent = alert.area;
      detail.append(detailLabel, detailValue);
      details.appendChild(detail);
      card.append(top, title, evidence, details);
      container.appendChild(card);
    });
  }

  function renderPlanTransitions(document, transitions, monthKey, planState = "complete") {
    const container = document.querySelector("[data-live-plan-transitions]");
    if (!container) return;

    const planAvailable = ["complete", "partial"].includes(String(planState));

    const entries = Object.entries(transitions || {})
      .map(([route, count]) => [String(route), toNullableNumber(count)])
      .filter(([, count]) => count !== null && count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

    while (container.firstChild) container.removeChild(container.firstChild);
    const createCell = (tag, text, className) => {
      const element = document.createElement(tag);
      element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const head = document.createElement("div");
    head.className = "matrix-head";
    head.append(
      createCell("span", "Origem → destino"),
      createCell("span", "Quantidade"),
      createCell("span", "Competência"),
      createCell("span", "Fonte"),
    );
    container.appendChild(head);

    if (!planAvailable) {
      const empty = document.createElement("div");
      empty.append(
        createCell("strong", "Transições indisponíveis"),
        createCell("span", "—"),
        createCell("span", monthKey || "—"),
        createCell("span", formatDataState(planState)),
      );
      container.appendChild(empty);
    } else if (!entries.length) {
      const empty = document.createElement("div");
      empty.append(
        createCell("strong", "Nenhuma transição informada"),
        createCell("span", "—"),
        createCell("span", monthKey || "—"),
        createCell("span", "IXC"),
      );
      container.appendChild(empty);
    } else {
      entries.forEach(([route, count]) => {
        const row = document.createElement("div");
        row.append(
          createCell("strong", route),
          createCell("span", formatInteger(count)),
          createCell("span", monthKey || "—"),
          createCell("span", "IXC logs"),
        );
        container.appendChild(row);
      });
    }

    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const stateLabel = !planAvailable
      ? formatDataState(planState)
      : entries.length
        ? `${formatInteger(total)} transições do IXC${planState === "partial" ? " · cobertura parcial" : ""}`
        : `Sem transições informadas${planState === "partial" ? " · cobertura parcial" : ""}`;
    document.querySelectorAll("[data-live-plan-transition-state]").forEach((element) => {
      element.textContent = stateLabel;
    });
  }

  function renderPlanCatalog(document, snapshot) {
    const catalog = snapshot?.breakdown?.plan_catalog;
    const syncUsable = !["running", "error"].includes(String(snapshot?.sync_status || ""));
    const plans = syncUsable && Array.isArray(catalog)
      ? [...new Map(catalog
        .map((plan) => ({ id: String(plan?.id ?? "").trim(), name: String(plan?.name ?? "").trim() }))
        .filter((plan) => plan.id && plan.name)
        .map((plan) => [plan.id, plan])).values()]
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR") || left.id.localeCompare(right.id))
      : [];
    document.querySelectorAll("[data-live-plan-filter]").forEach((select) => {
      const selected = select.value;
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = plans.length ? "Todos os planos" : "Catálogo indisponível";
      const options = plans.map((plan) => {
        const option = document.createElement("option");
        option.value = plan.id;
        option.textContent = plan.name;
        return option;
      });
      select.replaceChildren(empty, ...options);
      if (plans.some(plan => plan.id === selected)) select.value = selected;
      select.disabled = !plans.length || !Object.values(snapshot?.breakdown?.monthly || {}).some(row => row.cancellation_by_plan);
      select.onchange = () => renderCancellationHistory(document, snapshot, select.value);
      renderCancellationHistory(document, snapshot, select.value);
    });
    document.querySelectorAll("[data-live-plan-catalog]").forEach((container) => {
      container.replaceChildren();
      if (!plans.length) {
        container.appendChild(createInlineDataState(document, "Catálogo indisponível", "Aguardando os nomes cadastrados no IXC."));
        return;
      }
      plans.forEach((plan) => {
        const row = document.createElement("div");
        row.className = "plan-catalog-row";
        const name = document.createElement("strong");
        name.textContent = plan.name;
        const id = document.createElement("span");
        id.className = "mono";
        id.textContent = `ID ${plan.id}`;
        row.append(name, id);
        container.appendChild(row);
      });
    });
    document.querySelectorAll("[data-live-plan-catalog-state]").forEach((element) => {
      element.textContent = plans.length ? `${formatInteger(plans.length)} planos do IXC` : "Aguardando catálogo";
    });
  }

  function renderCancellationHistory(document, snapshot, planId = "") {
    const container = document.querySelector("[data-live-cancellation-history]");
    if (!container) return;
    const table = document.createElement("table");
    const caption = document.createElement("caption");
    const plan = snapshot?.breakdown?.plan_catalog?.find(row => String(row.id) === planId);
    caption.textContent = plan ? `Cancelamentos do plano ${plan.name}` : "Cancelamentos de todos os planos";
    const head = document.createElement("thead");
    const heading = document.createElement("tr");
    ["Mês", "Cancelamentos", "Cobertura"].forEach(label => {
      const cell = document.createElement("th"); cell.textContent = label; heading.appendChild(cell);
    });
    head.appendChild(heading);
    const body = document.createElement("tbody");
    Object.entries(snapshot?.breakdown?.monthly || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
      const known = !["running", "error"].includes(snapshot?.sync_status) &&
        (value.cancellations_data_state || snapshot?.data_quality?.cancellations_data_state) === "complete";
      const count = known ? (planId ? toNullableNumber(value.cancellation_by_plan?.[planId] ?? 0) : toNullableNumber(value.cancellations)) : null;
      const row = document.createElement("tr");
      const cutoff = String(snapshot?.data_quality?.coverage_end || "");
      const coverage = key === cutoff.slice(0, 7) ? `Até ${cutoff.split("-").reverse().join("/")}` : "Mês encerrado";
      [key.split("-").reverse().join("/"), formatIntegerOrDash(count), known ? coverage : "Indisponível"].forEach(value => {
        const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.append(caption, head, body);
    container.replaceChildren(table);
  }

  function applyLiveSnapshot(document, snapshot, snapshots = []) {
    if (!snapshot) return null;

    const financialHistory = document.querySelector("[data-financial-history]");
    if (financialHistory) {
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const heading = document.createElement("tr");
      ["Competência", "Previsto", "Recebido", "Em aberto", "% recebido"].forEach((label) => {
        const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; heading.appendChild(cell);
      });
      head.appendChild(heading);
      const tbody = document.createElement("tbody");
      dedupeSnapshots(snapshots.length ? snapshots : [snapshot])
        .filter((row) => String(row.period_start).slice(0, 4) === String(snapshot.period_start).slice(0, 4) && row.period_start <= snapshot.period_start)
        .sort((a, b) => a.period_start.localeCompare(b.period_start))
        .forEach((row) => {
          const metrics = deriveExecutiveMetrics(row);
          const known = metrics.financialState === "complete";
          const tr = document.createElement("tr");
          const month = String(row.period_start).slice(0, 7).split("-").reverse().join("/");
          [month, formatCurrencyOrDash(known ? metrics.dueAmount : null), formatCurrencyOrDash(known ? metrics.receivedAmount : null), formatCurrencyOrDash(known ? metrics.outstandingAmount : null), formatRate(known ? metrics.collectionRate : null)].forEach((value, index) => {
            const td = document.createElement("td"); td.textContent = value;
            if (index === 4 && known && metrics.collectionRate !== null) {
              const meter = document.createElement("span"); meter.className = "financial-meter"; meter.setAttribute("aria-hidden", "true");
              const fill = document.createElement("i"); fill.style.width = `${Math.max(0, Math.min(100, metrics.collectionRate * 100))}%`;
              meter.appendChild(fill); td.appendChild(meter);
            }
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
      table.append(head, tbody); financialHistory.replaceChildren(table);
    }

    const setText = (selector, value) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.textContent = String(value);
      });
    };
    const metrics = deriveExecutiveMetrics(snapshot);
    const baseDataState = metrics.baseDataState;
    const activations = metrics.activations;
    const cancellations = metrics.cancellations;
    const netAdditions = metrics.netAdditions;
    const upgrades = metrics.planAvailable ? toNullableNumber(snapshot.upgrades) : null;
    const downgrades = metrics.planAvailable ? toNullableNumber(snapshot.downgrades) : null;
    const planDelta = metrics.planAvailable ? toNullableNumber(snapshot.plan_delta_amount) : null;
    renderLiveDecisionQueue(document, snapshot);
    renderLiveCancellationReasons(document, snapshot);
    renderLiveAlerts(document, snapshot);
    renderPlanCatalog(document, snapshot);
    // Valores parciais não podem alimentar um KPI executivo: a série atual
    // mistura vencimento e caixa e ainda não tem reconciliação completa.
    const financialKnown = metrics.financialState === "complete";
    const operationalKnown = ["complete", "partial"].includes(metrics.operationalState);
    const due = financialKnown ? metrics.dueAmount : null;
    const received = financialKnown ? metrics.receivedAmount : null;
    const outstanding = financialKnown ? metrics.outstandingAmount : null;
    const quality = snapshot.data_quality || {};
    const contractsReceived = toNullableNumber(quality.contracts_received);
    const syncAt = snapshot.sync_finished_at || snapshot.snapshot_at;
    const arpuPresentation = getArpuPresentation(snapshot);

    setText("[data-live-active-base]", formatIntegerOrDash(metrics.activeBase));
    setText("[data-live-churn]", formatRate(metrics.churnRate));
    setText("[data-live-activations]", formatIntegerOrDash(activations));
    setText("[data-live-cancellations]", formatIntegerOrDash(cancellations));
    setText("[data-live-net-additions]", formatIntegerOrDash(netAdditions, true));
    setText("[data-live-received-money]", formatCompactCurrencyOrDash(received));
    setText("[data-live-delinquency]", formatRate(financialKnown ? metrics.delinquencyRate : null));
    setText("[data-live-collection-rate]", formatRate(financialKnown ? metrics.collectionRate : null));
    setText("[data-live-overdue-titles]", formatIntegerOrDash(financialKnown ? metrics.overdueTitleCount : null));
    setText("[data-live-open-operations]", formatIntegerOrDash(metrics.operationalBacklog));
    setText("[data-live-overdue-operations]", formatOperationalOverdue(metrics.operationalOverdue, metrics.operationalOverdueDataState));
    setText("[data-live-financial-state]", formatDataState(metrics.financialState));
    setText("[data-live-operational-state]", formatDataState(metrics.operationalState));
    setText("[data-live-received]", formatCompactCurrencyOrDash(received));
    setText("[data-live-outstanding-money]", formatCompactCurrencyOrDash(outstanding));
    setText("[data-live-upgrades]", formatIntegerOrDash(upgrades));
    setText("[data-live-downgrades]", formatIntegerOrDash(downgrades));
    setText("[data-live-plan-delta]", formatCurrencyOrDash(planDelta));
    setText("[data-live-arpu-label]", arpuPresentation.label);
    setText("[data-live-arpu-copy]", arpuPresentation.copy);
    const planRatio = upgrades !== null && upgrades > 0 && downgrades !== null ? `${(downgrades / upgrades).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×` : "—";
    setText("[data-live-plan-ratio]", planRatio);
    setText("[data-live-arpu]", formatCompactCurrencyOrDash(metrics.arpuAmount));
    setText("[data-live-due-summary]", formatCompactCurrencyOrDash(due));
    setText("[data-live-received-summary]", formatCompactCurrencyOrDash(received));
    setText("[data-live-outstanding-summary]", formatCompactCurrencyOrDash(outstanding));
    setText("[data-live-collection-summary]", financialKnown ? `${formatRate(metrics.collectionRate)} do previsto` : "—");
    setText("[data-live-delinquency-summary]", financialKnown ? `${formatRate(metrics.delinquencyRate)} do previsto` : "—");
    setText("[data-live-service-open]", formatIntegerOrDash(operationalKnown ? metrics.serviceOpenCount : null));
    setText("[data-live-service-overdue]", formatOperationalOverdue(operationalKnown ? metrics.serviceOverdueCount : null, metrics.serviceOverdueDataState));
    setText("[data-live-support-open]", formatIntegerOrDash(operationalKnown ? metrics.supportOpenCount : null));
    setText("[data-live-support-overdue]", formatOperationalOverdue(operationalKnown ? metrics.supportOverdueCount : null, metrics.supportOverdueDataState));
    setText(
      "[data-live-overdue-operations-copy]",
      metrics.operationalOverdueDataState === "complete"
        ? "O.S. e atendimentos fora da janela."
        : "Prazo operacional não calculado: falta um prazo homologado para toda a fila.",
    );
    const selectedMonthKey = String(snapshot.period_start || "").slice(0, 7);
    renderPlanTransitions(document, snapshot.breakdown?.monthly?.[selectedMonthKey]?.plan_transitions, selectedMonthKey, metrics.planState);
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
    setText("[data-live-badge]", "DADOS DO IXC · MENSAL");
    setText("[data-live-ixc-status]", getLiveIxcStatus(baseDataState));
    setText("[data-live-n8n-status]", "Recebido via n8n");
    setText("[data-live-supabase-status]", "RLS · leitura OK");
    setText("[data-live-ixc-read]", formatRelativeTime(syncAt));
    setText("[data-live-records]", formatIntegerOrDash(contractsReceived));
    setText("[data-live-n8n-run]", formatRelativeTime(syncAt));
    setText("[data-live-sync-run-id]", snapshot.sync_run_id ?? "não informado");
    setText(
      "[data-live-n8n-state]",
      baseDataState === "partial" && snapshot.sync_status === "success" ? "partial" : snapshot.sync_status || "concluído",
    );
    setText("[data-live-supabase-write]", formatRelativeTime(snapshot.snapshot_at));
    setText("[data-live-finance-detail-state]", formatDataState(metrics.financialState));
    const freshness = getSnapshotFreshness(snapshot);
    setText("[data-live-period-state]", freshness);
    setText("[data-live-sync-mini-status]", freshness);
    setText("[data-live-sync-mini-age]", formatRelativeTime(syncAt));
    setText("[data-live-source-notice]", getLiveSourceNotice(snapshot));
    updateFreshnessLights(document, freshness);

    const cancellationState = String(
      quality.cancellations_data_state || snapshot.cancellations_data_state ||
        (cancellations !== null ? "complete" : "unavailable"),
    );
    const commercialState = metrics.movementState === "complete" && baseDataState === "complete"
      ? "complete"
      : metrics.movementState === "error" || baseDataState === "error"
        ? "error"
        : metrics.movementState === "partial" || baseDataState === "partial"
          ? "partial"
          : "unavailable";
    setConfidenceState(
      document,
      "commercial",
      commercialState,
      commercialState === "complete" ? "Base e movimentos confirmados" : formatDataState(commercialState),
    );
    setConfidenceState(document, "finance", metrics.financialState);
    setConfidenceState(document, "operations", metrics.operationalState);
    setConfidenceState(
      document,
      "cancellations",
      cancellationState,
      cancellationState === "complete" && cancellations !== null
        ? `${formatInteger(cancellations)} no período`
        : formatDataState(cancellationState),
    );

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

    const monthly = mergeMonthlySeries(
      snapshot.breakdown?.monthly,
      snapshots.length ? snapshots : isCanonicalMonthlySnapshot(snapshot) ? [snapshot] : [],
      ["running", "error"].includes(String(snapshot.sync_status || "")) ? snapshot.sync_status : metrics.movementState,
    );
    const months = Object.entries(monthly).sort(([left], [right]) => left.localeCompare(right));
    const chartContainer = document.querySelector("[data-live-chart]");
    const chartMonths = [...document.querySelectorAll("[data-live-chart] .chart-month")];
    while (chartContainer && chartMonths.length < months.length) {
      const template = chartMonths[0];
      const chartMonth = template
        ? template.cloneNode(true)
        : (() => {
            const element = document.createElement("div");
            element.className = "chart-month";
            element.innerHTML = '<div class="bars"><i class="bar bar--activation"></i><i class="bar bar--cancellation"></i></div><span></span><small></small>';
            return element;
          })();
      chartContainer.appendChild(chartMonth);
      chartMonths.push(chartMonth);
    }
    const maximum = Math.max(1, ...months.flatMap(([, value]) => [Number(value.activations) || 0, Number(value.cancellations) || 0]));
    chartMonths.forEach((chartMonth, index) => {
      const entry = months[index];
      if (!entry) {
        chartMonth.hidden = true;
        return;
      }
      chartMonth.hidden = false;
      const [key, value] = entry;
      const activationValue = toNullableNumber(value.activations);
      const cancellationValue = toNullableNumber(value.cancellations);
      const activationBar = chartMonth.querySelector(".bar--activation");
      const cancellationBar = chartMonth.querySelector(".bar--cancellation");
      activationBar?.style.setProperty("--height", `${activationValue === null || activationValue === 0 ? 0 : Math.max(3, (activationValue / maximum) * 100)}%`);
      cancellationBar?.style.setProperty("--height", `${cancellationValue === null || cancellationValue === 0 ? 0 : Math.max(3, (cancellationValue / maximum) * 100)}%`);
      chartMonth.setAttribute("aria-label", `${key}: ${activationValue === null ? "ativação indisponível" : `${formatInteger(activationValue)} ativações`}; ${cancellationValue === null ? "cancelamento indisponível" : `${formatInteger(cancellationValue)} cancelamentos`}.`);
      const label = chartMonth.querySelector("span");
      const netLabel = chartMonth.querySelector("small");
      const monthDate = new Date(`${key}-01T12:00:00Z`);
      if (label && !Number.isNaN(monthDate.getTime())) {
        label.textContent = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(monthDate).replace(".", "");
      }
      if (netLabel) netLabel.textContent = activationValue !== null && cancellationValue !== null
        ? formatInteger(activationValue - cancellationValue, true)
        : "—";
    });
    const chartNote = document.querySelector("[data-live-chart-note]");
    if (chartNote) {
      chartNote.textContent = months.some(([, value]) => value.activations === null || value.cancellations === null)
        ? "Competências sem cobertura confirmada aparecem como —. Os demais meses usam seus próprios snapshots do IXC."
        : months.length
          ? "Série mensal calculada pelos eventos normalizados do IXC no Supabase."
          : "Movimentação indisponível: a fonte do IXC não confirmou a série mensal.";
    }
    return formatPeriodLabel(snapshot.period_end);
  }

  function markLiveUnavailable(document, reason) {
    document.querySelectorAll("[data-financial-history]").forEach((element) => { element.textContent = "Histórico financeiro indisponível."; });
    const message = String(reason || "Leitura indisponível");
    const statusSelector = [
      "[data-live-ixc-status]",
      "[data-live-n8n-status]",
      "[data-live-n8n-state]",
      "[data-live-supabase-status]",
      "[data-live-finance-detail-state]",
      "[data-live-operational-state]",
      "[data-live-plan-transition-state]",
      "[data-live-source-notice]",
      "[data-live-sync-mini-status]",
    ].join(", ");
    const valueElements = [...document.querySelectorAll("*")].filter((element) =>
      [...element.attributes].some((attribute) => attribute.name.startsWith("data-live-")),
    );
    valueElements.forEach((element) => {
      if (element.matches("[data-live-chart], [data-live-plan-transitions], [data-live-plan-filter], [data-live-plan-catalog]")) return;
      if (element.matches("[data-live-received-stack], [data-live-pending-stack]")) {
        element.style.width = "0%";
        return;
      }
      if (element.matches("[data-live-badge]")) {
        element.textContent = "SEM SNAPSHOT";
        return;
      }
      if (element.matches(statusSelector)) {
        element.textContent = message;
        return;
      }
      element.textContent = "—";
    });
    document.querySelectorAll("[data-live-plan-transitions]").forEach((element) => element.replaceChildren());
    renderPlanCatalog(document, null);
    document.querySelectorAll("[data-live-chart] .chart-month").forEach((element) => {
      element.hidden = true;
    });
    document.querySelectorAll("[data-live-chart-note]").forEach((element) => {
      element.textContent = message;
    });
    const freshness = message.toLowerCase().includes("sem snapshot")
      ? "Sem snapshot mensal"
      : "Leitura indisponível";
    document.querySelectorAll("[data-period-freshness]").forEach((element) => {
      element.textContent = freshness;
    });
    updateFreshnessLights(document, freshness);
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
      const changed = body.dataset.activePage !== pageId;

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
      const selectedPage = pages.find((page) => page.dataset.page === pageId);
      if (changed && !window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        selectedPage?.getAnimations?.().forEach((animation) => animation.cancel());
        selectedPage?.animate?.([
          { opacity: 0, transform: "translateY(10px)" },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" });
      }
      if (changed && !options?.skipFocus) window?.scrollTo?.({ top: 0, behavior: "instant" });

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
          "Use esta camada para entender a origem e o corte do indicador selecionado.";
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

    const alertFilters = [...document.querySelectorAll("[data-alert-filter]")];
    const alertSearch = document.querySelector("[data-alert-search]");
    const alertEmpty = document.querySelector("[data-alert-empty]");
    let selectedAlertSeverity = "todos";

    function applyAlertFilters() {
      const query = alertSearch?.value || "";
      const alertCards = [...document.querySelectorAll("[data-alert-card]")]
        .filter((card) => card.dataset.demoOnly !== "true");
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
    let liveSnapshots = [];
    let liveYear = null;
    let liveSnapshot = null;
    let livePeriodLabel = null;
    let liveRefreshTimer = null;

    function isMonthKey(value) {
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
    }

    function getSnapshotMonthKey(snapshot) {
      const key = String(snapshot?.period_start || "").slice(0, 7);
      return isMonthKey(key) ? key : null;
    }

    function populatePeriodOptions(rows, desiredMonthKey) {
      if (!periodSelect) return null;
      const availableRows = (Array.isArray(rows) ? rows : [])
        .filter((row) => getSnapshotMonthKey(row))
        .sort((left, right) => getSnapshotMonthKey(left).localeCompare(getSnapshotMonthKey(right)));
      const fallbackYear = liveYear || new Date().getFullYear();
      const options = availableRows.map((row) => {
        const key = getSnapshotMonthKey(row);
        const option = document.createElement("option");
        option.value = key;
        option.textContent = formatPeriodLabel(row.period_end) || key;
        return option;
      });

      if (!options.length) {
        const option = document.createElement("option");
        option.value = `${fallbackYear}-01`;
        option.textContent = `${fallbackYear} · aguardando snapshot`;
        options.push(option);
      }

      periodSelect.replaceChildren(...options);
      const requested = isMonthKey(desiredMonthKey) ? desiredMonthKey : null;
      const latest = getSnapshotMonthKey(availableRows[availableRows.length - 1]);
      periodSelect.value = options.some((option) => option.value === requested)
        ? requested
        : latest || options[options.length - 1].value;
      return periodSelect.value;
    }

    function updatePeriod() {
      const fallbackYear = new Date().getFullYear();
      const selectedKey = periodSelect?.value || `${fallbackYear}-01`;
      const selectedLiveSnapshot = liveSnapshots.find((row) => getSnapshotMonthKey(row) === selectedKey) ||
        (getSnapshotMonthKey(liveSnapshot) === selectedKey ? liveSnapshot : null);
      const livePeriod = selectedLiveSnapshot
        ? {
            label: formatPeriodLabel(selectedLiveSnapshot.period_end) || selectedKey,
            scope: "monthly",
            freshness: getSnapshotFreshness(selectedLiveSnapshot),
          }
        : null;
      const period = livePeriod || PERIODS[selectedKey] || {
        label: `${fallbackYear} · aguardando snapshot`,
        scope: "monthly",
        freshness: "Aguardando snapshot",
      };
      document.querySelectorAll("[data-period-label]").forEach((label) => {
        label.textContent = livePeriod?.label || livePeriodLabel || period.label;
      });
      document.querySelectorAll("[data-period-freshness]").forEach((label) => {
        label.textContent = period.freshness;
      });

      if (comparisonNotice) {
        const notice = getComparisonNotice(
          selectedKey,
          comparisonSelect?.value || "2025-jul",
        );
        comparisonNotice.textContent = notice;
        comparisonNotice.hidden = !notice;
      }
    }

    periodSelect?.addEventListener("change", () => {
      const selectedKey = periodSelect.value;
      const selected = liveSnapshots.find((row) => getSnapshotMonthKey(row) === selectedKey);
      if (selected) {
        liveSnapshot = selected;
        livePeriodLabel = applyLiveSnapshot(document, selected, liveSnapshots);
        updatePeriod();
        showToast(`Painel atualizado para ${livePeriodLabel || selectedKey}.`);
      } else {
        void loadLiveSnapshot({ selectedMonthKey: selectedKey, announce: true });
      }
    });
    comparisonSelect?.addEventListener("change", updatePeriod);
    updatePeriod();

    function downloadPeriodCsv() {
      const rows = liveSnapshots.length ? liveSnapshots : (liveSnapshot ? [liveSnapshot] : []);
      if (!rows.length) {
        showToast("Nenhum snapshot disponível para exportar.");
        return;
      }
      const csv = `﻿${buildPeriodCsv(rows)}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const anchor = document.createElement("a");
      const firstKey = getSnapshotMonthKey(rows[0]);
      const lastKey = getSnapshotMonthKey(rows[rows.length - 1]);
      anchor.href = URL.createObjectURL(blob);
      anchor.download = firstKey && lastKey && firstKey !== lastKey
        ? `painel-resultados-${firstKey}_${lastKey}.csv`
        : `painel-resultados-${lastKey || firstKey || "snapshot"}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window?.setTimeout?.(() => URL.revokeObjectURL(anchor.href), 4000);
      showToast(`CSV exportado com ${rows.length} ${rows.length === 1 ? "competência" : "competências"}.`);
    }

    function closeExportModal() {}

    document.querySelectorAll("[data-open-export]").forEach((trigger) => {
      trigger.addEventListener("click", downloadPeriodCsv);
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

    async function loadLiveSnapshot(options = {}) {
      if (!getSupabaseConfig(window)) return;
      const requestedMonthKey = isMonthKey(options.selectedMonthKey)
        ? options.selectedMonthKey
        : isMonthKey(periodSelect?.value)
          ? periodSelect.value
          : null;
      try {
        const requestedYear = requestedMonthKey ? Number(requestedMonthKey.slice(0, 4)) : new Date().getFullYear();
        const shouldFetch = options.force || liveYear !== requestedYear || liveSnapshots.length === 0;
        if (shouldFetch) {
          liveSnapshots = await fetchSnapshots(window, { year: requestedYear, limit: 12 });
          liveYear = requestedYear;
        }

        const selected = liveSnapshots.find((row) => getSnapshotMonthKey(row) === requestedMonthKey) ||
          liveSnapshots[liveSnapshots.length - 1] ||
          null;
        if (!selected) {
          liveSnapshots = [];
          liveSnapshot = null;
          livePeriodLabel = null;
          populatePeriodOptions([], requestedMonthKey);
          markLiveUnavailable(document, "Conectado · sem snapshot");
          updatePeriod();
          document.querySelectorAll("[data-period-freshness]").forEach((label) => {
            label.textContent = "Sem snapshot mensal";
          });
          return;
        }
        liveSnapshot = selected;
        const selectedKey = populatePeriodOptions(liveSnapshots, getSnapshotMonthKey(selected));
        if (selectedKey && selectedKey !== getSnapshotMonthKey(selected)) {
          liveSnapshot = liveSnapshots.find((row) => getSnapshotMonthKey(row) === selectedKey) || selected;
        }
        livePeriodLabel = applyLiveSnapshot(document, liveSnapshot, liveSnapshots);
        updatePeriod();
        if (options.announce !== false) showToast("Painel atualizado com os snapshots mensais do IXC.");
      } catch (error) {
        if (error?.code === "AUTH_REQUIRED") {
          stopLiveRefresh();
          showLogin();
          return;
        }
        markLiveUnavailable(document, "Leitura indisponível");
        liveSnapshots = [];
        liveSnapshot = null;
        livePeriodLabel = null;
        populatePeriodOptions([], requestedMonthKey);
        updatePeriod();
        document.querySelectorAll("[data-live-n8n-state]").forEach((element) => {
          element.textContent = "aguardando sincronização";
        });
        if (window?.console?.warn) window.console.warn("Falha ao ler snapshot do painel.", error);
      }
    }

    function startLiveRefresh() {
      const config = getSupabaseConfig(window);
      if (liveRefreshTimer || !config || config.refreshIntervalMs <= 0 || typeof window?.setInterval !== "function") return;
      liveRefreshTimer = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        void loadLiveSnapshot({ force: true, announce: false });
      }, config.refreshIntervalMs);
    }

    function stopLiveRefresh() {
      if (liveRefreshTimer !== null && typeof window?.clearInterval === "function") {
        window.clearInterval(liveRefreshTimer);
      }
      liveRefreshTimer = null;
    }

    document?.addEventListener?.("visibilitychange", () => {
      if (document.visibilityState === "visible") void loadLiveSnapshot({ force: true, announce: false });
    });

    document.querySelectorAll("[data-refresh-live]").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        void loadLiveSnapshot({ force: true, announce: true });
      });
    });

    const loginView = document.querySelector("#login-view");
    const appShell = document.querySelector("#dashboard-shell");
    const loginForm = document.querySelector("#login-form");
    const loginEmail = document.querySelector("#login-email");
    const loginPassword = document.querySelector("#login-password");
    const loginError = document.querySelector("[data-login-error]");
    const loginStatus = document.querySelector("[data-login-status]");
    const loginSubmit = document.querySelector("[data-login-submit]");
    const loginLink = document.querySelector("[data-login-link]");

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
      if (loginSubmit) loginSubmit.textContent = "Entrar com senha";
      if (loginPassword) loginPassword.value = "";
      setLoginError("");
      setLoginStatus("");
    }

    function showAuthenticatedApp() {
      document.body.dataset.authState = "authenticated";
      if (loginView) loginView.hidden = true;
      if (appShell) appShell.hidden = false;
      void loadLiveSnapshot();
      startLiveRefresh();
    }

    async function bootstrapAuth() {
      const config = getSupabaseConfig(window);
      if (!config || !config.requireAuth) {
        if (loginView) loginView.hidden = true;
        if (appShell) appShell.hidden = false;
        document.body.dataset.authState = "local-preview";
        void loadLiveSnapshot();
        startLiveRefresh();
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
      stopLiveRefresh();
      clearStoredSession(window);
      if (session?.access_token) {
        void requestAuth(window, "logout", {}, session.access_token).catch(() => undefined);
      }
      showLogin();
      document.querySelector("#login-email")?.focus();
    });

    function setLoginActionsBusy(busy) {
      if (loginSubmit) loginSubmit.disabled = busy;
      if (loginLink) loginLink.disabled = busy;
    }

    async function sendLoginLink() {
      const email = loginEmail?.value?.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setLoginError("Informe um e-mail corporativo válido.");
        loginEmail?.focus();
        return;
      }

      setLoginError("");
      setLoginActionsBusy(true);
      try {
        await requestAuth(window, "otp", {
          email,
          create_user: false,
        });
        setLoginStatus("Link enviado. Abra o e-mail corporativo e clique em “Sign in”. O link expira e só pode ser usado uma vez.");
      } catch (error) {
        setLoginError(formatAuthError(error, "Não foi possível enviar o link. Tente novamente."));
      } finally {
        setLoginActionsBusy(false);
      }
    }

    loginLink?.addEventListener("click", () => {
      void sendLoginLink();
    });

    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = loginEmail?.value?.trim();
      const password = loginPassword?.value || "";

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setLoginError("Informe um e-mail corporativo válido.");
        return;
      }
      if (!password) {
        setLoginError("Informe a senha do Supabase Auth.");
        loginPassword?.focus();
        return;
      }

      setLoginError("");
      try {
        setLoginActionsBusy(true);
        const session = await requestAuth(window, "token?grant_type=password", {
          email,
          password,
        });
        if (!session?.access_token) throw new Error("A sessão não foi retornada pelo Supabase.");
        storeSession(window, session);
        setLoginStatus("");
        showAuthenticatedApp();
      } catch (error) {
        setLoginError(formatAuthError(error, "Não foi possível entrar. Tente novamente."));
      } finally {
        setLoginActionsBusy(false);
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
    buildPeriodCsv,
    buildSnapshotQuery,
    buildMonthlySeries,
    deriveExecutiveMetrics,
    fetchLatestSnapshot,
    fetchSnapshots,
    filterAlerts,
    formatCurrency,
    formatAuthError,
    getArpuPresentation,
    getComparisonNotice,
    getLiveIxcStatus,
    getLiveSourceNotice,
    getSnapshotFreshness,
    initDashboard,
    markLiveUnavailable,
    renderLiveAlerts,
    mergeMonthlySeries,
    renderLiveCancellationReasons,
    renderLiveDecisionQueue,
  };
});
