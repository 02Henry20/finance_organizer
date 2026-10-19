import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { shouldIgnoreTransactionInStats } from "../js/finance.js";

// Run the UI/persistence functions with small DOM and Firestore boundaries.
// This keeps the regression checks local and never connects to a user's data.
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const store = readFileSync(new URL("../js/store.js", import.meta.url), "utf8");
function loadFunction(source, name, globals) {
  const pattern = new RegExp(`^(?:export )?((?:async )?function ${name}\\([^]*?^})`, "m");
  const match = source.match(pattern);
  assert.ok(match, `Missing function ${name}`);
  const context = vm.createContext(globals);
  return vm.runInContext(`(${match[1]})`, context);
}

test("a false canonical flag or manual override takes precedence over legacy flags", () => {
  assert.equal(shouldIgnoreTransactionInStats({ ignoreFromStats: true }), true);
  assert.equal(shouldIgnoreTransactionInStats({ statsIgnored: true }), true);
  assert.equal(shouldIgnoreTransactionInStats({ excludeFromStats: false, statsIgnored: true }), false);
  assert.equal(shouldIgnoreTransactionInStats({ statsExclusionOverride: false, excludeFromStats: true }), false);
  assert.equal(shouldIgnoreTransactionInStats({ statsExclusionOverride: true, excludeFromStats: false }), true);
});

test("transfer category synchronization does not recheck a manually removed tag", () => {
  const ignore = { checked: false };
  const fields = {
    "#transaction-category": { tagName: "SELECT", value: "transfer" },
    "#transaction-review": { removeAttribute() {} },
    "#transaction-ignore-stats": ignore
  };
  const sync = loadFunction(app, "syncTransactionReviewControl", {
    $: id => fields[id], state: { categories: [{ id: "transfer", type: "transfer" }, { id: "cash" }] }
  });
  sync();
  assert.equal(ignore.checked, false);
  ignore.checked = true;
  sync();
  assert.equal(ignore.checked, true);
  fields["#transaction-category"].value = "cash";
  sync();
  assert.equal(ignore.checked, false);
});

test("rule reapplication preserves both manual include and ignore choices", () => {
  const automatic = { categoryId: "transfer", internalTransfer: true, excludeFromStats: true, candidates: [] };
  const categorize = loadFunction(app, "buildCategorizedTransaction", {
    state: { categories: [{ id: "transfer", type: "transfer" }], accounts: [], rules: [] },
    categorizeTransaction: () => automatic,
    enrichTransactionNoteForAutomation: tx => tx
  });
  assert.equal(categorize({ categoryId: "transfer" }).excludeFromStats, true);
  for (const choice of [false, true]) {
    const tx = { categoryId: "transfer", statsExclusionOverride: choice, excludeFromStats: !choice };
    const next = categorize(tx, [], { reapplyMode: true });
    assert.equal(next.excludeFromStats, choice);
    assert.equal(next.statsExclusionOverride, choice);
  }
});

test("single and batch saves persist removal and clear legacy aliases after merge", async () => {
  let saved;
  const globals = {
    connectionGeneration: 0, assertConnection() {},
    uid: () => "new-id", state: { settings: { primaryCurrency: "EUR" }, transactions: [] },
    shouldIgnoreTransactionInStats, noteWithReviewReason: tx => tx.note || "",
    saveDoc: async (_collection, _id, data) => { saved = data; },
    db: {}, userDoc: (_collection, id) => id, serverTimestamp: () => 0,
    writeBatch: () => ({ set(_doc, data) { saved = data; }, async commit() {} })
  };
  const saveOne = loadFunction(store, "saveTransaction", globals);
  const saveBatch = loadFunction(store, "saveTransactionsBatch", globals);
  const original = { id: "tx", accountId: "eur", categoryId: "transfer", amount: -10, date: "2026-10-19", excludeFromStats: false, statsExclusionOverride: false, ignoreFromStats: true, statsIgnored: true };
  for (const save of [tx => saveOne(tx), tx => saveBatch([tx])]) {
    await save(original);
    const merged = { ...original, ...saved };
    assert.equal(merged.excludeFromStats, false);
    assert.equal(merged.statsExclusionOverride, false);
    assert.equal(merged.ignoreFromStats, false);
    assert.equal(merged.statsIgnored, false);
    assert.equal(shouldIgnoreTransactionInStats(merged), false);
  }
});
