import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImportPreview, parseBankFile, parseBrokerPositionsFile } from "../js/importer.js";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "../js/finance.js";

const file = text => ({ name: "statement.csv", text: async () => text });
const context = { accountId: "eur", currency: "EUR", accounts: [{ id: "eur", currency: "EUR" }], categories: DEFAULT_CATEGORIES, rules: DEFAULT_RULES };

test("English PayPal headers are recognized and native signed net amounts are retained", async () => {
  const parsed = await parseBankFile(file("Date,Time,Name,Type,Status,Currency,Gross,Fee,Net,Transaction ID,Balance Impact\n2026-10-19,10:00,Shop,Payment,Completed,EUR,-10,-1,-11,pay-1,Debit"));
  assert.equal(parsed.format, "paypal");
  assert.equal(parsed.rows[0][1], -11);
  assert.equal(buildImportPreview(parsed, parsed.mapping, context).transactions[0].amount, -11);
});

test("zero PayPal net amounts do not fall back to a nonzero gross amount", async () => {
  const parsed = await parseBankFile(file("Datum,Name,Typ,Status,Währung,Brutto,Gebühr,Netto,Transaktionscode,Auswirkung auf Guthaben\n19.10.2026,Shop,Zahlung,Abgeschlossen,EUR,10,-10,0,pay-2,Debit"));
  const preview = buildImportPreview(parsed, parsed.mapping, context);
  assert.equal(preview.transactions.length, 0);
  assert.equal(preview.skipped[0].reason, "Zero-amount transaction");
});

test("Revolut opening hints use the earliest completed row in descending exports", async () => {
  const parsed = await parseBankFile(file("Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCard Payment,Current,2026-10-19,2026-10-19,Shop,-20,0,EUR,COMPLETED,70\nCard Payment,Current,2026-10-18,2026-10-18,Shop,-10,0,EUR,COMPLETED,90"));
  assert.equal(parsed.openingBalanceHint, 100);
});

test("generic holdings keep integer quantities and prices without Smartbroker scaling", async () => {
  const parsed = await parseBrokerPositionsFile(file("Symbol,Name,Quantity,Price,Currency\nTEST,Test Holding,12000,10000,EUR\nEMPTY,Missing Quantity,,10,EUR"));
  assert.equal(parsed.positions.length, 1);
  assert.equal(parsed.positions[0].quantity, 12000);
  assert.equal(parsed.positions[0].manualPrice, 10000);
  assert.equal(parsed.skipped.length, 1);
});

test("individual activity rows cannot overwrite a complete holding with the latest trade size", async () => {
  const activity = file("date,asset_class,name,symbol,shares,price,currency,type,amount,transaction_id\n2026-10-19,stock,Test,TEST,2,10,EUR,BUY,-20,trade-1");
  await assert.rejects(parseBrokerPositionsFile(activity), /not complete holdings/);
});
