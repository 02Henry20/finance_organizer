import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { matchesGlob } from "node:path";
import { test } from "node:test";

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("Firestore owner rules match the finance app's actual document path", () => {
  const store = read("js/store.js");
  const rules = read("firestore.rules");
  const app = store.match(/const APP_PATH = \["apps", "([^"]+)", "users"\]/)[1];
  assert.ok(rules.includes(`/apps/${app}/users/{userId}/{document=**}`));
  assert.match(rules, /request\.auth != null && request\.auth\.uid == userId/);
  assert.match(rules, /allow read, write: if isOwner\(userId\)/);
});

test("hosting excludes private statements, tests and generated source graphs", () => {
  const { hosting } = JSON.parse(read("firebase.json"));
  for (const name of ["test-data/statement.csv", "tests/store.test.mjs", "graphify-out/graph.json", "AGENTS.md"]) {
    assert.ok(hosting.ignore.some(pattern => matchesGlob(name, pattern)), name);
  }
  const ignore = read(".gitignore");
  assert.equal(ignore.includes("\0"), false);
  for (const name of ["test-data/", "graphify-out/", ".codex/"]) assert.ok(ignore.split(/\r?\n/).includes(name));
});

test("the app shell has unique element IDs and all local assets exist", () => {
  const html = read("index.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
    assert.ok(existsSync(new URL(`../${match[1]}`, import.meta.url)), match[1]);
  }
});
