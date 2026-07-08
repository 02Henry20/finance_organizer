export const APP_NAME = "Capito";
export const TODAY = () => new Date().toISOString().slice(0, 10);

export const VALID_CURRENCIES = Object.freeze(["EUR", "USD", "GBP", "CHF", "JPY", "KRW", "CNY", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "SGD", "HKD", "INR", "VND", "THB", "MXN", "BRL", "ZAR"]);
export const CATEGORY_COLORS = Object.freeze(["#19C37D", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16", "#F97316", "#14B8A6", "#6366F1", "#A855F7", "#EAB308", "#22C55E", "#64748B", "#0EA5E9"]);
export const DEFAULT_CATEGORY_COLOR = "#3B82F6";

export const DEFAULT_SETTINGS = Object.freeze({
  primaryCurrency: "EUR",
  theme: "dark",
  motion: "on",
  marketProvider: "yahoo",
  marketApiKeyLocalOnly: "",
  autoRefreshQuotes: "on",
  autoRefreshFx: "on",
  quoteRefreshIntervalMinutes: 720,
  quoteRequestTimeoutSeconds: 30,
  portfolioComparisonMode: "rolling",
  portfolioComparisonDays: 30,
  portfolioComparisonDate: "",
  hideInternalTransfersInSpending: true,
  showAccountDeltaBars: true,
  showTransactionIds: false,
  accountDisplayCurrency: "",
  fxLastUpdatedAt: "",
  fxSource: "static fallback",
  fxRates: {
    EUR: 1,
    USD: 0.92,
    GBP: 1.17,
    KRW: 0.00063,
    JPY: 0.0058,
    CHF: 1.04
  }
});

export const ACCOUNT_TYPES = [
  { id: "checking", label: "Checking", sign: 1 },
  { id: "savings", label: "Savings", sign: 1 },
  { id: "cash", label: "Cash", sign: 1 },
  { id: "broker", label: "Broker cash", sign: 1 },
  { id: "asset", label: "Asset holding", sign: 1 },
  { id: "debt", label: "Debt | liability", sign: -1 },
  { id: "loan", label: "Loan receivable", sign: 1 },
  { id: "hidden", label: "Hidden | archive", sign: 0 }
];

export const DEFAULT_CATEGORIES = Object.freeze([
  { id: "income_salary", name: "Salary", group: "Income", type: "income", icon: "↗", color: "#19C37D" },
  { id: "income_freelance", name: "Freelance | side income", group: "Income", type: "income", icon: "+", color: "#22C55E" },
  { id: "income_dividend", name: "Dividends & interest", group: "Income", type: "income", icon: "◒", color: "#14B8A6" },
  { id: "income_other", name: "Other income", group: "Income", type: "income", icon: "+", color: "#84CC16" },
  { id: "refund", name: "Refund | reimbursement", group: "Income", type: "income", icon: "↩", color: "#06B6D4" },
  { id: "transfer", name: "Internal transfer", group: "Neutral", type: "transfer", icon: "⇄", color: "#64748B" },
  { id: "investment", name: "Investment | broker", group: "Neutral", type: "transfer", icon: "◆", color: "#8B5CF6" },
  { id: "debt_bafog", name: "BAföG | debt", group: "Neutral", type: "transfer", icon: "◌", color: "#F59E0B" },
  { id: "rent", name: "Rent", group: "Housing", type: "expense", icon: "⌂", color: "#3B82F6" },
  { id: "utilities", name: "Utilities & phone", group: "Housing", type: "expense", icon: "⌁", color: "#0EA5E9" },
  { id: "insurance", name: "Insurance", group: "Housing", type: "expense", icon: "▣", color: "#6366F1" },
  { id: "groceries", name: "Groceries", group: "Living", type: "expense", icon: "◍", color: "#19C37D" },
  { id: "restaurants", name: "Restaurants & coffee", group: "Living", type: "expense", icon: "☕", color: "#F97316" },
  { id: "cash", name: "Cash withdrawal", group: "Living", type: "expense", icon: "▣", color: "#EAB308" },
  { id: "transport", name: "Transport & fuel", group: "Mobility", type: "expense", icon: "→", color: "#06B6D4" },
  { id: "public_transport", name: "Public transport", group: "Mobility", type: "expense", icon: "▱", color: "#14B8A6" },
  { id: "travel", name: "Travel", group: "Mobility", type: "expense", icon: "✈", color: "#8B5CF6" },
  { id: "shopping", name: "Shopping | online", group: "Lifestyle", type: "expense", icon: "◧", color: "#EC4899" },
  { id: "clothing", name: "Clothing", group: "Lifestyle", type: "expense", icon: "◨", color: "#A855F7" },
  { id: "electronics", name: "Electronics & tools", group: "Lifestyle", type: "expense", icon: "⌘", color: "#6366F1" },
  { id: "subscriptions", name: "Subscriptions", group: "Lifestyle", type: "expense", icon: "◎", color: "#F59E0B" },
  { id: "health", name: "Health", group: "Lifestyle", type: "expense", icon: "✚", color: "#EF4444" },
  { id: "education", name: "Education", group: "Lifestyle", type: "expense", icon: "▱", color: "#3B82F6" },
  { id: "sport", name: "Sport", group: "Lifestyle", type: "expense", icon: "△", color: "#84CC16" },
  { id: "entertainment", name: "Entertainment", group: "Lifestyle", type: "expense", icon: "☆", color: "#EC4899" },
  { id: "taxes", name: "Taxes & fees", group: "Admin", type: "expense", icon: "%", color: "#EF4444" },
  { id: "bank_fees", name: "Bank fees", group: "Admin", type: "expense", icon: "∙", color: "#64748B" },
  { id: "gifts_family", name: "Gifts & family", group: "Personal", type: "expense", icon: "♡", color: "#F97316" },
  { id: "donations", name: "Donations", group: "Personal", type: "expense", icon: "♧", color: "#22C55E" },
  { id: "misc", name: "Misc | not applicable", group: "Misc", type: "neutral", icon: "?", color: "#64748B" }
]);

export const DEFAULT_RULES = Object.freeze([
  { id: "r_salary", label: "Salary and payroll", categoryId: "income_salary", keywords: ["salary", "gehalt", "lohn", "payroll", "mercedes", "daimler", "bonus", "stipend", "stipendium"] },
  { id: "r_freelance", label: "Freelance income", categoryId: "income_freelance", keywords: ["honorar", "freelance", "invoice payment", "rechnung beglichen", "consulting"] },
  { id: "r_dividend", label: "Dividends and interest", categoryId: "income_dividend", keywords: ["dividend", "dividende", "ausschuttung", "ausschüttung", "zinsgutschrift", "interest", "coupon"] },
  { id: "r_refund", label: "Refunds", categoryId: "refund", keywords: ["refund", "erstattung", "rueckerstattung", "rückerstattung", "reimbursement", "gutschrift", "chargeback"] },
  { id: "r_rent", label: "Rent", categoryId: "rent", keywords: ["miete", "rent", "wohnung", "nebenkosten wohnung", "kaution", "münchen miete", "munich rent"] },
  { id: "r_utilities", label: "Utilities and phone", categoryId: "utilities", keywords: ["vodafone", "telekom", "o2", "telefon", "internet", "strom", "gas", "stadtwerke", "wasser", "heizung", "rundfunk", "gez", "ard zdf"] },
  { id: "r_insurance", label: "Insurance", categoryId: "insurance", keywords: ["versicherung", "insurance", "haftpflicht", "krankenversicherung", "tk", "aok", "barmer", "allianz", "huk", "arag"] },
  { id: "r_groceries", label: "Groceries", categoryId: "groceries", keywords: ["rewe", "edeka", "aldi", "lidl", "kaufland", "penny", "netto", "dm-drogerie", "rossmann", "supermarkt", "grocery", "biomarkt", "denns"] },
  { id: "r_restaurants", label: "Restaurants and coffee", categoryId: "restaurants", keywords: ["restaurant", "cafe", "coffee", "kaffee", "bäcker", "baecker", "bäckerei", "mcdonald", "burger", "subway", "lieferando", "wolt", "uber eats", "starbucks", "mensa"] },
  { id: "r_cash", label: "Cash withdrawals", categoryId: "cash", keywords: ["bargeld", "cash", "atm", "geldautomat", "withdrawal", "auszahlung"] },
  { id: "r_transport", label: "Fuel and rides", categoryId: "transport", keywords: ["tank", "aral", "shell", "esso", "avia", "fuel", "tanken", "uber", "bolt", "taxi", "parking", "parkhaus"] },
  { id: "r_public_transport", label: "Public transport", categoryId: "public_transport", keywords: ["db bahn", "deutsche bahn", "bahn", "mvg", "bvg", "rmv", "vvs", "trainline", "fahrkarte", "deutschlandticket", "semester ticket", "semesterticket"] },
  { id: "r_travel", label: "Travel", categoryId: "travel", keywords: ["airbnb", "booking.com", "ryanair", "lufthansa", "hotel", "hostel", "flight", "flug", "agoda", "skyscanner", "bahncard", "korea air", "trip.com"] },
  { id: "r_online", label: "Online shopping", categoryId: "shopping", keywords: ["amazon", "paypal", "ebay", "zalando", "ikea", "aliexpress", "online kauf", "online purchase", "etsy"] },
  { id: "r_clothing", label: "Clothing", categoryId: "clothing", keywords: ["uniqlo", "zara", "h&m", "hm.com", "zalando", "nike", "adidas", "clothing", "kleidung", "decathlon"] },
  { id: "r_electronics", label: "Electronics and tools", categoryId: "electronics", keywords: ["mediamarkt", "saturn", "notebooksbilliger", "alternate", "thomann", "apple", "google store", "microsoft", "hardware", "electronics"] },
  { id: "r_subscription", label: "Subscriptions", categoryId: "subscriptions", keywords: ["spotify", "netflix", "prime", "youtube premium", "adobe", "icloud", "google storage", "openai", "chatgpt", "github", "notion", "microsoft 365"] },
  { id: "r_health", label: "Health", categoryId: "health", keywords: ["apotheke", "pharmacy", "doctor", "arzt", "dentist", "zahnarzt", "medikament", "clinic", "klinik", "therapie"] },
  { id: "r_education", label: "Education", categoryId: "education", keywords: ["tum", "tuition", "semesterbeitrag", "uni", "university", "studentenwerk", "schulgeld", "coursera", "udemy", "book", "textbook"] },
  { id: "r_sport", label: "Sport", categoryId: "sport", keywords: ["fitness", "gym", "bouldern", "crossfit", "sport", "urban sports", "mcfit", "fitx", "wellpass", "protein"] },
  { id: "r_entertainment", label: "Entertainment", categoryId: "entertainment", keywords: ["kino", "cinema", "steam", "playstation", "nintendo", "concert", "konzert", "eventim", "museum", "theater"] },
  { id: "r_bafog", label: "BAföG", categoryId: "debt_bafog", keywords: ["bafög", "bafoeg", "bafog", "auslandsbafög", "bundesverwaltungsamt"] },
  { id: "r_invest", label: "Broker and investing", categoryId: "investment", keywords: ["trade republic", "smartbroker", "broker", "etf", "visualvest", "depot", "finanzen.net", "isin", "wertpapier", "sparplan", "buy order", "sell order"] },
  { id: "r_gifts", label: "Gifts and family", categoryId: "gifts_family", keywords: ["geschenk", "gift", "birthday", "bday", "mama", "papa", "family", "familie", "flowers", "blumen"] },
  { id: "r_donations", label: "Donations", categoryId: "donations", keywords: ["donation", "spende", "charity", "ngo", "unicef", "rotes kreuz", "red cross"] },
  { id: "r_taxes", label: "Taxes", categoryId: "taxes", keywords: ["steuer", "tax", "finanzamt", "taxfix", "elster", "solidaritätszuschlag"] },
  { id: "r_bank_fees", label: "Bank fees", categoryId: "bank_fees", keywords: ["kontoführung", "kontofuehrung", "account fee", "gebühr", "fee", "entgelt", "overdraft", "zinsbelastung", "foreign transaction", "wise fee", "revolut fee", "fee split"] },
  { id: "r_wise_revolut_internal", label: "Wise/Revolut internal transfers", categoryId: "transfer", keywords: ["wise currency conversion", "wise top-up", "wise self-transfer", "revolut internal", "revolut top-up", "revolut product transfer", "instant access savings", "exchanged to eur", "exchanged from", "money_added", "conversion"] }
]);

export const DEFAULT_ACCOUNTS = Object.freeze([
  { id: "cash_wallet", name: "Cash wallet", institution: "Manual", type: "cash", currency: "EUR", openingBalance: 0, hidden: false, iban: "", accountNumber: "", bic: "", transferAliases: ["cash wallet", "bar" ], color: "#3B82F6" },
  { id: "bank_main", name: "Main checking", institution: "Bank", type: "checking", currency: "EUR", openingBalance: 0, hidden: false, iban: "", accountNumber: "", bic: "", transferAliases: ["main checking", "girokonto", "own account" ], color: "#3B82F6" },
  { id: "broker_main", name: "Broker", institution: "Broker", type: "broker", currency: "EUR", openingBalance: 0, hidden: false, iban: "", accountNumber: "", bic: "", transferAliases: ["broker", "trade republic", "depot", "securities account" ], color: "#3B82F6" },
  { id: "bafog_debt", name: "BAföG debt", institution: "Manual", type: "debt", currency: "EUR", openingBalance: 0, hidden: false, iban: "", accountNumber: "", bic: "", transferAliases: ["bafög", "bafoeg", "bva" ], color: "#3B82F6" }
]);

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9äöüÄÖÜ€$%+\-\.\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeIdentifier(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function isWeakInternalTransferIdentifier(raw, normalized) {
  const text = normalizeText(raw);
  const compact = normalized || normalizeIdentifier(raw);
  if (!compact) return true;

  // These appear in imported transaction metadata such as
  // "Personal Account (EUR)" or "revolut:Current:EUR". Treating them
  // as own-account identifiers would classify every merchant transaction
  // from that provider as an internal transfer.
  const weakExact = new Set([
    "bank", "broker", "manual", "account", "current", "deposit", "savings",
    "revolut", "wise", "sparkasse", "smartbroker", "traderepublic",
    "personalaccount", "personalaccounteur", "personalaccountkrw",
    "currenteur", "currentkrw", "depositeur", "savingseur",
    "mainchecking", "cashwallet"
  ]);
  if (weakExact.has(compact)) return true;

  const weakPhrase = /^(personal account|current account|savings account|deposit account)(?:\s*[a-z]{3})?$/.test(text);
  if (weakPhrase) return true;

  return false;
}

export function accountIdentifiers(account) {
  const aliases = Array.isArray(account.transferAliases)
    ? account.transferAliases
    : String(account.transferAliases || "").split(",");
  const candidates = [
    { raw: account.iban, source: "iban" },
    { raw: account.accountNumber, source: "accountNumber" },
    { raw: account.bic, source: "bic" },
    { raw: account.name, source: "name" },
    { raw: account.institution, source: "institution" },
    ...aliases.map(raw => ({ raw, source: "alias" }))
  ];

  return candidates
    .map(item => ({ raw: String(item.raw || "").trim(), normalized: normalizeIdentifier(item.raw), source: item.source }))
    .filter(item => item.normalized.length >= 5)
    .filter(item => !isWeakInternalTransferIdentifier(item.raw, item.normalized));
}

export function detectInternalTransfer(tx, accounts = []) {
  const text = normalizeIdentifier([tx.description, tx.counterparty, tx.rawText, tx.note].filter(Boolean).join(" "));
  if (!text || !accounts.length) return null;
  const currentAccountId = tx.accountId || "";
  const otherAccounts = accounts.filter(account => account.id !== currentAccountId && !account.hidden);
  for (const account of otherAccounts) {
    const match = accountIdentifiers(account).find(identifier => text.includes(identifier.normalized));
    if (match) {
      const amount = Number(tx.amount || 0);
      const sourceAccountId = amount >= 0 ? account.id : currentAccountId;
      const targetAccountId = amount >= 0 ? currentAccountId : account.id;
      return {
        categoryId: "transfer",
        confidence: 0.94,
        review: false,
        reason: `Detected own account identifier '${match.raw}' for ${account.name}.`,
        matchedAccountId: account.id,
        transferMatchedAccountId: account.id,
        transferSourceAccountId: sourceAccountId,
        transferTargetAccountId: targetAccountId,
        internalTransfer: true,
        excludeFromStats: true,
        candidates: [{ categoryId: "transfer", categoryName: "Internal transfer", score: 120, keywords: [match.raw] }]
      };
    }
  }
  return null;
}

export function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value ?? "").trim();
  if (!s) return null;
  s = s.replace(/\s/g, "").replace(/[€$£₩¥]/g, "");
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    sign = -1;
    s = s.slice(0, -1);
  }
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  s = s.replace(/[^0-9+\-.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

export function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(value));
    return epoch.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const german = raw.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})$/);
  if (german) {
    const day = german[1].padStart(2, "0");
    const month = german[2].padStart(2, "0");
    const year = german[3].length === 2 ? `20${german[3]}` : german[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

export function formatCurrency(value, currency = "EUR", locale = undefined) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value));
}

export function convertCurrency(value, fromCurrency, settings) {
  const primary = settings.primaryCurrency || "EUR";
  const from = fromCurrency || primary;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  if (from === primary) return amount;
  const rates = { ...DEFAULT_SETTINGS.fxRates, ...(settings.fxRates || {}) };
  const fromRate = Number(rates[from]);
  const primaryRate = Number(rates[primary] ?? 1);
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(primaryRate) || primaryRate <= 0) return amount;
  return amount * fromRate / primaryRate;
}

export function accountSign(type) {
  return ACCOUNT_TYPES.find(item => item.id === type)?.sign ?? 1;
}

export function transactionHash(input) {
  const str = `${input.accountId}|${input.date}|${Number(input.amount || 0).toFixed(2)}|${normalizeText(input.description).slice(0, 96)}|${normalizeText(input.counterparty).slice(0, 64)}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `tx_${(h >>> 0).toString(36)}`;
}

export function sortByDateDesc(entries) {
  return [...entries].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAtMs || "").localeCompare(String(a.createdAtMs || "")));
}

export function rulePriority(rule = {}) {
  const value = Number(rule.priority ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function applyRuleTextCase(value, { caseSensitive = false, mode = "plain" } = {}) {
  let text = String(value ?? "").normalize("NFKC").replace(/ß/g, "ss");
  if (mode === "german") {
    text = text
      .replace(/Ä/g, "Ae")
      .replace(/Ö/g, "Oe")
      .replace(/Ü/g, "Ue")
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue");
  }
  if (mode === "strip") {
    text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }
  if (!caseSensitive) text = text.toLocaleLowerCase();
  return text;
}

function ruleTokensFor(value, { caseSensitive = false, mode = "plain" } = {}) {
  const text = applyRuleTextCase(value, { caseSensitive, mode });
  return text.match(/[\p{L}\p{N}]+/gu) || [];
}

function uniqueRuleTokenVariants(value, { caseSensitive = false } = {}) {
  const seen = new Set();
  const variants = [];
  for (const mode of ["plain", "strip", "german"]) {
    const tokens = ruleTokensFor(value, { caseSensitive, mode });
    const key = tokens.join("\u0001");
    if (!tokens.length || seen.has(key)) continue;
    seen.add(key);
    variants.push(tokens);
  }
  return variants;
}

function normalizeRuleMask(value, { caseSensitive = false } = {}) {
  return uniqueRuleTokenVariants(value, { caseSensitive })[0]?.join(" ") || "";
}

function tokenSequenceMatch(textTokens, keywordTokens) {
  if (!textTokens.length || !keywordTokens.length || keywordTokens.length > textTokens.length) return false;
  for (let start = 0; start <= textTokens.length - keywordTokens.length; start += 1) {
    let ok = true;
    for (let offset = 0; offset < keywordTokens.length; offset += 1) {
      if (textTokens[start + offset] !== keywordTokens[offset]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function keywordMatchInfo(keyword, rawText, { caseSensitive = false } = {}) {
  const rawKeyword = String(keyword || "").trim();
  if (!rawKeyword) return null;

  const keywordVariants = uniqueRuleTokenVariants(rawKeyword, { caseSensitive });
  const textVariants = uniqueRuleTokenVariants(rawText, { caseSensitive });
  if (!keywordVariants.length || !textVariants.length) return null;

  let best = null;
  for (const keywordTokens of keywordVariants) {
    for (const textTokens of textVariants) {
      if (keywordTokens.length > 1) {
        // Multi-token rules match token sequences only.
        // "Board Game Cafe" matches "Board Game Cafe" and "Board-Game Cafe",
        // but deliberately does NOT match "BoardGameCafe".
        if (!tokenSequenceMatch(textTokens, keywordTokens)) continue;
        const phraseLength = keywordTokens.join(" ").length;
        const info = { keyword: rawKeyword, mode: "phrase", strength: 72 + keywordTokens.length * 9 + phraseLength * 0.35 };
        if (!best || info.strength > best.strength) best = info;
        continue;
      }

      const token = keywordTokens[0];
      if (textTokens.includes(token)) {
        const info = { keyword: rawKeyword, mode: "word", strength: 54 + Math.min(18, token.length) };
        if (!best || info.strength > best.strength) best = info;
        continue;
      }

      // Merchant names often append legal/plural suffixes, e.g. mcdonald -> mcdonalds.
      // Keep this to longer keywords only so short words like "CU" or "Bake" do not overmatch arbitrary compounds.
      if (token.length >= 5 && textTokens.some(item => item.startsWith(token))) {
        const info = { keyword: rawKeyword, mode: "prefix", strength: 38 + Math.min(12, token.length) };
        if (!best || info.strength > best.strength) best = info;
      }
    }
  }

  return best;
}

function keywordMatchesText(keyword, rawText, { caseSensitive = false } = {}) {
  return Boolean(keywordMatchInfo(keyword, rawText, { caseSensitive }));
}


function noteWithoutAutomationLines(note = "") {
  return String(note || "")
    .split(/\n+/)
    .filter(line => !/^\s*(Rule applied|Needs review):/i.test(line))
    .join(" ");
}

export function ruleMatchesTransaction(rule = {}, tx = {}) {
  const rawText = [tx.description, tx.counterparty, tx.rawText, noteWithoutAutomationLines(tx.note), tx.reason].filter(Boolean).join(" ");
  const rawKeywords = (rule.keywords || []).map(value => String(value || "").trim()).filter(Boolean);
  return rawKeywords.some(keyword => keywordMatchesText(keyword, rawText, { caseSensitive: Boolean(rule.caseSensitive) }));
}

export function categorizeTransaction(tx, rules = DEFAULT_RULES, categories = DEFAULT_CATEGORIES, accounts = []) {
  const rawText = [tx.description, tx.counterparty, tx.rawText, noteWithoutAutomationLines(tx.note)].filter(Boolean).join(" ");
  const categoryMap = new Map(categories.map(cat => [cat.id, cat]));
  const detectedTransfer = detectInternalTransfer(tx, accounts);
  if (detectedTransfer) return detectedTransfer;
  const matches = [];

  for (const rule of rules) {
    const rawKeywords = (rule.keywords || []).map(value => String(value || "").trim()).filter(Boolean);
    if (!rawKeywords.length) continue;
    const seenMasks = new Set();
    const infos = [];
    for (const keyword of rawKeywords) {
      const mask = normalizeRuleMask(keyword, { caseSensitive: Boolean(rule.caseSensitive) });
      if (!mask || seenMasks.has(mask)) continue;
      seenMasks.add(mask);
      const info = keywordMatchInfo(keyword, rawText, { caseSensitive: Boolean(rule.caseSensitive) });
      if (info) infos.push(info);
    }
    if (!infos.length) continue;
    const matched = infos.map(info => info.keyword);
    const priority = rulePriority(rule);
    const score = infos.reduce((sum, info) => sum + info.strength, 0) + matched.length * 10 + Math.max(0, priority) * 8;
    matches.push({ rule, score, matched, priority });
  }

  matches.sort((a, b) => b.priority - a.priority || b.score - a.score || String(a.rule.label || "").localeCompare(String(b.rule.label || "")));
  if (!matches.length) {
    return {
      categoryId: "misc",
      confidence: 0.25,
      review: false,
      reason: "No rule matched. Kept as Misc | not applicable.",
      candidates: []
    };
  }

  const top = matches[0];
  const challengers = matches.filter(item => item !== top && item.rule.categoryId !== top.rule.categoryId && item.priority === top.priority && Math.abs(top.score - item.score) <= 0.001);
  const topCategory = categoryMap.get(top.rule.categoryId);

  if (challengers.length) {
    return {
      categoryId: "misc",
      confidence: 0.48,
      review: true,
      reason: `Ambiguous: ${[top, ...challengers].map(item => categoryMap.get(item.rule.categoryId)?.name || item.rule.categoryId).join(" | ")}. Increase rule priority to resolve.`,
      candidates: [top, ...challengers].map(item => ({
        categoryId: item.rule.categoryId,
        categoryName: categoryMap.get(item.rule.categoryId)?.name || item.rule.categoryId,
        score: item.score,
        priority: item.priority,
        keywords: item.matched,
        ruleId: item.rule.id || "",
        ruleLabel: item.rule.label || ""
      }))
    };
  }

  return {
    categoryId: top.rule.categoryId,
    confidence: Math.min(0.99, top.score / 125),
    review: false,
    reason: `Matched rule '${top.rule.label}'${top.matched.length ? ` via keyword${top.matched.length === 1 ? "" : "s"} '${top.matched.join("', '")}'` : ""}.`,
    ruleId: top.rule.id || "",
    ruleLabel: top.rule.label || "",
    matchedKeywords: top.matched,
    candidates: [{ categoryId: top.rule.categoryId, categoryName: topCategory?.name || top.rule.categoryId, score: top.score, priority: top.priority, keywords: top.matched, ruleId: top.rule.id || "", ruleLabel: top.rule.label || "" }]
  };
}

export function monthKey(dateString) {
  return String(dateString || "").slice(0, 7);
}

export function shouldIgnoreTransactionInStats(tx = {}) {
  return Boolean(tx.excludeFromStats || tx.ignoreFromStats || tx.statsIgnored);
}


function normalizeCategoryLookup(value = "") {
  return String(value || "")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function unresolvedCategory(raw = "") {
  const label = String(raw || "").trim();
  return {
    id: label ? `unresolved:${label}` : "uncategorized",
    name: label ? `Unresolved · ${label}` : "Uncategorized",
    group: "Needs review",
    type: "expense",
    icon: "?",
    color: DEFAULT_CATEGORY_COLOR,
    unresolved: true
  };
}

function resolveCategory(categoryMap, categories = [], categoryId = "", { allowMiscFallback = true } = {}) {
  const raw = String(categoryId || "").trim();
  if (raw && categoryMap.get(raw)) return categoryMap.get(raw);
  if (raw) {
    const wanted = normalizeCategoryLookup(raw);
    const loose = categories.find(cat => [cat.id, cat.name, `${cat.icon || ""} ${cat.name || ""}`].map(normalizeCategoryLookup).includes(wanted));
    if (loose) return loose;
  }
  if ((!raw || raw === "misc") && allowMiscFallback) return categoryMap.get("misc") || unresolvedCategory("misc");
  return unresolvedCategory(raw);
}


function includeInSpendingForFinance(cat, tx = {}, settings = {}) {
  const isInternalOrTransfer = Boolean(tx.internalTransfer || tx.transferSourceAccountId || tx.transferTargetAccountId || cat?.type === "transfer");
  if (isInternalOrTransfer && settings.hideInternalTransfersInSpending) return false;
  if (cat?.id === "cash") return true;
  if (shouldIgnoreTransactionInStats(tx)) return false;
  return true;
}

export function buildMonthlySeries(transactions, categories, settings, monthsBack = 12) {
  const now = new Date(`${TODAY()}T00:00:00`);
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const categoryMap = new Map(categories.map(cat => [cat.id, cat]));
  const rows = months.map(month => ({ month, income: 0, expense: 0, transfer: 0, net: 0 }));
  const rowMap = new Map(rows.map(row => [row.month, row]));
  for (const tx of transactions) {
    const row = rowMap.get(monthKey(tx.date));
    if (!row) continue;
    const cat = resolveCategory(categoryMap, categories, tx.categoryId, { allowMiscFallback: false });
    const amount = convertCurrency(Number(tx.amount), tx.currency, settings);
    if (!includeInSpendingForFinance(cat, tx, settings)) {
      if (cat?.type === "transfer") row.transfer += amount;
      continue;
    }
    if (cat?.type === "transfer") row.transfer += amount;
    if (amount >= 0) row.income += amount;
    else row.expense += Math.abs(amount);
    row.net += amount;
  }
  return rows;
}

export function buildCategorySpend(transactions, categories, settings, period = monthKey(TODAY())) {
  const categoryMap = new Map(categories.map(cat => [cat.id, cat]));
  const totals = new Map();
  for (const tx of transactions) {
    if (monthKey(tx.date) !== period) continue;
    const cat = resolveCategory(categoryMap, categories, tx.categoryId);
    if (cat?.type === "income") continue;
    if (!includeInSpendingForFinance(cat, tx, settings)) continue;
    const value = Math.abs(Math.min(0, convertCurrency(tx.amount, tx.currency, settings)));
    if (value <= 0) continue;
    const prev = totals.get(cat.id) || { categoryId: cat.id, name: cat.name, group: cat.group, color: cat.color || DEFAULT_CATEGORY_COLOR, value: 0 };
    prev.value += value;
    totals.set(cat.id, prev);
  }
  return [...totals.values()].sort((a, b) => b.value - a.value);
}

export function calculateAccountBalance(account, transactions, settings, untilDate = "") {
  const own = transactions.filter(tx => tx.accountId === account.id && !tx.deleted && (!untilDate || String(tx.date || "") <= untilDate));
  const current = Number(account.openingBalance || 0) + own.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  return {
    raw: current,
    signed: current * accountSign(account.type),
    converted: convertCurrency(current * accountSign(account.type), account.currency, settings)
  };
}

export function calculatePortfolio(state) {
  const settings = state.settings || DEFAULT_SETTINGS;
  const visibleAccounts = state.accounts.filter(account => !account.hidden);
  const accountRows = visibleAccounts.map(account => ({
    ...account,
    balance: calculateAccountBalance(account, state.transactions, settings)
  }));
  const liquidity = accountRows
    .filter(account => !["asset", "debt"].includes(account.type))
    .reduce((sum, account) => sum + account.balance.converted, 0);
  const debt = accountRows
    .filter(account => account.type === "debt")
    .reduce((sum, account) => sum + Math.abs(account.balance.converted), 0);
  const receivables = accountRows
    .filter(account => account.type === "loan")
    .reduce((sum, account) => sum + account.balance.converted, 0);
  const assetValue = state.assets
    .filter(asset => !asset.hidden)
    .reduce((sum, asset) => {
      const price = Number(asset.lastPrice ?? asset.manualPrice ?? 0);
      const quantity = Number(asset.quantity || 0);
      return sum + convertCurrency(price * quantity, asset.currency, settings);
    }, 0);
  const netWorth = liquidity + assetValue + receivables - debt;
  return { liquidity, debt, receivables, assetValue, netWorth, accountRows };
}




function isoDateFromMs(ms) {
  const time = Number(ms);
  if (!Number.isFinite(time) || time <= 0) return "";
  return new Date(time).toISOString().slice(0, 10);
}

function assetBaselineValue(asset) {
  const quantity = Number(asset.quantity || 0);
  const currentPrice = Number(asset.lastPrice ?? asset.manualPrice ?? 0);
  const currentValue = currentPrice * quantity;
  const explicit = Number(asset.startingValue || 0);
  const costBasis = Number(asset.costBasis || 0);
  const buyPriceValue = Number(asset.buyPrice || 0) * quantity;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (Number.isFinite(costBasis) && costBasis > 0) return costBasis;
  if (Number.isFinite(buyPriceValue) && buyPriceValue > 0) return buyPriceValue;
  return Number.isFinite(currentValue) ? currentValue : 0;
}

function assetSnapshotValue(asset, settings, asOfDate = "") {
  const price = Number(asset.lastPrice ?? asset.manualPrice ?? 0);
  const quantity = Number(asset.quantity || 0);
  const currentValue = price * quantity;
  if (!asOfDate) return convertCurrency(currentValue, asset.currency, settings);

  if (asset.startingPosition) {
    const givenDate = String(asset.startingAt || isoDateFromMs(asset.createdAtMs) || TODAY()).slice(0, 10);
    const value = asOfDate < givenDate ? assetBaselineValue(asset) : currentValue;
    return convertCurrency(value, asset.currency, settings);
  }

  if (asset.createdAtMs) {
    const created = isoDateFromMs(asset.createdAtMs);
    if (created && created > asOfDate) return 0;
  }
  return convertCurrency(currentValue, asset.currency, settings);
}

export function calculatePortfolioSnapshot(state, asOfDate = "") {
  const settings = state.settings || DEFAULT_SETTINGS;
  const visibleAccounts = state.accounts.filter(account => !account.hidden);
  const accountRows = visibleAccounts.map(account => ({
    ...account,
    balance: calculateAccountBalance(account, state.transactions, settings, asOfDate)
  }));
  const liquidity = accountRows
    .filter(account => !["asset", "debt"].includes(account.type))
    .reduce((sum, account) => sum + account.balance.converted, 0);
  const debt = accountRows
    .filter(account => account.type === "debt")
    .reduce((sum, account) => sum + Math.abs(account.balance.converted), 0);
  const receivables = accountRows
    .filter(account => account.type === "loan")
    .reduce((sum, account) => sum + account.balance.converted, 0);
  const assetValue = state.assets
    .filter(asset => !asset.hidden)
    .reduce((sum, asset) => sum + assetSnapshotValue(asset, settings, asOfDate), 0);
  const netWorth = liquidity + assetValue + receivables - debt;
  return { liquidity, debt, receivables, assetValue, netWorth, accountRows, asOfDate };
}

export function calculateMonthlySnapshot(state) {
  const settings = state.settings || DEFAULT_SETTINGS;
  const currentMonth = monthKey(TODAY());
  const categories = state.categories;
  const series = buildMonthlySeries(state.transactions, categories, settings, 13);
  const current = series.find(row => row.month === currentMonth) || { income: 0, expense: 0, net: 0 };
  const previous = series.at(-2) || { income: 0, expense: 0, net: 0 };
  return { currentMonth, current, previous, series };
}
