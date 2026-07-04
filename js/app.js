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
import { drawAccountBars, drawDonut, drawIncomeExpense, drawNetSeries } from "./charts.js";

const VIEW_LABELS = {
  overview: ["COMMAND CENTER", "Overview"],
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
  if (monthIncome) monthIncome.textContent = formatCurrency(monthly.current.income, currency);
  if (monthExpense) monthExpense.textContent = formatCurrency(monthly.current.expense, currency);
  if (monthNet) {
    monthNet.textContent = formatCurrency(monthly.current.net, currency);
    monthNet.className = monthly.current.net >= 0 ? "amount-pos" : "amount-neg";
  }
  if (currentMonthPill) currentMonthPill.textContent = monthly.currentMonth;
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
      item.innerHTML = `<div><strong>${escapeHtml(tx.description)}</strong><small>${escapeHtml(tx.date)} · ${escapeHtml(tx.reason || "Needs review")}</small></div><span class="amount-neg">${formatCurrency(Math.abs(tx.amount), tx.currency || currency)}</span>`;
      item.addEventListener("click", () => openTransactionModal(tx.id));
      reviewList.append(item);
    }
  }
  drawIncomeExpense($("#income-expense-chart"), monthly.series, currency);
  drawNetSeries($("#net-series-chart"), monthly.series);
  drawDonut($("#category-donut-chart"), categorySpend, currency);
  drawAccountBars($("#account-bars-chart"), portfolio.accountRows, currency);
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
  $("#tx-count").textContent = `${rows.length} entries`;
  tbody.replaceChildren();
  for (const tx of rows.slice(0, 400)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const account = accounts.get(tx.accountId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(tx.date)}</td>
      <td><strong>${escapeHtml(tx.description)}</strong><br><small class="muted">${escapeHtml(tx.counterparty || tx.reason || "")}</small></td>
      <td>${escapeHtml(account?.name || tx.accountId || "—")}</td>
      <td>${categoryPill(cat, { review: tx.review })}</td>
      <td class="${Number(tx.amount) >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency || selectedCurrency())}</td>
      <td>${escapeHtml(tx.note || "")}</td>
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
    const holdingsHtml = holdings.length
      ? `<div class="holding-list">${holdings.slice(0, 6).map(asset => {
          const price = Number(asset.lastPrice ?? asset.manualPrice ?? 0);
          const value = assetMarketValue(asset);
          return `<button class="holding-row" type="button" data-edit-asset="${escapeHtml(asset.id)}"><span><strong>${escapeHtml(asset.symbol || asset.name)}</strong><small>${Number(asset.quantity || 0).toLocaleString()} × ${formatCurrency(price, asset.currency || account.currency || currency)}</small></span><b>${formatCurrency(value, asset.currency || account.currency || currency)}</b></button>`;
        }).join("")}${holdings.length > 6 ? `<small class="muted">+${holdings.length - 6} more holdings</small>` : ""}</div>`
      : `<div class="empty-holdings"><small>${isBroker ? "No holdings in this broker account yet." : "No linked holdings."}</small></div>`;
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
      ${isBroker ? holdingsHtml : ""}
      <div class="item-card-actions">
        ${isBroker ? `<button class="secondary-button compact" data-add-asset-for="${escapeHtml(account.id)}" type="button">Add holding</button>` : ""}
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
  container.querySelectorAll("[data-edit-asset]").forEach(btn => btn.addEventListener("click", () => openAssetModal(btn.dataset.editAsset)));
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
  renderTransactions();
  renderAccounts();
  renderAssets();
  renderRules();
  if (activeView === "settings") renderSettings();
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

function renderImportPreview() {
  const tbody = $("#import-preview-body");
  tbody.replaceChildren();
  if (!activePreview) {
    $("#preview-count").textContent = "No file";
    return;
  }
  const cats = categoryMap();
  $("#preview-count").textContent = `${activePreview.transactions.length} accepted · ${activePreview.skipped.length} skipped`;
  for (const tx of activePreview.transactions.slice(0, 100)) {
    const cat = cats.get(tx.categoryId) || cats.get("misc");
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(tx.date)}</td><td><strong>${escapeHtml(tx.description)}</strong><br><small class="muted">${escapeHtml(tx.reason || "")}</small></td><td class="${tx.amount >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency)}</td><td>${categoryPill(cat, { review: tx.review })}</td><td>${tx.review ? "Needs review" : "Prepared"}</td>`;
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

  ["#tx-search", "#tx-account-filter", "#tx-category-filter", "#tx-review-filter"].forEach(selector => $(selector)?.addEventListener("input", renderTransactions));
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

  $("#import-file").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      activeParsedFile = await parseBankFile(file);
      activePreview = null;
      $("#import-summary").hidden = false;
      $("#import-summary").textContent = `${activeParsedFile.filename}: ${activeParsedFile.rows.length} rows · delimiter ${activeParsedFile.delimiter === "\t" ? "tab" : activeParsedFile.delimiter}`;
      $("#build-preview-button").disabled = false;
      $("#commit-import-button").disabled = true;
      setMessage($("#import-message"), "File loaded. Check mapping, then build preview.");
      renderMapping();
      renderImportPreview();
    } catch (error) {
      toast("Import failed", error.message, "error");
    }
  });

  $("#build-preview-button").addEventListener("click", () => {
    if (!activeParsedFile) return;
    const account = state.accounts.find(item => item.id === $("#import-account").value);
    activePreview = buildImportPreview(activeParsedFile, activeParsedFile.mapping, {
      accountId: $("#import-account").value,
      currency: account?.currency || selectedCurrency(),
      rules: state.rules,
      categories: state.categories,
      accounts: state.accounts
    }, state.transactions);
    $("#commit-import-button").disabled = !activePreview.transactions.length;
    setMessage($("#import-message"), `${activePreview.transactions.length} rows ready. ${activePreview.transactions.filter(tx => tx.review).length} need review.`);
    renderImportPreview();
  });

  $("#commit-import-button").addEventListener("click", async () => {
    if (!activePreview?.transactions?.length) return;
    try {
      await saveTransactionsBatch(activePreview.transactions);
      toast("Import complete", `${activePreview.transactions.length} transactions saved.`);
      activeParsedFile = null;
      activePreview = null;
      $("#import-file").value = "";
      $("#build-preview-button").disabled = true;
      $("#commit-import-button").disabled = true;
      $("#import-summary").hidden = true;
      renderMapping();
      renderImportPreview();
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
