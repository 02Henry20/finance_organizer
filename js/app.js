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
  deleteAllData,
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
  repairSync,
  resolveSyncConflict,
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
  normalizeText,
  parseMoney,
  shouldIgnoreTransactionInStats
} from "./finance.js";
import {
  RECOGNIZED_BANK_FORMATS,
  RECOGNIZED_BROKER_FORMATS,
  buildBrokerPositionsPreview,
  buildImportPreview,
  parseBankFile,
  parseBrokerPositionsFile,
  serializeTransactionsCsv
} from "./importer.js";
import { fetchQuote } from "./market.js";
import { drawAccountBars, drawDonut, drawIncomeExpense, drawNetSeries, drawYearComparison } from "./charts.js";

const VIEW_LABELS = {
  overview: ["COMMAND CENTER", "Overview"],
  reports: ["PERIOD ANALYSIS", "Reports"],
  transactions: ["LEDGER", "Transactions"],
  import: ["BANK DATA", "Import"],
  accounts: ["MONEY CONTAINERS", "Accounts"],
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
let brokerParsedFile = null;
let brokerPreview = null;
let brokerPositionsPage = 1;
let renderTimer = null;
let quoteRefreshTimer = null;
let settingsDirty = false;
let hiddenAccountsExpanded = false;
let txSort = { key: "date", dir: "desc" };
let importSort = { key: "date", dir: "asc" };
let txSelectionMode = false;
let selectedTransactionIds = new Set();
let transactionCategoryDebounce = null;
let txFilteredRows = [];
let importSelectedIds = new Set();
let txPage = 1;
let importPage = 1;
let importSkippedPage = 1;
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
  transactions: 10,
  importPreview: 10,
  positions: 10,
  accountTransactions: 10,
  brokerPositions: 10
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

function categorySearchValue(categoryId = "") {
  if (!categoryId) return "";
  const cat = state.categories.find(item => item.id === categoryId);
  return cat ? `${cat.icon || "•"} ${cat.name}` : "";
}

function cleanCategorySearchLabel(value = "") {
  return String(value || "").trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function categoryIdFromSearch(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const byId = state.categories.find(cat => cat.id === raw);
  if (byId) return byId.id;
  const cleaned = cleanCategorySearchLabel(raw);
  const normalized = normalizeText(cleaned);
  const compact = normalizeText(cleaned.replace(/\s+/g, " "));
  const match = state.categories.find(cat => {
    const label = normalizeText(cleanCategorySearchLabel(categorySearchValue(cat.id)));
    const name = normalizeText(cat.name);
    return normalized === label || normalized === name || compact === name;
  });
  return match?.id || "";
}

function matchingCategoryOptions(value = "") {
  const query = normalizeText(cleanCategorySearchLabel(value));
  const compactQuery = String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const source = state.categories.map(cat => ({
    ...cat,
    label: categorySearchValue(cat.id),
    haystack: normalizeText([cat.name, cat.group, cat.type, cat.icon].join(" ")),
    compact: [cat.name, cat.group, cat.type, cat.icon].join(" ").replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  }));
  if (!query && !compactQuery) return source.slice(0, 10);
  return source
    .map(cat => {
      const name = normalizeText(cat.name);
      const starts = name.startsWith(query) || cat.haystack.startsWith(query) ? 2 : 0;
      const contains = cat.haystack.includes(query) || (compactQuery && cat.compact.includes(compactQuery)) ? 1 : 0;
      return { cat, score: starts + contains };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.cat.name).localeCompare(String(b.cat.name)))
    .slice(0, 10)
    .map(item => item.cat);
}

function renderTransactionCategoryMenu(show = false) {
  const menu = $("#transaction-category-menu");
  const input = $("#transaction-category");
  if (!menu || !input) return;
  const matches = matchingCategoryOptions(input.value);
  menu.replaceChildren();
  if (!show || !matches.length) {
    menu.hidden = true;
    return;
  }
  for (const cat of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-suggest-option";
    button.dataset.categoryId = cat.id;
    button.innerHTML = `<span>${escapeHtml(cat.icon || "•")}</span><strong>${escapeHtml(cat.name)}</strong><small>${escapeHtml(cat.group || "")}</small>`;
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      input.value = categorySearchValue(cat.id);
      menu.hidden = true;
      syncTransactionReviewControl();
    });
    menu.append(button);
  }
  menu.hidden = false;
}

function fillTransactionCategoryDatalist() {
  renderTransactionCategoryMenu(false);
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

function accountDisplayCurrency(account = null) {
  return (account?.displayCurrency || state.settings.primaryCurrency || "EUR").toUpperCase();
}

function accountCurrencyOptions(selected = "", nativeCurrency = "") {
  const main = selectedCurrency();
  const native = (nativeCurrency || main).toUpperCase();
  const chosen = [main, native].includes((selected || "").toUpperCase()) ? (selected || "").toUpperCase() : "";
  const options = [`<option value="" ${chosen ? "" : "selected"}>Main (${escapeHtml(main)})</option>`];
  if (native && native !== main) {
    options.push(`<option value="${escapeHtml(native)}" ${chosen === native ? "selected" : ""}>${escapeHtml(native)} · account</option>`);
  }
  return options.join("");
}

function convertPrimaryToAccountDisplay(value, targetCurrency = selectedCurrency()) {
  const amount = Number(value || 0);
  const primary = selectedCurrency();
  const target = (targetCurrency || primary).toUpperCase();
  if (target === primary) return amount;
  const rates = { EUR: 1, USD: 0.92, GBP: 1.17, KRW: 0.00063, JPY: 0.0058, CHF: 1.04, ...(state.settings.fxRates || {}) };
  const primaryRate = Number(rates[primary] ?? 1);
  const targetRate = Number(rates[target]);
  if (!Number.isFinite(primaryRate) || primaryRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) return amount;
  return amount * primaryRate / targetRate;
}

function accountRowsForDisplay(rows = [], targetCurrency = selectedCurrency()) {
  return rows.map(row => ({
    ...row,
    balance: {
      ...(row.balance || {}),
      converted: convertPrimaryToAccountDisplay(row.balance?.converted || 0, targetCurrency)
    }
  }));
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
  const name = cat?.name || "Misc";
  return `<span class="category-pill colored ${review ? "review-pill" : ""}" style="--cat-color:${color}" title="${escapeHtml(name)}"><span class="category-icon">${escapeHtml(cat?.icon || "?")}</span><span class="category-pill-text">${escapeHtml(name)}</span></span>`;
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

function isoDateFromMs(ms) {
  const time = Number(ms);
  if (!Number.isFinite(time) || time <= 0) return "";
  return new Date(time).toISOString().slice(0, 10);
}

function assetBaselineValue(asset) {
  const quantity = Number(asset.quantity || 0);
  const current = assetMarketValue(asset);
  const explicit = Number(asset.startingValue || 0);
  const costBasis = Number(asset.costBasis || 0);
  const buyPriceValue = Number(asset.buyPrice || 0) * quantity;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (Number.isFinite(costBasis) && costBasis > 0) return costBasis;
  if (Number.isFinite(buyPriceValue) && buyPriceValue > 0) return buyPriceValue;
  return Number.isFinite(current) ? current : 0;
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
    if (indicator) indicator.textContent = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
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
      <span class="metric-tag">${page} | ${pages}</span>
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

function compareBoundsForReport() {
  if (reportsMode === "year") {
    return { start: `${reportsCompareYear}-01-01`, end: `${reportsCompareYear}-12-31`, label: reportsCompareYear };
  }
  const month = String(reportsMonth || monthKey(TODAY())).slice(5, 7) || "01";
  const compareMonth = `${reportsCompareYear}-${month}`;
  return { start: monthStart(compareMonth), end: monthEnd(compareMonth), label: monthLabel(compareMonth, { short: true }) };
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

function includeInSpending(cat, tx = {}) {
  if (shouldIgnoreTransactionInStats(tx)) return false;
  return !(cat?.type === "transfer" && state.settings.hideInternalTransfersInSpending);
}

function summarizeTransactions(rows) {
  const cats = categoryMap();
  return rows.reduce((totals, tx) => {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const amount = convertCurrency(Number(tx.amount || 0), tx.currency || selectedCurrency(), state.settings);
    if (!includeInSpending(cat, tx)) {
      if (cat?.type === "transfer") totals.transfer += amount;
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
    if (!includeInSpending(cat, tx)) continue;
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

function quoteTimestamp(asset = null) {
  return asset?.lastQuotePriceAt || asset?.lastPriceAt || "";
}

function quoteAgeDays(asset = null) {
  const time = quoteTimestamp(asset) ? new Date(quoteTimestamp(asset)).getTime() : NaN;
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 86400000);
}

function quoteAgeLabel(asset = null) {
  const age = quoteAgeDays(asset);
  if (age == null) return "no update";
  return `${age.toFixed(1)}d ago`;
}

function quoteIsStale(asset = null, thresholdDays = 7) {
  const age = quoteAgeDays(asset);
  return age == null || age > thresholdDays;
}

function quoteAgeClass(asset = null) {
  return quoteIsStale(asset) ? "quote-age stale" : "quote-age";
}

function quoteMetaText(asset = null) {
  if (!asset?.lastPriceAt && !asset?.lastQuotePriceAt) return "No provider pull yet";
  const source = asset.lastQuoteSource || asset.provider || "provider";
  const symbol = asset.lastProviderSymbol || asset.providerSymbol || asset.symbol || "";
  const exchange = asset.lastQuoteExchange ? ` · ${asset.lastQuoteExchange}` : "";
  const providerPrice = Number.isFinite(Number(asset.lastProviderPrice)) && asset.lastProviderCurrency
    ? ` · ${formatCurrency(Number(asset.lastProviderPrice), asset.lastProviderCurrency)}`
    : "";
  return `${source}${symbol ? ` · ${symbol}` : ""}${exchange}${providerPrice}`;
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

function signedCurrency(value, currency = selectedCurrency()) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "±";
  return `${sign}${formatCurrency(Math.abs(amount), currency)}`;
}

function signedPercent(value, digits = 1) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "±";
  return `${sign}${Math.abs(amount).toFixed(digits)}%`;
}

function deltaHtml(current, previous, { inverted = false, label = "" } = {}) {
  const delta = Number(current || 0) - Number(previous || 0);
  const pct = Math.abs(previous) > 0.0001 ? delta / Math.abs(previous) * 100 : 0;
  const arrow = delta > 0 ? "↗" : delta < 0 ? "↘" : "→";
  const good = inverted ? delta <= 0 : delta >= 0;
  const cls = Math.abs(delta) < 0.005 ? "delta-flat" : good ? "delta-up" : "delta-down";
  return `<span class="${cls}">${arrow} ${signedCurrency(delta)} | ${signedPercent(pct)}</span>${label ? ` <em class="delta-period">${escapeHtml(label)}</em>` : ""}`;
}


function metricTrendHtml(current, previous, { inverted = false, currency = selectedCurrency(), mode = "currency" } = {}) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return `<span class="metric-trend delta-flat">→ ±0</span>`;
  const delta = currentValue - previousValue;
  const pct = Math.abs(previousValue) > 0.0001 ? delta / Math.abs(previousValue) * 100 : 0;
  const arrow = delta > 0 ? "↗" : delta < 0 ? "↘" : "→";
  const good = inverted ? delta <= 0 : delta >= 0;
  const cls = Math.abs(delta) < 0.005 ? "delta-flat" : good ? "delta-up" : "delta-down";
  let main;
  if (mode === "percent") main = signedPercent(delta, 1);
  else if (mode === "points") main = `${delta > 0 ? "+" : delta < 0 ? "-" : "±"}${Math.abs(delta).toFixed(1)} pts`;
  else main = signedCurrency(delta, currency);
  return `<span class="metric-trend ${cls}">${arrow} ${main} | ${signedPercent(pct)}</span>`;
}

function comparisonWindowFlow(compareDate) {
  const cats = categoryMap();
  const today = TODAY();
  return state.transactions.reduce((totals, tx) => {
    const date = String(tx.date || "");
    if (!date || date < compareDate || date > today) return totals;
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    if (!includeInSpending(cat, tx)) return totals;
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
  if (windowIncome) {
    windowIncome.textContent = formatCurrency(windowFlow.income, currency);
    windowIncome.className = windowFlow.income > 0 ? "amount-pos" : "delta-flat";
  }
  if (windowExpense) {
    windowExpense.textContent = formatCurrency(windowFlow.expense, currency);
    windowExpense.className = windowFlow.expense > 0 ? "amount-neg" : "delta-flat";
  }
  [windowIncome?.nextElementSibling, windowExpense?.nextElementSibling].forEach((label, index) => {
    if (!label) return;
    const value = index === 0 ? windowFlow.income : windowFlow.expense;
    label.className = value > 0 ? (index === 0 ? "amount-pos" : "amount-neg") : "delta-flat";
  });
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
  const accountChart = $("#account-bars-chart");
  const visibleAccountRows = (portfolio.accountRows || []).filter(row => !row.hidden);
  const chartWrap = accountChart?.closest(".chart-wrap");
  if (chartWrap) {
    const compact = window.matchMedia("(max-width: 920px)").matches;
    const minHeight = compact ? 282 : 230;
    const target = Math.min(460, Math.max(minHeight, visibleAccountRows.length * (compact ? 35 : 32) + 42));
    chartWrap.style.height = `${target}px`;
    chartWrap.style.minHeight = `${target}px`;
  }
  const accountChartCurrency = accountDisplayCurrency();
  drawAccountBars(accountChart, accountRowsForDisplay(portfolio.accountRows, accountChartCurrency), accountChartCurrency, {
    previousRows: accountRowsForDisplay(previousPortfolio.accountRows || [], accountChartCurrency),
    showDelta: state.settings.showAccountDeltaBars !== false
  });
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
  const compareBounds = compareBoundsForReport();
  const periodRows = transactionsInRange(bounds.start, bounds.end);
  const compareRows = transactionsInRange(compareBounds.start, compareBounds.end);
  const summary = summarizeTransactions(periodRows);
  const compareSummary = summarizeTransactions(compareRows);
  const categoryRows = categorySpendForRange(bounds.start, bounds.end);
  const compareCategoryRows = categorySpendForRange(compareBounds.start, compareBounds.end);
  const days = daysBetween(bounds.start, bounds.end);
  const compareDays = daysBetween(compareBounds.start, compareBounds.end);
  const topCategory = categoryRows[0];
  const compareTopValue = topCategory ? (compareCategoryRows.find(row => row.categoryId === topCategory.categoryId)?.value || 0) : 0;
  const savingsRate = summary.income > 0 ? summary.net / summary.income * 100 : null;
  const compareSavingsRate = compareSummary.income > 0 ? compareSummary.net / compareSummary.income * 100 : null;
  const dailySpend = summary.expense / days;
  const compareDailySpend = compareSummary.expense / compareDays;
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

  const incomeEl = $("#report-income");
  const spendingEl = $("#report-spending");
  const netEl = $("#report-net");
  const savingsEl = $("#report-savings-rate");
  const dailyEl = $("#report-daily-spend");
  const topEl = $("#report-top-category");
  incomeEl.textContent = formatCurrency(summary.income, currency);
  incomeEl.className = "report-neutral-value";
  spendingEl.textContent = formatCurrency(summary.expense, currency);
  spendingEl.className = "report-neutral-value";
  netEl.textContent = formatCurrency(summary.net, currency);
  netEl.className = summary.net > 0 ? "amount-pos" : summary.net < 0 ? "amount-neg" : "delta-flat";
  savingsEl.textContent = savingsRate == null ? "—" : formatPercent(savingsRate);
  savingsEl.className = savingsRate == null ? "delta-flat" : savingsRate >= 0 ? "amount-pos" : "amount-neg";
  dailyEl.textContent = formatCurrency(dailySpend, currency);
  dailyEl.className = "report-neutral-value";
  topEl.textContent = topCategory?.name || "—";
  topEl.title = topCategory?.name || "";

  $("#report-income-detail").innerHTML = `${metricTrendHtml(summary.income, compareSummary.income, { currency })}<span>vs ${escapeHtml(compareBounds.label)}</span>`;
  $("#report-spending-detail").innerHTML = `${metricTrendHtml(summary.expense, compareSummary.expense, { currency, inverted: true })}<span>vs ${escapeHtml(compareBounds.label)}</span>`;
  $("#report-net-detail").innerHTML = `${metricTrendHtml(summary.net, compareSummary.net, { currency })}<span>${escapeHtml(bounds.label)}</span>`;
  $("#report-savings-rate-detail").innerHTML = `${metricTrendHtml(savingsRate ?? 0, compareSavingsRate ?? 0, { mode: "points" })}<span>Net flow / income</span>`;
  $("#report-days-count").innerHTML = `${metricTrendHtml(dailySpend, compareDailySpend, { currency, inverted: true })}<span>${days} days</span>`;
  $("#report-top-category-value").innerHTML = topCategory
    ? `${metricTrendHtml(topCategory.value, compareTopValue, { currency, inverted: true })}<span>${formatCurrency(topCategory.value, currency)}</span>`
    : "No spending yet";
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
  const txCurrencyFilter = $("#tx-currency-filter");
  const importAccount = $("#import-account");
  const positionsImportAccount = $("#positions-import-account");
  const transactionAccount = $("#transaction-account");
  const transactionCategory = $("#transaction-category");
  const accountType = $("#account-type");
  const ruleCategory = $("#rule-category");
  const assetAccount = $("#asset-account");
  if (txAccountFilter) txAccountFilter.innerHTML = `<option value="all">All accounts</option>${accountOptions(txAccountFilter.value)}`;
  if (txCategoryFilter) txCategoryFilter.innerHTML = `<option value="all">All categories</option>${categoryOptions(txCategoryFilter.value)}`;
  if (txCurrencyFilter) {
    const current = txCurrencyFilter.value || "all";
    const currencies = [...new Set([selectedCurrency(), ...state.transactions.map(tx => tx.currency).filter(Boolean)])].sort();
    txCurrencyFilter.innerHTML = `<option value="all">All currencies</option>${currencies.map(code => `<option value="${escapeHtml(code)}" ${code === current ? "selected" : ""}>${escapeHtml(code)}</option>`).join("")}`;
  }
  if (importAccount) importAccount.innerHTML = accountOptions(importAccount.value || visibleAccounts()[0]?.id);
  if (positionsImportAccount) positionsImportAccount.innerHTML = accountOptions(positionsImportAccount.value || state.accounts.find(account => !account.hidden && account.type === "broker")?.id || visibleAccounts()[0]?.id, { brokerOnly: true });
  if (transactionAccount) transactionAccount.innerHTML = accountOptions(transactionAccount.value || visibleAccounts()[0]?.id);
  if (transactionCategory) {
    if (transactionCategory.tagName === "SELECT") {
      transactionCategory.innerHTML = categoryOptions(transactionCategory.value || "misc");
    } else {
      fillTransactionCategoryDatalist();
    }
  }
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
  const currencyFilter = $("#tx-currency-filter")?.value || "all";
  const minAmount = parseMoney($("#tx-min-amount")?.value);
  const maxAmount = parseMoney($("#tx-max-amount")?.value);
  const dateFrom = $("#tx-date-from")?.value || "";
  const dateTo = $("#tx-date-to")?.value || "";
  let rows = state.transactions;
  if (search) rows = rows.filter(tx => [tx.description, tx.counterparty, tx.note, tx.reason].join(" ").toLowerCase().includes(search));
  if (accountFilter !== "all") rows = rows.filter(tx => tx.accountId === accountFilter);
  if (categoryFilter !== "all") rows = rows.filter(tx => tx.categoryId === categoryFilter);
  if (currencyFilter !== "all") rows = rows.filter(tx => (tx.currency || selectedCurrency()) === currencyFilter);
  if (minAmount != null) rows = rows.filter(tx => Number(tx.amount || 0) >= minAmount);
  if (maxAmount != null) rows = rows.filter(tx => Number(tx.amount || 0) <= maxAmount);
  if (dateFrom) rows = rows.filter(tx => String(tx.date || "") >= dateFrom);
  if (dateTo) rows = rows.filter(tx => String(tx.date || "") <= dateTo);
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
  txFilteredRows = rows;
  selectedTransactionIds = new Set([...selectedTransactionIds].filter(id => state.transactions.some(tx => tx.id === id)));
  $("#tx-count").textContent = `${rows.length} entries`;
  txPage = renderPagination($("#transactions-pagination"), rows.length, txPage, PAGE_SIZES.transactions, page => {
    txPage = page;
    renderTransactions();
  });
  updateSortButtons("transactions", txSort);
  document.querySelector(".transactions-table")?.classList.toggle("selection-active", txSelectionMode);
  tbody.replaceChildren();
  for (const tx of pagedRows(rows, txPage, PAGE_SIZES.transactions)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const account = accounts.get(tx.accountId);
    const tr = document.createElement("tr");
    const selected = selectedTransactionIds.has(tx.id);
    tr.classList.toggle("is-selected-row", selected);
    tr.classList.toggle("is-ignored-row", shouldIgnoreTransactionInStats(tx));
    tr.innerHTML = `
      <td class="select-col desktop-only-tools"><input class="tx-select-checkbox" data-select-tx="${escapeHtml(tx.id)}" type="checkbox" ${selected ? "checked" : ""} aria-label="Select transaction"></td>
      <td>${escapeHtml(tx.date)}</td>
      <td class="description-cell"><strong>${escapeHtml(tx.description)}</strong><small class="muted table-ellipsis">${escapeHtml(tx.counterparty || tx.reason || "")}</small>${transactionFlagsHtml(tx)}</td>
      <td>${escapeHtml(account?.name || tx.accountId || "—")}</td>
      <td>${categoryPill(cat, { review: tx.review })}</td>
      <td class="${Number(tx.amount) >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency || selectedCurrency())}</td>
      <td class="note-cell"><span class="table-ellipsis" title="${escapeHtml(tx.note || "")}">${escapeHtml(tx.note || "")}</span></td>
      <td class="action-cell"><button class="ghost-button compact icon-only-action" type="button" data-edit-tx="${escapeHtml(tx.id)}" title="Edit transaction" aria-label="Edit transaction">✎</button></td>`;
    tbody.append(tr);
  }
  tbody.querySelectorAll("[data-edit-tx]").forEach(btn => btn.addEventListener("click", () => openTransactionModal(btn.dataset.editTx)));
  tbody.querySelectorAll("[data-select-tx]").forEach(box => box.addEventListener("change", event => {
    const id = event.currentTarget.dataset.selectTx;
    if (event.currentTarget.checked) selectedTransactionIds.add(id);
    else selectedTransactionIds.delete(id);
    renderTransactions();
  }));
  updateTransactionSelectionUi();
}

function accountRowFor(account, rows) {
  return rows.find(item => item.id === account.id) || {
    ...account,
    balance: { raw: Number(account.openingBalance || 0), converted: convertCurrency(Number(account.openingBalance || 0), account.currency || selectedCurrency(), state.settings) }
  };
}

function holdingsValueFor(account, currency = selectedCurrency()) {
  const primaryValue = holdingsForAccount(account.id).reduce((sum, asset) => {
    return sum + convertCurrency(assetMarketValue(asset), asset.currency || account.currency || selectedCurrency(), state.settings);
  }, 0);
  return currency === selectedCurrency() ? primaryValue : convertPrimaryToAccountDisplay(primaryValue, currency);
}

function accountSortValue(account, rows) {
  const row = accountRowFor(account, rows);
  const base = Number(row.balance?.converted || 0);
  const total = ["broker", "asset"].includes(account.type) ? base + holdingsValueFor(account) : base;
  return Number.isFinite(total) ? total : 0;
}

function sortAccountsByValue(accounts, rows) {
  return [...accounts].sort((a, b) => {
    const av = accountSortValue(a, rows);
    const bv = accountSortValue(b, rows);
    const aNeg = av < 0;
    const bNeg = bv < 0;
    if (aNeg !== bNeg) return aNeg ? 1 : -1;
    return Math.abs(bv) - Math.abs(av) || String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function previousHoldingValueFor(account, currentValue, currency = selectedCurrency()) {
  const holdings = holdingsForAccount(account.id);
  const compareDate = comparisonDateFromSettings();
  let total = 0;
  for (const asset of holdings) {
    const current = convertCurrency(assetMarketValue(asset), asset.currency || account.currency || selectedCurrency(), state.settings);
    const startingDate = String(asset.startingAt || isoDateFromMs(asset.createdAtMs) || TODAY()).slice(0, 10);
    const baseline = asset.startingPosition && compareDate < startingDate ? assetBaselineValue(asset) : Number(asset.costBasis || 0);
    const costBasis = convertCurrency(baseline || 0, asset.currency || account.currency || selectedCurrency(), state.settings);
    const pct = Number(asset.lastChangePercent);
    if (Number.isFinite(costBasis) && costBasis > 0) total += costBasis;
    else if (Number.isFinite(pct) && pct !== -100) total += current / (1 + pct / 100);
    else total += current;
  }
  const primaryPrevious = Number.isFinite(total) && total > 0 ? total : convertPrimaryToAccountDisplay(currentValue, selectedCurrency());
  return currency === selectedCurrency() ? primaryPrevious : convertPrimaryToAccountDisplay(primaryPrevious, currency);
}

function trendInline(current, previous, { inverted = false, currency = selectedCurrency() } = {}) {
  const delta = Number(current || 0) - Number(previous || 0);
  const pct = Math.abs(previous) > 0.0001 ? delta / Math.abs(previous) * 100 : 0;
  const arrow = delta > 0 ? "↗" : delta < 0 ? "↘" : "→";
  const good = inverted ? delta <= 0 : delta >= 0;
  const cls = Math.abs(delta) < 0.005 ? "delta-flat" : good ? "delta-up" : "delta-down";
  return `<small class="account-trend ${cls}">${arrow} ${signedCurrency(delta, currency)} | ${signedPercent(pct)}</small>`;
}

function accountStat(label, value, previous, { currency = selectedCurrency(), emphasize = false, inverted = false } = {}) {
  const signClass = Number(value || 0) < 0 ? "negative-stat" : Number(value || 0) > 0 ? "positive-stat" : "flat-stat";
  return `<div class="account-stat ${emphasize ? "total-stat" : ""} ${signClass}"><span>${escapeHtml(label)}</span><strong>${formatCurrency(value, currency)}</strong>${trendInline(value, previous, { inverted, currency })}</div>`;
}

function buildAccountCard(account, row, previousRow, { hidden = false } = {}) {
  const currency = accountDisplayCurrency(account);
  const isBroker = ["broker", "asset"].includes(account.type);
  const cashCurrent = convertPrimaryToAccountDisplay(row.balance?.converted || 0, currency);
  const cashPrevious = previousRow?.balance?.converted == null ? cashCurrent : convertPrimaryToAccountDisplay(previousRow.balance.converted, currency);
  const holdingsCurrent = isBroker ? holdingsValueFor(account, currency) : 0;
  const holdingsPrevious = isBroker ? previousHoldingValueFor(account, holdingsCurrent, currency) : 0;
  const totalCurrent = cashCurrent + holdingsCurrent;
  const totalPrevious = cashPrevious + holdingsPrevious;
  const identifier = maskIban(account.iban || account.accountNumber);
  const card = document.createElement("article");
  card.className = `surface-card item-card account-card ${isBroker ? "broker-card" : "bank-card"} ${hidden ? "hidden-account-card" : ""}`;
  const header = `
    <div class="item-card-header account-card-header">
      <div class="account-title-block">
        <h3 title="${escapeHtml(account.name)}">${escapeHtml(account.name)}</h3>
        <small class="account-meta-line">${escapeHtml(account.institution || "Manual")} · ${escapeHtml(account.type)} · Native ${escapeHtml(account.currency || selectedCurrency())}${currency !== (account.currency || selectedCurrency()).toUpperCase() ? ` · shown in ${escapeHtml(currency)}` : ""}</small>
        <small class="account-identifier">${escapeHtml(identifier)}</small>
        ${account.referenceAccountId ? `<small class="account-reference-preview">Ref: ${escapeHtml(accountNameById(account.referenceAccountId))}</small>` : ""}
        ${account.note ? `<small class="account-note-preview">${escapeHtml(account.note)}</small>` : ""}
      </div>
      <div class="account-card-controls">
        ${hidden ? `<span class="category-pill hidden-pill">Hidden</span>` : ""}
        <div class="account-menu-wrap">
          <button class="icon-button account-menu-button" type="button" data-account-menu-toggle aria-haspopup="menu" aria-label="Account options">⚙</button>
          <div class="account-menu" role="menu">
            ${!hidden ? `<button type="button" role="menuitem" data-account-transactions="${escapeHtml(account.id)}">Txns</button>` : ""}
            ${isBroker && !hidden ? `<button type="button" role="menuitem" data-view-positions="${escapeHtml(account.id)}">Positions</button>` : ""}
            <button type="button" role="menuitem" data-edit-account="${escapeHtml(account.id)}">${hidden ? "Restore · ✎" : "✎"}</button>
          </div>
        </div>
      </div>
    </div>`;
  const stats = isBroker
    ? `<div class="account-value-row broker-value-row">
        ${accountStat("Total", totalCurrent, totalPrevious, { currency, emphasize: true })}
        ${accountStat("Cash", cashCurrent, cashPrevious, { currency })}
        ${accountStat("Holdings", holdingsCurrent, holdingsPrevious, { currency })}
      </div>`
    : `<div class="account-value-row bank-value-row">
        ${accountStat("Balance", cashCurrent, cashPrevious, { currency, emphasize: true, inverted: account.type === "debt" })}
      </div>`;
  card.innerHTML = `${header}${stats}`;
  return card;
}

function appendAccountGroup(container, title, accounts, rows, previousRows, className = "") {
  if (!accounts.length) return;
  const section = document.createElement("section");
  section.className = `account-group-section ${className}`.trim();
  section.innerHTML = `<div class="account-group-heading"><p class="eyebrow">${escapeHtml(title)}</p><span class="metric-tag">${accounts.length}</span></div><div class="cards-grid account-group-grid"></div>`;
  const grid = section.querySelector(".account-group-grid");
  accounts.forEach(account => {
    const row = accountRowFor(account, rows);
    const previousRow = previousRows.find(item => item.id === account.id);
    grid.append(buildAccountCard(account, row, previousRow));
  });
  container.append(section);
}

function renderAccounts() {
  const container = $("#accounts-grid");
  if (!container) return;
  const portfolio = calculatePortfolio(state);
  const compareDate = comparisonDateFromSettings();
  const previousPortfolio = calculatePortfolioSnapshot(state, compareDate);
  const rows = portfolio.accountRows;
  const previousRows = previousPortfolio.accountRows || [];
  container.replaceChildren();

  const periodNote = $("#accounts-period-note");
  if (periodNote) periodNote.textContent = `Comparison ${comparisonLabel(compareDate)}`;

  const visible = sortAccountsByValue(visibleAccounts(), rows);
  const normalAccounts = sortAccountsByValue(visible.filter(account => !["broker", "asset"].includes(account.type)), rows);
  const brokerAccounts = sortAccountsByValue(visible.filter(account => ["broker", "asset"].includes(account.type)), rows);
  const hiddenAccounts = sortAccountsByValue(state.accounts.filter(account => account.hidden), rows);

  const hiddenSection = $("#hidden-accounts-section");
  const hiddenGrid = $("#hidden-accounts-grid");
  const hiddenToggle = $("#hidden-accounts-toggle");
  const hiddenCount = $("#hidden-accounts-count");
  if (!hiddenAccounts.length) hiddenAccountsExpanded = false;
  if (hiddenToggle) {
    hiddenToggle.hidden = hiddenAccounts.length === 0;
    hiddenToggle.textContent = hiddenAccountsExpanded ? `Hide hidden (${hiddenAccounts.length})` : `Show hidden (${hiddenAccounts.length})`;
    hiddenToggle.setAttribute("aria-expanded", String(hiddenAccountsExpanded));
  }
  if (hiddenCount) hiddenCount.textContent = String(hiddenAccounts.length);
  if (hiddenSection) hiddenSection.hidden = hiddenAccounts.length === 0 || !hiddenAccountsExpanded;
  if (hiddenGrid) hiddenGrid.replaceChildren();

  if (!visible.length) {
    container.innerHTML = `<article class="surface-card item-card empty-card"><h3>No visible accounts</h3><p class="muted">Add an account or restore one from the hidden accounts toggle above.</p></article>`;
  } else {
    appendAccountGroup(container, "Cash & bank", normalAccounts, rows, previousRows, "cash-bank-group");
    appendAccountGroup(container, "Broker", brokerAccounts, rows, previousRows, "broker-group");
  }

  if (hiddenGrid) {
    hiddenAccounts.forEach(account => {
      const row = accountRowFor(account, rows);
      const previousRow = previousRows.find(item => item.id === account.id);
      hiddenGrid.append(buildAccountCard(account, row, previousRow, { hidden: true }));
    });
  }

  wireAccountCardActions(container);
  if (hiddenGrid) wireAccountCardActions(hiddenGrid);
}

function wireAccountCardActions(root) {
  root.querySelectorAll("[data-edit-account]").forEach(btn => btn.addEventListener("click", event => {
    event.stopPropagation();
    btn.closest(".account-menu-wrap")?.classList.remove("menu-open");
    openAccountModal(btn.dataset.editAccount);
  }));
  root.querySelectorAll("[data-view-positions]").forEach(btn => btn.addEventListener("click", event => {
    event.stopPropagation();
    btn.closest(".account-menu-wrap")?.classList.remove("menu-open");
    openPositionsModal(btn.dataset.viewPositions);
  }));
  root.querySelectorAll("[data-account-transactions]").forEach(btn => btn.addEventListener("click", event => {
    event.stopPropagation();
    btn.closest(".account-menu-wrap")?.classList.remove("menu-open");
    openAccountTransactionsModal(btn.dataset.accountTransactions);
  }));
  root.querySelectorAll("[data-account-menu-toggle]").forEach(btn => btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const wrap = btn.closest(".account-menu-wrap");
    const wasOpen = Boolean(wrap?.classList.contains("menu-open"));
    document.querySelectorAll(".account-menu-wrap.menu-open").forEach(open => open.classList.remove("menu-open"));
    if (!wasOpen) wrap?.classList.add("menu-open");
  }));
}

function renderAssets() {
  // Assets are now displayed inside broker/asset accounts.
}

function updateRulesFoldState() {
  const isMobile = window.matchMedia("(max-width: 920px)").matches;
  const panels = [
    { panel: $("#categories-panel"), button: $("#categories-fold-toggle"), label: "Categories" },
    { panel: $("#rules-panel"), button: $("#rules-fold-toggle"), label: "Rules" }
  ];
  panels.forEach(({ panel, button, label }) => {
    if (!panel || !button) return;
    if (!isMobile) {
      panel.classList.remove("is-folded");
      button.hidden = true;
      return;
    }
    button.hidden = false;
    const folded = panel.classList.contains("is-folded");
    button.textContent = folded ? "Show" : "Hide";
    button.setAttribute("aria-expanded", String(!folded));
    button.setAttribute("aria-label", `${folded ? "Show" : "Hide"} ${label}`);
  });
}

function renderRules() {
  const categoriesList = $("#categories-list");
  const rulesList = $("#rules-list");
  if (!categoriesList || !rulesList) return;
  const cats = categoryMap();
  const categorySearch = normalizeText($("#category-search")?.value || "");
  const ruleSearch = normalizeText($("#rule-search")?.value || "");
  categoriesList.replaceChildren();
  rulesList.replaceChildren();
  const filteredCategories = state.categories.filter(cat => {
    if (!categorySearch) return true;
    return normalizeText([cat.name, cat.group, cat.type, cat.icon].join(" ")).includes(categorySearch);
  });
  for (const cat of filteredCategories) {
    const related = state.rules.filter(rule => rule.categoryId === cat.id);
    const row = document.createElement("div");
    row.className = "settings-row category-row";
    row.innerHTML = `<div><strong><span class="category-color-dot" style="--cat-color:${safeColor(cat.color)}"></span>${escapeHtml(cat.icon || "•")} ${escapeHtml(cat.name)}</strong><small>${escapeHtml(cat.group)} · ${escapeHtml(cat.type)} · ${related.length} keyword rules</small></div><button class="ghost-button compact icon-only-action" data-edit-category="${escapeHtml(cat.id)}" type="button" title="Edit category" aria-label="Edit category">✎</button>`;
    categoriesList.append(row);
  }
  if (!filteredCategories.length) categoriesList.innerHTML = `<p class="muted empty-list-note">No categories match this search.</p>`;

  const grouped = new Map();
  for (const rule of state.rules) {
    const cat = cats.get(rule.categoryId) || cats.get("misc");
    const haystack = normalizeText([rule.label, ...(rule.keywords || []), cat?.name, cat?.group].join(" "));
    if (ruleSearch && !haystack.includes(ruleSearch)) continue;
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
      row.innerHTML = `<div><strong>${escapeHtml(rule.label)}</strong><small>${sensitivity}: ${(rule.keywords || []).map(escapeHtml).join(", ")}</small></div><button class="ghost-button compact icon-only-action" data-edit-rule="${escapeHtml(rule.id)}" type="button" title="Edit rule" aria-label="Edit rule">✎</button>`;
      wrapper.append(row);
    }
    rulesList.append(wrapper);
  }
  if (!grouped.size) rulesList.innerHTML = `<p class="muted empty-list-note">No rules match this search.</p>`;
  categoriesList.querySelectorAll("[data-edit-category]").forEach(btn => btn.addEventListener("click", () => openCategoryModal(btn.dataset.editCategory)));
  rulesList.querySelectorAll("[data-edit-rule]").forEach(btn => btn.addEventListener("click", () => openRuleModal(btn.dataset.editRule)));
  updateRulesFoldState();
}

function renderSettings() {
  const form = $("#settings-form");
  if (settingsDirty || (form && form.contains(document.activeElement))) return;
  const compareMode = state.settings.portfolioComparisonMode || "rolling";
  $("#setting-currency").value = selectedCurrency();
  $("#setting-theme").value = state.settings.theme || "dark";
  $("#setting-motion").value = state.settings.motion || "on";
  const providerSetting = state.settings.marketProvider === "manual" ? "manual" : "yahoo";
  $("#setting-market-provider").value = providerSetting;
  $("#setting-hide-transfers").value = String(state.settings.hideInternalTransfersInSpending !== false);
  $("#setting-quote-interval").value = String(Number(state.settings.quoteRefreshIntervalMinutes ?? 720) / 60);
  const deltaBars = $("#setting-account-delta-bars");
  if (deltaBars) deltaBars.value = String(state.settings.showAccountDeltaBars !== false);
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

let settingsSaveTimer = null;

async function saveSettingsFromForm({ silent = true } = {}) {
  const primaryCurrency = normalizedCurrencyFrom("#setting-currency", "EUR");
  const comparisonMode = $("#setting-compare-mode").value || "rolling";
  await saveSettings({
    primaryCurrency,
    theme: $("#setting-theme").value,
    motion: $("#setting-motion").value,
    marketProvider: $("#setting-market-provider").value === "manual" ? "manual" : "yahoo",
    quoteRefreshIntervalMinutes: Math.max(0.6, Number($("#setting-quote-interval").value || 12) * 60),
    portfolioComparisonMode: comparisonMode,
    portfolioComparisonDays: comparisonMode === "rolling" ? Number($("#setting-compare-days").value || 30) : Number(state.settings.portfolioComparisonDays || 30),
    portfolioComparisonDate: comparisonMode === "date" ? $("#setting-compare-date").value || "" : "",
    hideInternalTransfersInSpending: $("#setting-hide-transfers").value === "true",
    showAccountDeltaBars: $("#setting-account-delta-bars")?.value !== "false"
  });
  settingsDirty = false;
  setMessage($("#settings-message"), silent ? "Saved automatically." : "Settings saved.");
  setupAutoRefreshTimers();
  runScheduledRefresh().catch(error => console.warn("Scheduled refresh skipped", error));
}

function scheduleSettingsSave() {
  settingsDirty = true;
  setMessage($("#settings-message"), "Saving…");
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    try { await saveSettingsFromForm(); }
    catch (error) { setMessage($("#settings-message"), error.message, true); }
  }, 650);
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
  const categoryInput = $("#transaction-category");
  const category = categoryInput?.tagName === "SELECT" ? (categoryInput.value || "") : categoryIdFromSearch(categoryInput?.value);
  const review = $("#transaction-review");
  if (!review) return;
  const locked = Boolean(category && category !== "misc" && category !== "auto");
  if (locked) review.checked = false;
  review.disabled = locked;
  const ignore = $("#transaction-ignore-stats");
  const cat = state.categories.find(item => item.id === category);
  if (ignore && cat?.type === "transfer") ignore.checked = true;
}

function transactionDraftForCategorization() {
  return {
    accountId: $("#transaction-account")?.value || "",
    date: $("#transaction-date")?.value || TODAY(),
    amount: parseMoney($("#transaction-amount")?.value) ?? 0,
    currency: ($("#transaction-currency")?.value || selectedCurrency()).toUpperCase(),
    description: $("#transaction-description")?.value || "",
    counterparty: $("#transaction-counterparty")?.value || "",
    note: $("#transaction-note")?.value || ""
  };
}

function applyRulesToTransactionCategory({ onlyWhenEmptyOrMisc = true, fillMisc = false } = {}) {
  const input = $("#transaction-category");
  if (!input) return null;
  const currentId = categoryIdFromSearch(input.value);
  if (onlyWhenEmptyOrMisc && currentId && currentId !== "misc") return null;
  const draft = transactionDraftForCategorization();
  if (![draft.description, draft.counterparty, draft.note].some(value => String(value || "").trim())) return null;
  const result = categorizeTransaction(draft, state.rules, state.categories, state.accounts);
  if (result?.categoryId && (result.categoryId !== "misc" || fillMisc)) {
    input.value = categorySearchValue(result.categoryId);
    syncTransactionReviewControl();
  }
  return result;
}

function scheduleTransactionCategoryAutofill() {
  if (transactionCategoryDebounce) clearTimeout(transactionCategoryDebounce);
  transactionCategoryDebounce = setTimeout(() => {
    transactionCategoryDebounce = null;
    applyRulesToTransactionCategory({ onlyWhenEmptyOrMisc: true, fillMisc: false });
  }, 500);
}

function openTransactionModal(id = "") {
  const tx = id ? state.transactions.find(item => item.id === id) : null;
  $("#transaction-modal-title").textContent = tx ? "Edit transaction" : "Add transaction";
  $("#transaction-id").value = tx?.id || "";
  $("#transaction-account").value = tx?.accountId || state.accounts[0]?.id || "";
  $("#transaction-date").value = tx?.date || TODAY();
  $("#transaction-amount").value = tx?.amount ?? "";
  $("#transaction-currency").value = tx?.currency || selectedCurrency();
  const categoryInput = $("#transaction-category");
  if (categoryInput) categoryInput.value = tx?.categoryId ? (categoryInput.tagName === "SELECT" ? tx.categoryId : categorySearchValue(tx.categoryId)) : "";
  renderTransactionCategoryMenu(false);
  $("#transaction-counterparty").value = tx?.counterparty || "";
  $("#transaction-description").value = tx?.description || "";
  $("#transaction-note").value = tx?.note || "";
  $("#transaction-review").checked = Boolean(tx?.review);
  if ($("#transaction-ignore-stats")) $("#transaction-ignore-stats").checked = shouldIgnoreTransactionInStats(tx || {});
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
  const accountDisplaySelect = $("#account-display-currency");
  if (accountDisplaySelect) accountDisplaySelect.innerHTML = accountCurrencyOptions(account?.displayCurrency || "", account?.currency || selectedCurrency());
  $("#account-opening").value = account?.openingBalance ?? 0;
  $("#account-opening-date").value = account?.openingBalanceDate || "";
  $("#account-note").value = account?.note || "";
  $("#account-iban").value = account?.iban || "";
  $("#account-number").value = account?.accountNumber || "";
  $("#account-bic").value = account?.bic || "";
  $("#account-aliases").value = Array.isArray(account?.transferAliases) ? account.transferAliases.join(", ") : account?.transferAliases || "";
  const referenceSelect = $("#account-reference-account");
  if (referenceSelect) {
    const currentId = account?.id || "";
    const selectedReference = account?.referenceAccountId || "";
    const choices = state.accounts.filter(item => item.id !== currentId && !item.hidden);
    referenceSelect.innerHTML = `<option value="">No reference account</option>${choices.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedReference ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.currency || selectedCurrency())}</option>`).join("")}`;
    referenceSelect.value = selectedReference;
  }
  $("#account-hidden").checked = Boolean(account?.hidden);
  $("#delete-account-button").hidden = !account;
  openModal("account");
}


function syncAssetPricingFields() {
  const provider = $("#asset-provider")?.value || "manual";
  const quantity = parseMoney($("#asset-quantity")?.value) || 0;
  const buyPrice = parseMoney($("#asset-buy-price")?.value) || 0;
  const costBasisInput = $("#asset-cost-basis");
  if (costBasisInput && quantity > 0 && buyPrice > 0) costBasisInput.value = (quantity * buyPrice).toFixed(2);

  const manualField = $("#asset-manual-price-field");
  const manualInput = $("#asset-manual-price");
  const manualLabel = manualField?.querySelector("span");
  const manualMeta = $("#asset-last-price-meta");
  const modalAsset = state.assets.find(item => item.id === $("#asset-id")?.value);
  const manualMode = provider === "manual";
  if (manualInput) manualInput.disabled = !manualMode;
  if (manualField) manualField.classList.toggle("is-disabled-field", !manualMode);
  if (manualLabel) manualLabel.textContent = manualMode ? "Current/manual price" : "Latest provider price";
  if (manualMeta) {
    manualMeta.textContent = manualMode ? "manual" : quoteAgeLabel(modalAsset);
    manualMeta.title = manualMode ? "Stored manually." : quoteMetaText(modalAsset);
    manualMeta.className = manualMode ? "quote-age-badge" : `quote-age-badge ${quoteIsStale(modalAsset) ? "stale" : ""}`;
    manualMeta.hidden = false;
  }

  const startingBox = $("#asset-starting-position");
  const startingDate = $("#asset-starting-at");
  if (startingDate) {
    startingDate.disabled = !startingBox?.checked;
    if (startingBox?.checked && !startingDate.value) startingDate.value = TODAY();
  }
}


function openAssetModal(id = "", accountId = "") {
  const asset = id ? state.assets.find(item => item.id === id) : null;
  const defaultBroker = accountId || asset?.accountId || state.accounts.find(item => !item.hidden && item.type === "broker")?.id || visibleAccounts()[0]?.id || "";
  $("#asset-id").value = asset?.id || "";
  $("#asset-account").value = defaultBroker;
  $("#asset-symbol").value = asset?.symbol || "";
  $("#asset-name").value = asset?.name || "";
  $("#asset-wkn").value = asset?.wkn || "";
  $("#asset-isin").value = asset?.isin || "";
  $("#asset-type").value = asset?.type || "stock";
  const selectedAssetProvider = asset?.provider === "manual" ? "manual" : (state.settings.marketProvider === "manual" && !asset ? "manual" : "yahoo");
  $("#asset-provider").value = selectedAssetProvider;
  $("#asset-quantity").value = asset?.quantity ?? 1;
  $("#asset-currency").value = asset?.currency || selectedCurrency();
  const providerValue = selectedAssetProvider;
  $("#asset-manual-price").value = providerValue === "manual" ? asset?.manualPrice ?? asset?.lastPrice ?? 0 : asset?.lastPrice ?? asset?.manualPrice ?? 0;
  $("#asset-buy-price").value = asset?.buyPrice ?? 0;
  $("#asset-cost-basis").value = asset?.costBasis ?? (Number(asset?.quantity || 0) * Number(asset?.buyPrice || 0));
  const startingInput = $("#asset-starting-position");
  if (startingInput) startingInput.checked = Boolean(asset?.startingPosition);
  const startingAtInput = $("#asset-starting-at");
  if (startingAtInput) startingAtInput.value = asset?.startingAt || TODAY();
  syncAssetPricingFields();
  const hiddenInput = $("#asset-hidden");
  if (hiddenInput) hiddenInput.checked = Boolean(asset?.hidden);
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
  const basis = asset.startingPosition ? assetBaselineValue(asset) : Number(asset.costBasis || 0);
  if (!Number.isFinite(basis) || basis <= 0) return { amount: null, percent: null };
  const amount = currentValue - basis;
  return { amount, percent: amount / basis * 100 };
}

function renderPositionsModal() {
  const tbody = $("#positions-body");
  if (!tbody || !activePositionsAccountId) return;
  const account = state.accounts.find(item => item.id === activePositionsAccountId);
  const holdings = holdingsForAccount(activePositionsAccountId);
  const staleCount = holdings.filter(asset => quoteIsStale(asset)).length;
  $("#positions-modal-title").textContent = account ? `${account.name} holdings` : "Holdings";
  const warning = $("#positions-stale-warning");
  if (warning) {
    warning.hidden = staleCount === 0;
    warning.onclick = () => toast("Stale holding prices", `${staleCount} holding${staleCount === 1 ? "" : "s"} have no Yahoo price from the last 7 days. Use the refresh icon next to the update age.`, "error");
  }
  $("#positions-delta-heading").textContent = positionsPeriod === "today" ? "Today" : "Since buy";
  $$('[data-position-period]').forEach(button => {
    const active = button.dataset.positionPeriod === positionsPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-position-unit]').forEach(button => {
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
    tbody.innerHTML = `<tr><td colspan="8" class="muted">No holdings in this account yet.</td></tr>`;
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
        ? signedPercent(deltaValue)
        : signedCurrency(deltaValue, currency);
    const buyPrice = Number(asset.buyPrice || 0) || (Number(asset.quantity || 0) ? Number(asset.costBasis || 0) / Number(asset.quantity || 1) : 0);
    const ageLabel = quoteAgeLabel(asset);
    const stale = quoteIsStale(asset);
    const providerSymbol = asset.lastProviderSymbol || asset.providerSymbol || asset.symbol || "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(asset.symbol || asset.name)}</strong><small class="muted table-ellipsis">${escapeHtml(asset.name || asset.type || "")}${asset.startingPosition ? " · given" : ""}</small></td>
      <td>${Number(asset.quantity || 0).toLocaleString()}</td>
      <td><span class="price-stack"><strong>${formatCurrency(price, currency)}</strong><small class="muted table-ellipsis" title="${escapeHtml(quoteMetaText(asset))}">${escapeHtml(providerSymbol)}</small></span></td>
      <td>${buyPrice ? formatCurrency(buyPrice, currency) : "—"}</td>
      <td>${formatCurrency(value, currency)}</td>
      <td><span class="${deltaClass}">${deltaText}</span></td>
      <td class="position-update-cell"><span class="${stale ? "quote-age stale" : "quote-age"}" title="${escapeHtml(quoteMetaText(asset))}">${escapeHtml(ageLabel)}</span><button class="icon-button tiny-icon-button" type="button" data-refresh-asset="${escapeHtml(asset.id)}" title="Update price" aria-label="Update price">↻</button></td>
      <td class="positions-edit-cell"><button class="ghost-button compact icon-only-action" type="button" data-edit-asset="${escapeHtml(asset.id)}" title="Edit holding" aria-label="Edit holding">✎</button></td>`;
    tbody.append(tr);
  }
  tbody.querySelectorAll("[data-edit-asset]").forEach(btn => btn.addEventListener("click", () => openAssetModal(btn.dataset.editAsset)));
  tbody.querySelectorAll("[data-refresh-asset]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.refreshAsset;
    btn.disabled = true;
    btn.textContent = "…";
    try {
      await refreshAsset(id);
      renderPositionsModal();
    } finally {
      btn.disabled = false;
      btn.textContent = "↻";
    }
  }));
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
      <td class="action-cell"><button class="ghost-button compact icon-only-action" type="button" data-edit-tx="${escapeHtml(tx.id)}" title="Edit transaction" aria-label="Edit transaction">✎</button></td>`;
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
  $("#category-icon").value = cat?.icon || "•";
  $("#category-type").value = cat?.type || "expense";
  $("#category-color").innerHTML = colorOptions(cat?.color || DEFAULT_CATEGORY_COLOR);
  $("#category-color").value = safeColor(cat?.color);
  openModal("category");
}

async function reapplyRulesToReviewQueue(rulesOverride = state.rules) {
  const updates = [];
  for (const tx of state.transactions) {
    const result = categorizeTransaction(tx, rulesOverride, state.categories, state.accounts);
    const next = {
      ...tx,
      categoryId: result.categoryId,
      confidence: result.confidence,
      review: result.review,
      reason: result.reason,
      candidates: result.candidates || [],
      matchedAccountId: result.matchedAccountId || tx.matchedAccountId || "",
      transferMatchedAccountId: result.transferMatchedAccountId || result.matchedAccountId || tx.transferMatchedAccountId || "",
      transferSourceAccountId: result.transferSourceAccountId || tx.transferSourceAccountId || "",
      transferTargetAccountId: result.transferTargetAccountId || tx.transferTargetAccountId || "",
      internalTransfer: Boolean(result.internalTransfer || tx.internalTransfer),
      excludeFromStats: Boolean(result.excludeFromStats || shouldIgnoreTransactionInStats(tx))
    };
    const changed = ["categoryId", "review", "reason", "internalTransfer", "excludeFromStats", "transferSourceAccountId", "transferTargetAccountId"]
      .some(key => JSON.stringify(tx[key] ?? null) !== JSON.stringify(next[key] ?? null));
    if (changed) updates.push(next);
  }
  if (updates.length) await saveTransactionsBatch(updates);
  return updates.length;
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
    toast("Price updated", `${quote.symbol || asset.symbol || asset.name}: ${formatCurrency(quote.price, quote.currency || asset.currency)} · pulled ${formatDateTime(quote.pulledAt || quote.time)}`);
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
    ["debit", "Debit | money out"],
    ["credit", "Credit | money in"],
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
  const hasFile = Boolean(activeParsedFile || brokerParsedFile);
  label.classList.toggle("has-file", hasFile);
  if (!hasFile) {
    title.textContent = "Choose bank or broker export";
    detail.textContent = `Recognized: ${RECOGNIZED_BANK_FORMATS.join(" · ")} · ${RECOGNIZED_BROKER_FORMATS.join(" · ")}`;
    return;
  }
  title.textContent = activeParsedFile?.filename || brokerParsedFile?.filename || "Selected file";
  const parts = [];
  if (activeParsedFile) parts.push(`${activeParsedFile.formatLabel || "Bank export"} · ${activeParsedFile.rows.length} rows${Number.isFinite(Number(activeParsedFile.openingBalanceHint)) ? ` · opening ${formatCurrency(Number(activeParsedFile.openingBalanceHint), selectedCurrency())}` : ""}`);
  if (brokerParsedFile) parts.push(`${brokerParsedFile.formatLabel || "Broker positions"} · ${brokerParsedFile.positions.length} positions`);
  detail.textContent = `${parts.join(" · ")}; click to replace`;
}

async function parseUnifiedImportFile(file) {
  const isSpreadsheet = /\.(xlsx|xls)$/i.test(file.name || "");
  let bank = null;
  let broker = null;
  const errors = [];
  if (!isSpreadsheet) {
    try {
      const parsedBank = await parseBankFile(file);
      if (parsedBank?.rows?.length) bank = parsedBank;
    } catch (error) {
      errors.push(error.message || "Bank parser failed");
    }
  }
  try {
    const parsedBroker = await parseBrokerPositionsFile(file);
    if (parsedBroker?.positions?.length) broker = parsedBroker;
  } catch (error) {
    errors.push(error.message || "Broker parser failed");
  }
  if (!bank && !broker) throw new Error(errors[0] || "No recognized bank transaction or broker position structure found.");
  return { bank, broker };
}

function buildActiveImportPreview() {
  if (!activeParsedFile) {
    activePreview = null;
    renderImportPreview();
    return;
  }
  const account = state.accounts.find(item => item.id === $("#import-account").value);
  activePreview = buildImportPreview(activeParsedFile, activeParsedFile.mapping, {
    accountId: $("#import-account").value,
    currency: account?.currency || selectedCurrency(),
    rules: state.rules,
    categories: state.categories,
    accounts: state.accounts
  }, state.transactions);
  importPage = 1;
  importSkippedPage = 1;
  $("#reset-import-button").disabled = false;
  renderImportPreview();
  updateUnifiedImportSummary();
}

function resetImportFlow(message = "") {
  activeParsedFile = null;
  activePreview = null;
  brokerParsedFile = null;
  brokerPreview = null;
  importPage = 1;
  importSkippedPage = 1;
  brokerPositionsPage = 1;
  const fileInput = $("#import-file");
  if (fileInput) fileInput.value = "";
  const positionFileInput = $("#positions-import-file");
  if (positionFileInput) positionFileInput.value = "";
  $("#commit-import-button").disabled = true;
  $("#reset-import-button").disabled = true;
  const positionButton = $("#commit-positions-import-button");
  if (positionButton) positionButton.disabled = true;
  const positionResetButton = $("#reset-positions-import-button");
  if (positionResetButton) positionResetButton.disabled = true;
  updateImportFileLabel();
  updateBrokerPositionsFileLabel();
  setMessage($("#import-message"), message);
  const balanceBox = $("#import-balance-summary");
  if (balanceBox) {
    balanceBox.hidden = true;
    balanceBox.innerHTML = "";
  }
  setMessage($("#positions-import-message"), "");
  renderImportPreview();
  renderFilteredImportPreview();
  renderBrokerPositionsPreview();
}

function renderImportPreview() {
  const tbody = $("#import-preview-body");
  if (!tbody) return;
  tbody.replaceChildren();
  if (!activePreview) {
    $("#preview-count").textContent = "No file";
    importSelectedIds.clear();
    renderPagination($("#import-preview-pagination"), 0, 1, PAGE_SIZES.importPreview, () => {});
    updateSortButtons("import", importSort);
    updateImportSelectionUi();
    renderFilteredImportPreview();
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
  importSelectedIds = new Set([...importSelectedIds].filter(id => activePreview.transactions.some(tx => (tx.id || tx.externalId) === id)));
  $("#preview-count").textContent = `${activePreview.transactions.length} accepted · ${activePreview.skipped.length} skipped`;
  importPage = renderPagination($("#import-preview-pagination"), rows.length, importPage, PAGE_SIZES.importPreview, page => {
    importPage = page;
    renderImportPreview();
  });
  updateSortButtons("import", importSort);
  for (const tx of pagedRows(rows, importPage, PAGE_SIZES.importPreview)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const id = tx.id || tx.externalId;
    const selected = importSelectedIds.has(id);
    const tr = document.createElement("tr");
    tr.classList.toggle("is-selected-row", selected);
    tr.classList.toggle("is-ignored-row", shouldIgnoreTransactionInStats(tx));
    tr.innerHTML = `<td class="select-col desktop-only-tools"><input class="import-select-checkbox" data-select-import-tx="${escapeHtml(id)}" type="checkbox" ${selected ? "checked" : ""} aria-label="Select import row"></td><td>${escapeHtml(tx.date)}</td><td class="description-cell"><strong>${escapeHtml(tx.description)}</strong><small class="muted table-ellipsis">${escapeHtml(tx.reason || "")}</small>${transactionFlagsHtml(tx)}</td><td class="${tx.amount >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency)}</td><td>${categoryPill(cat, { review: tx.review })}</td><td>${tx.review ? "Needs review" : "Prepared"}</td>`;
    tbody.append(tr);
  }
  tbody.querySelectorAll("[data-select-import-tx]").forEach(box => box.addEventListener("change", event => {
    const id = event.currentTarget.dataset.selectImportTx;
    if (event.currentTarget.checked) importSelectedIds.add(id);
    else importSelectedIds.delete(id);
    renderImportPreview();
  }));
  updateImportSelectionUi();
  renderFilteredImportPreview();
}

function renderFilteredImportPreview() {
  const card = $("#import-filtered-card");
  const tbody = $("#import-filtered-body");
  const count = $("#filtered-preview-count");
  if (!card || !tbody) return;
  const skipped = activePreview?.skipped || [];
  card.hidden = skipped.length === 0;
  tbody.replaceChildren();
  if (count) count.textContent = skipped.length ? `${skipped.length} filtered` : "None";
  if (!skipped.length) {
    renderPagination($("#import-filtered-pagination"), 0, 1, PAGE_SIZES.importPreview, () => {});
    return;
  }
  importSkippedPage = renderPagination($("#import-filtered-pagination"), skipped.length, importSkippedPage, PAGE_SIZES.importPreview, page => {
    importSkippedPage = page;
    renderFilteredImportPreview();
  });
  pagedRows(skipped, importSkippedPage, PAGE_SIZES.importPreview).forEach((item, index) => {
    const tx = item.tx || null;
    const rowNumber = (importSkippedPage - 1) * PAGE_SIZES.importPreview + index;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${tx?.date ? escapeHtml(tx.date) : "—"}</td>
      <td class="description-cell"><strong>${escapeHtml(tx?.description || item.row?.join(" · ") || "Filtered row")}</strong><small class="muted table-ellipsis">${escapeHtml(item.reason || "Filtered")}</small>${tx ? transactionFlagsHtml(tx) : ""}</td>
      <td class="${Number(tx?.amount || 0) >= 0 ? "amount-pos" : "amount-neg"}">${tx ? formatCurrency(tx.amount, tx.currency || selectedCurrency()) : "—"}</td>
      <td class="action-cell"><button class="secondary-button compact" type="button" data-restore-skipped="${rowNumber}" ${tx ? "" : "disabled"}>Add back</button></td>`;
    tbody.append(tr);
  });
  tbody.querySelectorAll("[data-restore-skipped]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.restoreSkipped);
    const item = activePreview?.skipped?.[index];
    if (!item?.tx) return;
    activePreview.transactions.push({ ...item.tx, review: true, reason: `Manually added back: ${item.reason || "filtered"}` });
    activePreview.skipped.splice(index, 1);
    toast("Row added back", "It is now included in the import preview and marked for review.");
    renderImportPreview();
    updateUnifiedImportSummary();
  }));
}

function updateBrokerPositionsFileLabel() {
  const label = $("#positions-file-label");
  const title = $("#positions-file-title");
  const detail = $("#positions-file-detail");
  if (!label || !title || !detail) return;
  label.classList.toggle("has-file", Boolean(brokerParsedFile));
  if (!brokerParsedFile) {
    title.textContent = "Choose broker position export";
    detail.textContent = `Recognized: ${RECOGNIZED_BROKER_FORMATS.join(" · ")}`;
    return;
  }
  title.textContent = brokerParsedFile.filename;
  detail.textContent = `${brokerParsedFile.formatLabel || "Broker positions"} recognized · ${brokerParsedFile.positions.length} positions loaded`;
}

function buildBrokerPositionsImportPreview() {
  if (!brokerParsedFile) {
    brokerPreview = null;
    renderBrokerPositionsPreview();
    return;
  }
  const accountId = $("#positions-import-account")?.value || state.accounts.find(account => !account.hidden && account.type === "broker")?.id || visibleAccounts()[0]?.id || "";
  brokerPreview = buildBrokerPositionsPreview(brokerParsedFile, { accountId }, state.assets);
  brokerPositionsPage = 1;
  const button = $("#commit-positions-import-button");
  if (button) button.disabled = !brokerPreview.positions.length;
  const resetButton = $("#reset-positions-import-button");
  if (resetButton) resetButton.disabled = false;
  renderBrokerPositionsPreview();
  updateUnifiedImportSummary();
}

function resetBrokerPositionsImportFlow(message = "") {
  brokerParsedFile = null;
  brokerPreview = null;
  brokerPositionsPage = 1;
  const fileInput = $("#positions-import-file");
  if (fileInput) fileInput.value = "";
  const button = $("#commit-positions-import-button");
  if (button) button.disabled = true;
  const resetButton = $("#reset-positions-import-button");
  if (resetButton) resetButton.disabled = true;
  updateBrokerPositionsFileLabel();
  setMessage($("#positions-import-message"), message);
  renderBrokerPositionsPreview();
}

function renderBrokerPositionsPreview() {
  const tbody = $("#positions-preview-body");
  if (!tbody) return;
  tbody.replaceChildren();
  if (!brokerPreview) {
    const count = $("#positions-preview-count");
    if (count) count.textContent = "No file";
    renderPagination($("#positions-preview-pagination"), 0, 1, PAGE_SIZES.brokerPositions, () => {});
    return;
  }
  const rows = brokerPreview.positions;
  const count = $("#positions-preview-count");
  if (count) count.textContent = `${rows.length} positions · ${brokerPreview.skipped.length} skipped`;
  brokerPositionsPage = renderPagination($("#positions-preview-pagination"), rows.length, brokerPositionsPage, PAGE_SIZES.brokerPositions, page => {
    brokerPositionsPage = page;
    renderBrokerPositionsPreview();
  });
  for (const asset of pagedRows(rows, brokerPositionsPage, PAGE_SIZES.brokerPositions)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(asset.symbol || asset.wkn || asset.isin || "—")}</strong><small class="muted table-ellipsis">${escapeHtml(asset.name || "")}</small></td>
      <td>${escapeHtml(asset.isin || "—")}</td>
      <td>${escapeHtml(asset.wkn || "—")}</td>
      <td>${Number(asset.quantity || 0).toLocaleString()}</td>
      <td>${formatCurrency(asset.manualPrice || asset.lastPrice || 0, asset.currency || selectedCurrency())}</td>
      <td>${formatCurrency((asset.manualPrice || asset.lastPrice || 0) * Number(asset.quantity || 0), asset.currency || selectedCurrency())}</td>
      <td><span class="metric-tag">${escapeHtml(asset.action || "New")}</span></td>`;
    tbody.append(tr);
  }
}

function updateUnifiedImportSummary() {
  const txCount = activePreview?.transactions?.length || 0;
  const txSkipped = activePreview?.skipped?.length || 0;
  const reviewCount = activePreview?.transactions?.filter(tx => tx.review).length || 0;
  const posCount = brokerPreview?.positions?.length || 0;
  const posSkipped = brokerPreview?.skipped?.length || 0;
  const hasAnything = txCount > 0 || posCount > 0;
  const button = $("#commit-import-button");
  if (button) {
    button.disabled = !hasAnything;
    button.textContent = posCount && txCount ? "Import transactions + positions" : posCount ? "Import positions" : "Import transactions";
  }
  const resetButton = $("#reset-import-button");
  if (resetButton) resetButton.disabled = !(activeParsedFile || brokerParsedFile);
  const parts = [];
  if (activeParsedFile) parts.push(`${activeParsedFile.formatLabel || "Bank export"}: ${txCount} transactions, ${reviewCount} review, ${txSkipped} duplicates/skipped${Number.isFinite(Number(activeParsedFile.openingBalanceHint)) ? `, opening ${formatCurrency(Number(activeParsedFile.openingBalanceHint), selectedCurrency())}` : ""}`);
  if (brokerParsedFile) parts.push(`${brokerParsedFile.formatLabel || "Broker export"}: ${posCount} positions, ${posSkipped} skipped`);
  const balanceSummary = importBalanceSummaryHtml();
  const balanceBox = $("#import-balance-summary");
  if (balanceBox) {
    balanceBox.hidden = !balanceSummary;
    balanceBox.innerHTML = balanceSummary ? `<strong>Balance after import</strong><div class="import-balance-list">${balanceSummary}</div>` : "";
  }
  if (parts.length) setMessage($("#import-message"), parts.join(" · "));
}

async function runSyncChoice(mode) {
  const labels = { local: "Keep local", merge: "Merge both", firebase: "Take Firebase" };
  $$("[data-sync-choice]").forEach(button => { button.disabled = true; });
  setMessage($("#repair-sync-message"), `${labels[mode] || "Sync"} running...`);
  try {
    const result = await resolveSyncConflict(mode);
    const counts = result.counts || {};
    const summary = `${labels[mode]} complete. Accounts ${counts.accounts ?? 0}, transactions ${counts.transactions ?? 0}, holdings ${counts.holdings ?? 0}, categories ${counts.categories ?? 0}, rules ${counts.rules ?? 0}.`;
    setMessage($("#repair-sync-message"), summary);
    toast("Sync resolved", summary);
  } catch (error) {
    setMessage($("#repair-sync-message"), firebaseErrorMessage(error), true);
    toast("Sync resolution failed", firebaseErrorMessage(error), "error");
  } finally {
    $$("[data-sync-choice]").forEach(button => { button.disabled = false; });
  }
}

async function runSyncRepair() {
  const button = $("#repair-sync-button");
  if (button) button.disabled = true;
  setMessage($("#repair-sync-message"), "Checking Firebase and local cache...");
  try {
    const result = await repairSync();
    const counts = result.counts || {};
    const summary = `Source: ${result.source}. Accounts ${counts.accounts ?? 0}, transactions ${counts.transactions ?? 0}, holdings ${counts.holdings ?? 0}, categories ${counts.categories ?? 0}, rules ${counts.rules ?? 0}.`;
    setMessage($("#repair-sync-message"), summary);
    toast("Sync check complete", summary);
  } catch (error) {
    setMessage($("#repair-sync-message"), firebaseErrorMessage(error), true);
    toast("Sync check failed", firebaseErrorMessage(error), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function exportTransactionsCsv() {
  const csv = serializeTransactionsCsv(state.transactions, state.categories, state.accounts);
  downloadTextFile(`capito-transactions-${TODAY()}.csv`, csv);
}


async function exportBackupJson() {
  const backup = await exportState();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `capito-full-backup-${TODAY()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}


function downloadTextFile(filename, content, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}


function accountNameById(id) {
  return state.accounts.find(account => account.id === id)?.name || id || "—";
}

function transactionFlagsHtml(tx = {}) {
  const flags = [];
  if (tx.internalTransfer) flags.push("Internal");
  if (tx.referenceFundingRole === "source-split") flags.push("Reference split");
  else if (tx.referenceFundingRole === "deduction") flags.push("Reference deduction");
  else if (tx.referenceFunding) flags.push("Reference");
  if (shouldIgnoreTransactionInStats(tx)) flags.push("Ignored stats");
  if (!flags.length) return "";
  return `<span class="tx-flags">${flags.map(flag => `<span>${escapeHtml(flag)}</span>`).join("")}</span>`;
}

function modalDialogShell(title, bodyHtml, { wide = false } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop app-dialog-backdrop";
  backdrop.innerHTML = `
    <section class="modal-card surface-card app-dialog-card ${wide ? "wide-modal" : ""}" role="dialog" aria-modal="true">
      <div class="modal-heading"><h3>${escapeHtml(title)}</h3></div>
      ${bodyHtml}
    </section>`;
  document.body.append(backdrop);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const close = () => {
    backdrop.remove();
    document.body.style.overflow = previousOverflow;
  };
  return { backdrop, close };
}

function confirmDialog({ title = "Confirm", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  return new Promise(resolve => {
    const { backdrop, close } = modalDialogShell(title, `
      <div class="dialog-copy muted">${escapeHtml(message)}</div>
      <div class="button-row dialog-actions">
        <button class="secondary-button" data-dialog-cancel type="button">${escapeHtml(cancelLabel)}</button>
        <button class="${danger ? "danger-button" : "primary-button"}" data-dialog-confirm type="button">${escapeHtml(confirmLabel)}</button>
      </div>`);
    const finish = value => { close(); resolve(value); };
    backdrop.querySelector("[data-dialog-cancel]").addEventListener("click", () => finish(false));
    backdrop.querySelector("[data-dialog-confirm]").addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", event => { if (event.target === backdrop) finish(false); });
    backdrop.querySelector("[data-dialog-cancel]").focus();
  });
}

function bulkEditDialog(count, { title = "Group edit", allowAccount = true } = {}) {
  return new Promise(resolve => {
    const categorySelect = `<option value="">Keep category</option>${categoryOptions("")}`;
    const accountSelect = `<option value="">Keep account</option>${accountOptions("", { includeHidden: true })}`;
    const { backdrop, close } = modalDialogShell(title, `
      <form class="form-stack" data-bulk-edit-form>
        <p class="muted">${count} selected rows. Empty fields keep the current value.</p>
        <div class="form-grid two">
          <label class="field"><span>Category</span><select id="bulk-edit-category">${categorySelect}</select></label>
          <label class="field"><span>Account</span><select id="bulk-edit-account" ${allowAccount ? "" : "disabled"}>${accountSelect}</select></label>
        </div>
        <label class="field"><span>Description</span><input id="bulk-edit-description" placeholder="Keep existing description"></label>
        <label class="field"><span>Counterparty</span><input id="bulk-edit-counterparty" placeholder="Keep existing counterparty · type __CLEAR__ to clear"></label>
        <label class="field"><span>Note</span><textarea id="bulk-edit-note" rows="3" placeholder="Keep existing note · type __CLEAR__ to clear"></textarea></label>
        <div class="form-grid two">
          <label class="field"><span>Review status</span><select id="bulk-edit-review"><option value="">Keep</option><option value="false">Clean</option><option value="true">Needs review</option></select></label>
          <label class="field"><span>Statistics</span><select id="bulk-edit-ignore"><option value="">Keep</option><option value="false">Include in stats</option><option value="true">Ignore in stats</option></select></label>
        </div>
        <div class="button-row dialog-actions"><button class="secondary-button" data-dialog-cancel type="button">Cancel</button><button class="primary-button" type="submit">Continue</button></div>
      </form>`, { wide: true });
    const finish = value => { close(); resolve(value); };
    backdrop.querySelector("[data-dialog-cancel]").addEventListener("click", () => finish(null));
    backdrop.addEventListener("click", event => { if (event.target === backdrop) finish(null); });
    backdrop.querySelector("[data-bulk-edit-form]").addEventListener("submit", event => {
      event.preventDefault();
      const patch = {};
      const categoryId = backdrop.querySelector("#bulk-edit-category").value;
      const accountId = backdrop.querySelector("#bulk-edit-account").value;
      const description = backdrop.querySelector("#bulk-edit-description").value.trim();
      const counterparty = backdrop.querySelector("#bulk-edit-counterparty").value.trim();
      const note = backdrop.querySelector("#bulk-edit-note").value;
      const review = backdrop.querySelector("#bulk-edit-review").value;
      const ignore = backdrop.querySelector("#bulk-edit-ignore").value;
      if (categoryId) patch.categoryId = categoryId;
      if (allowAccount && accountId) patch.accountId = accountId;
      if (description) patch.description = description === "__CLEAR__" ? "" : description;
      if (counterparty) patch.counterparty = counterparty === "__CLEAR__" ? "" : counterparty;
      if (note) patch.note = note === "__CLEAR__" ? "" : note;
      if (review) patch.review = review === "true";
      if (ignore) patch.excludeFromStats = ignore === "true";
      finish(patch);
    });
    backdrop.querySelector("#bulk-edit-category").focus();
  });
}

function accountBalanceAfterRows(account, rows = []) {
  return Number(account?.openingBalance || 0) + [
    ...state.transactions,
    ...rows
  ].filter(tx => tx.accountId === account?.id).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function importBalanceSummaryHtml() {
  const rows = activePreview?.transactions || [];
  if (!rows.length) return "";
  const accountIds = [...new Set(rows.map(tx => tx.accountId).filter(Boolean))];
  return accountIds.map(accountId => {
    const account = state.accounts.find(item => item.id === accountId);
    if (!account) return "";
    const current = accountBalanceAfterRows(account, []);
    const next = accountBalanceAfterRows(account, rows);
    const currency = account.currency || selectedCurrency();
    return `<div><strong>${escapeHtml(account.name)}</strong><span>${formatCurrency(current, currency)} → ${formatCurrency(next, currency)}</span></div>`;
  }).filter(Boolean).join("");
}


function roundManualMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function accountBalanceBeforeManualSave(accountId, excludingTransactionId = "") {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) return 0;
  return Number(account.openingBalance || 0) + state.transactions
    .filter(tx => tx.accountId === accountId && tx.id !== excludingTransactionId)
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

async function saveTransactionWithReferenceSplit(input) {
  const account = state.accounts.find(item => item.id === input.accountId);
  const referenceAccount = account?.referenceAccountId ? state.accounts.find(item => item.id === account.referenceAccountId) : null;
  const amount = Number(input.amount || 0);
  if (!account || !referenceAccount || amount >= 0 || input.internalTransfer) {
    await saveTransaction(input);
    return 1;
  }

  const balanceBefore = accountBalanceBeforeManualSave(account.id, input.id || "");
  const requested = Math.abs(amount);
  const available = Math.max(0, Number(balanceBefore || 0));
  const shortage = roundManualMoney(Math.max(0, requested - available));
  if (!Number.isFinite(shortage) || shortage <= 0.004) {
    await saveTransaction(input);
    return 1;
  }

  const localDeduction = roundManualMoney(Math.max(0, requested - shortage));
  const groupId = `rf_${input.id || Date.now()}`;
  const sourceTx = {
    ...input,
    amount: -localDeduction,
    referenceFunding: true,
    referenceFundingRole: "source-split",
    referenceSourceAccountId: account.id,
    referenceAccountId: referenceAccount.id,
    referenceOriginalAmount: amount,
    referenceCoveredAmount: shortage,
    referenceFundingGroupId: groupId,
    reason: `${input.reason || ""}${input.reason ? " " : ""}Split with reference account ${referenceAccount.name}: ${account.name} covers ${localDeduction.toFixed(2)}, reference covers ${shortage.toFixed(2)}.`
  };
  const sourceId = await saveTransaction(sourceTx);
  await saveTransaction({
    ...input,
    id: input.id ? `${input.id}_ref_deduction` : undefined,
    accountId: referenceAccount.id,
    amount: -shortage,
    description: `${account.name} reference remainder: ${input.description || "Transaction"}`,
    counterparty: input.counterparty || account.name,
    source: "auto:reference-account",
    referenceFunding: true,
    referenceFundingRole: "deduction",
    referenceSourceAccountId: account.id,
    referenceAccountId: referenceAccount.id,
    referenceOriginalAmount: amount,
    referenceCoveredAmount: shortage,
    referenceFundingGroupId: groupId,
    fundingOriginalId: sourceId,
    note: input.note || "Auto-created reference-account remainder. Later matching reference-account imports are filtered.",
    reason: `Auto deduction from ${referenceAccount.name} for the part of ${account.name} that would go below zero.`
  });
  return 2;
}

function selectedTransactions() {
  const ids = selectedTransactionIds;
  return state.transactions.filter(tx => ids.has(tx.id));
}

function updateTransactionSelectionUi() {
  const count = selectedTransactionIds.size;
  const toolbar = $("#tx-selection-toolbar");
  const counter = $("#tx-selected-count");
  const toggle = $("#tx-selection-toggle");
  const pageSelect = $("#tx-page-select-all");
  if (toolbar) toolbar.hidden = !txSelectionMode;
  if (counter) counter.textContent = `${count} selected`;
  if (toggle) toggle.textContent = txSelectionMode ? "Done" : "Select";
  const visibleIds = pagedRows(txFilteredRows, txPage, PAGE_SIZES.transactions).map(tx => tx.id);
  if (pageSelect) {
    pageSelect.checked = visibleIds.length > 0 && visibleIds.every(id => selectedTransactionIds.has(id));
    pageSelect.indeterminate = visibleIds.some(id => selectedTransactionIds.has(id)) && !pageSelect.checked;
  }
}

function importPreviewSelectedRows() {
  if (!activePreview?.transactions) return [];
  return activePreview.transactions.filter(tx => importSelectedIds.has(tx.id || tx.externalId));
}

function updateImportSelectionUi() {
  const count = importSelectedIds.size;
  const toolbar = $("#import-selection-toolbar");
  const counter = $("#import-selected-count");
  const pageSelect = $("#import-page-select-all");
  if (toolbar) toolbar.hidden = !activePreview?.transactions?.length;
  if (counter) counter.textContent = `${count} selected`;
  const rows = activePreview?.transactions || [];
  const pageRows = pagedRows(sortedRows(rows, importSort, {
    date: tx => tx.date || "",
    description: tx => tx.description || "",
    amount: tx => Number(tx.amount || 0),
    category: tx => categoryMap().get(tx.categoryId)?.name || tx.categoryId || "",
    status: tx => tx.review ? "Needs review" : "Prepared"
  }), importPage, PAGE_SIZES.importPreview);
  const visibleIds = pageRows.map(tx => tx.id || tx.externalId);
  if (pageSelect) {
    pageSelect.checked = visibleIds.length > 0 && visibleIds.every(id => importSelectedIds.has(id));
    pageSelect.indeterminate = visibleIds.some(id => importSelectedIds.has(id)) && !pageSelect.checked;
  }
}

async function promptBulkTransactionPatch(count, options = {}) {
  return bulkEditDialog(count, options);
}

async function deleteSelectedTransactions() {
  const rows = selectedTransactions();
  if (!rows.length) return toast("No transactions selected", "", "error");
  const ok = await confirmDialog({ title: "Delete transactions", message: `Delete ${rows.length} selected transactions permanently?`, confirmLabel: "Delete", danger: true });
  if (!ok) return;
  for (const tx of rows) await deleteTransaction(tx.id);
  selectedTransactionIds.clear();
  toast("Transactions deleted", `${rows.length} removed.`);
  renderTransactions();
}

async function groupEditSelectedTransactions() {
  const rows = selectedTransactions();
  if (!rows.length) return toast("No transactions selected", "", "error");
  const patch = await promptBulkTransactionPatch(rows.length, { title: "Group edit transactions", allowAccount: true });
  if (patch === null) return;
  if (!Object.keys(patch).length) return toast("No changes", "Nothing was changed.");
  const ok = await confirmDialog({ title: "Apply group edit", message: `Apply these changes to ${rows.length} selected transactions?`, confirmLabel: "Apply changes" });
  if (!ok) return;
  await saveTransactionsBatch(rows.map(tx => ({ ...tx, ...patch, source: tx.source || "bulk-edit" })));
  toast("Transactions updated", `${rows.length} changed.`);
  renderTransactions();
}

function exportSelectedTransactions() {
  const rows = selectedTransactions();
  if (!rows.length) return toast("No transactions selected", "", "error");
  downloadTextFile(`capito-selected-transactions-${TODAY()}.csv`, serializeTransactionsCsv(rows, state.categories, state.accounts));
}

function exportImportSelection() {
  const rows = importPreviewSelectedRows();
  if (!rows.length) return toast("No import rows selected", "", "error");
  downloadTextFile(`capito-selected-import-rows-${TODAY()}.csv`, serializeTransactionsCsv(rows, state.categories, state.accounts));
}

async function deleteSelectedImportRows() {
  const rows = importPreviewSelectedRows();
  if (!rows.length) return toast("No import rows selected", "", "error");
  const ok = await confirmDialog({ title: "Remove preview rows", message: `Delete ${rows.length} selected rows from the import preview?`, confirmLabel: "Remove rows", danger: true });
  if (!ok) return;
  const ids = new Set(rows.map(tx => tx.id || tx.externalId));
  activePreview.transactions = activePreview.transactions.filter(tx => !ids.has(tx.id || tx.externalId));
  importSelectedIds.clear();
  toast("Preview rows deleted", `${rows.length} removed from this import.`);
  renderImportPreview();
  updateUnifiedImportSummary();
}

async function groupEditImportRows() {
  const rows = importPreviewSelectedRows();
  if (!rows.length) return toast("No import rows selected", "", "error");
  const patch = await promptBulkTransactionPatch(rows.length, { title: "Group edit import rows", allowAccount: true });
  if (patch === null) return;
  if (!Object.keys(patch).length) return toast("No changes", "Nothing was changed.");
  const ok = await confirmDialog({ title: "Apply import edit", message: `Apply these changes to ${rows.length} selected import rows?`, confirmLabel: "Apply changes" });
  if (!ok) return;
  const ids = new Set(rows.map(tx => tx.id || tx.externalId));
  activePreview.transactions = activePreview.transactions.map(tx => ids.has(tx.id || tx.externalId) ? { ...tx, ...patch } : tx);
  toast("Import rows updated", `${rows.length} changed.`);
  renderImportPreview();
  updateUnifiedImportSummary();
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
  if (replace) {
    const firstOk = await confirmDialog({ title: "Replace current data", message: "Replace all current Capito data with this JSON backup?", confirmLabel: "Continue", danger: true });
    if (!firstOk) {
      if (fileInput) fileInput.value = "";
      return;
    }
    const secondOk = await confirmDialog({ title: "Final confirmation", message: "This deletes current accounts, rules, transactions and holdings before importing.", confirmLabel: "Replace data", danger: true });
    if (!secondOk) {
      if (fileInput) fileInput.value = "";
      return;
    }
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
  document.addEventListener("click", event => {
    if (!event.target.closest(".account-menu-wrap")) {
      document.querySelectorAll(".account-menu-wrap.menu-open").forEach(open => open.classList.remove("menu-open"));
    }
  });
  $$(`[data-view]`).forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.view)));
  $$(`[data-go-view]`).forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.goView)));
  $("#hidden-accounts-toggle")?.addEventListener("click", () => {
    hiddenAccountsExpanded = !hiddenAccountsExpanded;
    requestRender();
  });
  if (window.matchMedia("(max-width: 920px)").matches) {
    $("#categories-panel")?.classList.add("is-folded");
    $("#rules-panel")?.classList.add("is-folded");
  }
  updateRulesFoldState();
  $("#settings-form")?.addEventListener("input", scheduleSettingsSave);
  $("#settings-form")?.addEventListener("change", scheduleSettingsSave);
  $$("[data-compare-mode]").forEach(button => button.addEventListener("click", () => {
    setCompareMode(button.dataset.compareMode);
    scheduleSettingsSave();
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
  ["#tx-search", "#tx-account-filter", "#tx-category-filter", "#tx-currency-filter", "#tx-min-amount", "#tx-max-amount", "#tx-date-from", "#tx-date-to", "#tx-review-filter"].forEach(selector => $(selector)?.addEventListener("input", () => {
    txPage = 1;
    renderTransactions();
  }));
  $("#reset-tx-filters")?.addEventListener("click", () => {
    $("#tx-search").value = "";
    $("#tx-account-filter").value = "all";
    $("#tx-category-filter").value = "all";
    $("#tx-currency-filter").value = "all";
    $("#tx-min-amount").value = "";
    $("#tx-max-amount").value = "";
    $("#tx-date-from").value = "";
    $("#tx-date-to").value = "";
    $("#tx-review-filter").value = "all";
    selectedTransactionIds.clear();
    txPage = 1;
    renderTransactions();
  });
  $("#tx-filter-toggle")?.addEventListener("click", () => {
    const panel = $("#tx-filter-panel");
    const expanded = !panel.classList.toggle("is-collapsed");
    $("#tx-filter-toggle").setAttribute("aria-expanded", String(expanded));
    $("#tx-filter-toggle b").textContent = expanded ? "-" : "+";
  });

  ["#category-search", "#rule-search"].forEach(selector => $(selector)?.addEventListener("input", renderRules));
  ["#categories-fold-toggle", "#rules-fold-toggle"].forEach(selector => $(selector)?.addEventListener("click", () => {
    const panel = selector.includes("categories") ? $("#categories-panel") : $("#rules-panel");
    panel?.classList.toggle("is-folded");
    updateRulesFoldState();
  }));
  window.addEventListener("resize", updateRulesFoldState);

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
  $("#add-position-holding")?.addEventListener("click", () => {
    if (activePositionsAccountId) openAssetModal("", activePositionsAccountId);
  });
  $("#account-currency")?.addEventListener("input", () => {
    const select = $("#account-display-currency");
    if (select) select.innerHTML = accountCurrencyOptions(select.value || "", normalizedCurrencyFrom("#account-currency", selectedCurrency()));
  });
  ["#asset-provider", "#asset-quantity", "#asset-buy-price", "#asset-starting-position"].forEach(selector => {
    $(selector)?.addEventListener(selector === "#asset-quantity" || selector === "#asset-buy-price" ? "input" : "change", syncAssetPricingFields);
  });
  const transactionCategoryInput = $("#transaction-category");
  transactionCategoryInput?.addEventListener("input", () => {
    renderTransactionCategoryMenu(true);
    syncTransactionReviewControl();
  });
  transactionCategoryInput?.addEventListener("focus", () => renderTransactionCategoryMenu(true));
  transactionCategoryInput?.addEventListener("blur", () => setTimeout(() => renderTransactionCategoryMenu(false), 140));
  transactionCategoryInput?.addEventListener("change", syncTransactionReviewControl);
  ["#transaction-description", "#transaction-counterparty"].forEach(selector => {
    $(selector)?.addEventListener("input", scheduleTransactionCategoryAutofill);
    $(selector)?.addEventListener("blur", () => applyRulesToTransactionCategory({ onlyWhenEmptyOrMisc: true, fillMisc: false }));
  });

  $("#tx-selection-toggle")?.addEventListener("click", () => {
    txSelectionMode = !txSelectionMode;
    if (!txSelectionMode) selectedTransactionIds.clear();
    renderTransactions();
  });
  $("#tx-page-select-all")?.addEventListener("change", event => {
    const visibleIds = pagedRows(txFilteredRows, txPage, PAGE_SIZES.transactions).map(tx => tx.id);
    if (event.currentTarget.checked) visibleIds.forEach(id => selectedTransactionIds.add(id));
    else visibleIds.forEach(id => selectedTransactionIds.delete(id));
    renderTransactions();
  });
  $("#tx-select-all-filtered")?.addEventListener("click", () => {
    txFilteredRows.forEach(tx => selectedTransactionIds.add(tx.id));
    renderTransactions();
  });
  $("#tx-clear-selection")?.addEventListener("click", () => {
    selectedTransactionIds.clear();
    renderTransactions();
  });
  $("#tx-delete-selected")?.addEventListener("click", () => deleteSelectedTransactions().catch(error => toast("Delete failed", error.message, "error")));
  $("#tx-export-selected")?.addEventListener("click", exportSelectedTransactions);
  $("#tx-group-edit")?.addEventListener("click", () => groupEditSelectedTransactions().catch(error => toast("Group edit failed", error.message, "error")));

  $("#import-page-select-all")?.addEventListener("change", event => {
    if (!activePreview?.transactions) return;
    const rows = sortedRows(activePreview.transactions, importSort, {
      date: tx => tx.date || "",
      description: tx => tx.description || "",
      amount: tx => Number(tx.amount || 0),
      category: tx => categoryMap().get(tx.categoryId)?.name || tx.categoryId || "",
      status: tx => tx.review ? "Needs review" : "Prepared"
    });
    const visibleIds = pagedRows(rows, importPage, PAGE_SIZES.importPreview).map(tx => tx.id || tx.externalId);
    if (event.currentTarget.checked) visibleIds.forEach(id => importSelectedIds.add(id));
    else visibleIds.forEach(id => importSelectedIds.delete(id));
    renderImportPreview();
  });
  $("#import-select-all")?.addEventListener("click", () => {
    activePreview?.transactions?.forEach(tx => importSelectedIds.add(tx.id || tx.externalId));
    renderImportPreview();
  });
  $("#import-clear-selection")?.addEventListener("click", () => {
    importSelectedIds.clear();
    renderImportPreview();
  });
  $("#import-delete-selected")?.addEventListener("click", () => deleteSelectedImportRows().catch(error => toast("Preview delete failed", error.message, "error")));
  $("#import-export-selected")?.addEventListener("click", exportImportSelection);
  $("#import-group-edit")?.addEventListener("click", () => groupEditImportRows().catch(error => toast("Group edit failed", error.message, "error")));

  $("#export-button")?.addEventListener("click", exportTransactionsCsv);
  $("#export-json-button")?.addEventListener("click", () => exportBackupJson().catch(error => toast("JSON export failed", error.message, "error")));
  $("#repair-sync-button")?.addEventListener("click", runSyncRepair);
  $$("[data-sync-choice]").forEach(button => button.addEventListener("click", () => runSyncChoice(button.dataset.syncChoice)));
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
  $("#delete-all-confirm")?.addEventListener("input", event => {
    const ok = event.target.value === "DELETE ALL DATA";
    const button = $("#delete-all-data-button");
    if (button) button.disabled = !ok;
  });
  $("#delete-all-data-button")?.addEventListener("click", async () => {
    if ($("#delete-all-confirm")?.value !== "DELETE ALL DATA") return;
    const ok = await confirmDialog({ title: "Delete all data", message: "Delete all Capito data permanently?", confirmLabel: "Delete all data", danger: true });
    if (!ok) return;
    try {
      await deleteAllData();
      $("#delete-all-confirm").value = "";
      $("#delete-all-data-button").disabled = true;
      setMessage($("#delete-all-message"), "All data deleted.");
      toast("All data deleted");
    } catch (error) {
      setMessage($("#delete-all-message"), error.message, true);
      toast("Delete failed", error.message, "error");
    }
  });

  $("#transaction-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    try {
      const selectedCategoryId = categoryIdFromSearch($("#transaction-category")?.value);
      const input = {
        id: $("#transaction-id").value || undefined,
        accountId: $("#transaction-account").value,
        date: $("#transaction-date").value,
        amount: parseMoney($("#transaction-amount").value),
        currency: normalizedCurrencyFrom("#transaction-currency"),
        categoryId: selectedCategoryId,
        counterparty: $("#transaction-counterparty").value,
        description: $("#transaction-description").value,
        note: $("#transaction-note").value,
        review: $("#transaction-review").checked,
        excludeFromStats: Boolean($("#transaction-ignore-stats")?.checked),
        source: $("#transaction-id").value ? "manual-edit" : "manual"
      };
      if (!input.accountId || !input.date || input.amount == null) {
        toast("Invalid transaction", "Account, date and amount are required.", "error");
        return;
      }
      if (!input.categoryId) {
        const cat = categorizeTransaction(input, state.rules, state.categories, state.accounts);
        Object.assign(input, cat);
        if (!input.categoryId) input.categoryId = "misc";
      }
      if (!state.categories.some(cat => cat.id === input.categoryId)) {
        toast("Invalid category", "Choose an existing category from the category search list.", "error");
        $("#transaction-category")?.focus();
        return;
      }
      if (input.categoryId && input.categoryId !== "misc" && input.categoryId !== "auto") input.review = false;
      const savedCount = await saveTransactionWithReferenceSplit(input);
      toast("Transaction saved", savedCount > 1 ? "Split with reference account." : "");
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
    const ok = await confirmDialog({ title: "Delete transaction", message: "Delete this transaction permanently?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
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
        displayCurrency: $("#account-display-currency")?.value || "",
        openingBalance: parseMoney($("#account-opening").value) || 0,
        openingBalanceDate: $("#account-opening-date")?.value || "",
        note: $("#account-note")?.value || "",
        iban: $("#account-iban").value,
        accountNumber: $("#account-number").value,
        bic: $("#account-bic").value,
        transferAliases: $("#account-aliases").value,
        referenceAccountId: $("#account-reference-account")?.value || "",
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
    const first = await confirmDialog({ title: "Delete account", message: `Delete '${account.name}'? This account will be removed instead of hidden.`, confirmLabel: "Continue", danger: true });
    if (!first) return;
    const second = await confirmDialog({ title: "Final confirmation", message: `Delete '${account.name}' with ${txCount} linked transactions and ${assetCount} linked holdings?`, confirmLabel: "Delete account", danger: true });
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
      const quantity = parseMoney($("#asset-quantity").value) || 0;
      const buyPrice = parseMoney($("#asset-buy-price")?.value) || 0;
      const costBasis = quantity > 0 && buyPrice > 0 ? quantity * buyPrice : parseMoney($("#asset-cost-basis").value) || 0;
      await saveAsset({
        id: $("#asset-id").value || undefined,
        accountId: $("#asset-account").value,
        symbol: $("#asset-symbol").value,
        name: $("#asset-name").value,
        type: $("#asset-type").value,
        provider: $("#asset-provider").value === "manual" ? "manual" : "yahoo",
        wkn: $("#asset-wkn")?.value || "",
        isin: $("#asset-isin")?.value || "",
        quantity,
        currency: normalizedCurrencyFrom("#asset-currency"),
        manualPrice: ($("#asset-provider").value || "manual") === "manual" ? parseMoney($("#asset-manual-price").value) || 0 : parseMoney($("#asset-manual-price").value) || state.assets.find(item => item.id === $("#asset-id").value)?.manualPrice || 0,
        buyPrice,
        costBasis,
        startingPosition: Boolean($("#asset-starting-position")?.checked),
        startingAt: $("#asset-starting-position")?.checked ? $("#asset-starting-at")?.value || TODAY() : "",
        startingValue: Boolean($("#asset-starting-position")?.checked) ? costBasis || (quantity * (parseMoney($("#asset-manual-price").value) || 0)) : 0,
        hidden: Boolean($("#asset-hidden")?.checked)
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
    const ok = await confirmDialog({ title: "Delete holding", message: "Delete this holding permanently?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await deleteAsset(id);
    toast("Asset deleted");
    closeModal();
  });

  $("#category-form").addEventListener("submit", async event => {
    event.preventDefault();
    await saveCategory({
      id: $("#category-id").value || undefined,
      name: $("#category-name").value,
      group: state.categories.find(cat => cat.id === $("#category-id").value)?.group || "Custom",
      icon: $("#category-icon").value,
      type: $("#category-type").value,
      color: $("#category-color").value
    });
    toast("Category saved");
    closeModal();
  });

  $("#rule-form").addEventListener("submit", async event => {
    event.preventDefault();
    const ruleInput = {
      id: $("#rule-id").value || undefined,
      label: $("#rule-label").value,
      categoryId: $("#rule-category").value,
      keywords: $("#rule-keywords").value,
      caseSensitive: $("#rule-case-sensitive").value === "true"
    };
    const savedId = await saveRule(ruleInput);
    const keywords = String(ruleInput.keywords || "").split(",").map(item => item.trim()).filter(Boolean);
    const nextRule = { ...ruleInput, id: savedId, keywords };
    const nextRules = state.rules.some(rule => rule.id === savedId)
      ? state.rules.map(rule => rule.id === savedId ? nextRule : rule)
      : [...state.rules, nextRule];
    const reapplied = await reapplyRulesToReviewQueue(nextRules);
    toast("Rule saved", reapplied ? `${reapplied} past transactions rechecked.` : "No past transactions changed.");
    closeModal();
  });

  $("#delete-rule-button").addEventListener("click", async () => {
    const id = $("#rule-id").value;
    if (!id) return;
    const ok = await confirmDialog({ title: "Delete rule", message: "Delete this keyword rule and recategorize past transactions?", confirmLabel: "Delete rule", danger: true });
    if (!ok) return;
    const nextRules = state.rules.filter(rule => rule.id !== id);
    await deleteRule(id);
    const reapplied = await reapplyRulesToReviewQueue(nextRules);
    toast("Rule deleted", reapplied ? `${reapplied} past transactions rechecked.` : "");
    closeModal();
  });

  $("#settings-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    try { await saveSettingsFromForm({ silent: false }); }
    catch (error) { setMessage($("#settings-message"), error.message, true); }
  });

  $("#import-account")?.addEventListener("change", () => {
    if (activeParsedFile) {
      buildActiveImportPreview();
      updateUnifiedImportSummary();
    }
  });

  $("#positions-import-account")?.addEventListener("change", () => {
    if (brokerParsedFile) {
      buildBrokerPositionsImportPreview();
      updateUnifiedImportSummary();
    }
  });

  $("#positions-import-file")?.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseUnifiedImportFile(file);
      activeParsedFile = parsed.bank;
      brokerParsedFile = parsed.broker;
      activePreview = null;
      brokerPreview = null;
      updateImportFileLabel();
      updateBrokerPositionsFileLabel();
      buildActiveImportPreview();
      buildBrokerPositionsImportPreview();
      updateUnifiedImportSummary();
    } catch (error) {
      toast("Import failed", error.message, "error");
      setMessage($("#import-message"), error.message, true);
    }
  });

  $("#reset-positions-import-button")?.addEventListener("click", () => {
    resetImportFlow("Import reset.");
  });

  $("#commit-positions-import-button")?.addEventListener("click", async () => {
    $("#commit-import-button")?.click();
  });

  $("#import-file").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseUnifiedImportFile(file);
      activeParsedFile = parsed.bank;
      brokerParsedFile = parsed.broker;
      activePreview = null;
      brokerPreview = null;
      updateImportFileLabel();
      updateBrokerPositionsFileLabel();
      buildActiveImportPreview();
      buildBrokerPositionsImportPreview();
      updateUnifiedImportSummary();
    } catch (error) {
      toast("Import failed", error.message, "error");
      setMessage($("#import-message"), error.message, true);
    }
  });

  $("#reset-import-button")?.addEventListener("click", () => {
    resetImportFlow("Import reset.");
  });

  $("#commit-import-button").addEventListener("click", async () => {
    if (!activePreview?.transactions?.length && !brokerPreview?.positions?.length) return;
    try {
      let txCount = 0;
      let positionCount = 0;
      if (activePreview?.transactions?.length) {
        const importAccount = state.accounts.find(account => account.id === $("#import-account")?.value);
        const openingHint = Number(activeParsedFile?.openingBalanceHint);
        if (importAccount && Number.isFinite(openingHint)) {
          await saveAccount({ ...importAccount, openingBalance: openingHint });
        }
        await saveTransactionsBatch(activePreview.transactions);
        txCount = activePreview.transactions.length;
      }
      if (brokerPreview?.positions?.length) {
        for (const asset of brokerPreview.positions) await saveAsset(asset);
        positionCount = brokerPreview.positions.length;
      }
      toast("Import complete", `${txCount} transactions and ${positionCount} positions saved.`);
      resetImportFlow("Import complete.");
    } catch (error) {
      toast("Import save failed", error.message, "error");
      setMessage($("#import-message"), error.message, true);
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
