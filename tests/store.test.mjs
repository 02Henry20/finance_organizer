import assert from "node:assert/strict";
import { test } from "node:test";
import { mockStore } from "./helpers.mjs";

const emptyBackup = () => ({ accounts: [], categories: [], rules: [], transactions: [], assets: [] });
const snapshot = (metadata = {}) => ({ metadata: { hasPendingWrites: false, fromCache: false, ...metadata }, docs: [], exists: () => true, data: () => ({}) });

test("malformed and incomplete replacement backups fail before deleting or writing", async () => {
  const invalid = [
    { accounts: [] },
    { ...emptyBackup(), transactions: [null] },
    { ...emptyBackup(), accounts: [{ id: "bad/id" }] },
    { ...emptyBackup(), assets: [{ id: "same" }, { id: "same" }] },
    { ...emptyBackup(), transactions: [{ id: "tx", amount: 1, date: "2026-02-30" }] },
    { ...emptyBackup(), assets: [{ id: "asset", quantity: "invalid" }] },
    { ...emptyBackup(), settings: [] }
  ];
  for (const backup of invalid) {
    const store = mockStore();
    await assert.rejects(store.importStateBackup(backup, { replace: true }));
    assert.equal(store.writes.length, 0);
  }
});

test("valid partial merges and complete replacements still import", async () => {
  const store = mockStore();
  assert.equal((await store.importStateBackup({ accounts: [{ id: "account", name: "Bank" }] })).accounts, 1);
  assert.equal(store.writes[0].data.name, "Bank");
  const backup = { ...emptyBackup(), transactions: [{ id: "tx", amount: -10, date: "2026-10-19", raw: [undefined, "value"] }] };
  assert.equal((await store.importStateBackup(backup, { replace: true })).transactions, 1);
  assert.equal(store.writes[1].data.raw[0], null);
});

test("missing timestamps cannot make a colliding import overwrite a legacy transaction", async () => {
  const store = mockStore();
  store.state.transactions = [{ id: "same", amount: 10 }];
  await store.saveTransactionsBatch([{ id: "same", amount: 20, source: "import:test" }]);
  assert.equal(store.writes[0].data.id, "same_dup2");
  assert.equal(store.writes[0].data.amount, 20);
  assert.match(store.writes[0].ref, /same_dup2$/);
});

test("edits with an actual timestamp preserve the original transaction ID", async () => {
  const store = mockStore();
  store.state.transactions = [{ id: "same", amount: 10, createdAtMs: 123 }];
  await store.saveTransactionsBatch([{ id: "same", amount: 20, createdAtMs: 123 }]);
  assert.equal(store.writes[0].data.id, "same");
});

test("editing a holding keeps quote metadata, while changing currency invalidates the price", async () => {
  const store = mockStore();
  store.state.assets = [{ id: "asset", currency: "EUR", lastPrice: 42, lastPriceAt: "2026-10-18", lastChangePercent: 1.2 }];
  await store.saveAsset({ id: "asset", currency: "EUR", name: "Renamed", quantity: 10 });
  assert.equal(store.writes[0].data.lastPrice, 42);
  assert.equal(store.writes[0].data.lastPriceAt, "2026-10-18");
  assert.equal(store.writes[0].data.lastChangePercent, 1.2);
  await store.saveAsset({ id: "asset", currency: "GBP", name: "Renamed", quantity: 10 });
  assert.equal(store.writes[1].data.lastPrice, null);
  assert.equal(store.writes[1].data.lastPriceAt, "");
});

test("sync status reflects every listener, pending writes, cache and errors", async () => {
  const store = mockStore();
  await store.connectUser({ uid: "user-a" });
  const [accounts, categories] = store.subscriptions;
  accounts.next(snapshot());
  assert.equal(store.state.sync.status, "loading");
  for (const listener of store.subscriptions) listener.next(snapshot());
  assert.equal(store.state.sync.status, "synced");
  accounts.next(snapshot({ hasPendingWrites: true }));
  categories.next(snapshot());
  assert.equal(store.state.sync.pending, true);
  assert.equal(store.state.sync.status, "loading");
  accounts.next(snapshot());
  assert.equal(store.state.sync.pending, false);
  accounts.next(snapshot({ fromCache: true }));
  categories.next(snapshot());
  assert.equal(store.state.sync.status, "loading");
  accounts.error(new Error("permission denied"));
  categories.next(snapshot());
  assert.equal(store.state.sync.status, "error");
  accounts.next(snapshot());
  assert.equal(store.state.sync.status, "synced");
});

test("a connection that finishes after sign-out cannot reattach listeners", async () => {
  let finish;
  const store = mockStore({ getDocFromServer: () => new Promise(resolve => { finish = resolve; }) });
  const pending = store.connectUser({ uid: "old-user" });
  store.disconnectUser();
  finish({ exists: () => true });
  await pending;
  assert.equal(store.subscriptions.length, 0);
  assert.equal(store.state.user, null);
});

test("callbacks from a disconnected account cannot update the new workspace", async () => {
  const store = mockStore();
  await store.connectUser({ uid: "old-user" });
  const previousListener = store.subscriptions[0];
  await store.connectUser({ uid: "new-user" });
  previousListener.next({ ...snapshot(), docs: [{ id: "private-old-account", data: () => ({ name: "Old" }) }] });
  assert.equal(store.state.accounts.length, 0);
  assert.equal(previousListener.unsubscribed, true);
});

test("a backup operation stops if the signed-in workspace changes", async () => {
  let store;
  store = mockStore({ getDocs: async () => {
    store.disconnectUser();
    store.state.user = { uid: "different-user" };
    return { docs: [{ id: "old-account" }] };
  } });
  await assert.rejects(store.importStateBackup(emptyBackup(), { replace: true }), /workspace changed/);
  assert.equal(store.writes.length, 0);
});

test("the Firestore document path determines its identity, not a stale embedded ID", async () => {
  const store = mockStore();
  await store.connectUser({ uid: "user-a" });
  store.subscriptions[0].next({ ...snapshot(), docs: [{ id: "real-id", data: () => ({ id: "wrong-id", name: "Account" }) }] });
  assert.equal(store.state.accounts[0].id, "real-id");
});

test("offline cache misses cannot overwrite cloud preferences with defaults", async () => {
  const store = mockStore({ getDocFromServer: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); } });
  await store.connectUser({ uid: "user-a" });
  assert.equal(store.subscriptions.length, 6);
  assert.equal(store.writes.length, 0);
});

test("delete all does not report success when settings deletion fails", async () => {
  const store = mockStore({ deleteDoc: async () => { throw new Error("denied"); } });
  await assert.rejects(store.deleteAllData(), /denied/);
  assert.notEqual(store.state.sync.detail, "All data deleted");
});
