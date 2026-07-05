import { categorizeTransaction, normalizeText, parseDateValue, parseMoney, transactionHash, uid } from "./finance.js";

const FIELD_ALIASES = {
  date: ["date", "datum", "buchungstag", "booking date", "transaction date", "umsatzdatum", "valutadatum", "wertstellung", "value date", "created", "completed date", "finished on"],
  amount: ["amount", "betrag", "umsatz", "value", "wert", "buchungsbetrag", "transaction amount", "abbuchung", "gutschrift"],
  debit: ["debit", "soll", "belastung", "ausgang", "withdrawal", "money out"],
  credit: ["credit", "haben", "gutschrift", "eingang", "deposit", "money in"],
  balance: ["balance", "saldo", "kontostand", "running balance"],
  description: ["description", "verwendungszweck", "purpose", "memo", "text", "buchungstext", "payment reference", "wendungszweck", "details", "transaction details"],
  counterparty: ["counterparty", "payee", "payer", "name", "auftraggeber", "empfänger", "empfaenger", "begünstigter", "beguenstigter", "zahlungspflichtiger", "merchant"],
  iban: ["iban", "account", "konto", "gegenkonto", "kontonummer iban", "kontonummer/iban"],
  currency: ["currency", "währung", "waehrung", "ccy"],
  category: ["category", "kategorie"]
};

export const RECOGNIZED_BANK_FORMATS = [
  "Wise CSV: ID, Direction, Created/Finished on, Source/Target amount and currency",
  "Revolut CSV: Type, Product, Completed Date, Description, Amount, Fee, Currency, Balance",
  "Sparkasse CSV: Buchungstag, Buchungstext, Verwendungszweck, Begünstigter/Zahlungspflichtiger, Betrag, Währung",
  "Trade Republic CSV: datetime/date, type, asset_class, name, symbol, shares, amount, fee, tax, currency, transaction_id",
  "Generic CSV/TSV: date + amount/debit/credit + description/counterparty + currency"
];

export const RECOGNIZED_BROKER_FORMATS = [
  "Smartbroker XLSX/CSV: ISIN, WKN, Kürzel, Name, Assetklasse, Stücke, Einstandskurs, Marktkurs, Einstandswert, Marktwert, Währung",
  "Trade Republic CSV: date, asset_class, name, symbol/ISIN, shares, price, amount, currency"
];

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
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headerIndex(headers) {
  const normalized = headers.map(normalizeHeader);
  return key => {
    const candidates = Array.isArray(key) ? key : [key];
    const normalizedCandidates = candidates.map(normalizeHeader);
    let index = normalized.findIndex(header => normalizedCandidates.includes(header));
    if (index >= 0) return index;
    index = normalized.findIndex(header => normalizedCandidates.some(candidate => header.includes(candidate) || candidate.includes(header)));
    return index >= 0 ? index : null;
  };
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
    const score = ["date", "datum", "betrag", "amount", "saldo", "description", "verwendungszweck", "buchung", "direction", "completed date"].reduce(
      (total, word) => total + (normalized.includes(word) ? 1 : 0), 0
    );
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

function detectBankFormat(headers) {
  const has = value => headers.map(normalizeHeader).includes(normalizeHeader(value));
  const normalizedJoined = headers.map(normalizeHeader).join("|");
  if (has("ID") && has("Direction") && normalizedJoined.includes("source amount after fees") && normalizedJoined.includes("target amount after fees")) {
    return { id: "wise", label: "Wise CSV" };
  }
  if (has("Type") && has("Product") && has("Completed Date") && has("Amount") && has("Fee") && has("Currency")) {
    return { id: "revolut", label: "Revolut CSV" };
  }
  if (has("Auftragskonto") && has("Buchungstag") && has("Verwendungszweck") && has("Betrag") && (has("Waehrung") || has("Währung"))) {
    return { id: "sparkasse", label: "Sparkasse CSV" };
  }
  if (has("datetime") && has("date") && has("account_type") && has("type") && has("asset_class") && has("amount") && has("transaction_id")) {
    return { id: "trade_republic", label: "Trade Republic CSV" };
  }
  return { id: "generic", label: "Generic CSV/TSV" };
}

function money(value) {
  return parseMoney(value) ?? 0;
}

function normalizeWise(headers, rows) {
  const idx = headerIndex(headers);
  const i = {
    id: idx("ID"), status: idx("Status"), direction: idx("Direction"), created: idx("Created on"), finished: idx("Finished on"),
    sourceFee: idx("Source fee amount"), sourceFeeCurrency: idx("Source fee currency"), sourceName: idx("Source name"),
    sourceAmount: idx("Source amount after fees"), sourceCurrency: idx("Source currency"), targetName: idx("Target name"),
    targetAmount: idx("Target amount after fees"), targetCurrency: idx("Target currency"), rate: idx("Exchange rate"),
    reference: idx("Reference"), category: idx("Category"), note: idx("Note")
  };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID"];
  const outRows = rows.map(row => {
    const direction = String(row[i.direction] || "").toUpperCase();
    const sourceAmount = money(row[i.sourceAmount]);
    const sourceFee = money(row[i.sourceFee]);
    const targetAmount = money(row[i.targetAmount]);
    const sourceCurrency = String(row[i.sourceCurrency] || row[i.sourceFeeCurrency] || "").toUpperCase();
    const targetCurrency = String(row[i.targetCurrency] || sourceCurrency || "").toUpperCase();
    let amount = sourceAmount;
    let currency = sourceCurrency || targetCurrency || "EUR";
    if (direction === "OUT") amount = -Math.abs(sourceAmount + sourceFee);
    else if (direction === "IN") {
      amount = Math.abs(targetAmount || sourceAmount);
      currency = targetCurrency || sourceCurrency || "EUR";
    } else if (direction === "NEUTRAL") {
      amount = targetAmount || sourceAmount;
      currency = targetCurrency || sourceCurrency || "EUR";
    }
    const description = [
      row[i.category],
      row[i.reference],
      row[i.note],
      direction === "OUT" ? `Wise transfer to ${row[i.targetName] || "target"}` : direction === "IN" ? `Wise transfer from ${row[i.sourceName] || "source"}` : "Wise balance transaction",
      row[i.rate] ? `FX ${row[i.rate]}` : ""
    ].filter(Boolean).join(" · ");
    const counterparty = direction === "OUT" ? row[i.targetName] : row[i.sourceName];
    return [row[i.finished] || row[i.created], amount, currency, counterparty, description, "", row[i.id]];
  });
  return { headers: outHeaders, rows: outRows };
}

function normalizeRevolut(headers, rows) {
  const idx = headerIndex(headers);
  const i = { type: idx("Type"), product: idx("Product"), started: idx("Started Date"), completed: idx("Completed Date"), description: idx("Description"), amount: idx("Amount"), fee: idx("Fee"), currency: idx("Currency"), state: idx("State"), balance: idx("Balance") };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID"];
  const outRows = rows
    .filter(row => String(row[i.state] || "").toUpperCase() === "COMPLETED")
    .map(row => {
      const baseAmount = money(row[i.amount]);
      const fee = money(row[i.fee]);
      const amount = baseAmount - fee;
      const description = [row[i.product], row[i.type], row[i.description], fee ? `Fee ${row[i.fee]} ${row[i.currency] || ""}` : ""].filter(Boolean).join(" · ");
      const id = [row[i.product], row[i.completed] || row[i.started], row[i.description], row[i.amount], row[i.fee], row[i.currency]].join("|");
      return [row[i.completed] || row[i.started], amount, row[i.currency], row[i.description], description, row[i.balance], id];
    });
  return { headers: outHeaders, rows: outRows };
}

function normalizeSparkasse(headers, rows) {
  const idx = headerIndex(headers);
  const i = { account: idx("Auftragskonto"), booking: idx("Buchungstag"), valueDate: idx("Valutadatum"), bookingText: idx("Buchungstext"), purpose: idx("Verwendungszweck"), counterparty: idx(["Beguenstigter/Zahlungspflichtiger", "Begünstigter/Zahlungspflichtiger"]), iban: idx("Kontonummer/IBAN"), bic: idx("BIC SWIFT Code"), amount: idx("Betrag"), currency: idx(["Waehrung", "Währung"]), info: idx("Info") };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID"];
  const outRows = rows.map(row => {
    const description = [row[i.bookingText], row[i.purpose], row[i.info], row[i.iban], row[i.bic]].filter(Boolean).join(" · ");
    const id = [row[i.account], row[i.booking], row[i.amount], row[i.counterparty], row[i.purpose]].join("|");
    return [row[i.booking] || row[i.valueDate], row[i.amount], row[i.currency], row[i.counterparty], description, "", id];
  });
  return { headers: outHeaders, rows: outRows };
}

function normalizeTradeRepublic(headers, rows) {
  const idx = headerIndex(headers);
  const i = {
    date: idx("date"), datetime: idx("datetime"), type: idx("type"), assetClass: idx("asset_class"), name: idx("name"), symbol: idx("symbol"),
    shares: idx("shares"), price: idx("price"), amount: idx("amount"), fee: idx("fee"), tax: idx("tax"), currency: idx("currency"),
    originalAmount: idx("original_amount"), originalCurrency: idx("original_currency"), fxRate: idx("fx_rate"), description: idx("description"),
    transactionId: idx("transaction_id"), counterpartyName: idx("counterparty_name"), counterpartyIban: idx("counterparty_iban"), paymentReference: idx("payment_reference"), mcc: idx("mcc_code")
  };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID"];
  const outRows = rows.map(row => {
    const amount = money(row[i.amount]) + money(row[i.fee]) + money(row[i.tax]);
    const name = row[i.name] || row[i.counterpartyName] || row[i.description] || "Trade Republic";
    const description = [
      row[i.type],
      row[i.name],
      row[i.symbol] ? `ISIN ${row[i.symbol]}` : "",
      row[i.description],
      row[i.fee] ? `Fee ${row[i.fee]} ${row[i.currency] || ""}` : "",
      row[i.tax] ? `Tax ${row[i.tax]} ${row[i.currency] || ""}` : "",
      row[i.mcc] ? `MCC ${row[i.mcc]}` : ""
    ].filter(Boolean).join(" · ");
    return [row[i.date] || row[i.datetime], amount, row[i.currency] || "EUR", name, description, "", row[i.transactionId]];
  });
  return { headers: outHeaders, rows: outRows };
}

function normalizeBankRows(headers, rows, format) {
  if (format.id === "wise") return normalizeWise(headers, rows);
  if (format.id === "revolut") return normalizeRevolut(headers, rows);
  if (format.id === "sparkasse") return normalizeSparkasse(headers, rows);
  if (format.id === "trade_republic") return normalizeTradeRepublic(headers, rows);
  return { headers, rows };
}

export async function parseBankFile(file) {
  const text = await file.text();
  const delimiter = detectDelimiter(text);
  const allRows = parseCsvRows(text, delimiter).filter(row => row.length > 1);
  if (!allRows.length) throw new Error("The file does not look like a CSV/TSV bank export.");
  const headerRowIndex = findHeaderRow(allRows);
  const rawHeaders = allRows[headerRowIndex].map((header, index) => header || `Column ${index + 1}`);
  const rawRows = allRows.slice(headerRowIndex + 1);
  const format = detectBankFormat(rawHeaders);
  const normalized = normalizeBankRows(rawHeaders, rawRows, format);
  return {
    filename: file.name,
    delimiter,
    format: format.id,
    formatLabel: format.label,
    headers: normalized.headers,
    rows: normalized.rows,
    rawHeaders,
    rawRows,
    mapping: guessMapping(normalized.headers)
  };
}

function transactionSignature(tx) {
  return [
    tx.accountId || "",
    tx.date || "",
    Number(tx.amount || 0).toFixed(2),
    String(tx.currency || "").toUpperCase(),
    normalizeText(tx.description).slice(0, 160),
    normalizeText(tx.counterparty).slice(0, 120)
  ].join("|");
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
    source: context.formatLabel ? `import:${context.formatLabel}` : "import",
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
  const existingSignatures = new Set(existingTransactions.map(transactionSignature));
  const transactions = [];
  const skipped = [];
  for (const row of parsed.rows) {
    const tx = rowToTransaction(row, mapping, { ...context, importBatchId, formatLabel: parsed.formatLabel });
    if (!tx) {
      skipped.push({ row, reason: "Missing date or amount" });
      continue;
    }
    const signature = transactionSignature(tx);
    if (existingIds.has(tx.id) || existingSignatures.has(signature) || transactions.some(item => item.id === tx.id || transactionSignature(item) === signature)) {
      skipped.push({ row, reason: "Exact duplicate" });
      continue;
    }
    transactions.push(tx);
  }
  return { transactions, skipped, importBatchId };
}

function assetTypeFrom(value) {
  const text = normalizeText(value);
  if (text.includes("etf")) return "etf";
  if (text.includes("aktie") || text.includes("stock") || text.includes("equity")) return "stock";
  if (text.includes("fonds") || text.includes("fund")) return "fund";
  if (text.includes("anleihe") || text.includes("bond")) return "bond";
  if (text.includes("crypto") || text.includes("krypto")) return "crypto";
  return "manual";
}


function findEocd(bytes) {
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  throw new Error("Invalid XLSX file: ZIP directory not found.");
}

function readUInt16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress XLSX files locally. Export the broker positions as CSV or use a current Chrome/Edge version.");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const eocd = findEocd(bytes);
  const total = readUInt16(bytes, eocd + 10);
  let cursor = readUInt32(bytes, eocd + 16);
  const entries = new Map();
  for (let n = 0; n < total; n += 1) {
    if (readUInt32(bytes, cursor) !== 0x02014b50) break;
    const method = readUInt16(bytes, cursor + 10);
    const compressedSize = readUInt32(bytes, cursor + 20);
    const fileNameLength = readUInt16(bytes, cursor + 28);
    const extraLength = readUInt16(bytes, cursor + 30);
    const commentLength = readUInt16(bytes, cursor + 32);
    const localOffset = readUInt32(bytes, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength));
    const localNameLength = readUInt16(bytes, localOffset + 26);
    const localExtraLength = readUInt16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, { method, data });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(entries, path) {
  const entry = entries.get(path);
  if (!entry) return "";
  let data;
  if (entry.method === 0) data = entry.data;
  else if (entry.method === 8) data = await inflateRaw(entry.data);
  else throw new Error(`Unsupported XLSX compression method ${entry.method}.`);
  return new TextDecoder("utf-8").decode(data);
}

function xmlDoc(xml) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = xmlDoc(xml);
  return [...doc.getElementsByTagName("si")].map(item => [...item.getElementsByTagName("t")].map(t => t.textContent || "").join(""));
}

function cellColumnIndex(ref) {
  const letters = String(ref || "").replace(/[^A-Z]/gi, "").toUpperCase();
  let value = 0;
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}

function parseWorksheet(xml, sharedStrings) {
  const doc = xmlDoc(xml);
  const rows = [];
  for (const row of [...doc.getElementsByTagName("row")]) {
    const output = [];
    for (const cell of [...row.getElementsByTagName("c")]) {
      const col = cellColumnIndex(cell.getAttribute("r"));
      const type = cell.getAttribute("t");
      let value = "";
      if (type === "inlineStr") {
        value = [...cell.getElementsByTagName("t")].map(t => t.textContent || "").join("");
      } else {
        const v = cell.getElementsByTagName("v")[0]?.textContent ?? "";
        value = type === "s" ? (sharedStrings[Number(v)] ?? "") : v;
      }
      output[col] = value;
    }
    rows.push(output.map(item => item ?? ""));
  }
  return rows;
}

async function rowsFromXlsx(file) {
  const entries = await unzipEntries(file);
  const sharedStrings = parseSharedStrings(await readZipText(entries, "xl/sharedStrings.xml"));
  const worksheetName = [...entries.keys()].find(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) || "xl/worksheets/sheet1.xml";
  const sheetXml = await readZipText(entries, worksheetName);
  if (!sheetXml) throw new Error("XLSX workbook does not contain a readable worksheet.");
  return parseWorksheet(sheetXml, sharedStrings);
}

async function rowsFromFile(file) {
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return rowsFromXlsx(file);
  const text = await file.text();
  return parseCsvRows(text, detectDelimiter(text));
}

function excelSerialToIso(value) {
  const n = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(n) || n < 20000) return parseDateValue(value);
  const epoch = new Date(Date.UTC(1899, 11, 30));
  epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
  return epoch.toISOString().slice(0, 10);
}

function detectBrokerFormat(headers) {
  const normalized = headers.map(normalizeHeader).join("|");
  if (normalized.includes("isin") && normalized.includes("wkn") && normalized.includes("stucke") && normalized.includes("marktkurs pro stuck")) {
    return { id: "smartbroker", label: "Smartbroker positions" };
  }
  if (normalized.includes("asset class") || normalized.includes("asset_class") || (normalized.includes("asset class") && normalized.includes("shares"))) {
    return { id: "trade_republic", label: "Trade Republic positions" };
  }
  if (normalized.includes("asset_class") && normalized.includes("shares") && normalized.includes("symbol")) {
    return { id: "trade_republic", label: "Trade Republic positions" };
  }
  return { id: "generic", label: "Generic positions" };
}

export async function parseBrokerPositionsFile(file) {
  const allRows = (await rowsFromFile(file)).filter(row => row.some(cell => String(cell || "").trim() !== ""));
  if (!allRows.length) throw new Error("The file does not contain position rows.");
  const headerRowIndex = allRows.slice(0, 20).reduce((best, row, index) => {
    const text = row.map(normalizeHeader).join(" ");
    const score = ["isin", "wkn", "stucke", "shares", "symbol", "marktkurs", "marktwert", "einstandswert", "assetklasse", "asset class", "name", "transaction id"].reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
    return score > best.score ? { index, score } : best;
  }, { index: 0, score: -1 }).index;
  const headers = allRows[headerRowIndex].map((header, index) => header || `Column ${index + 1}`);
  const rows = allRows.slice(headerRowIndex + 1);
  const format = detectBrokerFormat(headers);
  const idx = headerIndex(headers);
  const i = {
    date: idx("DATUM"), isin: idx("ISIN"), wkn: idx("WKN"), symbol: idx(["KÜRZEL", "KUERZEL", "Kürzel"]), name1: idx("NAME 1"), name2: idx("NAME 2"),
    assetClass: idx("ASSETKLASSE"), quantity: idx(["STÜCKE", "STUECKE", "Stücke"]), buyPrice: idx(["EINSTANDSKURS PRO STÜCK", "EINSTANDSKURS PRO STUECK"]),
    price: idx(["MARKTKURS PRO STÜCK", "MARKTKURS PRO STUECK"]), costBasis: idx("EINSTANDSWERT"), marketValue: idx("MARKTWERT"), currency: idx(["WÄHRUNG", "WAEHRUNG"]), exchange: idx("BÖRSE")
  };
  if (format.id === "trade_republic") {
    const ti = {
      date: idx("date"), datetime: idx("datetime"), assetClass: idx("asset_class"), name: idx("name"), symbol: idx("symbol"), shares: idx("shares"),
      price: idx("price"), amount: idx("amount"), currency: idx("currency"), type: idx("type"), description: idx("description")
    };
    const bySymbol = new Map();
    const skipped = [];
    for (const row of rows) {
      const symbol = String(row[ti.symbol] || "").trim().toUpperCase();
      const name = String(row[ti.name] || "").trim();
      const quantity = parseMoney(row[ti.shares]);
      if (!symbol && !name) {
        skipped.push({ row, reason: "Missing symbol/ISIN and name" });
        continue;
      }
      if (!Number.isFinite(Number(quantity)) || Number(quantity) === 0) {
        skipped.push({ row, reason: "Missing quantity/shares" });
        continue;
      }
      const date = parseDateValue(row[ti.date] || row[ti.datetime]);
      const key = symbol || normalizeText(name);
      const existing = bySymbol.get(key);
      if (existing && String(existing.date || "") > String(date || "")) continue;
      const price = parseMoney(row[ti.price]) || 0;
      bySymbol.set(key, {
        symbol,
        name: name || symbol,
        type: assetTypeFrom(row[ti.assetClass]),
        quantity: Number(quantity || 0),
        currency: String(row[ti.currency] || "EUR").trim().toUpperCase().slice(0, 3) || "EUR",
        costBasis: 0,
        buyPrice: 0,
        manualPrice: Number(price || 0),
        lastPrice: price ? Number(price) : null,
        lastPriceAt: date ? `${date}T00:00:00.000Z` : new Date().toISOString(),
        provider: "manual",
        wkn: "",
        isin: symbol,
        hidden: false,
        startingPosition: true,
        startingAt: date || new Date().toISOString().slice(0, 10),
        startingValue: price ? Number(price || 0) * Number(quantity || 0) : 0,
        note: [row[ti.type], row[ti.description]].filter(Boolean).join(" · "),
        raw: row,
        date
      });
    }
    return { filename: file.name, format: format.id, formatLabel: format.label, headers, rows, positions: [...bySymbol.values()].map(({ date, ...position }) => position), skipped };
  }

  const positions = [];
  const skipped = [];
  for (const row of rows) {
    const isin = String(row[i.isin] || "").trim().toUpperCase();
    const wkn = String(row[i.wkn] || "").trim().toUpperCase();
    const symbol = String(row[i.symbol] || wkn || isin || "").trim().toUpperCase();
    const quantity = parseMoney(row[i.quantity]);
    if (!symbol && !isin && !wkn) {
      skipped.push({ row, reason: "Missing symbol, ISIN and WKN" });
      continue;
    }
    if (!Number.isFinite(Number(quantity))) {
      skipped.push({ row, reason: "Missing quantity" });
      continue;
    }
    const name = [row[i.name1], row[i.name2]].filter(Boolean).join(" · ").trim() || symbol || isin || wkn;
    positions.push({
      symbol,
      name,
      type: assetTypeFrom(row[i.assetClass]),
      quantity: Number(quantity || 0),
      currency: String(row[i.currency] || "EUR").trim().toUpperCase().slice(0, 3) || "EUR",
      costBasis: parseMoney(row[i.costBasis]) || 0,
      buyPrice: normalizeHeader(String(row[i.buyPrice] || "")).match(/^\d{4,}$/) ? (parseMoney(row[i.buyPrice]) || 0) / 1000 : (parseMoney(row[i.buyPrice]) || 0),
      manualPrice: normalizeHeader(String(row[i.price] || "")).match(/^\d{4,}$/) ? (parseMoney(row[i.price]) || 0) / 1000 : (parseMoney(row[i.price]) || 0),
      lastPrice: parseMoney(row[i.price]) || null,
      lastPriceAt: excelSerialToIso(row[i.date]) ? `${excelSerialToIso(row[i.date])}T00:00:00.000Z` : new Date().toISOString(),
      provider: "manual",
      wkn,
      isin,
      hidden: false,
      startingPosition: true,
      startingAt: excelSerialToIso(row[i.date]) || new Date().toISOString().slice(0, 10),
      startingValue: (parseMoney(row[i.marketValue]) || 0) || (parseMoney(row[i.costBasis]) || 0),
      note: row[i.exchange] ? `Exchange: ${row[i.exchange]}` : "",
      raw: row
    });
  }
  return { filename: file.name, format: format.id, formatLabel: format.label, headers, rows, positions, skipped };
}

function assetKey(asset) {
  const id = String(asset.isin || asset.wkn || asset.symbol || "").trim().toUpperCase();
  return `${asset.accountId || ""}|${id}`;
}

export function buildBrokerPositionsPreview(parsed, context, existingAssets = []) {
  const existingByKey = new Map(existingAssets.map(asset => [assetKey(asset), asset]));
  const positions = parsed.positions.map(position => {
    const draft = { ...position, accountId: context.accountId };
    const existing = existingByKey.get(assetKey(draft));
    return {
      ...draft,
      id: existing?.id || undefined,
      startingPosition: existing ? Boolean(existing.startingPosition) : Boolean(draft.startingPosition),
      startingAt: existing?.startingAt || draft.startingAt || "",
      startingValue: existing?.startingValue ?? draft.startingValue ?? 0,
      action: existing ? "Update" : "New"
    };
  });
  return { positions, skipped: parsed.skipped || [], formatLabel: parsed.formatLabel };
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
