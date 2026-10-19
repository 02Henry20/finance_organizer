import assert from "node:assert/strict";
import { test } from "node:test";
import { assetPrice, buildMonthlySeries, calculateAccountBalance, calculatePortfolio, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, parseDateValue, parseMoney, TODAY } from "../js/finance.js";
import { appFunction } from "./helpers.mjs";

test("invalid amounts do not turn into zero, and Unicode negatives keep their sign", () => {
  for (const value of ["", "EUR", "N/A", "not a number", "€—"]) assert.equal(parseMoney(value), null);
  for (const value of ["−€1,23", "–1.23", "(€1.23)", "1.23-"]) assert.equal(parseMoney(value), -1.23);
  assert.equal(parseMoney("0.00"), 0);
});

test("calendar parsing rejects impossible dates and supports European timestamps", () => {
  for (const date of ["2026-02-30", "2026-13-01", "31.04.2026", "29.02.2025", "Invalid", new Date(NaN)]) assert.equal(parseDateValue(date), "");
  assert.equal(parseDateValue("29.02.2024 23:59:00"), "2024-02-29");
  assert.equal(parseDateValue("31/07/2026 10:30:00"), "2026-07-31");
});

test("today, monthly report keys and rolling comparison use calendar days", () => {
  const previousTZ = process.env.TZ;
  const RealDate = globalThis.Date;
  try {
    for (const [zone, instant] of [["Europe/Berlin", "2026-03-01T00:30:00+01:00"], ["Asia/Seoul", "2026-03-01T00:30:00+09:00"], ["America/Los_Angeles", "2026-03-01T23:30:00-08:00"]]) {
      process.env.TZ = zone;
      const time = new RealDate(instant).getTime();
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      };
      assert.equal(TODAY(), "2026-03-01", zone);
      const rows = buildMonthlySeries([{ date: "2026-03-01", amount: -12, categoryId: "groceries", currency: "EUR" }], DEFAULT_CATEGORIES, DEFAULT_SETTINGS, 3);
      assert.deepEqual(rows.map(row => row.month), ["2026-01", "2026-02", "2026-03"], zone);
      assert.equal(rows[2].expense, 12);
      const state = { settings: { portfolioComparisonDays: 1 } };
      const addDaysIso = appFunction("addDaysIso");
      assert.equal(appFunction("comparisonDateFromSettings", { state, addDaysIso })(), "2026-02-28");
    }
  } finally {
    globalThis.Date = RealDate;
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("account balances convert each row into the account's native currency", () => {
  const settings = { ...DEFAULT_SETTINGS, fxRates: { EUR: 1, USD: 0.9 } };
  const account = { id: "eur", currency: "EUR", openingBalance: 100 };
  const transactions = [{ accountId: "eur", date: "2026-10-19", currency: "USD", amount: -10 }];
  assert.equal(calculateAccountBalance(account, transactions, settings).raw, 91);
  assert.equal(calculateAccountBalance(account, transactions, { ...settings, primaryCurrency: "USD" }).converted, 91 / 0.9);
});

test("a dated opening balance excludes older rows even in historical snapshots", () => {
  const account = { id: "eur", currency: "EUR", openingBalance: 100, openingBalanceDate: "2026-10-01" };
  const transactions = [{ accountId: "eur", date: "2026-09-01", amount: 1000 }, { accountId: "eur", date: "2026-10-02", amount: -10 }];
  assert.equal(calculateAccountBalance(account, transactions, DEFAULT_SETTINGS).raw, 90);
  assert.equal(calculateAccountBalance(account, transactions, DEFAULT_SETTINGS, "2026-09-30").raw, 0);
  const state = { settings: DEFAULT_SETTINGS, transactions };
  const currentBalance = appFunction("accountBalanceFromStoredTransactions", { state });
  const delta = appFunction("accountImportDelta", { state, accountBalanceFromStoredTransactions: currentBalance });
  assert.equal(currentBalance(account), 90);
  assert.equal(delta(account, [{ accountId: "eur", date: "2026-09-02", amount: 50 }]), 0);
});

test("manual prices override stale downloaded quotes in totals and holdings UI", () => {
  const holding = { provider: "manual", manualPrice: 10, lastPrice: 99, quantity: 2, currency: "EUR" };
  assert.equal(assetPrice(holding), 10);
  assert.equal(assetPrice({ provider: "manual", lastPrice: 5 }), 5);
  assert.equal(assetPrice({ ...holding, manualPrice: 0 }), 0);
  assert.equal(appFunction("assetMarketValue")(holding), 20);
  assert.equal(calculatePortfolio({ accounts: [], transactions: [], assets: [holding], settings: DEFAULT_SETTINGS }).holdingsValue, 20);
});

test("unknown daily holding change stays unknown and cannot divide by zero", () => {
  const positionDelta = appFunction("positionDelta", { positionsPeriod: "today", assetMarketValue: () => 100 });
  assert.equal(positionDelta({ lastChangePercent: null }).amount, null);
  assert.equal(positionDelta({ lastChangePercent: -100 }).amount, null);
  assert.equal(positionDelta({ lastChangePercent: 0 }).amount, 0);
});

test("automatic quote refresh honors the saved off setting", async () => {
  let calls = 0;
  const refresh = appFunction("maybeRefreshQuotes", {
    navigator: { onLine: true },
    state: { user: { uid: "user" }, settings: { autoRefreshQuotes: "off" }, assets: [{ provider: "yahoo" }] },
    refreshAllAssets: async () => { calls += 1; }
  });
  await refresh();
  assert.equal(calls, 0);
});
