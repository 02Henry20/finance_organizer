import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchYahooQuote, searchYahooAssetMatches } from "../js/market.js";
import { mockStore } from "./helpers.mjs";

test("Yahoo pence quotes are converted to pounds before valuing GBP holdings", async () => {
  const previous = globalThis.fetch;
  try {
    for (const currency of ["GBp", "GBX", "GBP"]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ chart: { result: [{ meta: { symbol: "TEST.L", regularMarketPrice: 567, regularMarketTime: Math.floor(Date.now() / 1000), currency } }] } }));
      const quote = await fetchYahooQuote({ symbol: "TEST.L", currency: "GBP" }, { targetCurrency: "GBP" });
      assert.equal(quote.currency, "GBP");
      assert.equal(quote.price, currency === "GBP" ? 567 : 5.67);
    }
  } finally { globalThis.fetch = previous; }
});

test("known identifier fallback works even when Yahoo lookup fails", async () => {
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  try {
    globalThis.fetch = async () => { throw new Error("offline"); };
    console.warn = () => {};
    const matches = await searchYahooAssetMatches({ isin: "US0378331005", name: "Apple", currency: "EUR" });
    assert.ok(matches.length > 0);
    assert.equal(matches[0].exactIdentifierMatch, true);
  } finally {
    globalThis.fetch = previousFetch;
    console.warn = previousWarn;
  }
});

test("the overall quote deadline prevents retrying every candidate after timeout", async () => {
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let calls = 0;
  let time = previousNow();
  try {
    Date.now = () => time;
    globalThis.fetch = async () => { calls += 1; time += 100; throw new Error("timeout"); };
    await assert.rejects(fetchYahooQuote({ symbol: "TEST", isin: "US0378331005" }, { timeoutMs: 50 }));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previousFetch; Date.now = previousNow; }
});

test("an absent quote change is stored as unknown instead of zero percent", async () => {
  const store = mockStore();
  store.state.assets = [{ id: "holding", currency: "EUR" }];
  await store.updateAssetQuote("holding", { currency: "EUR", price: 10, changePercent: null });
  assert.equal(store.writes[0].data.lastChangePercent, null);
});
