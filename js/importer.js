import { categorizeTransaction, parseDateValue, parseMoney, transactionHash, uid } from "./finance.js";

const FIELD_ALIASES = {
  date: ["date", "datum", "buchungstag", "booking date", "transaction date", "umsatzdatum", "valutadatum", "wertstellung", "value date", "created"],
  amount: ["amount", "betrag", "umsatz", "value", "wert", "buchungsbetrag", "transaction amount", "abbuchung", "gutschrift"],
  debit: ["debit", "soll", "belastung", "ausgang", "withdrawal", "money out"],
  credit: ["credit", "haben", "gutschrift", "eingang", "deposit", "money in"],
  balance: ["balance", "saldo", "kontostand", "running balance"],
  description: ["description", "verwendungszweck", "purpose", "memo", "text", "buchungstext", "payment reference", "wendungszweck", "details", "transaction details"],
  counterparty: ["counterparty", "payee", "payer", "name", "auftraggeber", "empfänger", "empfaenger", "begünstigter", "beguenstigter", "zahlungspflichtiger", "merchant"],
  iban: ["iban", "account", "konto", "gegenkonto"],
  currency: ["currency", "währung", "waehrung", "ccy"],
  category: ["category", "kategorie"]
};

function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 8).join("\n");
  const candidates = [";", ",", "\t", "|"];
  return candidates
    .map(delimiter => ({ delimiter, count: (sample.match(new RegExp(delimiter === "\t" ? "\\t" : `\\${delimiter}`, "g")) || []).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ";";
}

function parseCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = stripBom(text);
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field.trim());
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(cell => cell !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function guessMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const aliasSet = aliases.map(normalizeHeader);
    const exact = normalized.findIndex(header => aliasSet.includes(header));
    if (exact >= 0) {
      mapping[field] = exact;
      continue;
    }
    const partial = normalized.findIndex(header => aliasSet.some(alias => header.includes(alias) || alias.includes(header)));
    if (partial >= 0) mapping[field] = partial;
  }
  return mapping;
}

function findHeaderRow(rows) {
  let best = { index: 0, score: -1 };
  rows.slice(0, 20).forEach((row, index) => {
    const normalized = row.map(normalizeHeader).join(" ");
    const score = ["date", "datum", "betrag", "amount", "saldo", "description", "verwendungszweck", "buchung"].reduce(
      (total, word) => total + (normalized.includes(word) ? 1 : 0), 0
    );
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

export async function parseBankFile(file) {
  const text = await file.text();
  const delimiter = detectDelimiter(text);
  const allRows = parseCsvRows(text, delimiter).filter(row => row.length > 1);
  if (!allRows.length) throw new Error("The file does not look like a CSV/TSV bank export.");
  const headerRowIndex = findHeaderRow(allRows);
  const headers = allRows[headerRowIndex].map((header, index) => header || `Column ${index + 1}`);
  const dataRows = allRows.slice(headerRowIndex + 1);
  return {
    filename: file.name,
    delimiter,
    headers,
    rows: dataRows,
    mapping: guessMapping(headers)
  };
}

export function rowToTransaction(row, mapping, context) {
  const get = field => mapping[field] == null ? "" : row[mapping[field]];
  const date = parseDateValue(get("date"));
  let amount = parseMoney(get("amount"));
  const debit = parseMoney(get("debit"));
  const credit = parseMoney(get("credit"));
  if (amount == null && (debit != null || credit != null)) amount = (credit || 0) - Math.abs(debit || 0);
  const descriptionParts = [get("counterparty"), get("description"), get("iban")].filter(Boolean);
  const description = descriptionParts.join(" · ").trim() || "Imported transaction";
  const counterparty = get("counterparty") || "";
  const currency = (get("currency") || context.currency || "EUR").toUpperCase().slice(0, 3);

  if (!date || amount == null) return null;

  const base = {
    accountId: context.accountId,
    date,
    amount,
    currency,
    description,
    counterparty,
    rawText: row.join(" "),
    raw: row,
    source: "import",
    importBatchId: context.importBatchId,
    createdAtMs: Date.now()
  };
  const categorization = categorizeTransaction(base, context.rules, context.categories, context.accounts || []);
  const id = transactionHash(base);
  return {
    ...base,
    id,
    externalId: id,
    categoryId: categorization.categoryId,
    confidence: categorization.confidence,
    review: categorization.review,
    reason: categorization.reason,
    candidates: categorization.candidates,
    note: ""
  };
}

export function buildImportPreview(parsed, mapping, context, existingTransactions = []) {
  const importBatchId = uid();
  const existingIds = new Set(existingTransactions.map(tx => tx.externalId || tx.id));
  const transactions = [];
  const skipped = [];
  for (const row of parsed.rows) {
    const tx = rowToTransaction(row, mapping, { ...context, importBatchId });
    if (!tx) {
      skipped.push({ row, reason: "Missing date or amount" });
      continue;
    }
    if (existingIds.has(tx.id) || transactions.some(item => item.id === tx.id)) {
      skipped.push({ row, reason: "Duplicate" });
      continue;
    }
    transactions.push(tx);
  }
  return { transactions, skipped, importBatchId };
}

export function serializeTransactionsCsv(transactions, categories, accounts) {
  const categoryMap = new Map(categories.map(cat => [cat.id, cat.name]));
  const accountMap = new Map(accounts.map(account => [account.id, account.name]));
  const headers = ["Date", "Account", "Amount", "Currency", "Category", "Counterparty", "Description", "Note", "Review"];
  const escape = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(",")];
  for (const tx of transactions) {
    lines.push([
      tx.date,
      accountMap.get(tx.accountId) || tx.accountId,
      tx.amount,
      tx.currency,
      categoryMap.get(tx.categoryId) || tx.categoryId,
      tx.counterparty,
      tx.description,
      tx.note,
      tx.review ? "yes" : "no"
    ].map(escape).join(","));
  }
  return lines.join("\n");
}
