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

    function updatePeriod() {
      const period = PERIODS[periodSelect?.value] || PERIODS["2026-jul"];
      document.querySelectorAll("[data-period-label]").forEach((label) => {
        label.textContent = period.label;
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

    const loginView = document.querySelector("#login-view");
    const appShell = document.querySelector("#dashboard-shell");
    const loginForm = document.querySelector("#login-form");
    const loginError = document.querySelector("[data-login-error]");

    document.querySelector("[data-logout]")?.addEventListener("click", () => {
      if (loginView) loginView.hidden = false;
      if (appShell) appShell.hidden = true;
      document.querySelector("#login-email")?.focus();
    });

    loginForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = document.querySelector("#login-email")?.value?.trim();
      const password = document.querySelector("#login-password")?.value?.trim();

      if (!email || !password) {
        if (loginError) loginError.hidden = false;
        return;
      }

      if (loginError) loginError.hidden = true;
      if (loginView) loginView.hidden = true;
      if (appShell) appShell.hidden = false;
      showToast("Acesso demonstrativo liberado.");
    });

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
    filterAlerts,
    formatCurrency,
    getComparisonNotice,
    initDashboard,
  };
});
