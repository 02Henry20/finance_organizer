import {
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
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
  if (name === "rules") return items.sort((a, b) => String(a.categoryId || "").localeCompare(String(b.categoryId || "")) || Number(b.priority || 0) - Number(a.priority || 0) || String(a.label || "").localeCompare(String(b.label || "")));
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

  const settingsSnap = await getDoc(userDoc("settings", "preferences"));
  if (!settingsSnap.exists()) {
    await setDoc(userDoc("settings", "preferences"), {
      ...DEFAULT_SETTINGS,
      marketApiKeyLocalOnly: "",
      fxRates: { ...DEFAULT_SETTINGS.fxRates },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
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

  attachCollection("accounts", value => { state.accounts = value; });
  attachCollection("categories", value => { state.categories = value; });
  attachCollection("rules", value => { state.rules = value; });
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
    displayCurrency: input.displayCurrency ? String(input.displayCurrency).toUpperCase() : "",
    openingBalance: Number(input.openingBalance || 0),
    openingBalanceDate: input.openingBalanceDate || "",
    note: String(input.note || "").trim(),
    hidden: Boolean(input.hidden),
    iban: String(input.iban || "").replace(/\s+/g, "").toUpperCase(),
    accountNumber: String(input.accountNumber || "").trim(),
    bic: String(input.bic || "").replace(/\s+/g, "").toUpperCase(),
    transferAliases: Array.isArray(input.transferAliases)
      ? input.transferAliases.map(String).map(item => item.trim()).filter(Boolean)
      : String(input.transferAliases || "").split(",").map(item => item.trim()).filter(Boolean),
    referenceAccountId: String(input.referenceAccountId || ""),
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
    priority: Number(input.priority || 0),
    caseSensitive: Boolean(input.caseSensitive)
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
    internalTransfer: Boolean(input.internalTransfer),
    internalTransferRole: input.internalTransferRole || "",
    internalTransferGroupId: input.internalTransferGroupId || "",
    transferSourceAccountId: input.transferSourceAccountId || "",
    transferTargetAccountId: input.transferTargetAccountId || "",
    transferMatchedAccountId: input.transferMatchedAccountId || input.matchedAccountId || "",
    matchedAccountId: input.matchedAccountId || "",
    referenceFunding: Boolean(input.referenceFunding),
    referenceFundingRole: input.referenceFundingRole || "",
    referenceSourceAccountId: input.referenceSourceAccountId || "",
    referenceAccountId: input.referenceAccountId || "",
    referenceOriginalAmount: input.referenceOriginalAmount == null ? null : Number(input.referenceOriginalAmount),
    referenceCoveredAmount: input.referenceCoveredAmount == null ? null : Number(input.referenceCoveredAmount),
    referenceFundingGroupId: input.referenceFundingGroupId || "",
    fundingOriginalId: input.fundingOriginalId || "",
    excludeFromStats: input.categoryId === "cash" ? false : Boolean(input.excludeFromStats || input.ignoreFromStats || input.statsIgnored),
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
        excludeFromStats: tx.categoryId === "cash" ? false : Boolean(tx.excludeFromStats || tx.ignoreFromStats || tx.statsIgnored),
        internalTransfer: tx.categoryId === "cash" ? false : Boolean(tx.internalTransfer),
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
    buyPrice: Number(input.buyPrice || 0),
    startingPosition: input.startingPosition == null ? Boolean(existing?.startingPosition) : Boolean(input.startingPosition),
    startingAt: input.startingAt || existing?.startingAt || "",
    startingValue: input.startingValue == null ? Number(existing?.startingValue || 0) : Number(input.startingValue || 0),
    wkn: String(input.wkn || "").trim().toUpperCase(),
    isin: String(input.isin || "").trim().toUpperCase(),
    manualPrice: Number(input.manualPrice || 0),
    provider: (["stooq", "twelvedata"].includes(input.provider) ? "yahoo" : (input.provider || state.settings.marketProvider || "manual")),
    providerSymbol: input.providerSymbol == null ? String(existing?.providerSymbol || "").trim().toUpperCase() : String(input.providerSymbol || "").trim().toUpperCase(),
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


function convertQuotePriceToAssetCurrency(value, fromCurrency, toCurrency) {
  const amount = Number(value);
  const from = String(fromCurrency || toCurrency || state.settings.primaryCurrency || "EUR").toUpperCase();
  const to = String(toCurrency || from || state.settings.primaryCurrency || "EUR").toUpperCase();
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  const rates = { ...DEFAULT_SETTINGS.fxRates, ...(state.settings.fxRates || {}) };
  const fromRate = Number(rates[from]);
  const toRate = Number(rates[to]);
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) return amount;
  return amount * fromRate / toRate;
}

export async function updateAssetQuote(id, quote) {
  const existing = state.assets.find(asset => asset.id === id);
  const targetCurrency = String(existing?.currency || quote.currency || state.settings.primaryCurrency || "EUR").toUpperCase();
  const providerCurrency = String(quote.currency || targetCurrency).toUpperCase();
  const providerPrice = Number(quote.price);
  const convertedPrice = convertQuotePriceToAssetCurrency(providerPrice, providerCurrency, targetCurrency);
  await saveDoc("assets", id, {
    lastPrice: convertedPrice,
    lastPriceAt: quote.pulledAt || quote.time || new Date().toISOString(),
    lastQuotePriceAt: quote.priceTime || quote.datetime || quote.time || "",
    lastChangePercent: Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : null,
    lastProviderSymbol: quote.symbol || "",
    lastProviderPrice: Number.isFinite(providerPrice) ? providerPrice : null,
    lastProviderCurrency: providerCurrency,
    lastQuoteSource: quote.source || quote.provider || "",
    lastQuoteExchange: quote.exchange || "",
    lastQuoteMicCode: quote.micCode || "",
    currency: targetCurrency,
    provider: (["stooq", "twelvedata"].includes(quote.provider) ? "yahoo" : (quote.provider || existing?.provider || state.settings.marketProvider))
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
  if (!backup || typeof backup !== "object") throw new Error("The selected file is not a Capito JSON backup.");
  const collections = ["accounts", "categories", "rules", "transactions", "assets"];
  const hasAny = collections.some(name => Array.isArray(backup[name]));
  if (!hasAny) throw new Error("JSON backup is missing accounts, transactions, categories, rules and assets arrays.");

  setSync("loading", replace ? "Replacing data from JSON" : "Importing JSON backup", true);
  if (replace) {
    for (const name of collections) await deleteCollectionDocs(name);
  }

  const counts = {};
  const rowsByCollection = Object.fromEntries(collections.map(name => [name, Array.isArray(backup[name]) ? [...backup[name]] : []]));
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

async function readCollectionForRepair(name) {
  try {
    const snapshot = await getDocsFromServer(query(userCollection(name)));
    return { items: normalizeArray(name, snapshot.docs), source: "server" };
  } catch (error) {
    const snapshot = await getDocs(query(userCollection(name)));
    return { items: normalizeArray(name, snapshot.docs), source: browserOnline() ? `cache fallback (${error.message || "server unavailable"})` : "offline cache" };
  }
}

async function readSettingsForRepair() {
  try {
    const snapshot = await getDocFromServer(userDoc("settings", "preferences"));
    return { data: snapshot.exists() ? snapshot.data() : {}, source: "server" };
  } catch (error) {
    const snapshot = await getDoc(userDoc("settings", "preferences"));
    return { data: snapshot.exists() ? snapshot.data() : {}, source: browserOnline() ? `cache fallback (${error.message || "server unavailable"})` : "offline cache" };
  }
}


function mergeById(localItems = [], remoteItems = []) {
  const merged = new Map();
  const rank = item => Number(item?.clientUpdatedAtMs || item?.createdAtMs || item?.updatedAt?.seconds * 1000 || 0);
  for (const item of remoteItems || []) merged.set(item.id, item);
  for (const item of localItems || []) {
    const current = merged.get(item.id);
    if (!current || rank(item) >= rank(current)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

async function readServerCollectionStrict(name) {
  const snapshot = await getDocsFromServer(query(userCollection(name)));
  return normalizeArray(name, snapshot.docs);
}

async function readServerSettingsStrict() {
  const snapshot = await getDocFromServer(userDoc("settings", "preferences"));
  return snapshot.exists() ? snapshot.data() : {};
}

function localBackupSnapshot() {
  return {
    accounts: [...state.accounts],
    categories: [...state.categories],
    rules: [...state.rules],
    transactions: [...state.transactions],
    assets: [...state.assets],
    settings: { ...state.settings, marketApiKeyLocalOnly: "" }
  };
}

async function overwriteFirebaseFromSnapshot(snapshot) {
  const collections = ["accounts", "categories", "rules", "transactions", "assets"];
  for (const name of collections) await deleteCollectionDocs(name);
  for (const name of collections) await writeCollectionDocs(name, snapshot[name] || []);
  await saveDoc("settings", "preferences", {
    ...DEFAULT_SETTINGS,
    ...(snapshot.settings || {}),
    fxRates: { ...DEFAULT_SETTINGS.fxRates, ...((snapshot.settings || {}).fxRates || {}) },
    marketApiKeyLocalOnly: ""
  });
}

function applySnapshot(snapshot, sourceDetail = "Sync state updated") {
  state.accounts = normalizeArray("accounts", (snapshot.accounts || []).map(item => ({ id: item.id, data: () => item, metadata: {} })));
  state.categories = normalizeArray("categories", (snapshot.categories || []).map(item => ({ id: item.id, data: () => item, metadata: {} })));
  state.rules = normalizeArray("rules", (snapshot.rules || []).map(item => ({ id: item.id, data: () => item, metadata: {} })));
  state.transactions = normalizeArray("transactions", (snapshot.transactions || []).map(item => ({ id: item.id, data: () => item, metadata: {} })));
  state.assets = normalizeArray("assets", (snapshot.assets || []).map(item => ({ id: item.id, data: () => item, metadata: {} })));
  state.settings = mergeSettings(snapshot.settings || {});
  setSync("synced", sourceDetail);
  notify();
}

async function readFirebaseSnapshotStrict() {
  const [accounts, categories, rules, transactions, assets, settings] = await Promise.all([
    readServerCollectionStrict("accounts"),
    readServerCollectionStrict("categories"),
    readServerCollectionStrict("rules"),
    readServerCollectionStrict("transactions"),
    readServerCollectionStrict("assets"),
    readServerSettingsStrict()
  ]);
  return { accounts, categories, rules, transactions, assets, settings };
}

export async function resolveSyncConflict(mode) {
  if (!state.user?.uid) throw new Error("Sign in first before resolving sync.");
  const normalizedMode = String(mode || "").trim();
  if (!["local", "merge", "firebase"].includes(normalizedMode)) throw new Error("Choose keep local, merge both, or take Firebase.");

  setSync("loading", "Resolving sync state", true);

  if (normalizedMode === "local") {
    const local = localBackupSnapshot();
    await overwriteFirebaseFromSnapshot(local);
    setSync("synced", "Local data pushed to Firebase");
    notify();
    return {
      mode: "local",
      source: "local pushed to Firebase",
      counts: {
        accounts: local.accounts.length,
        categories: local.categories.length,
        rules: local.rules.length,
        transactions: local.transactions.length,
        holdings: local.assets.length
      }
    };
  }

  const remote = await readFirebaseSnapshotStrict();

  if (normalizedMode === "firebase") {
    applySnapshot(remote, "Firebase data loaded locally");
    return {
      mode: "firebase",
      source: "firebase",
      counts: {
        accounts: remote.accounts.length,
        categories: remote.categories.length,
        rules: remote.rules.length,
        transactions: remote.transactions.length,
        holdings: remote.assets.length
      }
    };
  }

  const local = localBackupSnapshot();
  const merged = {
    accounts: mergeById(local.accounts, remote.accounts),
    categories: mergeById(local.categories, remote.categories),
    rules: mergeById(local.rules, remote.rules),
    transactions: mergeById(local.transactions, remote.transactions),
    assets: mergeById(local.assets, remote.assets),
    settings: { ...DEFAULT_SETTINGS, ...remote.settings, ...local.settings, fxRates: { ...DEFAULT_SETTINGS.fxRates, ...(remote.settings?.fxRates || {}), ...(local.settings?.fxRates || {}) }, marketApiKeyLocalOnly: "" }
  };
  await overwriteFirebaseFromSnapshot(merged);
  applySnapshot(merged, "Local and Firebase data merged");
  return {
    mode: "merge",
    source: "merged local + firebase",
    counts: {
      accounts: merged.accounts.length,
      categories: merged.categories.length,
      rules: merged.rules.length,
      transactions: merged.transactions.length,
      holdings: merged.assets.length
    }
  };
}


export async function repairSync() {
  if (!state.user?.uid) throw new Error("Sign in first before checking sync.");
  setSync("loading", "Checking Firebase and local cache", true);
  try {
    const [accounts, categories, rules, transactions, assets, settings] = await Promise.all([
      readCollectionForRepair("accounts"),
      readCollectionForRepair("categories"),
      readCollectionForRepair("rules"),
      readCollectionForRepair("transactions"),
      readCollectionForRepair("assets"),
      readSettingsForRepair()
    ]);
    state.accounts = accounts.items;
    state.categories = categories.items;
    state.rules = rules.items;
    state.transactions = transactions.items;
    state.assets = assets.items;
    state.settings = mergeSettings(settings.data);
    const sources = [accounts, categories, rules, transactions, assets, settings].map(item => item.source);
    const fromServer = sources.every(source => source === "server");
    const counts = {
      accounts: state.accounts.length,
      categories: state.categories.length,
      rules: state.rules.length,
      transactions: state.transactions.length,
      holdings: state.assets.length
    };
    setSync(fromServer ? "synced" : "offline", fromServer ? "Sync check complete" : "Used offline cache / server fallback");
    notify();
    return { source: fromServer ? "server" : [...new Set(sources)].join(" | "), counts };
  } catch (error) {
    setSync("error", error.message || "Sync check failed");
    throw error;
  }
}

export async function deleteAllData() {
  const collections = ["transactions", "assets", "rules", "categories", "accounts"];
  setSync("loading", "Deleting all data", true);
  for (const name of collections) await deleteCollectionDocs(name);
  await deleteDoc(userDoc("settings", "preferences")).catch(() => undefined);
  await deleteDoc(userDoc("meta", "seed")).catch(() => undefined);
  state.accounts = [];
  state.categories = [];
  state.rules = [];
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
