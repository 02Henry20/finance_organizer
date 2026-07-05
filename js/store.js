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
const LOCAL_SETTINGS_KEY = "capito-local-settings-v1";

export const state = {
  user: null,
  accounts: [],
  categories: [],
  rules: [],
  transactions: [],
  assets: [],
  settings: { ...DEFAULT_SETTINGS },
  sync: { status: "idle", detail: "Not signed in", pending: false, lastChangeAt: null },
  tutorial: { active: false }
};

const listeners = new Set();
let unsubscribers = [];
let hasSeeded = false;
let snapshotsReady = new Set();
let tutorialSnapshot = null;
let tutorialUser = null;

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

function sortCollectionItems(name, items) {
  const list = [...items];
  if (name === "transactions") return sortByDateDesc(list);
  if (name === "accounts") return list.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || String(a.name).localeCompare(String(b.name)));
  if (name === "categories") return list.sort((a, b) => String(a.group).localeCompare(String(b.group)) || String(a.name).localeCompare(String(b.name)));
  if (name === "rules") return list.sort((a, b) => String(a.categoryId || "").localeCompare(String(b.categoryId || "")) || String(a.label || "").localeCompare(String(b.label || "")));
  if (name === "assets") return list.sort((a, b) => String(a.name || a.symbol).localeCompare(String(b.name || b.symbol)));
  return list;
}

function normalizeArray(name, docs) {
  return sortCollectionItems(name, docs.map(normalizeDoc));
}

function setTutorialSync(detail = "Tutorial mode") {
  state.sync = { status: "tutorial", detail, pending: false, lastChangeAt: new Date().toISOString() };
}

function cloneStateSnapshot() {
  return JSON.parse(JSON.stringify({
    accounts: state.accounts,
    categories: state.categories,
    rules: state.rules,
    transactions: state.transactions,
    assets: state.assets,
    settings: state.settings,
    sync: state.sync
  }));
}

function applyLocalDataset(data = {}) {
  state.accounts = sortCollectionItems("accounts", Array.isArray(data.accounts) ? data.accounts : []);
  state.categories = sortCollectionItems("categories", Array.isArray(data.categories) && data.categories.length ? data.categories : [...DEFAULT_CATEGORIES]);
  if (!state.categories.some(item => item.id === "misc")) {
    const misc = DEFAULT_CATEGORIES.find(item => item.id === "misc");
    if (misc) state.categories.push(misc);
    state.categories = sortCollectionItems("categories", state.categories);
  }
  state.rules = sortCollectionItems("rules", Array.isArray(data.rules) ? data.rules : [...DEFAULT_RULES]);
  state.transactions = sortCollectionItems("transactions", Array.isArray(data.transactions) ? data.transactions : []);
  state.assets = sortCollectionItems("assets", Array.isArray(data.assets) ? data.assets : []);
  state.settings = mergeSettings(data.settings || {});
  state.tutorial = { active: true };
  setTutorialSync("Tutorial mode | local test data");
  notify();
}

function localUpsert(collectionName, item) {
  state[collectionName] = sortCollectionItems(collectionName, [...state[collectionName].filter(entry => entry.id !== item.id), item]);
  setTutorialSync("Tutorial mode | changes stay local");
  notify();
}

function localDelete(collectionName, id) {
  state[collectionName] = sortCollectionItems(collectionName, state[collectionName].filter(entry => entry.id !== id));
  setTutorialSync("Tutorial mode | changes stay local");
  notify();
}

export function isTutorialMode() {
  return Boolean(state.tutorial?.active);
}

export async function enterTutorialMode(dataset = {}) {
  if (state.tutorial?.active) {
    applyLocalDataset(dataset);
    return { started: true, restarted: true };
  }
  tutorialSnapshot = cloneStateSnapshot();
  tutorialUser = state.user || null;
  unsubscribers.forEach(unsubscribe => unsubscribe());
  unsubscribers = [];
  hasSeeded = false;
  snapshotsReady = new Set();
  applyLocalDataset(dataset);
  return { started: true };
}

export async function exitTutorialMode() {
  if (!state.tutorial?.active) return { restored: false };
  const backup = tutorialSnapshot ? JSON.parse(JSON.stringify(tutorialSnapshot)) : null;
  state.tutorial = { active: false };
  tutorialSnapshot = null;
  if (backup) {
    state.accounts = backup.accounts || [];
    state.categories = backup.categories || [...DEFAULT_CATEGORIES];
    state.rules = backup.rules || [...DEFAULT_RULES];
    state.transactions = backup.transactions || [];
    state.assets = backup.assets || [];
    state.settings = mergeSettings(backup.settings || {});
    state.sync = backup.sync || { status: "idle", detail: "Not signed in", pending: false, lastChangeAt: null };
    notify();
  }
  const user = tutorialUser;
  tutorialUser = null;
  if (user) {
    await connectUser(user);
    return { restored: true, reconnected: true };
  }
  return { restored: true, reconnected: false };
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
  const payload = {
    id,
    name: input.name?.trim() || "Unnamed account",
    institution: input.institution?.trim() || "Manual",
    type: input.type || "checking",
    currency: (input.currency || state.settings.primaryCurrency || "EUR").toUpperCase(),
    openingBalance: Number(input.openingBalance || 0),
    hidden: Boolean(input.hidden),
    iban: String(input.iban || "").replace(/s+/g, "").toUpperCase(),
    accountNumber: String(input.accountNumber || "").trim(),
    bic: String(input.bic || "").replace(/s+/g, "").toUpperCase(),
    transferAliases: Array.isArray(input.transferAliases)
      ? input.transferAliases.map(String).map(item => item.trim()).filter(Boolean)
      : String(input.transferAliases || "").split(",").map(item => item.trim()).filter(Boolean),
    sort: Number(input.sort || Date.now())
  };
  if (state.tutorial?.active) {
    localUpsert("accounts", payload);
    return id;
  }
  await saveDoc("accounts", id, payload);
  return id;
}

export async function deleteAccount(id, { hideOnly = true } = {}) {
  if (state.tutorial?.active) {
    if (hideOnly) {
      const current = state.accounts.find(item => item.id === id);
      if (current) localUpsert("accounts", { ...current, hidden: true });
      return;
    }
    localDelete("accounts", id);
    return;
  }
  if (hideOnly) return updateDoc(userDoc("accounts", id), { hidden: true, updatedAt: serverTimestamp() });
  await deleteDoc(userDoc("accounts", id));
}

export async function saveCategory(input) {
  const id = input.id || `cat_${uid().slice(0, 8)}`;
  const payload = {
    id,
    name: input.name?.trim() || "New category",
    group: input.group?.trim() || "Custom",
    type: input.type || "expense",
    icon: input.icon || "•",
    color: /^#[0-9a-f]{6}$/i.test(String(input.color || "")) ? String(input.color).toUpperCase() : "#3B82F6",
    isDefault: Boolean(input.isDefault)
  };
  if (state.tutorial?.active) {
    localUpsert("categories", payload);
    return id;
  }
  await saveDoc("categories", id, payload);
  return id;
}

export async function saveRule(input) {
  const id = input.id || `rule_${uid().slice(0, 8)}`;
  const keywords = Array.isArray(input.keywords)
    ? input.keywords.map(String).map(s => s.trim()).filter(Boolean)
    : String(input.keywords || "").split(",").map(s => s.trim()).filter(Boolean);
  const payload = {
    id,
    label: input.label?.trim() || keywords.join(" + ") || "New rule",
    categoryId: input.categoryId || "misc",
    keywords,
    caseSensitive: Boolean(input.caseSensitive)
  };
  if (state.tutorial?.active) {
    localUpsert("rules", payload);
    return id;
  }
  await saveDoc("rules", id, payload);
  return id;
}

export async function deleteRule(id) {
  if (state.tutorial?.active) {
    localDelete("rules", id);
    return;
  }
  await deleteDoc(userDoc("rules", id));
}

export async function saveTransaction(input) {
  const id = input.id || uid();
  const payload = {
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
  };
  if (state.tutorial?.active) {
    localUpsert("transactions", payload);
    return id;
  }
  await saveDoc("transactions", id, payload);
  return id;
}

export async function saveTransactionsBatch(transactions) {
  if (!transactions.length) return { imported: 0 };
  if (state.tutorial?.active) {
    const mapped = transactions.map(tx => ({
      ...tx,
      id: tx.id || uid(),
      amount: Number(tx.amount || 0),
      currency: (tx.currency || state.settings.primaryCurrency || "EUR").toUpperCase()
    }));
    state.transactions = sortCollectionItems("transactions", [...state.transactions.filter(tx => !mapped.some(next => next.id === tx.id)), ...mapped]);
    setTutorialSync("Tutorial mode | changes stay local");
    notify();
    return { imported: mapped.length };
  }
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
  if (state.tutorial?.active) {
    localDelete("transactions", id);
    return;
  }
  await deleteDoc(userDoc("transactions", id));
}

export async function saveAsset(input) {
  const id = input.id || uid();
  const existing = state.assets.find(asset => asset.id === id);
  const payload = {
    id,
    symbol: String(input.symbol || "").trim().toUpperCase(),
    name: input.name?.trim() || String(input.symbol || "Asset").toUpperCase(),
    type: input.type || "stock",
    quantity: Number(input.quantity || 0),
    currency: (input.currency || state.settings.primaryCurrency || "EUR").toUpperCase(),
    costBasis: Number(input.costBasis || 0),
    buyPrice: Number(input.buyPrice || 0),
    wkn: String(input.wkn || "").trim().toUpperCase(),
    isin: String(input.isin || "").trim().toUpperCase(),
    manualPrice: Number(input.manualPrice || 0),
    provider: input.provider || state.settings.marketProvider || "manual",
    accountId: input.accountId || "",
    hidden: Boolean(input.hidden),
    createdAtMs: existing?.createdAtMs || input.createdAtMs || Date.now(),
    lastPrice: input.lastPrice == null ? null : Number(input.lastPrice),
    lastPriceAt: input.lastPriceAt || "",
    lastChangePercent: input.lastChangePercent == null ? null : Number(input.lastChangePercent)
  };
  if (state.tutorial?.active) {
    localUpsert("assets", payload);
    return id;
  }
  await saveDoc("assets", id, payload);
  return id;
}

export async function deleteAsset(id) {
  if (state.tutorial?.active) {
    localDelete("assets", id);
    return;
  }
  await deleteDoc(userDoc("assets", id));
}

export async function updateAssetQuote(id, quote) {
  if (state.tutorial?.active) {
    const current = state.assets.find(asset => asset.id === id) || { id };
    localUpsert("assets", {
      ...current,
      lastPrice: Number(quote.price),
      lastPriceAt: quote.time || new Date().toISOString(),
      lastChangePercent: Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : null,
      currency: quote.currency || current.currency || state.settings.primaryCurrency,
      provider: quote.provider || current.provider || state.settings.marketProvider
    });
    return;
  }
  await saveDoc("assets", id, {
    lastPrice: Number(quote.price),
    lastPriceAt: quote.time || new Date().toISOString(),
    lastChangePercent: Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : null,
    currency: quote.currency || state.assets.find(asset => asset.id === id)?.currency || state.settings.primaryCurrency,
    provider: quote.provider || state.assets.find(asset => asset.id === id)?.provider || state.settings.marketProvider
  });
}

export async function saveSettings(patch) {
  if (patch.marketApiKeyLocalOnly != null) setLocalMarketApiKey(patch.marketApiKeyLocalOnly);
  if (state.tutorial?.active) {
    state.settings = mergeSettings({ ...state.settings, ...patch, marketApiKeyLocalOnly: getLocalMarketApiKey() });
    setTutorialSync("Tutorial mode | settings stay local");
    notify();
    return;
  }
  const cloudPatch = { ...patch };
  delete cloudPatch.marketApiKeyLocalOnly;
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
  if (!silent && !state.tutorial?.active) setSync("loading", "Refreshing exchange rates");
  const result = await fetchLatestFxRates([...currencies]);
  if (state.tutorial?.active) {
    state.settings = mergeSettings({
      ...state.settings,
      fxRates: { ...(state.settings.fxRates || {}), ...result.rates },
      fxLastUpdatedAt: result.time,
      fxSource: result.source
    });
    setTutorialSync("Tutorial mode | exchange rates refreshed locally");
    notify();
    return result;
  }
  await saveSettings({
    fxRates: { ...(state.settings.fxRates || {}), ...result.rates },
    fxLastUpdatedAt: result.time,
    fxSource: result.source
  });
  return result;
}


function sanitizeForFirestorefunction sanitizeForFirestore(value) {
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
  if (!backup || typeof backup !== "object") throw new Error("The selected file is not a Capito JSON backup.");
  const collections = ["accounts", "categories", "rules", "transactions", "assets"];
  const hasAny = collections.some(name => Array.isArray(backup[name]));
  if (!hasAny) throw new Error("JSON backup is missing accounts, transactions, categories, rules and assets arrays.");

  if (state.tutorial?.active) {
    const rowsByCollection = Object.fromEntries(collections.map(name => [name, Array.isArray(backup[name]) ? [...backup[name]] : []]));
    if (!rowsByCollection.categories.some(category => category.id === "misc")) {
      const misc = DEFAULT_CATEGORIES.find(category => category.id === "misc");
      if (misc) rowsByCollection.categories.push(misc);
    }
    applyLocalDataset({ ...rowsByCollection, settings: backup.settings || state.settings });
    return Object.fromEntries(collections.map(name => [name, rowsByCollection[name].length]).concat([["settings", backup.settings ? 1 : 0]]));
  }

  setSync("loading", replace ? "Replacing data from JSON" : "Importing JSON backup", true);
  if (replace) {
    for (const name of collections) await deleteCollectionDocs(name);
  }

  const counts = {};
  const rowsByCollection = Object.fromEntries(collections.map(name => [name, Array.isArray(backup[name]) ? [...backup[name]] : []]));
  if (!rowsByCollection.categories.some(category => category.id === "misc")) {
    const misc = DEFAULT_CATEGORIES.find(category => category.id === "misc");
    if (misc) rowsByCollection.categories.push(misc);
  }
  for (const name of collections) counts[name] = await writeCollectionDocs(name, rowsByCollection[name]);

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

export async function deleteAllData() {
  if (state.tutorial?.active) {
    state.accounts = [];
    state.categories = [...DEFAULT_CATEGORIES];
    state.rules = [...DEFAULT_RULES];
    state.transactions = [];
    state.assets = [];
    state.settings = { ...DEFAULT_SETTINGS, marketApiKeyLocalOnly: getLocalMarketApiKey() };
    setTutorialSync("Tutorial mode | local data cleared");
    notify();
    return { deleted: true };
  }
  const collections = ["transactions", "assets", "rules", "categories", "accounts"];
  setSync("loading", "Deleting all data", true);
  for (const name of collections) await deleteCollectionDocs(name);
  await deleteDoc(userDoc("settings", "preferences")).catch(() => undefined);
  await deleteDoc(userDoc("meta", "seed")).catch(() => undefined);
  state.accounts = [];
  state.categories = [...DEFAULT_CATEGORIES];
  state.rules = [...DEFAULT_RULES];
  state.transactions = [];
  state.assets = [];
  state.settings = { ...DEFAULT_SETTINGS, marketApiKeyLocalOnly: getLocalMarketApiKey() };
  setSync("synced", "All data deleted");
  notify();
  return { deleted: true };
}

export async function exportState() {
  return {
    format: "capito-export-v1",
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
