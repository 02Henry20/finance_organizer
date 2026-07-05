import {
  auth,
  createUserWithEmailAndPassword,
  initializeAuthPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "./firebase.js";
import {
  connectUser,
  deleteAccount,
  deleteAsset,
  deleteRule,
  deleteTransaction,
  disconnectUser,
  exportState,
  importStateBackup,
  getLocalMarketApiKey,
  saveAccount,
  saveAsset,
  saveCategory,
  saveRule,
  saveSettings,
  saveTransaction,
  saveTransactionsBatch,
  refreshFxRates,
  setLocalMarketApiKey,
  state,
  subscribe,
  updateAssetQuote
} from "./store.js";
import {
  ACCOUNT_TYPES,
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
  TODAY,
  VALID_CURRENCIES,
  buildCategorySpend,
  calculateMonthlySnapshot,
  calculatePortfolio,
  calculatePortfolioSnapshot,
  categorizeTransaction,
  convertCurrency,
  formatCurrency,
  monthKey,
  parseMoney
} from "./finance.js";
import { buildImportPreview, parseBankFile, serializeTransactionsCsv } from "./importer.js";
import { fetchQuote } from "./market.js";
import { drawAccountBars, drawDonut, drawIncomeExpense, drawNetSeries, drawYearComparison } from "./charts.js";

const VIEW_LABELS = {
  overview: ["COMMAND CENTER", "Overview"],
  reports: ["REPORTS", "Reports"],
  transactions: ["TRANSACTIONS", "Transactions"],
  import: ["BANK DATA", "Import"],
  accounts: ["ACCOUNTS", "Accounts"],
  assets: ["PORTFOLIO", "Assets"],
  rules: ["AUTOMATION", "Rules"],
  settings: ["CONTROL", "Settings"]
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const elements = {
  authShell: $("#auth-shell"),
  appShell: $("#app-shell"),
  bootStatus: $("#boot-status"),
  authForm: $("#auth-form"),
  authEmail: $("#auth-email"),
  authPassword: $("#auth-password"),
  authMessage: $("#auth-message"),
  createAccount: $("#create-account-button"),
  resetPassword: $("#reset-password-button"),
  signOut: $("#sign-out-button"),
  userChip: $("#user-chip"),
  syncPill: $("#sync-pill"),
  viewKicker: $("#view-kicker"),
  viewTitle: $("#view-title"),
  modalBackdrop: $("#modal-backdrop"),
  toastContainer: $("#toast-container")
};

let activeView = "overview";
let activeParsedFile = null;
let activePreview = null;
let renderTimer = null;
let quoteRefreshTimer = null;
let settingsDirty = false;
let hiddenAccountsExpanded = false;
let txSort = { key: "date", dir: "desc" };
let importSort = { key: "date", dir: "asc" };
let txPage = 1;
let importPage = 1;
let positionsPage = 1;
let accountTransactionsPage = 1;
let activePositionsAccountId = "";
let activeAccountTransactionsId = "";
let positionsPeriod = "basis";
let positionsUnit = "absolute";
let reportsMode = "month";
let reportsMonth = monthKey(TODAY());
let reportsYear = String(new Date().getFullYear());
let reportsCompareYear = String(new Date().getFullYear() - 1);

const PAGE_SIZES = {
  transactions: 25,
  importPreview: 25,
  positions: 8,
  accountTransactions: 8
};

function firebaseErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Use a password with at least six characters.",
    "auth/network-request-failed": "No connection. Firebase sign-in needs internet unless your session is cached.",
    "permission-denied": "Firebase denied access. Check that your Firestore rules allow this user path."
  };
  return messages[error?.code] || error?.message || "Something went wrong.";
}

function toast(title, copy = "", type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.innerHTML = `<span>${type === "error" ? "!" : "✓"}</span><div><strong></strong><small></small></div>`;
  item.querySelector("strong").textContent = title;
  item.querySelector("small").textContent = copy;
  elements.toastContainer.append(item);
  setTimeout(() => item.remove(), 4300);
}

function setMessage(el, text, error = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", error);
}

function setBusy(form, busy) {
  form.querySelectorAll("button,input,select,textarea").forEach(control => { control.disabled = busy; });
}

async function bootAuth() {
  try {
    await initializeAuthPersistence();
    elements.bootStatus.classList.add("ready");
    elements.bootStatus.querySelector("strong").textContent = "Firebase ready";
  } catch (error) {
    elements.bootStatus.classList.add("error");
    elements.bootStatus.querySelector("strong").textContent = firebaseErrorMessage(error);
  }

  onAuthStateChanged(auth, async user => {
    if (!user) {
      disconnectUser();
      elements.authShell.hidden = false;
      elements.appShell.hidden = true;
      elements.authPassword.value = "";
      return;
    }
    elements.authShell.hidden = true;
    elements.appShell.hidden = false;
    elements.userChip.textContent = user.email || user.uid;
    try {
      await connectUser(user);
      navigateTo("overview");
      setTimeout(() => maybeRefreshFxRates(), 1200);
      setTimeout(() => maybeRefreshQuotes().catch(error => console.warn("Initial quote refresh skipped", error)), 1800);
      setupAutoRefreshTimers();
    } catch (error) {
      toast("Firebase synchronization failed", firebaseErrorMessage(error), "error");
    }
  });
}

function applyAppearance() {
  document.documentElement.dataset.theme = state.settings.theme === "light" ? "light" : "dark";
  document.documentElement.dataset.motion = state.settings.motion === "off" ? "off" : "on";
}

function syncStatus() {
  const pill = elements.syncPill;
  if (!pill) return;
  const status = state.sync.status || "loading";
  pill.className = `sync-pill ${status}`.trim();
  const label = status === "synced"
    ? "Synced"
    : status === "offline"
      ? "Offline"
      : status === "error"
        ? "Sync issue"
        : "Syncing";
  pill.querySelector("strong").textContent = label;
  const sub = pill.querySelector("small");
  if (sub) {
    sub.textContent = status === "synced" ? "" : (state.sync.detail || "");
    sub.hidden = status === "synced" || !sub.textContent;
  }
}

function navigateTo(view) {
  if (!VIEW_LABELS[view]) return;
  activeView = view;
  $$(`[data-view-section]`).forEach(section => section.classList.toggle("active", section.dataset.viewSection === view));
  $$(`[data-view]`).forEach(button => button.classList.toggle("active", button.dataset.view === view));
  elements.viewKicker.textContent = VIEW_LABELS[view][0];
  elements.viewTitle.textContent = VIEW_LABELS[view][1];
  requestRender();
}

function categoryOptions(selected = "misc") {
  return state.categories.map(cat => `<option value="${escapeHtml(cat.id)}" ${cat.id === selected ? "selected" : ""}>${escapeHtml(cat.icon || "•")} ${escapeHtml(cat.name)}</option>`).join("");
}

function accountOptions(selected = "", options = {}) {
  const { includeHidden = false, brokerOnly = false } = options;
  let accounts = state.accounts.filter(account => includeHidden || !account.hidden || account.id === selected);
  if (brokerOnly) accounts = accounts.filter(account => ["broker", "asset"].includes(account.type) || account.id === selected);
  return accounts.map(account => `<option value="${escapeHtml(account.id)}" ${account.id === selected ? "selected" : ""}>${escapeHtml(account.name)} · ${escapeHtml(account.currency || "EUR")}</option>`).join("");
}

function typeOptions(selected = "checking") {
  return ACCOUNT_TYPES.map(type => `<option value="${type.id}" ${type.id === selected ? "selected" : ""}>${type.label}</option>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
}

function selectedCurrency() {
  return (state.settings.primaryCurrency || "EUR").toUpperCase();
}

function categoryMap() {
  return new Map(state.categories.map(cat => [cat.id, cat]));
}

function accountMap() {
  return new Map(state.accounts.map(account => [account.id, account]));
}

function safeColor(value, fallback = DEFAULT_CATEGORY_COLOR) {
  const raw = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

function categoryPill(cat, { review = false } = {}) {
  const color = safeColor(cat?.color);
  return `<span class="category-pill colored ${review ? "review-pill" : ""}" style="--cat-color:${color}">${escapeHtml(cat?.icon || "?")} ${escapeHtml(cat?.name || "Misc")}</span>`;
}

function colorOptions(selected = DEFAULT_CATEGORY_COLOR) {
  const labels = ["Emerald", "Blue", "Violet", "Amber", "Red", "Cyan", "Pink", "Lime", "Orange", "Teal", "Indigo", "Purple", "Gold", "Green", "Slate", "Sky"];
  const current = safeColor(selected);
  return CATEGORY_COLORS.map((color, index) => `<option value="${color}" ${color.toUpperCase() === current.toUpperCase() ? "selected" : ""}>${labels[index] || "Color"} · ${color}</option>`).join("");
}

function isValidCurrency(code) {
  return VALID_CURRENCIES.includes(String(code || "").trim().toUpperCase());
}

function normalizedCurrencyFrom(selector, fallback = selectedCurrency()) {
  const code = $(selector).value.trim().toUpperCase();
  if (!code) return fallback;
  if (!isValidCurrency(code)) throw new Error(`${code} is not in the supported currency list.`);
  return code;
}

function visibleAccounts() {
  return state.accounts.filter(account => !account.hidden);
}

function holdingsForAccount(accountId) {
  const firstBroker = state.accounts.find(account => !account.hidden && account.type === "broker")?.id || "";
  return state.assets.filter(asset => !asset.hidden && ((asset.accountId || firstBroker) === accountId));
}

function assetMarketValue(asset) {
  const price = Number(asset.lastPrice ?? asset.manualPrice ?? 0);
  return price * Number(asset.quantity || 0);
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

function compareValues(a, b) {
  const ax = a == null ? "" : a;
  const bx = b == null ? "" : b;
  if (typeof ax === "number" && typeof bx === "number") return ax - bx;
  return String(ax).localeCompare(String(bx), undefined, { numeric: true, sensitivity: "base" });
}

function sortedRows(rows, sort, getters) {
  const getter = getters[sort.key] || getters.date || (row => row);
  const direction = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareValues(getter(a), getter(b));
    if (primary) return primary * direction;
    return compareValues(a.date || "", b.date || "") * -1;
  });
}

function updateSortButtons(tableName, sort) {
  $$(`[data-sort-table="${tableName}"]`).forEach(button => {
    const active = button.dataset.sortKey === sort.key;
    button.classList.toggle("active", active);
    const indicator = button.querySelector(".sort-indicator");
    if (indicator) indicator.textContent = active ? (sort.dir === "asc" ? "^" : "v") : "";
  });
}

function renderPagination(container, total, currentPage, pageSize, onChange) {
  if (!container) return currentPage;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, currentPage), pages);
  if (total <= pageSize) {
    container.hidden = true;
    container.replaceChildren();
    return page;
  }
  container.hidden = false;
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  container.innerHTML = `
    <span>${start}-${end} of ${total}</span>
    <div class="pagination-actions">
      <button class="ghost-button compact" data-page="prev" type="button" ${page <= 1 ? "disabled" : ""}>Prev</button>
      <span class="metric-tag">${page} / ${pages}</span>
      <button class="ghost-button compact" data-page="next" type="button" ${page >= pages ? "disabled" : ""}>Next</button>
    </div>`;
  container.querySelector("[data-page='prev']")?.addEventListener("click", () => onChange(page - 1));
  container.querySelector("[data-page='next']")?.addEventListener("click", () => onChange(page + 1));
  return page;
}

function pagedRows(rows, page, pageSize) {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function monthStart(month) {
  return `${month}-01`;
}

function monthEnd(month) {
  const [year, value] = String(month || monthKey(TODAY())).split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
}

function shiftMonth(month, offset) {
  const [year, value] = String(month || monthKey(TODAY())).split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function monthLabel(month, options = {}) {
  const [year, value] = String(month || monthKey(TODAY())).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: options.short ? "short" : "long", year: "numeric" }).format(new Date(year, value - 1, 1));
}

function availableReportYears() {
  const current = new Date().getFullYear();
  const years = new Set([current, current - 1, current - 2]);
  state.transactions.forEach(tx => {
    const year = Number(String(tx.date || "").slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  });
  return [...years].sort((a, b) => b - a).map(String);
}

function periodBoundsForReport() {
  if (reportsMode === "year") return { start: `${reportsYear}-01-01`, end: `${reportsYear}-12-31`, label: reportsYear };
  return { start: monthStart(reportsMonth), end: monthEnd(reportsMonth), label: monthLabel(reportsMonth) };
}

function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function transactionsInRange(start, end) {
  return state.transactions.filter(tx => {
    const date = String(tx.date || "");
    return date >= start && date <= end;
  });
}

function includeInSpending(cat) {
  return !(cat?.type === "transfer" && state.settings.hideInternalTransfersInSpending);
}

function summarizeTransactions(rows) {
  const cats = categoryMap();
  return rows.reduce((totals, tx) => {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const amount = convertCurrency(Number(tx.amount || 0), tx.currency || selectedCurrency(), state.settings);
    if (cat?.type === "transfer" && !includeInSpending(cat)) {
      totals.transfer += amount;
      return totals;
    }
    if (amount >= 0) totals.income += amount;
    else totals.expense += Math.abs(amount);
    totals.net += amount;
    return totals;
  }, { income: 0, expense: 0, net: 0, transfer: 0 });
}

function categorySpendForRange(start, end) {
  const cats = categoryMap();
  const totals = new Map();
  for (const tx of transactionsInRange(start, end)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    if (cat?.type === "income") continue;
    if (!includeInSpending(cat)) continue;
    const value = Math.abs(Math.min(0, convertCurrency(tx.amount, tx.currency || selectedCurrency(), state.settings)));
    if (value <= 0) continue;
    const prev = totals.get(cat.id) || { categoryId: cat.id, name: cat.name, group: cat.group, color: cat.color || DEFAULT_CATEGORY_COLOR, value: 0 };
    prev.value += value;
    totals.set(cat.id, prev);
  }
  return [...totals.values()].sort((a, b) => b.value - a.value);
}

function aggregateMonths(months) {
  return months.map(month => ({ month, ...summarizeTransactions(transactionsInRange(monthStart(month), monthEnd(month))) }));
}

function monthsEndingAt(month, count = 13) {
  return Array.from({ length: count }, (_, index) => shiftMonth(month, index - count + 1));
}

function monthsForYear(year) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function formatDateTime(value) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function maskIban(value) {
  const clean = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!clean) return "No identifier";
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)} •••• ${clean.slice(-4)}`;
}

function comparisonDateFromSettings() {
  const mode = state.settings.portfolioComparisonMode || "rolling";
  if (mode === "date" && state.settings.portfolioComparisonDate) return state.settings.portfolioComparisonDate;
  const days = Math.max(1, Number(state.settings.portfolioComparisonDays || 30));
  const d = new Date(`${TODAY()}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function comparisonLabel(compareDate) {
  if ((state.settings.portfolioComparisonMode || "rolling") === "date") return `since ${compareDate}`;
  return `since ${Number(state.settings.portfolioComparisonDays || 30)}d`;
}

function deltaHtml(current, previous, { inverted = false, label = "" } = {}) {
  const delta = Number(current || 0) - Number(previous || 0);
  const pct = Math.abs(previous) > 0.0001 ? delta / Math.abs(previous) * 100 : 0;
  const arrow = delta > 0 ? "↗" : delta < 0 ? "↘" : "→";
  const good = inverted ? delta <= 0 : delta >= 0;
  const cls = Math.abs(delta) < 0.005 ? "delta-flat" : good ? "delta-up" : "delta-down";
  return `<span class="${cls}">${arrow} ${formatCurrency(Math.abs(delta), selectedCurrency())} · ${Math.abs(pct).toFixed(1)}%</span> ${escapeHtml(label)}`;
}

function comparisonWindowFlow(compareDate) {
  const cats = categoryMap();
  const today = TODAY();
  return state.transactions.reduce((totals, tx) => {
    const date = String(tx.date || "");
    if (!date || date < compareDate || date > today) return totals;
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    if (cat?.type === "transfer" && state.settings.hideInternalTransfersInSpending) return totals;
    const amount = convertCurrency(Number(tx.amount || 0), tx.currency || selectedCurrency(), state.settings);
    if (amount >= 0) totals.income += amount;
    else totals.expense += Math.abs(amount);
    totals.net += amount;
    return totals;
  }, { income: 0, expense: 0, net: 0 });
}

function renderOverview() {
  const currency = selectedCurrency();
  const portfolio = calculatePortfolio(state);
  const compareDate = comparisonDateFromSettings();
  const previousPortfolio = calculatePortfolioSnapshot(state, compareDate);
  const compareText = comparisonLabel(compareDate);
  const monthly = calculateMonthlySnapshot(state);
  const categorySpend = buildCategorySpend(state.transactions, state.categories, state.settings, monthly.currentMonth);
  const reviewRows = state.transactions.filter(tx => tx.review);
  const review = reviewRows.slice(0, 8);
  const windowFlow = comparisonWindowFlow(compareDate);
  const overviewDate = $("#overview-date");
  const netWorthValue = $("#net-worth-value");
  const netWorthDelta = $("#net-worth-delta");
  const netWorthWindow = $("#net-worth-window");
  const windowIncome = $("#window-income");
  const windowExpense = $("#window-expense");
  if (overviewDate) overviewDate.textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date());
  if (netWorthValue) netWorthValue.textContent = formatCurrency(portfolio.netWorth, currency);
  if (netWorthDelta) netWorthDelta.innerHTML = deltaHtml(portfolio.netWorth, previousPortfolio.netWorth, { label: compareText });
  if (netWorthWindow) netWorthWindow.textContent = `Cashflow ${compareText}`;
  if (windowIncome) windowIncome.textContent = formatCurrency(windowFlow.income, currency);
  if (windowExpense) windowExpense.textContent = formatCurrency(windowFlow.expense, currency);
  $("#liquidity-value").textContent = formatCurrency(portfolio.liquidity, currency);
  $("#asset-value").textContent = formatCurrency(portfolio.assetValue, currency);
  $("#debt-value").textContent = formatCurrency(portfolio.debt, currency);
  const liquidityDelta = $("#liquidity-delta");
  const assetDelta = $("#asset-delta");
  const debtDelta = $("#debt-delta");
  if (liquidityDelta) liquidityDelta.innerHTML = deltaHtml(portfolio.liquidity, previousPortfolio.liquidity, { label: compareText });
  if (assetDelta) assetDelta.innerHTML = deltaHtml(portfolio.assetValue, previousPortfolio.assetValue, { label: compareText });
  if (debtDelta) debtDelta.innerHTML = deltaHtml(portfolio.debt, previousPortfolio.debt, { inverted: true, label: compareText });
  const monthIncome = $("#month-income");
  const monthExpense = $("#month-expense");
  const monthNet = $("#month-net");
  const currentMonthPill = $("#current-month-pill");
  const spendingMonthPill = $("#spending-month-pill");
  if (monthIncome) monthIncome.textContent = formatCurrency(monthly.current.income, currency);
  if (monthExpense) monthExpense.textContent = formatCurrency(monthly.current.expense, currency);
  if (monthNet) {
    monthNet.textContent = formatCurrency(monthly.current.net, currency);
    monthNet.className = monthly.current.net >= 0 ? "amount-pos" : "amount-neg";
  }
  if (currentMonthPill) currentMonthPill.textContent = monthly.currentMonth;
  if (spendingMonthPill) spendingMonthPill.textContent = monthLabel(monthly.currentMonth, { short: true });
  const reviewPanel = $("#review-panel");
  const reviewCount = $("#review-count");
  const reviewList = $("#review-list");
  if (reviewPanel) reviewPanel.hidden = reviewRows.length === 0;
  document.querySelector(".home-layout")?.classList.toggle("no-review", reviewRows.length === 0);
  if (reviewCount) reviewCount.textContent = `${reviewRows.length} to review`;
  if (reviewList) {
    reviewList.replaceChildren();
    for (const tx of review) {
      const item = document.createElement("button");
      item.className = "mini-item link-button";
      item.type = "button";
      item.innerHTML = `<div class="review-item-text"><strong class="review-main">${escapeHtml(tx.description)}</strong><small class="review-line">${escapeHtml(tx.date)}</small><small class="review-line">${escapeHtml(tx.reason || "Needs review")}</small></div><span class="amount-neg">${formatCurrency(Math.abs(tx.amount), tx.currency || currency)}</span>`;
      item.addEventListener("click", () => openTransactionModal(tx.id));
      reviewList.append(item);
    }
  }
  drawIncomeExpense($("#income-expense-chart"), monthly.series, currency);
  drawNetSeries($("#net-series-chart"), monthly.series);
  drawDonut($("#category-donut-chart"), categorySpend, currency);
  drawAccountBars($("#account-bars-chart"), portfolio.accountRows, currency);
}

function fillReportControls() {
  const years = availableReportYears();
  const selectedYear = reportsMode === "year" ? reportsYear : reportsMonth.slice(0, 4);
  if (!years.includes(reportsYear)) reportsYear = years[0] || String(new Date().getFullYear());
  if (!years.includes(reportsCompareYear)) {
    reportsCompareYear = years.find(year => year !== selectedYear) || String(Number(selectedYear) - 1);
  }
  if (reportsCompareYear === selectedYear) reportsCompareYear = String(Number(selectedYear) - 1);
  const yearOptions = [...new Set([...years, reportsYear, reportsCompareYear, String(Number(selectedYear) - 1)])]
    .filter(Boolean)
    .sort((a, b) => Number(b) - Number(a));
  const reportMonth = $("#report-month");
  const reportYear = $("#report-year");
  const reportCompareYear = $("#report-compare-year");
  const monthField = $("#report-month-field");
  const yearField = $("#report-year-field");
  if (reportMonth) reportMonth.value = reportsMonth;
  if (reportYear) {
    reportYear.innerHTML = yearOptions.map(year => `<option value="${year}" ${year === reportsYear ? "selected" : ""}>${year}</option>`).join("");
  }
  if (reportCompareYear) {
    reportCompareYear.innerHTML = yearOptions.map(year => `<option value="${year}" ${year === reportsCompareYear ? "selected" : ""}>${year}</option>`).join("");
  }
  if (monthField) monthField.hidden = reportsMode !== "month";
  if (yearField) yearField.hidden = reportsMode !== "year";
  $$("[data-report-mode]").forEach(button => {
    const active = button.dataset.reportMode === reportsMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderReports() {
  if (!$("#report-income")) return;
  fillReportControls();
  const currency = selectedCurrency();
  const bounds = periodBoundsForReport();
  const periodRows = transactionsInRange(bounds.start, bounds.end);
  const summary = summarizeTransactions(periodRows);
  const categoryRows = categorySpendForRange(bounds.start, bounds.end);
  const days = daysBetween(bounds.start, bounds.end);
  const topCategory = categoryRows[0];
  const savingsRate = summary.income > 0 ? summary.net / summary.income * 100 : null;
  const selectedYear = reportsMode === "year" ? reportsYear : reportsMonth.slice(0, 4);
  const trendMonths = reportsMode === "year" ? monthsForYear(reportsYear) : monthsEndingAt(reportsMonth, 13);
  const trendRows = aggregateMonths(trendMonths);
  const currentYearRows = aggregateMonths(monthsForYear(selectedYear));
  const compareYearRows = aggregateMonths(monthsForYear(reportsCompareYear));
  const yoyRows = currentYearRows.map((row, index) => ({
    label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(2000, index, 1)),
    current: row.expense,
    previous: compareYearRows[index]?.expense || 0
  }));

  $("#report-income").textContent = formatCurrency(summary.income, currency);
  $("#report-spending").textContent = formatCurrency(summary.expense, currency);
  const netEl = $("#report-net");
  netEl.textContent = formatCurrency(summary.net, currency);
  netEl.className = summary.net >= 0 ? "amount-pos" : "amount-neg";
  $("#report-savings-rate").textContent = savingsRate == null ? "—" : formatPercent(savingsRate);
  $("#report-daily-spend").textContent = formatCurrency(summary.expense / days, currency);
  $("#report-days-count").textContent = `${days} days`;
  $("#report-income-detail").textContent = `${periodRows.filter(tx => Number(tx.amount || 0) > 0).length} inflows`;
  $("#report-spending-detail").textContent = `${periodRows.filter(tx => Number(tx.amount || 0) < 0).length} outflows`;
  $("#report-net-detail").textContent = bounds.label;
  $("#report-top-category").textContent = topCategory?.name || "—";
  $("#report-top-category-value").textContent = topCategory ? formatCurrency(topCategory.value, currency) : "No spending yet";
  $("#report-period-pill").textContent = bounds.label;
  $("#report-cashflow-title").textContent = reportsMode === "year" ? `${reportsYear} monthly cashflow` : "13-month cashflow";
  $("#report-net-title").textContent = reportsMode === "year" ? `${reportsYear} net flow` : "Rolling net flow";
  $("#report-spending-title").textContent = `Category split`;
  $("#report-yoy-title").textContent = `${selectedYear} vs ${reportsCompareYear} spending`;

  drawIncomeExpense($("#report-cashflow-chart"), trendRows, currency);
  drawNetSeries($("#report-net-chart"), trendRows);
  drawDonut($("#report-category-chart"), categoryRows, currency);
  drawYearComparison($("#report-yoy-chart"), yoyRows, currency, { currentLabel: selectedYear, previousLabel: reportsCompareYear });
}

function fillFilters() {
  const txAccountFilter = $("#tx-account-filter");
  const txCategoryFilter = $("#tx-category-filter");
  const importAccount = $("#import-account");
  const transactionAccount = $("#transaction-account");
  const transactionCategory = $("#transaction-category");
  const accountType = $("#account-type");
  const ruleCategory = $("#rule-category");
  const assetAccount = $("#asset-account");
  if (txAccountFilter) txAccountFilter.innerHTML = `<option value="all">All accounts</option>${accountOptions(txAccountFilter.value)}`;
  if (txCategoryFilter) txCategoryFilter.innerHTML = `<option value="all">All categories</option>${categoryOptions(txCategoryFilter.value)}`;
  if (importAccount) importAccount.innerHTML = accountOptions(importAccount.value || visibleAccounts()[0]?.id);
  if (transactionAccount) transactionAccount.innerHTML = accountOptions(transactionAccount.value || visibleAccounts()[0]?.id);
  if (transactionCategory) transactionCategory.innerHTML = categoryOptions(transactionCategory.value || "misc");
  if (accountType) accountType.innerHTML = typeOptions(accountType.value || "checking");
  if (ruleCategory) ruleCategory.innerHTML = categoryOptions(ruleCategory.value || "misc");
  if (assetAccount) assetAccount.innerHTML = accountOptions(assetAccount.value || state.accounts.find(account => !account.hidden && account.type === "broker")?.id || visibleAccounts()[0]?.id, { brokerOnly: true });
}

function renderTransactions() {
  const tbody = $("#transactions-body");
  if (!tbody) return;
  const cats = categoryMap();
  const accounts = accountMap();
  const search = $("#tx-search").value.trim().toLowerCase();
  const accountFilter = $("#tx-account-filter").value || "all";
  const categoryFilter = $("#tx-category-filter").value || "all";
  const reviewFilter = $("#tx-review-filter").value || "all";
  let rows = state.transactions;
  if (search) rows = rows.filter(tx => [tx.description, tx.counterparty, tx.note, tx.reason].join(" ").toLowerCase().includes(search));
  if (accountFilter !== "all") rows = rows.filter(tx => tx.accountId === accountFilter);
  if (categoryFilter !== "all") rows = rows.filter(tx => tx.categoryId === categoryFilter);
  if (reviewFilter === "review") rows = rows.filter(tx => tx.review);
  if (reviewFilter === "clean") rows = rows.filter(tx => !tx.review);
  rows = sortedRows(rows, txSort, {
    date: tx => tx.date || "",
    description: tx => tx.description || "",
    account: tx => accounts.get(tx.accountId)?.name || tx.accountId || "",
    category: tx => cats.get(tx.categoryId)?.name || tx.categoryId || "",
    amount: tx => Number(tx.amount || 0),
    note: tx => tx.note || ""
  });
  $("#tx-count").textContent = `${rows.length} entries`;
  txPage = renderPagination($("#transactions-pagination"), rows.length, txPage, PAGE_SIZES.transactions, page => {
    txPage = page;
    renderTransactions();
  });
  updateSortButtons("transactions", txSort);
  tbody.replaceChildren();
  for (const tx of pagedRows(rows, txPage, PAGE_SIZES.transactions)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const account = accounts.get(tx.accountId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(tx.date)}</td>
      <td class="description-cell"><strong>${escapeHtml(tx.description)}</strong><small class="muted table-ellipsis">${escapeHtml(tx.counterparty || tx.reason || "")}</small></td>
      <td>${escapeHtml(account?.name || tx.accountId || "—")}</td>
      <td>${categoryPill(cat, { review: tx.review })}</td>
      <td class="${Number(tx.amount) >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency || selectedCurrency())}</td>
      <td class="note-cell"><span class="table-ellipsis" title="${escapeHtml(tx.note || "")}">${escapeHtml(tx.note || "")}</span></td>
      <td class="action-cell"><button class="ghost-button compact" type="button" data-edit-tx="${escapeHtml(tx.id)}">Edit</button></td>`;
    tbody.append(tr);
  }
  tbody.querySelectorAll("[data-edit-tx]").forEach(btn => btn.addEventListener("click", () => openTransactionModal(btn.dataset.editTx)));
}

function renderAccounts() {
  const container = $("#accounts-grid");
  if (!container) return;
  const portfolio = calculatePortfolio(state);
  const rows = portfolio.accountRows;
  const currency = selectedCurrency();
  container.replaceChildren();
  const accounts = visibleAccounts();
  const hiddenAccounts = state.accounts.filter(account => account.hidden);
  const hiddenSection = $("#hidden-accounts-section");
  const hiddenGrid = $("#hidden-accounts-grid");
  const hiddenToggle = $("#hidden-accounts-toggle");
  if (!hiddenAccounts.length) hiddenAccountsExpanded = false;
  if (hiddenToggle) {
    hiddenToggle.hidden = hiddenAccounts.length === 0;
    hiddenToggle.textContent = hiddenAccountsExpanded ? `Hide hidden accounts (${hiddenAccounts.length})` : `Show hidden accounts (${hiddenAccounts.length})`;
    hiddenToggle.setAttribute("aria-expanded", String(hiddenAccountsExpanded));
  }
  if (hiddenSection) hiddenSection.hidden = hiddenAccounts.length === 0 || !hiddenAccountsExpanded;
  if (hiddenGrid) hiddenGrid.replaceChildren();
  if (!accounts.length) {
    container.innerHTML = `<article class="surface-card item-card empty-card"><h3>No visible accounts</h3><p class="muted">Add an account or restore one from the hidden accounts toggle above.</p></article>`;
  }
  for (const account of accounts) {
    const row = rows.find(item => item.id === account.id) || { ...account, balance: { raw: Number(account.openingBalance || 0), converted: Number(account.openingBalance || 0) } };
    const holdings = holdingsForAccount(account.id);
    const holdingsValue = holdings.reduce((sum, asset) => sum + convertCurrency(assetMarketValue(asset), asset.currency || account.currency || currency, state.settings), 0);
    const totalValue = row.balance.converted + holdingsValue;
    const isBroker = ["broker", "asset"].includes(account.type);
    const card = document.createElement("article");
    card.className = `surface-card item-card account-card ${isBroker ? "broker-card" : ""}`;
    card.innerHTML = `
      <div class="item-card-header">
        <div>
          <h3>${escapeHtml(account.name)}</h3>
          <small>${escapeHtml(account.institution || "Manual")} · ${escapeHtml(account.type)} · ${escapeHtml(account.currency)}</small>
        </div>
        <span class="category-pill">${escapeHtml(maskIban(account.iban || account.accountNumber))}</span>
      </div>
      <div class="account-value-row">
        <div><span>Cash balance</span><strong class="${row.balance.converted >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(row.balance.raw, account.currency || currency)}</strong></div>
        ${isBroker ? `<div><span>Holdings</span><strong>${formatCurrency(holdingsValue, currency)}</strong></div><div><span>Total</span><strong>${formatCurrency(totalValue, currency)}</strong></div>` : ""}
      </div>
      ${isBroker ? `<div class="account-holding-summary"><small>${holdings.length ? `${holdings.length} positions hidden from the card.` : "No positions yet."}</small></div>` : ""}
      <div class="item-card-actions">
        ${isBroker ? `<button class="secondary-button compact" data-view-positions="${escapeHtml(account.id)}" type="button">View positions</button><button class="secondary-button compact" data-add-asset-for="${escapeHtml(account.id)}" type="button">Add holding</button>` : ""}
        <button class="ghost-button compact" data-account-transactions="${escapeHtml(account.id)}" type="button">Latest transactions</button>
        <button class="ghost-button compact" data-edit-account="${escapeHtml(account.id)}" type="button">Edit account</button>
      </div>`;
    container.append(card);
  }
  if (hiddenGrid) {
    for (const account of hiddenAccounts) {
      const card = document.createElement("article");
      card.className = "surface-card item-card account-card hidden-account-card";
      card.innerHTML = `<div class="item-card-header"><div><h3>${escapeHtml(account.name)}</h3><small>${escapeHtml(account.institution || "Manual")} · ${escapeHtml(account.type)} · ${escapeHtml(account.currency)}</small></div><span class="category-pill">Hidden</span></div><small>${escapeHtml(maskIban(account.iban || account.accountNumber))}</small><div class="item-card-actions"><button class="ghost-button compact" data-edit-account="${escapeHtml(account.id)}" type="button">Edit / restore</button></div>`;
      hiddenGrid.append(card);
    }
  }
  container.querySelectorAll("[data-edit-account]").forEach(btn => btn.addEventListener("click", () => openAccountModal(btn.dataset.editAccount)));
  container.querySelectorAll("[data-add-asset-for]").forEach(btn => btn.addEventListener("click", () => openAssetModal("", btn.dataset.addAssetFor)));
  container.querySelectorAll("[data-view-positions]").forEach(btn => btn.addEventListener("click", () => openPositionsModal(btn.dataset.viewPositions)));
  container.querySelectorAll("[data-account-transactions]").forEach(btn => btn.addEventListener("click", () => openAccountTransactionsModal(btn.dataset.accountTransactions)));
  hiddenGrid?.querySelectorAll("[data-edit-account]").forEach(btn => btn.addEventListener("click", () => openAccountModal(btn.dataset.editAccount)));
}

function renderAssets() {
  // Assets are now displayed inside broker/asset accounts.
}

function renderRules() {
  const categoriesList = $("#categories-list");
  const rulesList = $("#rules-list");
  if (!categoriesList || !rulesList) return;
  const cats = categoryMap();
  categoriesList.replaceChildren();
  rulesList.replaceChildren();
  for (const cat of state.categories) {
    const related = state.rules.filter(rule => rule.categoryId === cat.id);
    const row = document.createElement("div");
    row.className = "settings-row category-row";
    row.innerHTML = `<div><strong><span class="category-color-dot" style="--cat-color:${safeColor(cat.color)}"></span>${escapeHtml(cat.icon || "•")} ${escapeHtml(cat.name)}</strong><small>${escapeHtml(cat.group)} · ${escapeHtml(cat.type)} · ${related.length} keyword rules</small></div><button class="ghost-button compact" data-edit-category="${escapeHtml(cat.id)}" type="button">Edit</button>`;
    categoriesList.append(row);
  }

  const grouped = new Map();
  for (const rule of state.rules) {
    const cat = cats.get(rule.categoryId) || cats.get("misc");
    const key = cat?.id || "misc";
    if (!grouped.has(key)) grouped.set(key, { cat, rules: [] });
    grouped.get(key).rules.push(rule);
  }
  for (const group of [...grouped.values()].sort((a, b) => String(a.cat?.group || "").localeCompare(String(b.cat?.group || "")) || String(a.cat?.name || "").localeCompare(String(b.cat?.name || "")))) {
    const wrapper = document.createElement("section");
    wrapper.className = "rule-group";
    wrapper.innerHTML = `<div class="rule-group-heading"><strong><span class="category-color-dot" style="--cat-color:${safeColor(group.cat?.color)}"></span>${escapeHtml(group.cat?.icon || "?")} ${escapeHtml(group.cat?.name || "Misc")}</strong><small>${escapeHtml(group.cat?.group || "Misc")}</small></div>`;
    for (const rule of group.rules.sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")))) {
      const row = document.createElement("div");
      row.className = "settings-row rule-row";
      const sensitivity = rule.caseSensitive ? "case-sensitive" : "case-insensitive";
      row.innerHTML = `<div><strong>${escapeHtml(rule.label)}</strong><small>${sensitivity}: ${(rule.keywords || []).map(escapeHtml).join(", ")}</small></div><button class="ghost-button compact" data-edit-rule="${escapeHtml(rule.id)}" type="button">Edit</button>`;
      wrapper.append(row);
    }
    rulesList.append(wrapper);
  }
  categoriesList.querySelectorAll("[data-edit-category]").forEach(btn => btn.addEventListener("click", () => openCategoryModal(btn.dataset.editCategory)));
  rulesList.querySelectorAll("[data-edit-rule]").forEach(btn => btn.addEventListener("click", () => openRuleModal(btn.dataset.editRule)));
}

function renderSettings() {
  const form = $("#settings-form");
  if (settingsDirty || (form && form.contains(document.activeElement))) return;
  const compareMode = state.settings.portfolioComparisonMode || "rolling";
  $("#setting-currency").value = selectedCurrency();
  $("#setting-theme").value = state.settings.theme || "dark";
  $("#setting-motion").value = state.settings.motion || "on";
  $("#setting-market-provider").value = state.settings.marketProvider || "twelvedata";
  $("#setting-market-key").value = getLocalMarketApiKey();
  $("#setting-hide-transfers").value = String(state.settings.hideInternalTransfersInSpending !== false);
  $("#setting-quote-interval").value = String(state.settings.quoteRefreshIntervalMinutes ?? 720);
  setCompareMode(compareMode);
  $("#setting-compare-days").value = Number(state.settings.portfolioComparisonDays || 30);
  $("#setting-compare-date").value = state.settings.portfolioComparisonDate || "";
}

function setCompareMode(mode) {
  const nextMode = mode === "date" ? "date" : "rolling";
  const modeInput = $("#setting-compare-mode");
  const daysField = $("#compare-days-field");
  const dateField = $("#compare-date-field");
  const daysInput = $("#setting-compare-days");
  const dateInput = $("#setting-compare-date");
  const isDateMode = nextMode === "date";

  if (modeInput) modeInput.value = nextMode;
  $$("[data-compare-mode]").forEach(button => {
    const active = button.dataset.compareMode === nextMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (daysField) daysField.hidden = isDateMode;
  if (dateField) dateField.hidden = !isDateMode;
  if (daysInput) {
    daysInput.disabled = isDateMode;
    daysInput.required = !isDateMode;
  }
  if (dateInput) {
    dateInput.disabled = !isDateMode;
    dateInput.required = isDateMode;
  }
}

function markSettingsDirty() {
  settingsDirty = true;
  setMessage($("#settings-message"), "");
}

function requestRender() {
  if (renderTimer) cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(() => render());
}

function render() {
  applyAppearance();
  syncStatus();
  fillFilters();
  if (!state.user) return;
  renderOverview();
  if (activeView === "reports") renderReports();
  renderTransactions();
  renderAccounts();
  renderAssets();
  renderRules();
  if (activeView === "settings") renderSettings();
  renderOpenAccountDialogs();
}

function openModal(type) {
  elements.modalBackdrop.hidden = false;
  $$(`[data-modal]`).forEach(modal => modal.hidden = modal.dataset.modal !== type);
  document.body.style.overflow = "hidden";
}

function closeModal() {
  elements.modalBackdrop.hidden = true;
  $$(`[data-modal]`).forEach(modal => modal.hidden = true);
  document.body.style.overflow = "";
  activePositionsAccountId = "";
  activeAccountTransactionsId = "";
}

function syncTransactionReviewControl() {
  const category = $("#transaction-category")?.value || "misc";
  const review = $("#transaction-review");
  if (!review) return;
  const locked = Boolean(category && category !== "misc" && category !== "auto");
  if (locked) review.checked = false;
  review.disabled = locked;
}

function openTransactionModal(id = "") {
  const tx = id ? state.transactions.find(item => item.id === id) : null;
  $("#transaction-modal-title").textContent = tx ? "Edit transaction" : "Add transaction";
  $("#transaction-id").value = tx?.id || "";
  $("#transaction-account").value = tx?.accountId || state.accounts[0]?.id || "";
  $("#transaction-date").value = tx?.date || TODAY();
  $("#transaction-amount").value = tx?.amount ?? "";
  $("#transaction-currency").value = tx?.currency || selectedCurrency();
  $("#transaction-category").value = tx?.categoryId || "misc";
  $("#transaction-counterparty").value = tx?.counterparty || "";
  $("#transaction-description").value = tx?.description || "";
  $("#transaction-note").value = tx?.note || "";
  $("#transaction-review").checked = Boolean(tx?.review);
  $("#delete-transaction-button").hidden = !tx;
  syncTransactionReviewControl();
  openModal("transaction");
}

function openAccountModal(id = "") {
  const account = id ? state.accounts.find(item => item.id === id) : null;
  $("#account-id").value = account?.id || "";
  $("#account-name").value = account?.name || "";
  $("#account-institution").value = account?.institution || "";
  $("#account-type").value = account?.type || "checking";
  $("#account-currency").value = account?.currency || selectedCurrency();
  $("#account-opening").value = account?.openingBalance ?? 0;
  $("#account-iban").value = account?.iban || "";
  $("#account-number").value = account?.accountNumber || "";
  $("#account-bic").value = account?.bic || "";
  $("#account-aliases").value = Array.isArray(account?.transferAliases) ? account.transferAliases.join(", ") : account?.transferAliases || "";
  $("#account-hidden").checked = Boolean(account?.hidden);
  $("#delete-account-button").hidden = !account;
  openModal("account");
}

function openAssetModal(id = "", accountId = "") {
  const asset = id ? state.assets.find(item => item.id === id) : null;
  const defaultBroker = accountId || asset?.accountId || state.accounts.find(item => !item.hidden && item.type === "broker")?.id || visibleAccounts()[0]?.id || "";
  $("#asset-id").value = asset?.id || "";
  $("#asset-account").value = defaultBroker;
  $("#asset-symbol").value = asset?.symbol || "";
  $("#asset-name").value = asset?.name || "";
  $("#asset-type").value = asset?.type || "stock";
  $("#asset-provider").value = asset?.provider || state.settings.marketProvider || "manual";
  $("#asset-quantity").value = asset?.quantity ?? 1;
  $("#asset-currency").value = asset?.currency || selectedCurrency();
  $("#asset-manual-price").value = asset?.manualPrice ?? asset?.lastPrice ?? 0;
  $("#asset-cost-basis").value = asset?.costBasis ?? 0;
  $("#asset-hidden").checked = Boolean(asset?.hidden);
  $("#delete-asset-button").hidden = !asset;
  openModal("asset");
}

function positionDelta(asset) {
  const currentValue = assetMarketValue(asset);
  if (positionsPeriod === "today") {
    const pct = Number(asset.lastChangePercent);
    if (!Number.isFinite(pct)) return { amount: null, percent: null };
    const previousValue = currentValue / (1 + pct / 100);
    return { amount: currentValue - previousValue, percent: pct };
  }
  const basis = Number(asset.costBasis || 0);
  if (!Number.isFinite(basis) || basis <= 0) return { amount: null, percent: null };
  const amount = currentValue - basis;
  return { amount, percent: amount / basis * 100 };
}

function renderPositionsModal() {
  const tbody = $("#positions-body");
  if (!tbody || !activePositionsAccountId) return;
  const account = state.accounts.find(item => item.id === activePositionsAccountId);
  const holdings = holdingsForAccount(activePositionsAccountId);
  $("#positions-modal-title").textContent = account ? `${account.name} positions` : "Positions";
  $("#positions-delta-heading").textContent = positionsPeriod === "today" ? "Today" : "Since buy";
  $$("[data-position-period]").forEach(button => {
    const active = button.dataset.positionPeriod === positionsPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("[data-position-unit]").forEach(button => {
    const active = button.dataset.positionUnit === positionsUnit;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  positionsPage = renderPagination($("#positions-pagination"), holdings.length, positionsPage, PAGE_SIZES.positions, page => {
    positionsPage = page;
    renderPositionsModal();
  });
  tbody.replaceChildren();
  if (!holdings.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No positions in this account yet.</td></tr>`;
    return;
  }
  for (const asset of pagedRows(holdings, positionsPage, PAGE_SIZES.positions)) {
    const price = Number(asset.lastPrice ?? asset.manualPrice ?? 0);
    const value = assetMarketValue(asset);
    const currency = asset.currency || account?.currency || selectedCurrency();
    const delta = positionDelta(asset);
    const deltaValue = positionsUnit === "percent" ? delta.percent : delta.amount;
    const deltaClass = !Number.isFinite(deltaValue) || Math.abs(deltaValue) < 0.005 ? "delta-flat" : deltaValue >= 0 ? "delta-up" : "delta-down";
    const deltaText = !Number.isFinite(deltaValue)
      ? "—"
      : positionsUnit === "percent"
        ? formatPercent(deltaValue)
        : formatCurrency(deltaValue, currency);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(asset.symbol || asset.name)}</strong><small class="muted table-ellipsis">${escapeHtml(asset.name || asset.type || "")}</small></td>
      <td>${Number(asset.quantity || 0).toLocaleString()}</td>
      <td>${formatCurrency(price, currency)}</td>
      <td>${formatCurrency(value, currency)}</td>
      <td><span class="${deltaClass}">${deltaText}</span></td>
      <td class="action-cell"><button class="ghost-button compact" type="button" data-edit-asset="${escapeHtml(asset.id)}">Edit</button></td>`;
    tbody.append(tr);
  }
  tbody.querySelectorAll("[data-edit-asset]").forEach(btn => btn.addEventListener("click", () => openAssetModal(btn.dataset.editAsset)));
}

function openPositionsModal(accountId) {
  activePositionsAccountId = accountId || "";
  activeAccountTransactionsId = "";
  positionsPage = 1;
  renderPositionsModal();
  openModal("positions");
}

function renderAccountTransactionsModal() {
  const tbody = $("#account-transactions-body");
  if (!tbody || !activeAccountTransactionsId) return;
  const account = state.accounts.find(item => item.id === activeAccountTransactionsId);
  const cats = categoryMap();
  const rows = sortedRows(
    state.transactions.filter(tx => tx.accountId === activeAccountTransactionsId),
    { key: "date", dir: "desc" },
    { date: tx => tx.date || "" }
  );
  $("#account-transactions-title").textContent = account ? `${account.name} latest transactions` : "Latest transactions";
  accountTransactionsPage = renderPagination($("#account-transactions-pagination"), rows.length, accountTransactionsPage, PAGE_SIZES.accountTransactions, page => {
    accountTransactionsPage = page;
    renderAccountTransactionsModal();
  });
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No transactions for this account yet.</td></tr>`;
    return;
  }
  for (const tx of pagedRows(rows, accountTransactionsPage, PAGE_SIZES.accountTransactions)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(tx.date)}</td>
      <td class="description-cell"><strong>${escapeHtml(tx.description)}</strong><small class="muted table-ellipsis">${escapeHtml(tx.counterparty || tx.reason || "")}</small></td>
      <td>${categoryPill(cat, { review: tx.review })}</td>
      <td class="${Number(tx.amount) >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency || selectedCurrency())}</td>
      <td class="note-cell"><span class="table-ellipsis" title="${escapeHtml(tx.note || "")}">${escapeHtml(tx.note || "")}</span></td>
      <td class="action-cell"><button class="ghost-button compact" type="button" data-edit-tx="${escapeHtml(tx.id)}">Edit</button></td>`;
    tbody.append(tr);
  }
  tbody.querySelectorAll("[data-edit-tx]").forEach(btn => btn.addEventListener("click", () => openTransactionModal(btn.dataset.editTx)));
}

function openAccountTransactionsModal(accountId) {
  activeAccountTransactionsId = accountId || "";
  activePositionsAccountId = "";
  accountTransactionsPage = 1;
  renderAccountTransactionsModal();
  openModal("account-transactions");
}

function renderOpenAccountDialogs() {
  if (!elements.modalBackdrop || elements.modalBackdrop.hidden) return;
  const visibleModal = $("[data-modal]:not([hidden])")?.dataset.modal;
  if (visibleModal === "positions") renderPositionsModal();
  if (visibleModal === "account-transactions") renderAccountTransactionsModal();
}

function openCategoryModal(id = "") {
  const cat = id ? state.categories.find(item => item.id === id) : null;
  $("#category-id").value = cat?.id || "";
  $("#category-name").value = cat?.name || "";
  $("#category-group").value = cat?.group || "Custom";
  $("#category-icon").value = cat?.icon || "•";
  $("#category-type").value = cat?.type || "expense";
  $("#category-color").innerHTML = colorOptions(cat?.color || DEFAULT_CATEGORY_COLOR);
  $("#category-color").value = safeColor(cat?.color);
  openModal("category");
}

function openRuleModal(id = "") {
  const rule = id ? state.rules.find(item => item.id === id) : null;
  $("#rule-id").value = rule?.id || "";
  $("#rule-label").value = rule?.label || "";
  $("#rule-category").value = rule?.categoryId || "misc";
  $("#rule-keywords").value = (rule?.keywords || []).join(", ");
  $("#rule-case-sensitive").value = String(Boolean(rule?.caseSensitive));
  $("#delete-rule-button").hidden = !rule;
  openModal("rule");
}

async function refreshAsset(id) {
  const asset = state.assets.find(item => item.id === id);
  if (!asset) return;
  try {
    const quote = await fetchQuote(asset, state.settings);
    await updateAssetQuote(id, quote);
    toast("Price updated", `${asset.symbol || asset.name}: ${formatCurrency(quote.price, quote.currency || asset.currency)}`);
  } catch (error) {
    toast("Price refresh failed", error.message, "error");
  }
}

async function refreshAllAssets({ silent = false } = {}) {
  const visible = state.assets.filter(asset => !asset.hidden && (asset.provider || state.settings.marketProvider) !== "manual");
  if (!visible.length) {
    if (!silent) toast("No online holdings", "Add a non-manual holding first.", "error");
    return { ok: 0, failed: 0 };
  }
  let ok = 0;
  let failed = 0;
  for (const asset of visible) {
    try {
      const quote = await fetchQuote(asset, state.settings);
      await updateAssetQuote(asset.id, quote);
      ok += 1;
    } catch (error) {
      failed += 1;
      console.warn("Quote failed", asset.symbol, error);
    }
  }
  if (!silent) toast("Quote refresh complete", `${ok} updated${failed ? ` · ${failed} failed` : ""}`, failed ? "error" : "success");
  return { ok, failed };
}

async function maybeRefreshQuotes() {
  if (!navigator.onLine) return;
  const intervalMinutes = Number(state.settings.quoteRefreshIntervalMinutes ?? 720);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;
  const visible = state.assets.filter(asset => !asset.hidden && (asset.provider || state.settings.marketProvider) !== "manual");
  if (!visible.length) return;
  const maxAgeMs = intervalMinutes * 60 * 1000;
  const stale = visible.some(asset => {
    const last = asset.lastPriceAt ? new Date(asset.lastPriceAt).getTime() : 0;
    return !last || Date.now() - last > maxAgeMs;
  });
  if (!stale) return;
  await refreshAllAssets({ silent: true });
}

async function runScheduledRefresh() {
  await maybeRefreshFxRates();
  await maybeRefreshQuotes();
}

function setupAutoRefreshTimers() {
  if (quoteRefreshTimer) clearInterval(quoteRefreshTimer);
  const intervalMinutes = Number(state.settings.quoteRefreshIntervalMinutes ?? 720);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;
  quoteRefreshTimer = setInterval(() => runScheduledRefresh().catch(error => console.warn("Scheduled refresh skipped", error)), Math.max(15, intervalMinutes) * 60 * 1000);
}

async function maybeRefreshFxRates() {
  if (!navigator.onLine || state.settings.autoRefreshFx === "off") return;
  const intervalMinutes = Number(state.settings.quoteRefreshIntervalMinutes ?? 720);
  const maxAgeMs = Math.max(15, intervalMinutes) * 60 * 1000;
  const last = state.settings.fxLastUpdatedAt ? new Date(state.settings.fxLastUpdatedAt).getTime() : 0;
  const stale = !last || Date.now() - last > maxAgeMs;
  if (!stale) return;
  try {
    await refreshFxRates({ silent: true });
  } catch (error) {
    console.warn("FX refresh skipped", error);
  }
}

function mappingSelect(field, label) {
  const select = document.createElement("label");
  select.className = "field";
  const options = [`<option value="">Ignore</option>`].concat(activeParsedFile.headers.map((header, index) => `<option value="${index}" ${activeParsedFile.mapping[field] === index ? "selected" : ""}>${escapeHtml(header)}</option>`)).join("");
  select.innerHTML = `<span>${label}</span><select data-map-field="${field}">${options}</select>`;
  return select;
}

function renderMapping() {
  const grid = $("#mapping-grid");
  if (!grid) return;
  grid.replaceChildren();
  if (!activeParsedFile) {
    grid.innerHTML = `<p class="muted">Upload a file to map columns.</p>`;
    return;
  }
  [
    ["date", "Date"],
    ["amount", "Amount"],
    ["debit", "Debit / money out"],
    ["credit", "Credit / money in"],
    ["description", "Description"],
    ["counterparty", "Counterparty"],
    ["currency", "Currency"],
    ["balance", "Balance"]
  ].forEach(([field, label]) => grid.append(mappingSelect(field, label)));
  grid.querySelectorAll("[data-map-field]").forEach(select => select.addEventListener("change", () => {
    const value = select.value === "" ? undefined : Number(select.value);
    if (value == null) delete activeParsedFile.mapping[select.dataset.mapField];
    else activeParsedFile.mapping[select.dataset.mapField] = value;
  }));
}

function updateImportFileLabel() {
  const label = $("#import-file-label");
  const title = $("#import-file-title");
  const detail = $("#import-file-detail");
  if (!label || !title || !detail) return;
  label.classList.toggle("has-file", Boolean(activeParsedFile));
  if (!activeParsedFile) {
    title.textContent = "Choose a bank export";
    detail.textContent = "CSV, semicolon CSV, tab-separated, German and English headers";
    return;
  }
  title.textContent = activeParsedFile.filename;
  detail.textContent = `${activeParsedFile.rows.length} rows loaded; click to replace`;
}

function buildActiveImportPreview() {
  if (!activeParsedFile) return;
  const account = state.accounts.find(item => item.id === $("#import-account").value);
  activePreview = buildImportPreview(activeParsedFile, activeParsedFile.mapping, {
    accountId: $("#import-account").value,
    currency: account?.currency || selectedCurrency(),
    rules: state.rules,
    categories: state.categories,
    accounts: state.accounts
  }, state.transactions);
  importPage = 1;
  $("#commit-import-button").disabled = !activePreview.transactions.length;
  $("#reset-import-button").disabled = false;
  setMessage($("#import-message"), `${activePreview.transactions.length} rows ready. ${activePreview.transactions.filter(tx => tx.review).length} need review.`);
  renderImportPreview();
}

function resetImportFlow(message = "") {
  activeParsedFile = null;
  activePreview = null;
  importPage = 1;
  const fileInput = $("#import-file");
  if (fileInput) fileInput.value = "";
  $("#commit-import-button").disabled = true;
  $("#reset-import-button").disabled = true;
  updateImportFileLabel();
  setMessage($("#import-message"), message);
  renderImportPreview();
}

function renderImportPreview() {
  const tbody = $("#import-preview-body");
  if (!tbody) return;
  tbody.replaceChildren();
  if (!activePreview) {
    $("#preview-count").textContent = "No file";
    renderPagination($("#import-preview-pagination"), 0, 1, PAGE_SIZES.importPreview, () => {});
    updateSortButtons("import", importSort);
    return;
  }
  const cats = categoryMap();
  const rows = sortedRows(activePreview.transactions, importSort, {
    date: tx => tx.date || "",
    description: tx => tx.description || "",
    amount: tx => Number(tx.amount || 0),
    category: tx => cats.get(tx.categoryId)?.name || tx.categoryId || "",
    status: tx => tx.review ? "Needs review" : "Prepared"
  });
  $("#preview-count").textContent = `${activePreview.transactions.length} accepted · ${activePreview.skipped.length} skipped`;
  importPage = renderPagination($("#import-preview-pagination"), rows.length, importPage, PAGE_SIZES.importPreview, page => {
    importPage = page;
    renderImportPreview();
  });
  updateSortButtons("import", importSort);
  for (const tx of pagedRows(rows, importPage, PAGE_SIZES.importPreview)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(tx.date)}</td><td class="description-cell"><strong>${escapeHtml(tx.description)}</strong><small class="muted table-ellipsis">${escapeHtml(tx.reason || "")}</small></td><td class="${tx.amount >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency)}</td><td>${categoryPill(cat, { review: tx.review })}</td><td>${tx.review ? "Needs review" : "Prepared"}</td>`;
    tbody.append(tr);
  }
}

async function exportTransactionsCsv() {
  const csv = serializeTransactionsCsv(state.transactions, state.categories, state.accounts);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vaultpilot-transactions-${TODAY()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}


async function exportBackupJson() {
  const backup = await exportState();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vaultpilot-full-backup-${TODAY()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result || "{}"))); }
      catch (error) { reject(new Error("The selected file is not valid JSON.")); }
    };
    reader.onerror = () => reject(new Error("Could not read JSON file."));
    reader.readAsText(file);
  });
}

async function importJsonBackupFile(file) {
  if (!file) return;
  const button = $("#import-json-button");
  const fileInput = $("#import-json-file");
  const replace = $("#import-json-mode").value === "replace";
  if (replace && !confirm("Replace all current VaultPilot data with this JSON backup?")) {
    if (fileInput) fileInput.value = "";
    return;
  }
  if (replace && !confirm("Final confirmation: this deletes current accounts, rules, transactions and holdings before importing.")) {
    if (fileInput) fileInput.value = "";
    return;
  }

  if (button) button.disabled = true;
  try {
    setMessage($("#import-json-message"), "Importing JSON backup...");
    const backup = await readJsonFile(file);
    const counts = await importStateBackup(backup, { replace });
    setMessage($("#import-json-message"), `Imported ${counts.accounts || 0} accounts, ${counts.transactions || 0} transactions, ${counts.assets || 0} holdings, ${counts.categories || 0} categories and ${counts.rules || 0} rules.`);
    toast("JSON import complete", replace ? "Current data was replaced." : "Backup was merged into current data.");
    if (fileInput) fileInput.value = "";
  } catch (error) {
    setMessage($("#import-json-message"), error.message, true);
    toast("JSON import failed", error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function wireEvents() {
  elements.authForm.addEventListener("submit", async event => {
    event.preventDefault();
    setBusy(elements.authForm, true);
    setMessage(elements.authMessage, "");
    try {
      await signInWithEmailAndPassword(auth, elements.authEmail.value.trim(), elements.authPassword.value);
    } catch (error) {
      setMessage(elements.authMessage, firebaseErrorMessage(error), true);
    } finally {
      setBusy(elements.authForm, false);
    }
  });

  if (elements.createAccount) {
    elements.createAccount.addEventListener("click", async () => {
      setBusy(elements.authForm, true);
      setMessage(elements.authMessage, "");
      try {
        await createUserWithEmailAndPassword(auth, elements.authEmail.value.trim(), elements.authPassword.value);
      } catch (error) {
        setMessage(elements.authMessage, firebaseErrorMessage(error), true);
      } finally {
        setBusy(elements.authForm, false);
      }
    });
  }

  if (elements.resetPassword) {
    elements.resetPassword.addEventListener("click", async () => {
      try {
        const email = elements.authEmail.value.trim();
        if (!email) return setMessage(elements.authMessage, "Enter your email first.", true);
        await sendPasswordResetEmail(auth, email);
        setMessage(elements.authMessage, "Password reset email sent.");
      } catch (error) {
        setMessage(elements.authMessage, firebaseErrorMessage(error), true);
      }
    });
  }

  elements.signOut?.addEventListener("click", () => signOut(auth));
  $$(`[data-view]`).forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.view)));
  $$(`[data-go-view]`).forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.goView)));
  $("#hidden-accounts-toggle")?.addEventListener("click", () => {
    hiddenAccountsExpanded = !hiddenAccountsExpanded;
    requestRender();
  });
  $("#settings-form")?.addEventListener("pointerdown", event => {
    if (event.target.closest("input,select,textarea,button")) markSettingsDirty();
  }, { passive: true });
  $("#settings-form")?.addEventListener("focusin", markSettingsDirty);
  $("#settings-form")?.addEventListener("input", markSettingsDirty);
  $("#settings-form")?.addEventListener("change", markSettingsDirty);
  $$("[data-compare-mode]").forEach(button => button.addEventListener("click", () => {
    markSettingsDirty();
    setCompareMode(button.dataset.compareMode);
  }));
  $$(`[data-open-modal]`).forEach(button => button.addEventListener("click", () => {
    const type = button.dataset.openModal;
    if (type === "transaction") openTransactionModal();
    else if (type === "account") openAccountModal();
    else if (type === "asset") openAssetModal();
    else if (type === "category") openCategoryModal();
    else if (type === "rule") openRuleModal();
  }));
  $$(`[data-close-modal]`).forEach(button => button.addEventListener("click", closeModal));
  elements.modalBackdrop.addEventListener("click", event => { if (event.target === elements.modalBackdrop) closeModal(); });

  $("[data-sort-table='transactions']")?.closest("table")?.addEventListener("click", event => {
    const button = event.target.closest("[data-sort-table='transactions']");
    if (!button) return;
    const key = button.dataset.sortKey;
    txSort = txSort.key === key ? { key, dir: txSort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" ? "desc" : "asc" };
    txPage = 1;
    renderTransactions();
  });
  $("[data-sort-table='import']")?.closest("table")?.addEventListener("click", event => {
    const button = event.target.closest("[data-sort-table='import']");
    if (!button) return;
    const key = button.dataset.sortKey;
    importSort = importSort.key === key ? { key, dir: importSort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" ? "asc" : "asc" };
    importPage = 1;
    renderImportPreview();
  });
  ["#tx-search", "#tx-account-filter", "#tx-category-filter", "#tx-review-filter"].forEach(selector => $(selector)?.addEventListener("input", () => {
    txPage = 1;
    renderTransactions();
  }));
  $("#reset-tx-filters")?.addEventListener("click", () => {
    $("#tx-search").value = "";
    $("#tx-account-filter").value = "all";
    $("#tx-category-filter").value = "all";
    $("#tx-review-filter").value = "all";
    txPage = 1;
    renderTransactions();
  });
  $("#tx-filter-toggle")?.addEventListener("click", () => {
    const panel = $("#tx-filter-panel");
    const expanded = !panel.classList.toggle("is-collapsed");
    $("#tx-filter-toggle").setAttribute("aria-expanded", String(expanded));
    $("#tx-filter-toggle b").textContent = expanded ? "-" : "+";
  });
  $$("[data-report-mode]").forEach(button => button.addEventListener("click", () => {
    reportsMode = button.dataset.reportMode === "year" ? "year" : "month";
    renderReports();
  }));
  $("#report-month")?.addEventListener("change", event => {
    reportsMonth = event.target.value || monthKey(TODAY());
    reportsYear = reportsMonth.slice(0, 4);
    renderReports();
  });
  $("#report-year")?.addEventListener("change", event => {
    reportsYear = event.target.value || String(new Date().getFullYear());
    renderReports();
  });
  $("#report-compare-year")?.addEventListener("change", event => {
    reportsCompareYear = event.target.value || String(Number(reportsYear) - 1);
    renderReports();
  });
  $$("[data-position-period]").forEach(button => button.addEventListener("click", () => {
    positionsPeriod = button.dataset.positionPeriod === "today" ? "today" : "basis";
    renderPositionsModal();
  }));
  $$("[data-position-unit]").forEach(button => button.addEventListener("click", () => {
    positionsUnit = button.dataset.positionUnit === "percent" ? "percent" : "absolute";
    renderPositionsModal();
  }));
  $("#transaction-category")?.addEventListener("change", syncTransactionReviewControl);
  $("#export-button")?.addEventListener("click", exportTransactionsCsv);
  $("#export-json-button")?.addEventListener("click", () => exportBackupJson().catch(error => toast("JSON export failed", error.message, "error")));
  $("#import-json-file")?.addEventListener("change", event => {
    importJsonBackupFile(event.target.files?.[0]);
  });
  $("#import-json-button")?.addEventListener("click", () => {
    const fileInput = $("#import-json-file");
    if (!fileInput) return;
    setMessage($("#import-json-message"), "");
    fileInput.value = "";
    fileInput.click();
  });

  $("#transaction-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    try {
      const input = {
        id: $("#transaction-id").value || undefined,
        accountId: $("#transaction-account").value,
        date: $("#transaction-date").value,
        amount: parseMoney($("#transaction-amount").value),
        currency: normalizedCurrencyFrom("#transaction-currency"),
        categoryId: $("#transaction-category").value,
        counterparty: $("#transaction-counterparty").value,
        description: $("#transaction-description").value,
        note: $("#transaction-note").value,
        review: $("#transaction-review").checked,
        source: $("#transaction-id").value ? "manual-edit" : "manual"
      };
      if (!input.accountId || !input.date || input.amount == null) {
        toast("Invalid transaction", "Account, date and amount are required.", "error");
        return;
      }
      if (input.categoryId && input.categoryId !== "misc" && input.categoryId !== "auto") input.review = false;
      if (!input.categoryId || input.categoryId === "auto") {
        const cat = categorizeTransaction(input, state.rules, state.categories, state.accounts);
        Object.assign(input, cat);
      }
      await saveTransaction(input);
      toast("Transaction saved");
      closeModal();
    } catch (error) {
      toast("Save failed", error.message, "error");
    } finally {
      setBusy(form, false);
      syncTransactionReviewControl();
    }
  });

  $("#delete-transaction-button").addEventListener("click", async () => {
    const id = $("#transaction-id").value;
    if (!id) return;
    await deleteTransaction(id);
    toast("Transaction deleted");
    closeModal();
  });

  $("#account-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    try {
      await saveAccount({
        id: $("#account-id").value || undefined,
        name: $("#account-name").value,
        institution: $("#account-institution").value,
        type: $("#account-type").value,
        currency: normalizedCurrencyFrom("#account-currency"),
        openingBalance: parseMoney($("#account-opening").value) || 0,
        iban: $("#account-iban").value,
        accountNumber: $("#account-number").value,
        bic: $("#account-bic").value,
        transferAliases: $("#account-aliases").value,
        hidden: $("#account-hidden").checked
      });
      toast("Account saved");
      closeModal();
    } catch (error) {
      toast("Account save failed", error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  $("#delete-account-button").addEventListener("click", async () => {
    const id = $("#account-id").value;
    const account = state.accounts.find(item => item.id === id);
    if (!id || !account) return;
    const txCount = state.transactions.filter(tx => tx.accountId === id).length;
    const assetCount = state.assets.filter(asset => asset.accountId === id).length;
    const first = confirm(`Delete '${account.name}'? This account will be removed instead of hidden.`);
    if (!first) return;
    const second = confirm(`Final confirmation: delete '${account.name}' with ${txCount} linked transactions and ${assetCount} linked holdings?`);
    if (!second) return;
    try {
      await deleteAccount(id, { hideOnly: false });
      toast("Account deleted", "Transactions remain available, but the account record is removed.");
      closeModal();
    } catch (error) {
      toast("Delete failed", error.message, "error");
    }
  });

  $("#asset-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    try {
      await saveAsset({
        id: $("#asset-id").value || undefined,
        accountId: $("#asset-account").value,
        symbol: $("#asset-symbol").value,
        name: $("#asset-name").value,
        type: $("#asset-type").value,
        provider: $("#asset-provider").value,
        quantity: parseMoney($("#asset-quantity").value) || 0,
        currency: normalizedCurrencyFrom("#asset-currency"),
        manualPrice: parseMoney($("#asset-manual-price").value) || 0,
        costBasis: parseMoney($("#asset-cost-basis").value) || 0,
        hidden: $("#asset-hidden").checked
      });
      toast("Holding saved");
      closeModal();
    } catch (error) {
      toast("Holding save failed", error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  $("#delete-asset-button").addEventListener("click", async () => {
    const id = $("#asset-id").value;
    if (!id) return;
    await deleteAsset(id);
    toast("Asset deleted");
    closeModal();
  });

  $("#category-form").addEventListener("submit", async event => {
    event.preventDefault();
    await saveCategory({
      id: $("#category-id").value || undefined,
      name: $("#category-name").value,
      group: $("#category-group").value,
      icon: $("#category-icon").value,
      type: $("#category-type").value,
      color: $("#category-color").value
    });
    toast("Category saved");
    closeModal();
  });

  $("#rule-form").addEventListener("submit", async event => {
    event.preventDefault();
    await saveRule({
      id: $("#rule-id").value || undefined,
      label: $("#rule-label").value,
      categoryId: $("#rule-category").value,
      keywords: $("#rule-keywords").value,
      caseSensitive: $("#rule-case-sensitive").value === "true"
    });
    toast("Rule saved");
    closeModal();
  });

  $("#delete-rule-button").addEventListener("click", async () => {
    const id = $("#rule-id").value;
    if (!id) return;
    await deleteRule(id);
    toast("Rule deleted");
    closeModal();
  });

  $("#settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const primaryCurrency = normalizedCurrencyFrom("#setting-currency", "EUR");
      setLocalMarketApiKey($("#setting-market-key").value.trim());
      const comparisonMode = $("#setting-compare-mode").value || "rolling";
      await saveSettings({
        primaryCurrency,
        theme: $("#setting-theme").value,
        motion: $("#setting-motion").value,
        marketProvider: $("#setting-market-provider").value,
        quoteRefreshIntervalMinutes: Number($("#setting-quote-interval").value || 720),
        portfolioComparisonMode: comparisonMode,
        portfolioComparisonDays: comparisonMode === "rolling" ? Number($("#setting-compare-days").value || 30) : Number(state.settings.portfolioComparisonDays || 30),
        portfolioComparisonDate: comparisonMode === "date" ? $("#setting-compare-date").value || "" : "",
        hideInternalTransfersInSpending: $("#setting-hide-transfers").value === "true"
      });
      settingsDirty = false;
      setMessage($("#settings-message"), "Settings saved.");
      toast("Settings saved");
      setupAutoRefreshTimers();
      runScheduledRefresh().catch(error => console.warn("Scheduled refresh skipped", error));
    } catch (error) {
      setMessage($("#settings-message"), error.message, true);
    }
  });

  $("#import-account")?.addEventListener("change", () => {
    if (activeParsedFile) buildActiveImportPreview();
  });

  $("#import-file").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      activeParsedFile = await parseBankFile(file);
      activePreview = null;
      updateImportFileLabel();
      setMessage($("#import-message"), "File loaded. Preview built from expected column names.");
      buildActiveImportPreview();
    } catch (error) {
      toast("Import failed", error.message, "error");
    }
  });

  $("#reset-import-button")?.addEventListener("click", () => {
    resetImportFlow("Import reset.");
  });

  $("#commit-import-button").addEventListener("click", async () => {
    if (!activePreview?.transactions?.length) return;
    try {
      await saveTransactionsBatch(activePreview.transactions);
      toast("Import complete", `${activePreview.transactions.length} transactions saved.`);
      resetImportFlow("Import complete.");
    } catch (error) {
      toast("Import save failed", error.message, "error");
    }
  });

  window.addEventListener("resize", () => requestRender());
}

subscribe(() => requestRender());
wireEvents();
bootAuth();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(error => console.warn("Service worker failed", error));
  });
}
