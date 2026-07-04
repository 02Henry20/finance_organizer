import {
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "./firebase.js";
import { fetchLatestFxRates } from "./market.js";
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_CATEGORIES,
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  sortByDateDesc,
  uid
} from "./finance.js";

const APP_PATH = ["apps", "finance-organizer", "users"];
const LOCAL_SETTINGS_KEY = "vaultpilot-local-settings-v1";

export const state = {
  user: null,
  accounts: [],
  categories: [],
  rules: [],
  transactions: [],
  assets: [],
  settings: { ...DEFAULT_SETTINGS },
  sync: { status: "idle", detail: "Not signed in", pending: false, lastChangeAt: null }
};

const listeners = new Set();
let unsubscribers = [];
let hasSeeded = false;
let snapshotsReady = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener(state);
}

function setSync(status, detail, pending = false) {
  state.sync = { status, detail, pending, lastChangeAt: new Date().toISOString() };
  notify();
}

function browserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function updateSyncFromSnapshot(name, snapshot) {
  snapshotsReady.add(name);
  const pending = snapshot.metadata?.hasPendingWrites || false;
  const fromCache = snapshot.metadata?.fromCache || false;
  state.sync.pending = pending;
  if (!browserOnline()) {
    state.sync.status = "offline";
    state.sync.detail = "Offline cache";
  } else if (pending) {
    state.sync.status = "loading";
    state.sync.detail = "Saving local changes";
  } else {
    state.sync.status = "synced";
    state.sync.detail = "";
  }
  state.sync.lastChangeAt = new Date().toISOString();
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setSync("loading", "Connection restored; syncing"));
  window.addEventListener("offline", () => setSync("offline", "Offline cache"));
}

function userCollection(name) {
  if (!state.user?.uid) throw new Error("No signed-in user.");
  return collection(db, ...APP_PATH, state.user.uid, name);
}

function userDoc(collectionName, id) {
  if (!state.user?.uid) throw new Error("No signed-in user.");
  return doc(db, ...APP_PATH, state.user.uid, collectionName, id);
}

function normalizeDoc(snapshot) {
  const data = snapshot.data() || {};
  return { id: snapshot.id, ...data, pending: snapshot.metadata?.hasPendingWrites || false };
}

function normalizeArray(name, docs) {
  const items = docs.map(normalizeDoc);
  if (name === "transactions") return sortByDateDesc(items);
  if (name === "accounts") return items.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || String(a.name).localeCompare(String(b.name)));
  if (name === "categories") return items.sort((a, b) => String(a.group).localeCompare(String(b.group)) || String(a.name).localeCompare(String(b.name)));
  if (name === "rules") return items.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  if (name === "assets") return items.sort((a, b) => String(a.name || a.symbol).localeCompare(String(b.name || b.symbol)));
  return items;
}

function readLocalSettings() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeLocalSettings(patch) {
  try {
    const current = readLocalSettings();
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Non-critical. API keys are optional and deliberately local only.
  }
}

export function getLocalMarketApiKey() {
  return readLocalSettings().marketApiKeyLocalOnly || "";
}

export function setLocalMarketApiKey(apiKey) {
  writeLocalSettings({ marketApiKeyLocalOnly: apiKey || "" });
  state.settings.marketApiKeyLocalOnly = apiKey || "";
  notify();
}

function mergeSettings(cloud = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...cloud,
    fxRates: { ...DEFAULT_SETTINGS.fxRates, ...(cloud.fxRates || {}) },
    marketApiKeyLocalOnly: getLocalMarketApiKey()
  };
}

async function ensureDefaults() {
  if (!state.user?.uid || hasSeeded) return;
  hasSeeded = true;

  const [accountsSnap, categoriesSnap, rulesSnap, settingsSnap] = await Promise.all([
    getDocs(query(userCollection("accounts"))),
    getDocs(query(userCollection("categories"))),
    getDocs(query(userCollection("rules"))),
    getDoc(userDoc("settings", "preferences"))
  ]);

  const existingAccounts = new Set(accountsSnap.docs.map(item => item.id));
  const existingCategories = new Set(categoriesSnap.docs.map(item => item.id));
  const existingRules = new Set(rulesSnap.docs.map(item => item.id));
  const currentSettings = settingsSnap.exists() ? settingsSnap.data() : {};

  const batch = writeBatch(db);
  DEFAULT_ACCOUNTS.forEach((account, index) => {
    if (!existingAccounts.has(account.id)) {
      batch.set(userDoc("accounts", account.id), {
        ...account,
        sort: index,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  });
  DEFAULT_CATEGORIES.forEach(category => {
    const payload = {
      ...category,
      isDefault: true,
      updatedAt: serverTimestamp()
    };
    if (!existingCategories.has(category.id)) payload.createdAt = serverTimestamp();
    batch.set(userDoc("categories", category.id), payload, { merge: true });
  });
  DEFAULT_RULES.forEach(rule => {
    const payload = {
      ...rule,
      updatedAt: serverTimestamp()
    };
    if (!existingRules.has(rule.id)) payload.createdAt = serverTimestamp();
    batch.set(userDoc("rules", rule.id), payload, { merge: true });
  });
  batch.set(userDoc("settings", "preferences"), {
    ...DEFAULT_SETTINGS,
    ...currentSettings,
    fxRates: { ...DEFAULT_SETTINGS.fxRates, ...(currentSettings.fxRates || {}) },
    marketApiKeyLocalOnly: "",
    updatedAt: serverTimestamp()
  }, { merge: true });
  batch.set(userDoc("meta", "seed"), { version: 2, updatedAt: serverTimestamp(), createdAt: currentSettings.seededAt || serverTimestamp() }, { merge: true });
  await batch.commit();
}

export async function connectUser(user) {
  disconnectUser();
  state.user = user;
  state.accounts = [];
  state.categories = [];
  state.rules = [];
  state.transactions = [];
  state.assets = [];
  state.settings = { ...DEFAULT_SETTINGS, marketApiKeyLocalOnly: getLocalMarketApiKey() };
  hasSeeded = false;
  snapshotsReady = new Set();
  setSync("loading", "Preparing your workspace");

  await ensureDefaults();
  const attachCollection = (name, setter) => {
    const unsubscribe = onSnapshot(query(userCollection(name)), { includeMetadataChanges: true }, snapshot => {
      setter(normalizeArray(name, snapshot.docs));
      updateSyncFromSnapshot(name, snapshot);
    }, error => {
      setSync("error", error.message || "Firebase listener failed");
    });
    unsubscribers.push(unsubscribe);
  };

  attachCollection("accounts", value => { state.accounts = value.length ? value : [...DEFAULT_ACCOUNTS]; });
  attachCollection("categories", value => { state.categories = value.length ? value : [...DEFAULT_CATEGORIES]; });
  attachCollection("rules", value => { state.rules = value.length ? value : [...DEFAULT_RULES]; });
  attachCollection("transactions", value => { state.transactions = value; });
  attachCollection("assets", value => { state.assets = value; });

  const settingsUnsub = onSnapshot(userDoc("settings", "preferences"), { includeMetadataChanges: true }, snapshot => {
    state.settings = mergeSettings(snapshot.exists() ? snapshot.data() : {});
    updateSyncFromSnapshot("settings", snapshot);
  }, error => setSync("error", error.message || "Settings listener failed"));
  unsubscribers.push(settingsUnsub);
}

export function disconnectUser() {
  unsubscribers.forEach(unsubscribe => unsubscribe());
  unsubscribers = [];
  hasSeeded = false;
  snapshotsReady = new Set();
  state.user = null;
  state.accounts = [];
  state.categories = [];
  state.rules = [];
  state.transactions = [];
  state.assets = [];
  state.settings = { ...DEFAULT_SETTINGS, marketApiKeyLocalOnly: getLocalMarketApiKey() };
  state.sync = { status: "idle", detail: "Not signed in", pending: false, lastChangeAt: null };
  notify();
}

async function saveDoc(collectionName, id, data) {
  const now = Date.now();
  await setDoc(userDoc(collectionName, id), {
    ...data,
    clientUpdatedAtMs: now,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function saveAccount(input) {
  const id = input.id || uid();
  await saveDoc("accounts", id, {
    id,
    name: input.name?.trim() || "Unnamed account",
    institution: input.institution?.trim() || "Manual",
    type: input.type || "checking",
    currency: (input.currency || state.settings.primaryCurrency || "EUR").toUpperCase(),
    openingBalance: Number(input.openingBalance || 0),
    hidden: Boolean(input.hidden),
    iban: String(input.iban || "").replace(/\s+/g, "").toUpperCase(),
    accountNumber: String(input.accountNumber || "").trim(),
    bic: String(input.bic || "").replace(/\s+/g, "").toUpperCase(),
    transferAliases: Array.isArray(input.transferAliases)
      ? input.transferAliases.map(String).map(item => item.trim()).filter(Boolean)
      : String(input.transferAliases || "").split(",").map(item => item.trim()).filter(Boolean),
    sort: Number(input.sort || Date.now())
  });
  return id;
}

export async function deleteAccount(id, { hideOnly = true } = {}) {
  if (hideOnly) return updateDoc(userDoc("accounts", id), { hidden: true, updatedAt: serverTimestamp() });
  await deleteDoc(userDoc("accounts", id));
}

export async function saveCategory(input) {
  const id = input.id || `cat_${uid().slice(0, 8)}`;
  await saveDoc("categories", id, {
    id,
    name: input.name?.trim() || "New category",
    group: input.group?.trim() || "Custom",
    type: input.type || "expense",
    icon: input.icon || "•",
    color: /^#[0-9a-f]{6}$/i.test(String(input.color || "")) ? String(input.color).toUpperCase() : "#3B82F6",
    isDefault: Boolean(input.isDefault)
  });
  return id;
}

export async function saveRule(input) {
  const id = input.id || `rule_${uid().slice(0, 8)}`;
  const keywords = Array.isArray(input.keywords)
    ? input.keywords.map(String).map(s => s.trim()).filter(Boolean)
    : String(input.keywords || "").split(",").map(s => s.trim()).filter(Boolean);
  await saveDoc("rules", id, {
    id,
    label: input.label?.trim() || keywords.join(" + ") || "New rule",
    categoryId: input.categoryId || "misc",
    keywords,
    requireAll: Boolean(input.requireAll),
    priority: Number(input.priority || 50)
  });
  return id;
}

export async function deleteRule(id) {
  await deleteDoc(userDoc("rules", id));
}

export async function saveTransaction(input) {
  const id = input.id || uid();
  await saveDoc("transactions", id, {
    id,
    accountId: input.accountId,
    date: input.date,
    amount: Number(input.amount || 0),
    currency: (input.currency || state.settings.primaryCurrency || "EUR").toUpperCase(),
    description: input.description?.trim() || "Manual entry",
    counterparty: input.counterparty?.trim() || "",
    categoryId: input.categoryId || "misc",
    note: input.note?.trim() || "",
    source: input.source || "manual",
    externalId: input.externalId || "",
    importBatchId: input.importBatchId || "",
    review: Boolean(input.review),
    confidence: Number(input.confidence ?? 1),
    reason: input.reason || "",
    candidates: input.candidates || [],
    rawText: input.rawText || "",
    raw: input.raw || null,
    createdAtMs: input.createdAtMs || Date.now()
  });
  return id;
}

export async function saveTransactionsBatch(transactions) {
  if (!transactions.length) return { imported: 0 };
  let imported = 0;
  for (let index = 0; index < transactions.length; index += 400) {
    const batch = writeBatch(db);
    for (const tx of transactions.slice(index, index + 400)) {
      const id = tx.id || uid();
      imported += 1;
      batch.set(userDoc("transactions", id), {
        ...tx,
        id,
        amount: Number(tx.amount || 0),
        currency: (tx.currency || state.settings.primaryCurrency || "EUR").toUpperCase(),
        clientUpdatedAtMs: Date.now(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
  }
  return { imported };
}

export async function deleteTransaction(id) {
  await deleteDoc(userDoc("transactions", id));
}

export async function saveAsset(input) {
  const id = input.id || uid();
  const existing = state.assets.find(asset => asset.id === id);
  await saveDoc("assets", id, {
    id,
    symbol: String(input.symbol || "").trim().toUpperCase(),
    name: input.name?.trim() || String(input.symbol || "Asset").toUpperCase(),
    type: input.type || "stock",
    quantity: Number(input.quantity || 0),
    currency: (input.currency || state.settings.primaryCurrency || "EUR").toUpperCase(),
    costBasis: Number(input.costBasis || 0),
    manualPrice: Number(input.manualPrice || 0),
    provider: input.provider || state.settings.marketProvider || "manual",
    accountId: input.accountId || "",
    hidden: Boolean(input.hidden),
    createdAtMs: existing?.createdAtMs || input.createdAtMs || Date.now(),
    lastPrice: input.lastPrice == null ? null : Number(input.lastPrice),
    lastPriceAt: input.lastPriceAt || "",
    lastChangePercent: input.lastChangePercent == null ? null : Number(input.lastChangePercent)
  });
  return id;
}

export async function deleteAsset(id) {
  await deleteDoc(userDoc("assets", id));
}

export async function updateAssetQuote(id, quote) {
  await saveDoc("assets", id, {
    lastPrice: Number(quote.price),
    lastPriceAt: quote.time || new Date().toISOString(),
    lastChangePercent: Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : null,
    currency: quote.currency || state.assets.find(asset => asset.id === id)?.currency || state.settings.primaryCurrency,
    provider: quote.provider || state.assets.find(asset => asset.id === id)?.provider || state.settings.marketProvider
  });
}

export async function saveSettings(patch) {
  const cloudPatch = { ...patch };
  delete cloudPatch.marketApiKeyLocalOnly;
  if (patch.marketApiKeyLocalOnly != null) setLocalMarketApiKey(patch.marketApiKeyLocalOnly);
  await saveDoc("settings", "preferences", {
    ...state.settings,
    ...cloudPatch,
    marketApiKeyLocalOnly: ""
  });
}


export async function refreshFxRates({ silent = false } = {}) {
  const currencies = new Set([state.settings.primaryCurrency || "EUR"]);
  state.accounts.forEach(account => currencies.add(account.currency || "EUR"));
  state.assets.forEach(asset => currencies.add(asset.currency || "EUR"));
  if (!silent) setSync("loading", "Refreshing exchange rates");
  const result = await fetchLatestFxRates([...currencies]);
  await saveSettings({
    fxRates: { ...(state.settings.fxRates || {}), ...result.rates },
    fxLastUpdatedAt: result.time,
    fxSource: result.source
  });
  return result;
}



function sanitizeForFirestore(value) {
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (["pending", "updatedAt", "createdAt"].includes(key)) continue;
      if (typeof item === "undefined") continue;
      out[key] = sanitizeForFirestore(item);
    }
    return out;
  }
  return value;
}

async function deleteCollectionDocs(name) {
  const snapshot = await getDocs(query(userCollection(name)));
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    const batch = writeBatch(db);
    snapshot.docs.slice(index, index + 400).forEach(item => batch.delete(userDoc(name, item.id)));
    await batch.commit();
  }
}

async function writeCollectionDocs(name, rows = []) {
  let count = 0;
  const cleanRows = Array.isArray(rows) ? rows : [];
  for (let index = 0; index < cleanRows.length; index += 400) {
    const batch = writeBatch(db);
    for (const row of cleanRows.slice(index, index + 400)) {
      const id = String(row.id || uid());
      batch.set(userDoc(name, id), {
        ...sanitizeForFirestore(row),
        id,
        clientUpdatedAtMs: Date.now(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      count += 1;
    }
    await batch.commit();
  }
  return count;
}

export async function importStateBackup(backup, { replace = false } = {}) {
  if (!backup || typeof backup !== "object") throw new Error("The selected file is not a VaultPilot JSON backup.");
  const collections = ["accounts", "categories", "rules", "transactions", "assets"];
  const hasAny = collections.some(name => Array.isArray(backup[name]));
  if (!hasAny) throw new Error("JSON backup is missing accounts, transactions, categories, rules and assets arrays.");

  setSync("loading", replace ? "Replacing data from JSON" : "Importing JSON backup", true);
  if (replace) {
    for (const name of collections) await deleteCollectionDocs(name);
  }

  const counts = {};
  for (const name of collections) counts[name] = await writeCollectionDocs(name, backup[name] || []);

  if (backup.settings && typeof backup.settings === "object") {
    const settings = sanitizeForFirestore({ ...backup.settings, marketApiKeyLocalOnly: "" });
    await saveDoc("settings", "preferences", {
      ...DEFAULT_SETTINGS,
      ...settings,
      fxRates: { ...DEFAULT_SETTINGS.fxRates, ...(settings.fxRates || {}) },
      marketApiKeyLocalOnly: ""
    });
    counts.settings = 1;
  } else {
    counts.settings = 0;
  }
  setSync("synced", "JSON import complete");
  return counts;
}

export async function exportState() {
  return {
    format: "vaultpilot-export-v1",
    exportedAt: new Date().toISOString(),
    user: state.user ? { uid: state.user.uid, email: state.user.email || "" } : null,
    settings: { ...state.settings, marketApiKeyLocalOnly: "" },
    accounts: state.accounts,
    categories: state.categories,
    rules: state.rules,
    transactions: state.transactions,
    assets: state.assets
  };
}
