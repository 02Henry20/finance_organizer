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
  TODAY,
  buildCategorySpend,
  calculateMonthlySnapshot,
  calculatePortfolio,
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
  transactions: ["LEDGER", "Transactions"],
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
      ? "Offline cache"
      : status === "error"
        ? "Sync issue"
        : "Syncing";
  pill.querySelector("strong").textContent = label;
  pill.querySelector("small").textContent = state.sync.detail || "Checking data";
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

function renderOverview() {
  const currency = selectedCurrency();
  const portfolio = calculatePortfolio(state);
  const monthly = calculateMonthlySnapshot(state);
  const categorySpend = buildCategorySpend(state.transactions, state.categories, state.settings, monthly.currentMonth);
  const review = state.transactions.filter(tx => tx.review).slice(0, 8);
  $("#overview-date").textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date());
  $("#net-worth-value").textContent = formatCurrency(portfolio.netWorth, currency);
  $("#liquidity-value").textContent = formatCurrency(portfolio.liquidity, currency);
  $("#asset-value").textContent = formatCurrency(portfolio.assetValue, currency);
  $("#debt-value").textContent = formatCurrency(portfolio.debt, currency);
  $("#month-income").textContent = formatCurrency(monthly.current.income, currency);
  $("#month-expense").textContent = formatCurrency(monthly.current.expense, currency);
  $("#month-net").textContent = formatCurrency(monthly.current.net, currency);
  $("#month-net").className = monthly.current.net >= 0 ? "amount-pos" : "amount-neg";
  $("#current-month-pill").textContent = monthly.currentMonth;
  $("#review-count").textContent = state.transactions.filter(tx => tx.review).length.toString();
  const reviewList = $("#review-list");
  reviewList.replaceChildren();
  if (!review.length) {
    reviewList.innerHTML = `<div class="mini-item"><div><strong>No ambiguous imports</strong><small>Everything currently has a category decision.</small></div></div>`;
  } else {
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
      <td><span class="category-pill ${tx.review ? "review-pill" : ""}">${escapeHtml(cat?.icon || "?")} ${escapeHtml(cat?.name || "Misc")}</span></td>
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
  if (!accounts.length) {
    container.innerHTML = `<article class="glass-card item-card empty-card"><h3>No accounts yet</h3><p class="muted">Add a checking, cash, broker or debt account.</p></article>`;
    return;
  }
  for (const account of accounts) {
    const row = rows.find(item => item.id === account.id) || { ...account, balance: { raw: Number(account.openingBalance || 0), converted: Number(account.openingBalance || 0) } };
    const holdings = holdingsForAccount(account.id);
    const holdingsValue = holdings.reduce((sum, asset) => sum + convertCurrency(assetMarketValue(asset), asset.currency || account.currency || currency, state.settings), 0);
    const totalValue = row.balance.converted + holdingsValue;
    const isBroker = ["broker", "asset"].includes(account.type);
    const card = document.createElement("article");
    card.className = `glass-card item-card account-card ${isBroker ? "broker-card" : ""}`;
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
  container.querySelectorAll("[data-edit-account]").forEach(btn => btn.addEventListener("click", () => openAccountModal(btn.dataset.editAccount)));
  container.querySelectorAll("[data-add-asset-for]").forEach(btn => btn.addEventListener("click", () => openAssetModal("", btn.dataset.addAssetFor)));
  container.querySelectorAll("[data-edit-asset]").forEach(btn => btn.addEventListener("click", () => openAssetModal(btn.dataset.editAsset)));
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
    row.innerHTML = `<div><strong>${escapeHtml(cat.icon || "•")} ${escapeHtml(cat.name)}</strong><small>${escapeHtml(cat.group)} · ${escapeHtml(cat.type)} · ${related.length} keyword rules</small></div><button class="ghost-button compact" data-edit-category="${escapeHtml(cat.id)}" type="button">Edit</button>`;
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
    wrapper.innerHTML = `<div class="rule-group-heading"><strong>${escapeHtml(group.cat?.icon || "?")} ${escapeHtml(group.cat?.name || "Misc")}</strong><small>${escapeHtml(group.cat?.group || "Misc")}</small></div>`;
    for (const rule of group.rules.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))) {
      const row = document.createElement("div");
      row.className = "settings-row rule-row";
      row.innerHTML = `<div><strong>${escapeHtml(rule.label)}</strong><small>${rule.requireAll ? "all keywords" : "any keyword"}: ${(rule.keywords || []).map(escapeHtml).join(", ")} · priority ${Number(rule.priority || 0)}</small></div><button class="ghost-button compact" data-edit-rule="${escapeHtml(rule.id)}" type="button">Edit</button>`;
      wrapper.append(row);
    }
    rulesList.append(wrapper);
  }
  categoriesList.querySelectorAll("[data-edit-category]").forEach(btn => btn.addEventListener("click", () => openCategoryModal(btn.dataset.editCategory)));
  rulesList.querySelectorAll("[data-edit-rule]").forEach(btn => btn.addEventListener("click", () => openRuleModal(btn.dataset.editRule)));
}

function renderSettings() {
  $("#setting-currency").value = selectedCurrency();
  $("#setting-theme").value = state.settings.theme || "dark";
  $("#setting-motion").value = state.settings.motion || "on";
  $("#setting-market-provider").value = state.settings.marketProvider || "twelvedata";
  $("#setting-market-key").value = getLocalMarketApiKey();
  $("#setting-hide-transfers").value = String(state.settings.hideInternalTransfersInSpending !== false);
  const fxStatus = $("#fx-status");
  if (fxStatus) {
    fxStatus.textContent = `${state.settings.fxSource || "static fallback"} · ${state.settings.fxLastUpdatedAt ? formatDateTime(state.settings.fxLastUpdatedAt) : "not refreshed yet"}`;
  }
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
  openModal("category");
}

function openRuleModal(id = "") {
  const rule = id ? state.rules.find(item => item.id === id) : null;
  $("#rule-id").value = rule?.id || "";
  $("#rule-label").value = rule?.label || "";
  $("#rule-category").value = rule?.categoryId || "misc";
  $("#rule-keywords").value = (rule?.keywords || []).join(", ");
  $("#rule-priority").value = rule?.priority ?? 50;
  $("#rule-require-all").value = String(Boolean(rule?.requireAll));
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

async function refreshAllAssets() {
  const visible = state.assets.filter(asset => !asset.hidden);
  if (!visible.length) return toast("No assets", "Add an asset first.", "error");
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
  toast("Quote refresh complete", `${ok} updated${failed ? ` · ${failed} failed` : ""}`, failed ? "error" : "success");
}


async function maybeRefreshFxRates() {
  if (!navigator.onLine || state.settings.autoRefreshFx === "off") return;
  const last = state.settings.fxLastUpdatedAt ? new Date(state.settings.fxLastUpdatedAt).getTime() : 0;
  const stale = !last || Date.now() - last > 12 * 60 * 60 * 1000;
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
    tr.innerHTML = `<td>${escapeHtml(tx.date)}</td><td><strong>${escapeHtml(tx.description)}</strong><br><small class="muted">${escapeHtml(tx.reason || "")}</small></td><td class="${tx.amount >= 0 ? "amount-pos" : "amount-neg"}">${formatCurrency(tx.amount, tx.currency)}</td><td><span class="category-pill ${tx.review ? "review-pill" : ""}">${escapeHtml(cat?.icon || "?")} ${escapeHtml(cat?.name || "Misc")}</span></td><td>${tx.review ? "Needs review" : "Ready"}</td>`;
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

  elements.signOut.addEventListener("click", () => signOut(auth));
  $$(`[data-view]`).forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.view)));
  $$(`[data-go-view]`).forEach(button => button.addEventListener("click", () => navigateTo(button.dataset.goView)));
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
  $("#refresh-quotes-button")?.addEventListener("click", refreshAllAssets);
  $("#refresh-fx-button")?.addEventListener("click", async () => {
    try {
      const result = await refreshFxRates();
      toast("Exchange rates updated", `${result.source} · ${formatDateTime(result.time)}`);
    } catch (error) {
      toast("Exchange-rate update failed", error.message, "error");
    }
  });

  $("#transaction-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = {
      id: $("#transaction-id").value || undefined,
      accountId: $("#transaction-account").value,
      date: $("#transaction-date").value,
      amount: parseMoney($("#transaction-amount").value),
      currency: $("#transaction-currency").value.toUpperCase() || selectedCurrency(),
      categoryId: $("#transaction-category").value,
      counterparty: $("#transaction-counterparty").value,
      description: $("#transaction-description").value,
      note: $("#transaction-note").value,
      review: $("#transaction-review").checked,
      source: $("#transaction-id").value ? "manual-edit" : "manual"
    };
    if (!input.accountId || !input.date || input.amount == null) return toast("Invalid transaction", "Account, date and amount are required.", "error");
    if (!input.categoryId || input.categoryId === "auto") {
      const cat = categorizeTransaction(input, state.rules, state.categories, state.accounts);
      Object.assign(input, cat);
    }
    setBusy(form, true);
    try {
      await saveTransaction(input);
      toast("Transaction saved");
      closeModal();
    } catch (error) {
      toast("Save failed", error.message, "error");
    } finally { setBusy(form, false); }
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
        currency: $("#account-currency").value.toUpperCase() || selectedCurrency(),
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
      toast("Account deleted", "Transactions remain in the ledger but the account record is removed.");
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
        currency: $("#asset-currency").value.toUpperCase() || selectedCurrency(),
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
      type: $("#category-type").value
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
      priority: $("#rule-priority").value,
      requireAll: $("#rule-require-all").value === "true"
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
      setLocalMarketApiKey($("#setting-market-key").value.trim());
      await saveSettings({
        primaryCurrency: $("#setting-currency").value.toUpperCase() || "EUR",
        theme: $("#setting-theme").value,
        motion: $("#setting-motion").value,
        marketProvider: $("#setting-market-provider").value,
        hideInternalTransfersInSpending: $("#setting-hide-transfers").value === "true"
      });
      setMessage($("#settings-message"), "Settings saved.");
      toast("Settings saved");
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
