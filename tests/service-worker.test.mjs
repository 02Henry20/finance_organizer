import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function worker(fetch, cached = new Map()) {
  const listeners = {};
  const stored = [];
  const deleted = [];
  let skipped = false;
  const context = vm.createContext({
    URL, Response, fetch,
    self: { location: { origin: "https://capito.test" }, addEventListener: (type, listener) => { listeners[type] = listener; }, skipWaiting: async () => { skipped = true; }, clients: { claim: async () => {} } },
    caches: {
      match: async request => cached.get(request.url || request),
      keys: async () => ["capito-old", "unrelated-app"],
      delete: async name => { deleted.push(name); },
      open: async () => ({ put: async (request, response) => { stored.push({ request, response }); }, addAll: async () => { throw new Error("offline"); }, add: async () => {} })
    }
  });
  vm.runInContext(readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"), context);
  return { listeners, stored, deleted, skipped: () => skipped, request(url, mode = "cors") {
    let promise;
    listeners.fetch({ request: { method: "GET", url, mode }, respondWith(value) { promise = value; } });
    return promise;
  } };
}

test("offline scripts never receive the HTML navigation fallback", async () => {
  const w = worker(async () => { throw new Error("offline"); }, new Map([["./index.html", new Response("shell")]]));
  assert.equal((await w.request("https://capito.test/js/missing.js")).type, "error");
  assert.equal(await (await w.request("https://capito.test/reports", "navigate")).text(), "shell");
});

test("HTTP errors cannot poison the offline cache and external requests bypass it", async () => {
  const w = worker(async () => new Response("unavailable", { status: 503 }));
  assert.equal((await w.request("https://capito.test/js/app.js")).status, 503);
  assert.equal(w.stored.length, 0);
  assert.equal(w.request("https://unrelated.test/market.js"), undefined);
});

test("failed installs keep the old worker, and activation preserves other apps' caches", async () => {
  const w = worker(async () => new Response("ok"));
  let installing;
  w.listeners.install({ waitUntil(value) { installing = value; } });
  await assert.rejects(installing, /offline/);
  assert.equal(w.skipped(), false);
  let activating;
  w.listeners.activate({ waitUntil(value) { activating = value; } });
  await activating;
  assert.deepEqual(w.deleted, ["capito-old"]);
});
