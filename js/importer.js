import { accountIdentifiers, categorizeTransaction, normalizeIdentifier, normalizeText, parseDateValue, parseMoney, transactionHash, uid } from "./finance.js";
import { decryptAgileXlsx, isOleCompoundFile } from "./ooxml-crypto.js";

const KAKAOPAY_DEFAULT_PASSWORD = "020521";

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
  category: ["category", "kategorie"],
  excludeFromStats: ["exclude from stats", "ignore in stats", "ignore in spending", "ignore in spending statistics", "statistics", "spending stats"],
  note: ["note", "notes", "import note", "metadata", "transfer info"],
  accountKey: ["account key", "account ledger", "ledger", "product account", "provider account"],
  fee: ["fee", "fees", "total fees"],
  externalId: ["external id", "transaction id", "transferwise id", "id"],
  categoryOverride: ["category override", "category id", "forced category"]
};

export const RECOGNIZED_BANK_FORMATS = [
  "Wise currency statement CSV/XLSX: TransferWise ID or ID, Date Time, Amount, Running Balance, Total fees",
  "Wise legacy CSV: ID, Direction, Created/Finished on, Source/Target amount and currency",
  "Revolut consolidated XLSX/CSV: Date, Description, Category, Money in/out, Balance, Fees",
  "Revolut account CSV/XLSX: Type, Product, Started/Completed Date, Description, Amount, Fee, Currency, State, Balance",
  "PayPal CSV: Datum, Name, Typ, Status, Währung, Brutto/Netto, Transaktionscode, Auswirkung auf Guthaben",
  "KakaoPay XLSX: 거래일시, 거래구분/내용, 거래금액, 거래 후 잔액 (password-protected exports unlock automatically)",
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


function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/â‚¬/g, "€")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    // NFKD decomposes Hangul syllables into jamo; keep jamo ranges and recompose.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\u1100-\u11FF\u3130-\u318F\uac00-\ud7a3]+/g, " ")
    .normalize("NFC")
    .trim();
}

function headerIndex(headers) {
  const normalized = headers.map(normalizeHeader);
  return key => {
    const candidates = Array.isArray(key) ? key : [key];
    const normalizedCandidates = candidates.map(normalizeHeader).filter(Boolean);
    if (!normalizedCandidates.length) return null;
    let index = normalized.findIndex(header => header && normalizedCandidates.includes(header));
    if (index >= 0) return index;
    index = normalized.findIndex(header => header && normalizedCandidates.some(candidate => candidate.length >= 2 && (header.includes(candidate) || candidate.includes(header))));
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
  rows.slice(0, 40).forEach((row, index) => {
    const normalized = row.map(normalizeHeader).join(" ");
    const score = [
      "date", "datum", "betrag", "amount", "saldo", "description", "verwendungszweck", "buchung",
      "direction", "completed date", "money in out", "fees", "transaktionscode", "auswirkung auf guthaben",
      "running balance", "transaction details type", "거래일시", "거래금액", "이용금액", "거래 후 잔액"
    ].reduce((total, word) => total + (normalized.includes(normalizeHeader(word)) || normalized.includes(word) ? 1 : 0), 0);
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

function detectBankFormat(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const has = value => normalizedHeaders.includes(normalizeHeader(value));
  const normalizedJoined = normalizedHeaders.join("|");
  const hasAny = (...values) => values.some(value => has(value));
  if (
    has("Date Time") && has("Amount") && has("Running Balance") && hasAny("Total fees", "Total Fees") &&
    (has("TransferWise ID") || (has("ID") && hasAny("Transaction Details Type", "Transaction Type")))
  ) {
    return { id: "wise_statement", label: "Wise currency statement" };
  }
  if (has("ID") && has("Direction") && normalizedJoined.includes("source amount after fees") && normalizedJoined.includes("target amount after fees")) {
    return { id: "wise", label: "Wise legacy CSV" };
  }
  if (has("Type") && has("Product") && has("Completed Date") && has("Amount") && has("Fee") && has("Currency")) {
    return { id: "revolut", label: "Revolut account statement" };
  }
  if (has("Date") && has("Description") && has("Category") && normalizedJoined.includes("money in out") && has("Balance")) {
    return { id: "revolut_consolidated", label: "Revolut consolidated statement" };
  }
  if (
    has("Datum") && hasAny("Transaktionscode", "Transaction ID") && hasAny("Währung", "Currency") &&
    hasAny("Netto", "Brutto", "Net", "Gross") && hasAny("Auswirkung auf Guthaben", "Balance Impact", "Status")
  ) {
    return { id: "paypal", label: "PayPal CSV" };
  }
  if (
    hasAny("거래일시", "이용일시", "거래 일시", "날짜") &&
    hasAny("거래금액", "이용금액", "거래 금액", "금액") &&
    hasAny("거래구분", "이용구분", "구분", "내용", "가맹점", "가맹점명", "적요", "사용처")
  ) {
    return { id: "kakaopay", label: "KakaoPay statement" };
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

function truthy(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "ja", "ignore", "ignored", "exclude", "excluded"].includes(text);
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}



function appendUniqueNoteLine(note = "", line = "") {
  const clean = String(line || "").trim();
  if (!clean) return String(note || "").trim();
  const current = String(note || "").trim();
  if (current.toLowerCase().includes(clean.toLowerCase())) return current;
  return [current, clean].filter(Boolean).join("\n");
}

function ruleApplicationNote(categorization = {}, categoryId = "", categories = []) {
  if (!categorization || categorization.review) return "";
  const candidate = (categorization.candidates || []).find(item => item.categoryId === categoryId) || categorization.candidates?.[0] || null;
  const ruleLabel = categorization.ruleLabel || candidate?.ruleLabel || "";
  const ruleId = categorization.ruleId || candidate?.ruleId || "";
  const keywords = Array.isArray(categorization.matchedKeywords) && categorization.matchedKeywords.length
    ? categorization.matchedKeywords
    : (candidate?.keywords || []);
  if (!ruleLabel && !ruleId) return "";
  const categoryName = categories.find(cat => cat.id === categoryId)?.name || candidate?.categoryName || categoryId || "category";
  const keywordText = keywords.length ? ` via keyword${keywords.length === 1 ? "" : "s"} '${keywords.join("', '")}'` : "";
  return `Rule applied: '${ruleLabel || "unnamed rule"}'${keywordText} → ${categoryName}.`;
}

function reviewReasonNote(reason = "") {
  const detail = String(reason || "Manual review requested.").trim();
  return `Needs review: ${detail}`;
}

function enrichTransactionNoteForAutomation(tx = {}, categorization = null, categories = []) {
  let note = String(tx.note || "").trim();
  const ruleLine = ruleApplicationNote(categorization, tx.categoryId, categories);
  if (ruleLine) note = appendUniqueNoteLine(note, ruleLine);
  if (tx.review) note = appendUniqueNoteLine(note, reviewReasonNote(tx.reason));
  return { ...tx, note };
}

function amountWithFeeSplitRows({ date, movement, fee = 0, currency, counterparty, description, balance = "", externalId, excludeFromStats, note, accountKey, categoryId = "" }) {
  const rows = [];
  const feeAmount = Math.abs(Number(fee || 0));
  const move = Number(movement || 0);
  const shouldSplitFee = Boolean(excludeFromStats && feeAmount > 0 && move !== 0);
  const neutralMovement = shouldSplitFee ? move + feeAmount : move;
  rows.push([date, neutralMovement, currency, counterparty, description, balance, externalId, excludeFromStats ? "true" : "false", note, accountKey, categoryId]);
  if (shouldSplitFee) {
    rows.push([date, -feeAmount, currency, "Bank fee", `${description} · Fee`, "", `${externalId}_fee`, "false", `Fee split from ignored transfer. Original movement ${move} ${currency}.`, accountKey, "bank_fees"]);
  }
  return rows;
}


function dateSortKey(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const milli = Number(String(match[7] || "0").padEnd(3, "0"));
    return Date.UTC(year, month - 1, day, hour, minute, second, milli);
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  const date = parseDateValue(value);
  const fallback = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
  return Number.isFinite(fallback) ? fallback : 0;
}

function parseWiseDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(.*))?$/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${month}-${day}`;
  }
  return parseExcelSerialDate(value);
}

function parseExcelSerialDate(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 20000 && number < 70000) return parseDateValue(number);
  return parseDateValue(value);
}

function parseNativeNumber(value, currency = "") {
  const preferred = String(currency || "").toUpperCase();
  const raw = String(value ?? "").replace(/\u00A0/g, " ").replace(/−/g, "-").trim();
  if (!raw) return 0;
  if (["KRW", "JPY"].includes(preferred)) {
    const sign = /^-|−/.test(raw) || raw.includes("-") ? -1 : 1;
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) return 0;
    return sign * Number(digits);
  }
  return money(raw);
}

function kakaoPaySignedAmount(amount, kind = "", description = "", rawAmount = "") {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value === 0) return value;
  const raw = String(rawAmount ?? "").replace(/\u00A0/g, " ").replace(/−/g, "-").trim();
  // Prefer the spreadsheet's own sign when present (+15,000원 / -9,000원).
  if (/^[+-]/.test(raw) || raw.includes("-") || raw.includes("+")) return value < 0 ? -Math.abs(value) : Math.abs(value);
  if (value < 0) return value;
  const text = normalizeText([kind, description].join(" "));
  if (["입금", "충전", "환불", "취소", "적립", "받"].some(token => text.includes(normalizeText(token)))) return Math.abs(value);
  if (["결제", "송금", "출금", "사용", "승인", "보냄"].some(token => text.includes(normalizeText(token)))) return -Math.abs(value);
  return -Math.abs(value);
}

function isKakaoPayIgnoredMovement(kind = "", description = "") {
  const text = normalizeText([kind, description].join(" "));
  if (!text) return { ignore: false, reason: "" };
  // Match top-up/transfer kinds, not merchant names that merely contain 충전 (e.g. 충전돼지).
  const exactTokens = ["충전", "자동충전", "머니 충전", "출금", "입금", "이체", "송금"];
  const kindText = normalizeText(kind);
  if (exactTokens.some(token => {
    const needle = normalizeText(token);
    return Boolean(needle) && (kindText === needle || kindText.includes(needle));
  })) {
    return { ignore: true, reason: "KakaoPay top-up/withdrawal/transfer; excluded from spending statistics." };
  }
  if (/(^|\s)(자동\s*)?머니\s*충전(\s|$)/.test(text) || /(^|\s)카카오페이\s*충전(\s|$)/.test(text)) {
    return { ignore: true, reason: "KakaoPay top-up/withdrawal/transfer; excluded from spending statistics." };
  }
  return { ignore: false, reason: "" };
}

function normalizeKakaoPay(headers, rows, filename = "") {
  const idx = headerIndex(headers);
  const i = {
    date: idx(["거래일시", "이용일시", "거래 일시", "일시", "날짜", "Date"]),
    kind: idx(["거래구분", "이용구분", "구분", "유형", "Type"]),
    description: idx(["사용처", "내용", "적요", "가맹점", "가맹점명", "이용처", "상품명", "Description"]),
    amount: idx(["거래금액", "이용금액", "거래 금액", "금액", "Amount"]),
    balance: idx(["거래 후 잔액", "거래후잔액", "잔액", "Balance"]),
    method: idx(["결제수단", "수단", "카드", "Method"]),
    status: idx(["상태", "Status"]),
    memo: idx(["메모", "비고", "Note"])
  };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID", "Exclude From Stats", "Note", "Account Key", "Category Override"];
  const outRows = [];
  const source = filename || "KakaoPay statement";
  for (const row of rows) {
    const date = parseExcelSerialDate(row[i.date]);
    if (!date) continue;
    const currency = "KRW";
    const kind = cleanText(row[i.kind]);
    const descriptionText = cleanText(row[i.description]);
    const rawAmount = row[i.amount];
    const amount = kakaoPaySignedAmount(parseNativeNumber(rawAmount, currency), kind, descriptionText, rawAmount);
    if (!Number.isFinite(Number(amount)) || amount === 0) continue;
    const method = cleanText(row[i.method]);
    const status = cleanText(row[i.status]);
    const ignored = isKakaoPayIgnoredMovement(kind, descriptionText);
    const counterparty = descriptionText || kind || "KakaoPay";
    const note = [kind, method, status, cleanText(row[i.memo]), ignored.reason, `Source ${source}`].filter(Boolean).join(" · ");
    const description = [kind, descriptionText, method].filter(Boolean).join(" · ");
    const balance = i.balance == null ? "" : parseNativeNumber(row[i.balance], currency);
    outRows.push(...amountWithFeeSplitRows({
      date,
      movement: amount,
      fee: 0,
      currency,
      counterparty,
      description,
      balance: Number.isFinite(Number(balance)) ? balance : "",
      externalId: ["kakaopay", date, amount, kind, descriptionText, method].join("|"),
      excludeFromStats: ignored.ignore,
      note,
      accountKey: "kakaopay:KRW",
      categoryId: ignored.ignore ? "transfer" : ""
    }));
  }
  return { headers: outHeaders, rows: outRows };
}

function firstNativeMoney(value, currency = "") {
  if (value == null || value === "") return 0;
  const text = String(value).replace(/â‚¬/g, "€").replace(/\u00A0/g, " ").replace(/−/g, "-");
  const preferred = String(currency || "").toUpperCase();
  const escaped = preferred.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (preferred && preferred !== "EUR") {
    const pattern = new RegExp(`([+-]?\\s*\\d[\\d,.\\s]*)\\s*${escaped}\\b`, "i");
    const match = text.match(pattern);
    if (match) return parseNativeNumber(match[1], preferred);
  }
  if (preferred === "EUR") {
    const match = text.match(/([+-]?\s*(?:€|EUR|â‚¬)\s*\d[\d,.]*|[+-]?\s*\d[\d,.]*\s*(?:€|EUR|â‚¬))/i);
    if (match) return money(match[1]);
  }
  const generic = text.match(/[+-]?\s*\d[\d,.]*/);
  return generic ? parseNativeNumber(generic[0], preferred) : money(text);
}

function isOwnName(text = "") {
  const normalized = normalizeIdentifier(text);
  return normalized.includes("anhhao") || normalized.includes("henryluu") || normalized.includes("anhaohenryluu");
}

function isWiseIgnoredMovement(row, i) {
  const details = normalizeText(row[i.detailsType]);
  const description = normalizeText(row[i.description]);
  const transactionType = normalizeText(row[i.transactionType]);
  const exchangeFrom = String(row[i.exchangeFrom] || "").trim().toUpperCase();
  const exchangeTo = String(row[i.exchangeTo] || "").trim().toUpperCase();
  const ownCounterparty = isOwnName([row[i.description], row[i.payer], row[i.payee]].join(" "));
  if (details.includes("conversion") || description.includes("converted")) return { ignore: true, reason: "Wise currency conversion; excluded from spending statistics." };
  if (details.includes("money_added") || description.includes("topped up") || description.includes("top up")) return { ignore: true, reason: "Wise top-up; excluded from spending statistics." };
  if (ownCounterparty && exchangeFrom && exchangeTo && exchangeFrom !== exchangeTo) return { ignore: true, reason: "Wise self-transfer with currency exchange; excluded from spending statistics." };
  if (ownCounterparty && details.includes("transfer")) return { ignore: true, reason: "Wise self-transfer; excluded from spending statistics." };
  if (transactionType === "credit" && (description.includes("refund") || description.includes("reversal"))) return { ignore: true, reason: "Wise refund/reversal; excluded from spending statistics." };
  return { ignore: false, reason: "" };
}

function normalizeWiseStatement(headers, rows) {
  const idx = headerIndex(headers);
  const i = {
    id: idx(["TransferWise ID", "ID"]), date: idx("Date"), dateTime: idx("Date Time"), amount: idx("Amount"), currency: idx("Currency"), description: idx("Description"), reference: idx("Payment Reference"),
    balance: idx("Running Balance"), exchangeFrom: idx("Exchange From"), exchangeTo: idx("Exchange To"), rate: idx("Exchange Rate"), payer: idx("Payer Name"), payee: idx("Payee Name"), merchant: idx("Merchant"),
    note: idx("Note"), fees: idx(["Total fees", "Total Fees"]), exchangeToAmount: idx("Exchange To Amount"), transactionType: idx("Transaction Type"), detailsType: idx("Transaction Details Type")
  };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID", "Exclude From Stats", "Note", "Account Key", "Category Override"];
  const outRows = [];
  const sorted = [...rows].sort((a, b) => dateSortKey(a[i.dateTime] || a[i.date]) - dateSortKey(b[i.dateTime] || b[i.date]));
  for (const row of sorted) {
    const currency = String(row[i.currency] || "EUR").toUpperCase();
    const movement = money(row[i.amount]);
    if (!Number.isFinite(Number(movement))) continue;
    const fee = money(row[i.fees]);
    const date = parseWiseDate(row[i.dateTime] || row[i.date]);
    const detailsType = String(row[i.detailsType] || "").trim();
    const txType = String(row[i.transactionType] || "").trim();
    const ignored = isWiseIgnoredMovement(row, i);
    const counterparty = row[i.merchant] || row[i.payee] || row[i.payer] || (ignored.ignore ? "Wise internal" : "Wise");
    const meta = [
      row[i.reference] ? `Ref ${row[i.reference]}` : "",
      detailsType ? `Details ${detailsType}` : "",
      txType ? `Type ${txType}` : "",
      row[i.exchangeFrom] || row[i.exchangeTo] ? `FX ${row[i.exchangeFrom] || "?"} → ${row[i.exchangeTo] || "?"}${row[i.rate] ? ` @ ${row[i.rate]}` : ""}` : "",
      Number(fee || 0) ? `Total fees ${fee} ${currency} · informational; not subtracted again` : "",
      ignored.reason
    ].filter(Boolean).join(" · ");
    const description = [row[i.description], meta].filter(Boolean).join(" · ");
    const accountKey = `wise:${currency}`;
    const categoryOverride = ignored.ignore ? "transfer" : "";
    outRows.push(...amountWithFeeSplitRows({
      date,
      movement,
      fee,
      currency,
      counterparty,
      description,
      balance: row[i.balance],
      externalId: row[i.id] || [date, movement, description, row[i.balance]].join("|"),
      excludeFromStats: ignored.ignore,
      note: meta,
      accountKey,
      categoryId: categoryOverride
    }));
  }
  const first = sorted.find(row => row[i.balance] !== undefined && row[i.balance] !== "" && row[i.amount] !== undefined && row[i.amount] !== "");
  const openingBalanceHint = first ? money(first[i.balance]) - money(first[i.amount]) : null;
  return { headers: outHeaders, rows: outRows, openingBalanceHint, openingBalanceDetails: [{ product: `wise:${String(first?.[i.currency] || "").toUpperCase()}`, value: openingBalanceHint }] };
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
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID", "Exclude From Stats", "Note", "Account Key", "Category Override"];
  const outRows = rows.flatMap(row => {
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
    const isNeutral = direction === "NEUTRAL" || sourceCurrency !== targetCurrency || normalizeText(row[i.category]).includes("transfer");
    const description = [
      row[i.category], row[i.reference], row[i.note],
      direction === "OUT" ? `Wise transfer to ${row[i.targetName] || "target"}` : direction === "IN" ? `Wise transfer from ${row[i.sourceName] || "source"}` : "Wise balance transaction",
      row[i.rate] ? `FX ${row[i.rate]}` : "",
      isNeutral ? "Wise transfer/conversion; excluded from spending statistics." : ""
    ].filter(Boolean).join(" · ");
    const counterparty = direction === "OUT" ? row[i.targetName] : row[i.sourceName];
    return amountWithFeeSplitRows({
      date: row[i.finished] || row[i.created],
      movement: amount,
      fee: sourceFee,
      currency,
      counterparty,
      description,
      balance: "",
      externalId: row[i.id],
      excludeFromStats: isNeutral,
      note: description,
      accountKey: `wise:${currency}`,
      categoryId: isNeutral ? "transfer" : ""
    });
  });
  return { headers: outHeaders, rows: outRows };
}

function isRevolutNeutral(category = "", description = "") {
  const cat = normalizeText(category);
  const desc = normalizeText(description);
  const compact = normalizeIdentifier([category, description].join(" "));
  // Interest paid into savings is real income, not an internal transfer.
  if (cat.includes("interest") || desc.includes("net interest")) return false;
  const transferLike = [
    "top up", "top-up", "topup", "exchange", "exchanged", "currency exchange", "transfer",
    "savings transfer", "deposit", "current account transfer",
    "payment from anh", "payment to anh", "open banking top-up", "apple pay top-up"
  ].some(token => desc.includes(token) || cat.includes(token));
  const savingsMovement = desc.includes("from instant access savings") || desc.includes("to instant access savings") ||
    ((desc.includes("instant access savings") || cat.includes("instant access savings")) && !desc.includes("interest"));
  const own = isOwnName(desc) || compact.includes("anhaohenryluu") || compact.includes("anhhaohenryluu");
  return transferLike || savingsMovement ||
    (cat.includes("others") && (savingsMovement || desc.includes("savings") || desc.includes("exchanged") || own)) ||
    desc.includes("exchanged to") || desc.includes("exchanged from") || own;
}

function normalizeRevolut(headers, rows) {
  const idx = headerIndex(headers);
  const i = { type: idx("Type"), product: idx("Product"), started: idx("Started Date"), completed: idx("Completed Date"), description: idx("Description"), amount: idx("Amount"), fee: idx("Fee"), currency: idx("Currency"), state: idx("State"), balance: idx("Balance") };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID", "Exclude From Stats", "Note", "Account Key", "Category Override"];
  const allowedRows = rows.filter(row => ["COMPLETED", "PENDING"].includes(String(row[i.state] || "").toUpperCase()));

  const openingByProduct = new Map();
  for (const row of allowedRows.filter(row => String(row[i.state] || "").toUpperCase() === "COMPLETED")) {
    const product = String(row[i.product] || "Current");
    const currency = String(row[i.currency] || "EUR").toUpperCase();
    const key = `revolut:${product}:${currency}`;
    const balance = money(row[i.balance]);
    if (openingByProduct.has(key) || balance == null) continue;
    const netAmount = money(row[i.amount]) - money(row[i.fee]);
    openingByProduct.set(key, balance - netAmount);
  }
  const openingBalanceHint = [...openingByProduct.values()].reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);

  const outRows = allowedRows.flatMap(row => {
    const baseAmount = money(row[i.amount]);
    const fee = money(row[i.fee]);
    const movement = roundMoney(baseAmount - fee);
    const currency = String(row[i.currency] || "EUR").toUpperCase();
    const product = String(row[i.product] || "Current");
    const state = String(row[i.state] || "").toUpperCase();
    const date = parseExcelSerialDate(row[i.started] || row[i.completed]);
    const neutral = isRevolutNeutral(row[i.type], row[i.description]);
    const note = [product, row[i.type], state, fee ? `Fee ${fee} ${currency}` : "", neutral ? "Revolut internal/top-up/exchange; excluded from spending statistics." : ""].filter(Boolean).join(" · ");
    const description = [product, row[i.type], row[i.description], state === "PENDING" ? "Pending" : "", fee ? `Fee ${fee} ${currency}` : ""].filter(Boolean).join(" · ");
    const id = [product, date || row[i.completed] || row[i.started], row[i.description], row[i.amount], row[i.fee], currency, state].join("|");
    return amountWithFeeSplitRows({
      date,
      movement,
      fee,
      currency,
      counterparty: row[i.description],
      description,
      balance: row[i.balance],
      externalId: id,
      excludeFromStats: neutral,
      note,
      accountKey: `revolut:${product}:${currency}`,
      categoryId: neutral ? "transfer" : ""
    });
  });
  return { headers: outHeaders, rows: outRows, openingBalanceHint, openingBalanceDetails: [...openingByProduct.entries()].map(([product, value]) => ({ product, value })) };
}

function accountLineBefore(rows, index) {
  for (let i = index - 1; i >= Math.max(0, index - 8); i -= 1) {
    const text = String(rows[i]?.[0] || "");
    if (/Personal Account|Savings/i.test(text)) return text;
  }
  return "Revolut Account";
}

function currencyFromAccountLine(line, fallback = "EUR") {
  const match = String(line || "").match(/\(([^)]+)\)/);
  return String(match?.[1] || fallback).trim().toUpperCase();
}

function productFromAccountLine(line) {
  return /savings|deposit|instant access/i.test(String(line || "")) ? "Deposit" : "Current";
}

function normalizeRevolutConsolidatedRows(rows, filename = "") {
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID", "Exclude From Stats", "Note", "Account Key", "Category Override"];
  const outRows = [];
  const openingDetails = [];
  const source = filename || "Revolut consolidated statement";

  const isInstantAccessSavings = value => normalizeText(value).includes("instant access savings");
  const addRow = ({ date, movement, currency, counterparty, description, balance = "", externalId, excludeFromStats = false, note = "", accountKey, categoryId = "" }) => {
    if (!date || !Number.isFinite(Number(movement))) return;
    outRows.push(...amountWithFeeSplitRows({
      date,
      movement,
      fee: 0,
      currency,
      counterparty,
      description,
      balance,
      externalId,
      excludeFromStats,
      note,
      accountKey,
      categoryId
    }));
  };

  for (let h = 0; h < rows.length; h += 1) {
    const header = rows[h].map(cleanText);
    const isTransaction = header[0] === "Date" && header[1] === "Description" && header[2] === "Category" && normalizeText(header[3]).includes("money in out");
    const isInterest = header[0] === "Date" && header[1] === "Description" && normalizeText(header[3]).includes("gross interest") && normalizeText(header[7]).includes("net interest");
    if (!isTransaction && !isInterest) continue;

    const accountLine = accountLineBefore(rows, h);
    const currency = currencyFromAccountLine(accountLine, "EUR");
    const product = productFromAccountLine(accountLine);
    const accountKey = `revolut:${product}:${currency}`;

    for (let r = h + 1; r < rows.length; r += 1) {
      const row = rows[r];
      const first = cleanText(row[0]);
      if (!first) continue;
      if (first === "---------" || /Transaction statement/i.test(first) || (first === "Date" && cleanText(row[1]) === "Description")) break;
      if (/^Total$/i.test(first)) break;

      const date = parseExcelSerialDate(row[0]);
      if (!date) continue;

      if (isTransaction) {
        const descriptionText = cleanText(row[1]);
        const category = cleanText(row[2]);
        const rawMovement = row[3];
        const movement = firstNativeMoney(rawMovement, currency);
        if (!Number.isFinite(Number(movement))) continue;
        const balance = firstNativeMoney(row[4], currency);
        const feeInfo = Math.abs(firstNativeMoney(row[7], currency));
        const neutral = isRevolutNeutral(category, descriptionText);
        const note = [
          accountKey,
          category,
          feeInfo ? `Fee ${feeInfo} ${currency} already included in Money in/out; not subtracted again` : "",
          neutral ? "Revolut internal/top-up/exchange/savings movement; excluded from spending statistics." : "",
          `Source ${source}`
        ].filter(Boolean).join(" · ");

        addRow({
          date,
          movement,
          currency,
          counterparty: descriptionText || "Revolut",
          description: [accountLine, category, descriptionText, feeInfo ? `Fee ${feeInfo} ${currency} informational` : ""].filter(Boolean).join(" · "),
          balance: Number.isFinite(Number(balance)) ? balance : "",
          externalId: [`revolut-consolidated-current`, accountKey, date, descriptionText, rawMovement, row[4]].join("|"),
          excludeFromStats: neutral,
          note,
          accountKey,
          categoryId: neutral ? "transfer" : ""
        });

        // Revolut consolidated statements often list savings transfers only in
        // the EUR current account. Mirror those rows into the deposit ledger
        // with the inverse movement so the deposit balance is reconstructed.
        if (product === "Current" && currency === "EUR" && isInstantAccessSavings(descriptionText)) {
          const depositAccountKey = "revolut:Deposit:EUR";
          addRow({
            date,
            movement: -movement,
            currency: "EUR",
            counterparty: "Revolut Savings",
            description: [`Savings (EUR)`, descriptionText, "Mirror of current-account savings transfer"].filter(Boolean).join(" · "),
            balance: "",
            externalId: [`revolut-consolidated-deposit-transfer`, depositAccountKey, date, descriptionText, rawMovement].join("|"),
            excludeFromStats: true,
            note: [depositAccountKey, `Inverse of current-account movement ${movement} EUR`, "Reconstructs Instant Access Savings balance from current-account transfer row", `Source ${source}`].join(" · "),
            accountKey: depositAccountKey,
            categoryId: "transfer"
          });
        }
      } else if (isInterest) {
        const descriptionText = cleanText(row[1]);
        const movement = firstNativeMoney(row[7], currency);
        const feeInfo = Math.abs(firstNativeMoney(row[6], currency));
        if (!Number.isFinite(Number(movement))) continue;
        addRow({
          date,
          movement,
          currency,
          counterparty: "Revolut Savings",
          description: [accountLine, descriptionText, "Net interest"].filter(Boolean).join(" · "),
          balance: "",
          externalId: [`revolut-consolidated-interest`, accountKey, date, descriptionText, row[7]].join("|"),
          excludeFromStats: false,
          note: [accountKey, "Savings net interest", feeInfo ? `Fee ${feeInfo} ${currency} informational; not subtracted again` : "", `Source ${source}`].filter(Boolean).join(" · "),
          accountKey,
          categoryId: "income_dividend"
        });
      }
    }
  }

  return { headers: outHeaders, rows: outRows, openingBalanceHint: null, openingBalanceDetails: openingDetails };
}


function isPayPalIgnoredMovement(type = "", status = "", impact = "", description = "") {
  const typ = normalizeText(type);
  const st = normalizeText(status);
  const imp = normalizeText(impact);
  const desc = normalizeText(description);
  if (imp.includes("memo") || typ.includes("autorisierung") || typ.includes("authorization") || typ.includes("general authorization")) {
    return { skip: true, ignore: false, reason: "" };
  }
  if (
    typ.includes("bankgutschrift") ||
    typ.includes("bank deposit to paypal") ||
    typ.includes("auflosung einer bankgutschrift") ||
    typ.includes("reserve for payment cover") ||
    desc.includes("bankgutschrift auf paypal")
  ) {
    return { skip: false, ignore: true, reason: "PayPal bank funding/cover; excluded from spending statistics." };
  }
  if (st.includes("ausstehend") || st.includes("pending") || st.includes("platzhalter")) {
    return { skip: true, ignore: false, reason: "" };
  }
  if (!(st.includes("abgeschlossen") || st.includes("completed") || st.includes("erledigt") || st === "")) {
    return { skip: true, ignore: false, reason: "" };
  }
  return { skip: false, ignore: false, reason: "" };
}

function normalizePayPal(headers, rows) {
  const idx = headerIndex(headers);
  const i = {
    date: idx("Datum"),
    time: idx("Uhrzeit"),
    name: idx("Name"),
    type: idx("Typ"),
    status: idx("Status"),
    currency: idx(["Währung", "Waehrung", "Currency"]),
    gross: idx(["Brutto", "Gross"]),
    fee: idx(["Gebühr", "Gebuehr", "Fee"]),
    net: idx(["Netto", "Net"]),
    sender: idx(["Absender E-Mail-Adresse", "From Email Address"]),
    recipient: idx(["Empfänger E-Mail-Adresse", "Empfaenger E-Mail-Adresse", "To Email Address"]),
    txId: idx(["Transaktionscode", "Transaction ID"]),
    subject: idx(["Betreff", "Subject"]),
    note: idx(["Hinweis", "Note"]),
    balance: idx(["Guthaben", "Balance"]),
    impact: idx(["Auswirkung auf Guthaben", "Balance Impact"]),
    item: idx(["Artikelbezeichnung", "Item Title"]),
    relatedId: idx(["Zugehöriger Transaktionscode", "Zugehoeriger Transaktionscode", "Reference Txn ID"])
  };
  const outHeaders = ["Date", "Amount", "Currency", "Counterparty", "Description", "Balance", "External ID", "Exclude From Stats", "Note", "Account Key", "Category Override"];
  const outRows = [];
  for (const row of rows) {
    const type = cleanText(row[i.type]);
    const status = cleanText(row[i.status]);
    const impact = cleanText(row[i.impact]);
    const name = cleanText(row[i.name]);
    const subject = cleanText(row[i.subject]);
    const item = cleanText(row[i.item]);
    const ignored = isPayPalIgnoredMovement(type, status, impact, [name, subject, item].join(" "));
    if (ignored.skip) continue;
    const currency = String(row[i.currency] || "EUR").toUpperCase().slice(0, 3) || "EUR";
    const net = money(row[i.net]);
    const gross = money(row[i.gross]);
    const movement = Number.isFinite(Number(net)) && net !== 0 ? net : gross;
    if (!Number.isFinite(Number(movement)) || movement === 0) continue;
    const date = parseDateValue(row[i.date]);
    if (!date) continue;
    const fee = money(row[i.fee]);
    const counterparty = name || cleanText(row[i.recipient]) || cleanText(row[i.sender]) || "PayPal";
    const note = [
      type,
      status,
      impact,
      subject,
      cleanText(row[i.note]),
      fee ? `Fee ${fee} ${currency}` : "",
      cleanText(row[i.relatedId]) ? `Related ${cleanText(row[i.relatedId])}` : "",
      ignored.reason
    ].filter(Boolean).join(" · ");
    const description = [type, name, item, subject].filter(Boolean).join(" · ");
    outRows.push(...amountWithFeeSplitRows({
      date,
      movement,
      fee,
      currency,
      counterparty,
      description,
      balance: row[i.balance],
      externalId: cleanText(row[i.txId]) || [date, movement, currency, description].join("|"),
      excludeFromStats: ignored.ignore,
      note,
      accountKey: `paypal:${currency}`,
      categoryId: ignored.ignore ? "transfer" : ""
    }));
  }
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

function normalizeBankRows(headers, rows, format, filename = "") {
  if (format.id === "wise_statement") return normalizeWiseStatement(headers, rows);
  if (format.id === "wise") return normalizeWise(headers, rows);
  if (format.id === "revolut") return normalizeRevolut(headers, rows);
  if (format.id === "revolut_consolidated") return normalizeRevolutConsolidatedRows([headers, ...rows], filename);
  if (format.id === "paypal") return normalizePayPal(headers, rows);
  if (format.id === "kakaopay") return normalizeKakaoPay(headers, rows, filename);
  if (format.id === "sparkasse") return normalizeSparkasse(headers, rows);
  if (format.id === "trade_republic") return normalizeTradeRepublic(headers, rows);
  return { headers, rows };
}

function looksLikeKakaoPayFilename(name = "") {
  return /카카오|kakao\s*pay|kakaopay|다운로드내역/i.test(String(name || ""));
}

function bytesContainAsciiOrUtf16le(bytes, asciiText) {
  const ascii = new TextDecoder("latin1").decode(bytes);
  if (ascii.includes(asciiText)) return true;
  // OLE compound-file stream names are often UTF-16LE, so "EncryptionInfo"
  // appears as E\0n\0c\0r\0y\0p\0t\0i\0o\0n\0I\0n\0f\0o\0 rather than ASCII.
  const utf16 = new TextDecoder("utf-16le").decode(bytes);
  return utf16.includes(asciiText);
}

async function inspectProtectedSpreadsheet(file) {
  if (file.size === 0) {
    return { error: "The selected spreadsheet is empty (0 bytes). Re-download the statement and try again." };
  }
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!isOleCompoundFile(header)) return { encrypted: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ascii = new TextDecoder("latin1").decode(bytes);
  const encrypted = bytesContainAsciiOrUtf16le(bytes, "EncryptedPackage")
    || bytesContainAsciiOrUtf16le(bytes, "EncryptionInfo")
    || ascii.includes("cipherAlgorithm")
    || ascii.includes("encryptedKeyValue")
    || looksLikeKakaoPayFilename(file.name);
  if (!encrypted) {
    return { error: "This .xls spreadsheet format is not supported. Re-export or save the file as .xlsx or CSV and try again." };
  }
  if (looksLikeKakaoPayFilename(file.name)) {
    return { encrypted: true, bytes, password: KAKAOPAY_DEFAULT_PASSWORD, label: "KakaoPay" };
  }
  return {
    error: "This spreadsheet is password-protected. Save an unprotected copy in Excel, then import that file."
  };
}

async function maybeDecryptProtectedSpreadsheet(file) {
  const info = await inspectProtectedSpreadsheet(file);
  if (info.error) throw new Error(info.error);
  if (!info.encrypted) return file;
  try {
    const decrypted = await decryptAgileXlsx(info.bytes, info.password);
    const name = String(file.name || "statement.xlsx").replace(/\.xls$/i, ".xlsx");
    return new File([decrypted], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } catch (error) {
    const detail = String(error?.message || error || "decryption failed");
    if (info.label === "KakaoPay") {
      throw new Error(`Could not unlock this KakaoPay spreadsheet with the built-in password. ${detail}`);
    }
    throw new Error(`Could not unlock this spreadsheet. ${detail}`);
  }
}

function buildParsedBankResult(file, delimiter, format, normalized, rawHeaders, rawRows) {
  return {
    filename: file.name,
    delimiter,
    format: format.id || format,
    formatLabel: format.label || format,
    headers: normalized.headers,
    rows: normalized.rows,
    openingBalanceHint: finiteNumberOrNull(normalized.openingBalanceHint),
    openingBalanceDetails: normalized.openingBalanceDetails || [],
    rawHeaders: rawHeaders || normalized.headers,
    rawRows: rawRows || normalized.rows,
    mapping: guessMapping(normalized.headers)
  };
}

function parseBankRows(allRows, filename = "", delimiter = "") {
  if (!allRows.length) throw new Error("The file does not contain readable rows.");

  const consolidated = normalizeRevolutConsolidatedRows(allRows, filename || "Revolut statement");
  if (consolidated.rows.length) {
    return buildParsedBankResult(
      { name: filename },
      delimiter || "xlsx",
      { id: "revolut_consolidated", label: delimiter === "xlsx" ? "Revolut consolidated XLSX" : "Revolut consolidated statement" },
      consolidated,
      consolidated.headers,
      consolidated.rows
    );
  }

  const headerRowIndex = findHeaderRow(allRows);
  const rawHeaders = allRows[headerRowIndex].map((header, index) => header || `Column ${index + 1}`);
  const rawRows = allRows.slice(headerRowIndex + 1).filter(row => row.some(cell => String(cell ?? "").trim() !== ""));
  let format = detectBankFormat(rawHeaders);
  if (format.id === "generic" && looksLikeKakaoPayFilename(filename)) {
    format = { id: "kakaopay", label: "KakaoPay statement" };
  }
  const normalized = normalizeBankRows(rawHeaders, rawRows, format, filename);
  if (!normalized.rows?.length && format.id !== "generic") {
    throw new Error(`Recognized ${format.label}, but no importable transactions were found.`);
  }
  if (!normalized.rows?.length) {
    throw new Error("No supported bank statement pattern produced transactions from this file.");
  }
  return buildParsedBankResult(
    { name: filename },
    delimiter || "csv",
    {
      id: format.id,
      label: delimiter === "xlsx" && format.id === "revolut"
        ? "Revolut account statement XLSX"
        : delimiter === "xlsx" && format.id === "wise_statement"
          ? "Wise currency statement XLSX"
          : delimiter === "xlsx" && format.id === "kakaopay"
            ? "KakaoPay XLSX"
            : format.label
    },
    normalized,
    rawHeaders,
    rawRows
  );
}

export async function parseBankFile(file) {
  const isSpreadsheet = /\.(xlsx|xls)$/i.test(file.name || "");
  if (isSpreadsheet) {
    const unlocked = await maybeDecryptProtectedSpreadsheet(file);
    const allRows = (await rowsFromXlsx(unlocked)).filter(row => row.length > 1 || row.some(cell => String(cell || "").trim()));
    return parseBankRows(allRows, file.name || unlocked.name || "statement.xlsx", "xlsx");
  }

  const text = await file.text();
  const delimiter = detectDelimiter(text);
  // Keep single-cell title/account rows (e.g. Revolut consolidated "Personal Account (EUR)").
  const allRows = parseCsvRows(text, delimiter).filter(row => row.length > 1 || row.some(cell => String(cell || "").trim()));
  if (!allRows.length) throw new Error("The file does not look like a CSV/TSV bank export.");
  return parseBankRows(allRows, file.name || "statement.csv", delimiter);
}

function transactionSignature(tx) {
  const normalizedDate = parseDateValue(tx.date) || String(tx.date || "").slice(0, 10);
  return [
    tx.accountId || "",
    normalizedDate,
    Number(tx.amount || 0).toFixed(2),
    String(tx.currency || "").toUpperCase(),
    normalizeText(tx.description).slice(0, 160),
    normalizeText(tx.counterparty).slice(0, 120)
  ].join("|");
}


function signatureMapFromTransactions(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const signature = transactionSignature(row);
    for (const key of [row.id, row.externalId].filter(Boolean)) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(signature);
    }
  }
  return map;
}

function hasExactSignature(map, key, signature) {
  return Boolean(key && map.get(key)?.has(signature));
}

function keyHasDifferentSignature(map, key, signature) {
  const signatures = key ? map.get(key) : null;
  return Boolean(signatures && !signatures.has(signature));
}

function shortImportHash(value) {
  const text = String(value || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function reserveTransactionKeys(map, tx, signature) {
  for (const key of [tx.id, tx.externalId].filter(Boolean)) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(signature);
  }
}

function makeCollisionSafeId(tx, signature, knownMap, previewMap) {
  const currentId = tx.id || `tx_${shortImportHash(signature)}`;
  const conflicts = keyHasDifferentSignature(knownMap, currentId, signature) || keyHasDifferentSignature(previewMap, currentId, signature);
  if (!conflicts) return tx;
  const base = currentId.replace(/_c[0-9a-z]+(?:_\d+)?$/i, "");
  const suffix = shortImportHash([signature, tx.externalId, tx.rawText].filter(Boolean).join("|"));
  let candidate = `${base}_c${suffix}`;
  let counter = 2;
  while (knownMap.has(candidate) || previewMap.has(candidate)) {
    candidate = `${base}_c${suffix}_${counter}`;
    counter += 1;
  }
  tx.id = candidate;
  if (!tx.externalId || tx.externalId === currentId) tx.externalId = candidate;
  tx.reason = [tx.reason, "Import ID collision resolved; full transaction signature differs."].filter(Boolean).join(" ");
  return tx;
}

function makeDuplicateAcceptedId(tx, signature, knownMap, previewMap) {
  const currentId = tx.id || `tx_${shortImportHash(signature)}`;
  const base = currentId.replace(/_dup\d+$/i, "");
  let counter = 2;
  let candidate = `${base}_dup${counter}`;
  while (knownMap.has(candidate) || previewMap.has(candidate)) {
    counter += 1;
    candidate = `${base}_dup${counter}`;
  }
  tx.id = candidate;
  tx.externalId = candidate;
  tx.review = false;
  tx.duplicateAccepted = true;
  tx.reviewClearedAtMs = Date.now();
  tx.reviewClearedBy = "duplicate-id-prepared";
  tx.confidence = Math.max(Number(tx.confidence ?? 0.9), 0.9);
  tx.reason = [tx.reason, `Exact duplicate was explicitly prepared with duplicate ID ${counter}.`].filter(Boolean).join(" ");
  return tx;
}

function amountKey(value) {
  return Math.abs(Number(value || 0)).toFixed(2);
}

function transferText(tx = {}) {
  return normalizeIdentifier([tx.description, tx.counterparty, tx.note, tx.rawText].filter(Boolean).join(" "));
}

function deriveTransferMeta(tx = {}) {
  if (!tx.internalTransfer && !tx.transferSourceAccountId && !tx.transferTargetAccountId) return null;
  const amount = Number(tx.amount || 0);
  const matchedAccountId = tx.transferMatchedAccountId || tx.matchedAccountId || "";
  const sourceAccountId = tx.transferSourceAccountId || (amount >= 0 ? matchedAccountId : tx.accountId);
  const targetAccountId = tx.transferTargetAccountId || (amount >= 0 ? tx.accountId : matchedAccountId);
  if (!sourceAccountId || !targetAccountId || sourceAccountId === targetAccountId) return null;
  return { sourceAccountId, targetAccountId };
}

function transferReferenceCompatible(a = {}, b = {}) {
  const ax = transferText(a);
  const bx = transferText(b);
  if (!ax || !bx) return true;
  if (ax.includes(bx) || bx.includes(ax)) return true;
  const aTokens = new Set(ax.match(/[a-z0-9]{5,}/g) || []);
  const bTokens = new Set(bx.match(/[a-z0-9]{5,}/g) || []);
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap > 0;
}

function matchesInternalTransferDuplicate(tx, existing = []) {
  const meta = deriveTransferMeta(tx);
  if (!meta) return false;
  const currency = String(tx.currency || "").toUpperCase();
  const amount = amountKey(tx.amount);
  return existing.some(item => {
    const other = deriveTransferMeta(item);
    if (!other) return false;
    if (other.sourceAccountId !== meta.sourceAccountId || other.targetAccountId !== meta.targetAccountId) return false;
    if (amountKey(item.amount) !== amount) return false;
    if (String(item.currency || "").toUpperCase() !== currency) return false;
    return true;
  });
}

function referenceAccountTextMatches(tx = {}, sourceAccount = {}) {
  const text = transferText(tx);
  if (!text || !sourceAccount) return false;
  return accountIdentifiers(sourceAccount).some(identifier => text.includes(identifier.normalized));
}

function matchesReferenceFundingDuplicate(tx, existing = [], accounts = []) {
  const currency = String(tx.currency || "").toUpperCase();
  const amount = amountKey(tx.amount);
  return existing.some(item => {
    if (!item.referenceFunding || item.referenceFundingRole !== "deduction") return false;
    if (item.accountId !== tx.accountId) return false;
    if (String(item.currency || "").toUpperCase() !== currency) return false;
    if (amountKey(item.amount) !== amount) return false;
    const sourceAccount = accounts.find(account => account.id === item.referenceSourceAccountId);
    return referenceAccountTextMatches(tx, sourceAccount) || transferReferenceCompatible(tx, item);
  });
}

function currentBalanceForAccount(account, rows = []) {
  return Number(account?.openingBalance || 0) + rows
    .filter(tx => tx.accountId === account?.id)
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function baseGeneratedFields(tx, groupId) {
  return {
    date: tx.date,
    currency: tx.currency,
    categoryId: "transfer",
    confidence: 0.98,
    review: false,
    source: "auto:transfer",
    importBatchId: tx.importBatchId,
    rawText: tx.rawText || "",
    raw: tx.raw || null,
    note: "Auto-created by Capito. Hidden from spending statistics.",
    internalTransfer: true,
    excludeFromStats: true,
    reason: "Auto-created transfer counterpart.",
    internalTransferGroupId: groupId,
    createdAtMs: tx.createdAtMs || Date.now()
  };
}

function withInternalTransferFields(tx, categorization, groupId) {
  const sourceAccountId = categorization.transferSourceAccountId || (Number(tx.amount || 0) >= 0 ? categorization.matchedAccountId : tx.accountId);
  const targetAccountId = categorization.transferTargetAccountId || (Number(tx.amount || 0) >= 0 ? tx.accountId : categorization.matchedAccountId);
  return {
    ...tx,
    internalTransfer: true,
    excludeFromStats: true,
    internalTransferRole: Number(tx.amount || 0) >= 0 ? "target" : "source",
    internalTransferGroupId: groupId,
    transferSourceAccountId: sourceAccountId,
    transferTargetAccountId: targetAccountId,
    transferMatchedAccountId: categorization.matchedAccountId || categorization.transferMatchedAccountId || "",
    reason: categorization.reason || tx.reason || "Internal transfer detected."
  };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function buildReferenceFundingRows(tx, account, referenceAccount, acceptedRows, existingRows) {
  if (!account?.referenceAccountId || !referenceAccount || Number(tx.amount || 0) >= 0 || tx.internalTransfer) return [];
  const balanceBefore = currentBalanceForAccount(account, [...existingRows, ...acceptedRows]);
  const requested = Math.abs(Number(tx.amount || 0));
  const available = Math.max(0, Number(balanceBefore || 0));
  const shortage = roundMoney(Math.max(0, requested - available));
  if (!Number.isFinite(shortage) || shortage <= 0.004) return [];

  const localDeduction = roundMoney(Math.max(0, requested - shortage));
  const originalAmount = Number(tx.amount || 0);
  tx.amount = -localDeduction;
  tx.referenceFunding = true;
  tx.referenceFundingRole = "source-split";
  tx.referenceSourceAccountId = account.id;
  tx.referenceAccountId = referenceAccount.id;
  tx.referenceOriginalAmount = originalAmount;
  tx.referenceCoveredAmount = shortage;
  tx.reason = `${tx.reason || ""}${tx.reason ? " " : ""}Split with reference account ${referenceAccount.name}: ${account.name} covers ${localDeduction.toFixed(2)}, reference covers ${shortage.toFixed(2)}.`;

  const groupId = `rf_${tx.id}`;
  const deduction = {
    ...tx,
    id: `${tx.id}_ref_deduction`,
    externalId: `${tx.externalId || tx.id}_ref_deduction`,
    accountId: referenceAccount.id,
    amount: -shortage,
    description: `${account.name} reference remainder: ${tx.description}`,
    counterparty: tx.counterparty || account.name,
    source: "auto:reference-account",
    internalTransfer: false,
    internalTransferRole: "",
    internalTransferGroupId: "",
    transferSourceAccountId: "",
    transferTargetAccountId: "",
    transferMatchedAccountId: "",
    matchedAccountId: "",
    referenceFunding: true,
    referenceFundingRole: "deduction",
    referenceSourceAccountId: account.id,
    referenceAccountId: referenceAccount.id,
    referenceOriginalAmount: originalAmount,
    referenceCoveredAmount: shortage,
    fundingOriginalId: tx.id,
    excludeFromStats: Boolean(tx.excludeFromStats),
    note: tx.note || "Auto-created reference-account remainder. Later matching reference-account imports are filtered.",
    reason: `Auto deduction from ${referenceAccount.name} for the part of ${account.name} that would go below zero.`,
    referenceFundingGroupId: groupId
  };
  return [deduction];
}

function resolveImportAccountId(accountKey = "", currency = "", context = {}) {
  const fallback = context.accountId;
  const key = normalizeIdentifier(accountKey);
  if (!key) return fallback;
  const wantedCurrency = String(currency || "").toUpperCase();
  const accounts = context.accounts || [];
  const exact = accounts.find(account => normalizeIdentifier(account.id) === key || normalizeIdentifier(account.name) === key);
  if (exact) return exact.id;
  const scored = accounts.map(account => {
    const haystack = normalizeIdentifier([account.id, account.name, account.institution, account.type, account.currency, ...(account.transferAliases || [])].join(" "));
    let score = 0;
    if (haystack.includes(key) || key.includes(haystack)) score += 100;
    for (const part of key.match(/[a-z0-9]{3,}/g) || []) if (haystack.includes(part)) score += 18;
    if (wantedCurrency && String(account.currency || "").toUpperCase() === wantedCurrency) score += 15;
    if (key.includes("wise") && normalizeIdentifier([account.name, account.institution].join(" ")).includes("wise")) score += 30;
    if (key.includes("revolut") && normalizeIdentifier([account.name, account.institution].join(" ")).includes("revolut")) score += 30;
    if (key.includes("paypal") && normalizeIdentifier([account.name, account.institution].join(" ")).includes("paypal")) score += 30;
    if ((key.includes("kakaopay") || key.includes("kakao")) && normalizeIdentifier([account.name, account.institution].join(" ")).match(/kakao|kakaopay/)) score += 30;
    if (key.includes("deposit") && normalizeIdentifier([account.name, account.type].join(" ")).match(/deposit|savings|saving/)) score += 20;
    if (key.includes("current") && normalizeIdentifier([account.name, account.type].join(" ")).match(/current|checking|giro/)) score += 12;
    return { account, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 40 ? scored[0].account.id : fallback;
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
  const accountKey = get("accountKey");
  const accountId = resolveImportAccountId(accountKey, currency, context);
  const forcedIgnore = truthy(get("excludeFromStats"));
  const note = get("note") || "";
  const categoryOverride = String(row[mapping.categoryOverride] || "").trim();
  const suppliedExternalId = get("externalId") || "";

  if (!date || amount == null) return null;

  const base = {
    accountId,
    date,
    amount,
    currency,
    description,
    counterparty,
    rawText: row.join(" "),
    raw: row,
    source: context.formatLabel ? `import:${context.formatLabel}` : "import",
    importBatchId: context.importBatchId,
    createdAtMs: Date.now(),
    note
  };
  const categorization = categorizeTransaction(base, context.rules, context.categories, context.accounts || []);
  const id = transactionHash({ ...base, description: suppliedExternalId ? `${description} ${suppliedExternalId}` : description });
  const groupId = categorization.internalTransfer ? `it_${id}` : "";
  const nextCategoryId = categoryOverride || categorization.categoryId;
  const nextCategory = (context.categories || []).find(cat => cat.id === nextCategoryId);
  const nextIsCash = nextCategoryId === "cash";
  const nextIsInternalTransfer = Boolean(categorization.internalTransfer || nextCategoryId === "transfer");
  const nextIsTransferCategory = Boolean(nextIsInternalTransfer || nextCategory?.type === "transfer");
  const ignoredReason = forcedIgnore && !nextIsCash ? "Excluded from spending statistics by import rule." : "";
  const tx = enrichTransactionNoteForAutomation({
    ...base,
    id,
    externalId: suppliedExternalId || id,
    categoryId: nextCategoryId,
    confidence: categoryOverride ? 0.98 : categorization.confidence,
    review: categoryOverride ? false : categorization.review,
    reason: [categorization.reason, ignoredReason, accountKey ? `Ledger ${accountKey}` : ""].filter(Boolean).join(" "),
    candidates: categorization.candidates,
    matchedAccountId: categorization.matchedAccountId || "",
    transferMatchedAccountId: categorization.transferMatchedAccountId || categorization.matchedAccountId || "",
    transferSourceAccountId: categorization.transferSourceAccountId || "",
    transferTargetAccountId: categorization.transferTargetAccountId || "",
    internalTransfer: nextIsInternalTransfer,
    excludeFromStats: nextIsCash ? false : Boolean((forcedIgnore || categorization.excludeFromStats) && nextIsTransferCategory),
    note
  }, categoryOverride ? null : categorization, context.categories || []);
  return categorization.internalTransfer ? withInternalTransferFields(tx, categorization, groupId) : tx;
}

export function buildImportPreview(parsed, mapping, context, existingTransactions = []) {
  const importBatchId = uid();
  const allowExactDuplicates = context.allowExactDuplicates === true;
  const existingKeySignatures = signatureMapFromTransactions(existingTransactions);
  const existingSignatures = new Set(existingTransactions.map(transactionSignature));
  const previewKeySignatures = new Map();
  const previewSignatures = new Set();
  const transactions = [];
  const skipped = [];
  const allKnownRows = () => [...existingTransactions, ...transactions];
  for (const row of parsed.rows) {
    const tx = rowToTransaction(row, mapping, { ...context, importBatchId, formatLabel: parsed.formatLabel });
    if (!tx) {
      skipped.push({ row, reason: "Missing date or amount" });
      continue;
    }
    const signature = transactionSignature(tx);
    const exactIdDuplicate = [tx.id, tx.externalId].filter(Boolean).some(key => hasExactSignature(existingKeySignatures, key, signature) || hasExactSignature(previewKeySignatures, key, signature));
    if (existingSignatures.has(signature) || previewSignatures.has(signature) || exactIdDuplicate) {
      if (!allowExactDuplicates) {
        const duplicateTx = makeDuplicateAcceptedId({ ...tx }, signature, existingKeySignatures, previewKeySignatures);
        reserveTransactionKeys(previewKeySignatures, duplicateTx, signature);
        skipped.push({
          row,
          tx: duplicateTx,
          duplicate: true,
          reason: "Exact duplicate: same account, date, amount, currency, description and counterparty"
        });
        continue;
      }
      makeDuplicateAcceptedId(tx, signature, existingKeySignatures, previewKeySignatures);
    }
    makeCollisionSafeId(tx, signature, existingKeySignatures, previewKeySignatures);
    if (matchesInternalTransferDuplicate(tx, allKnownRows())) {
      skipped.push({ row, tx, reason: "Internal transfer counterpart already represented" });
      continue;
    }
    if (matchesReferenceFundingDuplicate(tx, allKnownRows(), context.accounts || [])) {
      skipped.push({ row, tx, reason: "Reference-account deduction already represented" });
      continue;
    }

    const account = (context.accounts || []).find(item => item.id === tx.accountId);
    const referenceAccount = account?.referenceAccountId ? (context.accounts || []).find(item => item.id === account.referenceAccountId) : null;
    const referenceRows = buildReferenceFundingRows(tx, account, referenceAccount, transactions, existingTransactions);

    transactions.push(tx);
    previewSignatures.add(signature);
    reserveTransactionKeys(previewKeySignatures, tx, signature);
    for (const generated of referenceRows) {
      const generatedSignature = transactionSignature(generated);
      if (!matchesReferenceFundingDuplicate(generated, allKnownRows(), context.accounts || []) && !previewSignatures.has(generatedSignature) && !existingSignatures.has(generatedSignature)) {
        makeCollisionSafeId(generated, generatedSignature, existingKeySignatures, previewKeySignatures);
        transactions.push(generated);
        previewSignatures.add(generatedSignature);
        reserveTransactionKeys(previewKeySignatures, generated, generatedSignature);
      }
    }
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

function xmlEntityDecode(value = "") {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlAttr(xml = "", name = "") {
  const pattern = new RegExp(`${name}="([^"]*)"`);
  return xml.match(pattern)?.[1] || "";
}

function xmlDoc(xml) {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(xml, "application/xml");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = xmlDoc(xml);
  if (doc) return [...doc.getElementsByTagName("si")].map(item => [...item.getElementsByTagName("t")].map(t => t.textContent || "").join(""));
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map(match => {
    return [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlEntityDecode(t[1])).join("");
  });
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
  if (doc) {
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

  for (const rowMatch of xml.matchAll(/<row[^>]*>[\s\S]*?<\/row>/g)) {
    const output = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const col = cellColumnIndex(xmlAttr(attrs, "r"));
      const type = xmlAttr(attrs, "t");
      let value = "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlEntityDecode(t[1])).join("");
      } else {
        const raw = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : xmlEntityDecode(raw);
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

function smartbrokerScaledDecimal(value, { allowScale = true } = {}) {
  const parsed = parseMoney(value);
  if (!Number.isFinite(Number(parsed))) return null;
  const number = Number(parsed);
  const raw = String(value ?? "").trim();
  const looksIntegerLike = /^-?\d+$/.test(raw) || (typeof value === "number" && Number.isInteger(value));
  if (allowScale && looksIntegerLike && Math.abs(number) >= 10000) return number / 1000;
  return number;
}

function smartbrokerScaledQuantity(value, price, marketValue) {
  const parsed = parseMoney(value);
  if (!Number.isFinite(Number(parsed))) return null;
  const quantity = Number(parsed);
  const raw = String(value ?? "").trim();
  const looksIntegerLike = /^\d+$/.test(raw) || (typeof value === "number" && Number.isInteger(value));
  if (!looksIntegerLike || Math.abs(quantity) < 1000) return quantity;

  const scaled = quantity / 1000;
  const priceNumber = Number(price);
  const valueNumber = Number(marketValue);
  if (Number.isFinite(priceNumber) && priceNumber > 0 && Number.isFinite(valueNumber) && valueNumber > 0) {
    const unscaledError = Math.abs(quantity * priceNumber - valueNumber);
    const scaledError = Math.abs(scaled * priceNumber - valueNumber);
    return scaledError <= unscaledError ? scaled : quantity;
  }
  return scaled;
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
    const marketPrice = smartbrokerScaledDecimal(row[i.price]);
    const buyPrice = smartbrokerScaledDecimal(row[i.buyPrice]);
    const costBasis = parseMoney(row[i.costBasis]) || 0;
    const marketValue = parseMoney(row[i.marketValue]) || 0;
    const scaledQuantity = smartbrokerScaledQuantity(row[i.quantity], marketPrice, marketValue);
    positions.push({
      symbol,
      name,
      type: assetTypeFrom(row[i.assetClass]),
      quantity: Number(scaledQuantity || 0),
      currency: String(row[i.currency] || "EUR").trim().toUpperCase().slice(0, 3) || "EUR",
      costBasis,
      buyPrice: buyPrice || 0,
      manualPrice: marketPrice || 0,
      lastPrice: marketPrice || null,
      lastPriceAt: excelSerialToIso(row[i.date]) ? `${excelSerialToIso(row[i.date])}T00:00:00.000Z` : new Date().toISOString(),
      provider: "manual",
      wkn,
      isin,
      hidden: false,
      startingPosition: true,
      startingAt: excelSerialToIso(row[i.date]) || new Date().toISOString().slice(0, 10),
      startingValue: marketValue || costBasis,
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
