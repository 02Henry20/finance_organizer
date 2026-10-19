import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as finance from "../js/finance.js";

export function appFunction(name, globals = {}) {
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const match = source.match(new RegExp(`^((?:async )?function ${name}\\([^]*?^})`, "m"));
  if (!match) throw new Error(`Missing app function ${name}`);
  return vm.runInNewContext(`(${match[1]})`, { ...finance, ...globals });
}

export function mockStore(overrides = {}) {
  const writes = [];
  const subscriptions = [];
  const globals = {
    ...finance, console,
    navigator: { onLine: true },
    localStorage: { getItem: () => null, setItem() {} },
    db: {}, collection: (_db, ...path) => path.join("/"), doc: (_db, ...path) => path.join("/"), query: ref => ref,
    getDoc: async () => ({ exists: () => true, data: () => ({}) }),
    getDocs: async () => ({ docs: [] }),
    getDocFromServer: async () => ({ exists: () => true, data: () => ({}) }),
    getDocsFromServer: async () => ({ docs: [] }),
    onSnapshot(ref, _options, next, error) {
      const subscription = { ref, next, error, unsubscribed: false };
      subscriptions.push(subscription);
      return () => { subscription.unsubscribed = true; };
    },
    serverTimestamp: () => "timestamp",
    setDoc: async (ref, data, options) => { writes.push({ ref, data, options }); },
    deleteDoc: async ref => { writes.push({ ref, deleted: true }); },
    updateDoc: async (ref, data) => { writes.push({ ref, data }); },
    writeBatch: () => ({
      set(ref, data, options) { writes.push({ ref, data, options }); },
      delete(ref) { writes.push({ ref, deleted: true }); },
      async commit() {}
    }),
    ...overrides
  };
  const context = vm.createContext(globals);
  const source = readFileSync(new URL("../js/store.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");
  vm.runInContext(source, context);
  const api = vm.runInContext("({ state, connectUser, disconnectUser, saveAccount, saveTransaction, saveTransactionsBatch, saveAsset, updateAssetQuote, importStateBackup, refreshFxRates, repairSync, resolveSyncConflict, deleteAllData })", context);
  api.state.user = { uid: "user-a" };
  return { ...api, writes, subscriptions, globals };
}
