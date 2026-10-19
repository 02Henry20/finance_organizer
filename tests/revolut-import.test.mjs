import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBankFile, buildImportPreview } from "../js/importer.js";
import { calculateAccountBalance, DEFAULT_CATEGORIES, DEFAULT_RULES, DEFAULT_SETTINGS, parseDateValue } from "../js/finance.js";

const csv = rows => rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
const statement = csv([
  ["Personal Account (EUR)"],
  ["Date", "Description", "Category", "Money in/out", "Balance", "Tax withheld", "Other taxes", "Fees"],
  ["Jul 31, 2026", "Shop", "Merchant", "-€10.00", "€90.00"],
  ["Jul 31, 2026", "Shop", "Merchant", "-€10.00", "€80.00"],
  ["---------"],
  ["Personal Account (KRW)"],
  ["Date", "Description", "Category", "Money in/out", "Money in/out", "Balance", "Balance", "Tax withheld", "Tax withheld", "Other taxes", "Other taxes", "Fees", "Fees"],
  ["Aug 5, 2026", "Shop", "Merchant", "-12,000 KRW", "-€7.29", "420 KRW", "€0.28", "0 KRW", "€0.00", "0 KRW", "€0.00", "100 KRW", "€0.06"],
  ["---------"],
  ["Personal Account (GBP)"],
  ["Date", "Description", "Category", "Money in/out", "Money in/out", "Balance", "Balance", "Tax withheld", "Tax withheld", "Other taxes", "Other taxes", "Fees", "Fees"],
  ["Aug 1, 2026", "Transfer from someone", "Others", "£6.67", "€7.79", "£6.67", "€7.79"],
  ["Aug 3, 2026", "Exchanged to EUR", "Exchange", "-£6.67", "-€7.79", "£0.00", "€0.00"],
  ["Total"]
]);
const accounts = ["EUR", "KRW", "GBP"].map(currency => ({ id: currency, currency, name: `Revolut Current ${currency}`, institution: "Revolut", type: "checking", openingBalance: currency === "EUR" ? 100 : 0 }));
const context = (selectedAccounts = accounts) => ({ accountId: "EUR", currency: "EUR", accounts: selectedAccounts, categories: DEFAULT_CATEGORIES, rules: DEFAULT_RULES });
const parse = text => parseBankFile({ name: "statement.csv", text: async () => text });

test("Revolut keeps native currencies, signs, balances and repeated native columns", async () => {
  const parsed = await parse(statement);
  assert.deepEqual(parsed.rows.map(row => row.slice(0, 3)), [
    ["2026-07-31", -10, "EUR"], ["2026-07-31", -10, "EUR"],
    ["2026-08-05", -12000, "KRW"], ["2026-08-01", 6.67, "GBP"], ["2026-08-03", -6.67, "GBP"]
  ]);
  assert.equal(parsed.rows[2][5], 420);
  assert.match(parsed.rows[2][8], /Fee 100 KRW/);
  assert.equal(parsed.rows[4][5], 0);
  const preview = buildImportPreview(parsed, parsed.mapping, context());
  assert.equal(preview.transactions.length, 5);
  assert.equal(preview.skipped.length, 0);
  for (const tx of preview.transactions) assert.equal(tx.accountId, tx.currency);
  assert.equal(calculateAccountBalance(accounts[0], preview.transactions, DEFAULT_SETTINGS).raw, 80);
  const again = buildImportPreview(parsed, parsed.mapping, context(), preview.transactions);
  assert.equal(again.transactions.length, 0);
  assert.equal(again.skipped.length, 5);
});

test("missing currency accounts cannot fall back to EUR or be added back unsafely", async () => {
  const parsed = await parse(statement);
  const wrongCurrencyExactMatch = { ...accounts[0], id: "revolut:Current:GBP" };
  const preview = buildImportPreview(parsed, parsed.mapping, context([accounts[0], wrongCurrencyExactMatch]));
  assert.equal(preview.transactions.length, 2);
  assert.equal(preview.skipped.length, 3);
  for (const item of preview.skipped) {
    assert.match(item.reason, /No matching (KRW|GBP) account/);
    assert.equal(item.tx, undefined);
  }
});

test("truly identical statement rows are still skipped within a file", async () => {
  const parsed = await parse(statement);
  parsed.rows.push(parsed.rows[0]);
  const preview = buildImportPreview(parsed, parsed.mapping, context());
  assert.equal(preview.transactions.length, 5);
  assert.equal(preview.skipped.length, 1);
  assert.equal(preview.skipped[0].duplicate, true);
});

test("calendar dates are preserved across timezones, including DST", () => {
  for (const timezone of ["UTC", "Europe/Berlin", "Asia/Seoul", "America/Los_Angeles"]) {
    const previous = process.env.TZ;
    try {
      process.env.TZ = timezone;
      for (const [value, expected] of [["Jul 31, 2026", "2026-07-31"], ["Oct 25, 2026", "2026-10-25"], ["March 29, 2026", "2026-03-29"], ["2026-07-31 23:59:59", "2026-07-31"], ["31.07.2026", "2026-07-31"], [46234, "2026-07-31"]]) {
        assert.equal(parseDateValue(value), expected, `${timezone}: ${value}`);
      }
      assert.equal(parseDateValue("Feb 30, 2026"), "");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  }
});

test("standard Revolut statements also separate currencies and opening hints", async () => {
  const parsed = await parse(csv([
    ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"],
    ["Card Payment", "Current", "2026-07-31 12:00:00", "2026-07-31", "Shop", "-10", "0", "EUR", "COMPLETED", "90"],
    ["Exchange", "Current", "2026-08-03 12:00:00", "2026-08-03", "Exchanged to EUR", "-6.67", "0", "GBP", "COMPLETED", "0"]
  ]));
  assert.equal(parsed.openingBalanceHint, null);
  assert.deepEqual(parsed.openingBalanceDetails, [{ product: "revolut:Current:EUR", value: 100 }, { product: "revolut:Current:GBP", value: 6.67 }]);
  const preview = buildImportPreview(parsed, parsed.mapping, context());
  assert.deepEqual(preview.transactions.map(tx => [tx.accountId, tx.amount]), [["EUR", -10], ["GBP", -6.67]]);
});

// Optional private cross-check: supply the statement path through REVOLUT_CSV.
test("supplied Revolut statement reconciles every date and currency", { skip: !process.env.REVOLUT_CSV }, async () => {
  const text = readFileSync(process.env.REVOLUT_CSV, "utf8");
  const parsed = await parse(text);
  const preview = buildImportPreview(parsed, parsed.mapping, context());
  const expectedDates = [...text.matchAll(/^"([A-Za-z]+ \d{1,2}, \d{4})",/gm)].map(match => {
    const date = new Date(`${match[1]} 12:00:00 GMT`);
    return date.toISOString().slice(0, 10);
  });
  assert.equal(expectedDates.length, 195);
  assert.deepEqual(parsed.rows.map(row => row[0]), expectedDates);
  assert.equal(preview.transactions.length, 195);
  assert.equal(preview.skipped.length, 0);
  const expected = { EUR: [172, -98452], KRW: [21, 42000], GBP: [2, 0] };
  for (const [currency, [count, cents]] of Object.entries(expected)) {
    const rows = preview.transactions.filter(tx => tx.currency === currency);
    assert.equal(rows.length, count);
    assert.equal(rows.reduce((sum, tx) => sum + Math.round(tx.amount * 100), 0), cents);
    assert.ok(rows.every(tx => tx.accountId === currency));
  }
  const euroAccount = { ...accounts[0], openingBalance: 1020.97 };
  assert.equal(Math.round(calculateAccountBalance(euroAccount, preview.transactions, DEFAULT_SETTINGS).raw * 100), 3645);
  const eurOnly = buildImportPreview(parsed, parsed.mapping, context([euroAccount]));
  assert.equal(eurOnly.transactions.length, 172);
  assert.equal(eurOnly.skipped.length, 23);
  assert.equal(buildImportPreview(parsed, parsed.mapping, context(), preview.transactions).transactions.length, 0);
});
