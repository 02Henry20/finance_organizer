function parseNumber(value) {
  const text = String(value ?? "").replace(/\s/g, "").replace(/,/g, "").trim();
  if (!text || text === "-" || text.toUpperCase() === "N/D") return NaN;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function cleanTicker(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/:/g, ".")
    .toUpperCase();
}

function looksLikeTicker(value) {
  return /^[A-Z0-9._^-]{1,32}$/.test(cleanTicker(value));
}

function isoFromUnixSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const date = new Date(number * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isoFromDateValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function quoteAgeDays(value) {
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 86400000);
}

function addUnique(list, item, source = "candidate") {
  const symbol = cleanTicker(item?.symbol || item);
  if (!symbol || !looksLikeTicker(symbol)) return;
  const key = symbol.toUpperCase();
  if (list.some(existing => existing.key === key)) return;
  list.push({ symbol, key, source: item?.source || source });
}

const YAHOO_KNOWN_BY_ISIN = Object.freeze({
  US0378331005: ["APC.DE", "AAPL"],
  US1912161007: ["CCC3.DE", "KO"],
  DE000SHA0159: ["SHA0.DE", "SHA.DE"],
  DE000SHA0100: ["SHA0.DE", "SHA.DE"],
  DE0005152623: ["D6RG.F"],
  DE0007100000: ["MBG.DE", "MBG.F"],
  DE000DK0ECS2: ["D6RF.HM"],
  DE000DK0ECU8: ["OG70.MU"],
  DE000ETFL581: ["ACWI.PA"],
  FR0010524777: ["NRJ.PA"],
  IE00B1XNHC34: ["IQQH.DE"],
  IE00B3WJKG14: ["QDVE.DE"],
  IE00B4X9L533: ["H4ZJ.DE"],
  IE00BDR55927: ["UIMM.DE"],
  IE00BTJRMP35: ["XMEM.DE"],
  LU0489337690: ["XUKS.MU"]
});

const YAHOO_KNOWN_BY_WKN = Object.freeze({
  "865985": ["APC.DE", "AAPL"],
  "850663": ["CCC3.DE", "KO"],
  SHA015: ["SHA0.DE", "SHA.DE"],
  SHA010: ["SHA0.DE", "SHA.DE"],
  "515262": ["D6RG.F"],
  "710000": ["MBG.DE", "MBG.F"],
  DK0ECS: ["D6RF.HM"],
  DK0ECU: ["OG70.MU"],
  ETFL58: ["ACWI.PA"],
  LYX0CB: ["NRJ.PA"],
  A0MW0M: ["IQQH.DE"],
  A142N1: ["QDVE.DE"],
  A1C9KK: ["H4ZJ.DE"],
  A2H5CB: ["UIMM.DE"],
  A12GVR: ["XMEM.DE"],
  DBX0F1: ["XUKS.MU"]
});

function yahooCurrencyHint(symbol) {
  const s = cleanTicker(symbol);
  if ([".DE", ".F", ".HM", ".MU", ".PA", ".AS", ".MI", ".MC"].some(suffix => s.endsWith(suffix))) return "EUR";
  if (s.endsWith(".L")) return "GBP";
  return "";
}

function yahooQuoteCandidates(asset = {}) {
  const candidates = [];
  const add = (item, source) => addUnique(candidates, item, source);
  const isin = String(asset.isin || "").trim().toUpperCase();
  const wkn = String(asset.wkn || "").trim().toUpperCase();

  // Explicitly saved working Yahoo symbols should be tried first.
  [asset.providerSymbol, asset.lastProviderSymbol, asset.yahooSymbol, asset.symbol, asset.ticker].forEach(value => add(value, "asset"));
  (YAHOO_KNOWN_BY_ISIN[isin] || []).forEach(symbol => add(symbol, `known isin ${isin}`));
  (YAHOO_KNOWN_BY_WKN[wkn] || []).forEach(symbol => add(symbol, `known wkn ${wkn}`));

  const compact = cleanTicker(asset.symbol || "").replace(/[^A-Z0-9]/g, "");
  if (compact && compact.length <= 10) [".DE", ".F", ".HM", ".MU", ".PA", ".AS", ".MI", ".L"].forEach(suffix => add(`${compact}${suffix}`, `suffix ${suffix}`));
  return candidates.map(({ key, ...candidate }) => candidate);
}

function searchQueriesForAsset(asset = {}) {
  return [asset.isin, asset.wkn, asset.providerSymbol, asset.symbol, asset.name]
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index);
}

function yahooProxyUrls(url, { fast = false } = {}) {
  const encoded = encodeURIComponent(url);
  const list = [
    { name: "direct", url },
    { name: "AllOrigins", url: `https://api.allorigins.win/raw?url=${encoded}` },
    { name: "CorsProxy.io", url: `https://corsproxy.io/?url=${encoded}` },
    { name: "CodeTabs", url: `https://api.codetabs.com/v1/proxy?quest=${encoded}` }
  ];
  return fast ? list.slice(0, 2) : list;
}

async function fetchTextWithTimeout(url, timeoutMs = 16000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { mode: "cors", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const errors = [];
  const timeoutMs = Number(options.timeoutMs || 16000);
  for (const endpoint of yahooProxyUrls(url, options)) {
    try {
      const text = await fetchTextWithTimeout(endpoint.url, timeoutMs);
      const data = JSON.parse(text);
      if (data?.chart?.error) throw new Error(data.chart.error.description || data.chart.error.code || "Yahoo error");
      return data;
    } catch (error) {
      errors.push(`${endpoint.name}: ${error.name === "AbortError" ? "timeout" : error.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

function yahooChartUrl(symbol, range = "5d", interval = "1d") {
  const query = new URLSearchParams({ range, interval, includePrePost: "false", events: "history" });
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanTicker(symbol))}?${query.toString()}`;
}

function parseYahooChartQuote(data, candidate, url) {
  const chart = data?.chart || {};
  if (chart.error) throw new Error(chart.error.description || chart.error.code || "Yahoo Finance returned an error.");
  const result = Array.isArray(chart.result) ? chart.result[0] : null;
  if (!result) throw new Error("Yahoo Finance returned no quote result.");
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];

  let price = parseNumber(meta.regularMarketPrice);
  let priceTime = isoFromUnixSeconds(meta.regularMarketTime);
  if (!Number.isFinite(price) || price <= 0) {
    const closes = Array.isArray(quote.close) ? quote.close : [];
    for (let index = closes.length - 1; index >= 0; index -= 1) {
      const close = parseNumber(closes[index]);
      if (Number.isFinite(close) && close > 0) {
        price = close;
        priceTime = isoFromUnixSeconds(timestamps[index]);
        break;
      }
    }
  }
  if (!Number.isFinite(price) || price <= 0) throw new Error("No usable Yahoo Finance price.");
  if (!priceTime && timestamps.length) priceTime = isoFromUnixSeconds(timestamps[timestamps.length - 1]);

  const pulledAt = new Date().toISOString();
  const symbol = cleanTicker(meta.symbol || candidate.symbol);
  return {
    provider: "yahoo",
    source: "Yahoo Finance",
    symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || meta.exchange || "",
    micCode: meta.exchange || "",
    name: meta.shortName || meta.longName || "",
    quoteType: meta.instrumentType || meta.quoteType || candidate.quoteType || "",
    price,
    currency: String(meta.currency || candidate.currency || yahooCurrencyHint(symbol) || "").toUpperCase(),
    changePercent: null,
    time: pulledAt,
    pulledAt,
    priceTime: priceTime || pulledAt,
    url,
    raw: meta
  };
}

async function fetchYahooQuoteCandidate(candidate) {
  const errors = [];
  for (const [range, interval] of [["5d", "1d"], ["1mo", "1d"]]) {
    const url = yahooChartUrl(candidate.symbol, range, interval);
    try {
      return parseYahooChartQuote(await fetchJson(url), candidate, url);
    } catch (error) {
      errors.push(`${range}/${interval}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

function scoreYahooSearchResult(result = {}, asset = {}) {
  const wantedCurrency = String(asset.currency || "EUR").toUpperCase();
  const symbol = cleanTicker(result.symbol || "");
  let score = 0;
  if (String(result.currency || "").toUpperCase() === wantedCurrency) score += 60;
  if ([".DE", ".F", ".HM", ".MU", ".PA", ".AS", ".MI"].some(suffix => symbol.endsWith(suffix))) score += 25;
  if (String(result.quoteType || "").toUpperCase().match(/EQUITY|ETF|MUTUALFUND|FUND/)) score += 10;
  return score;
}


function yahooSearchName(row = {}) {
  return String(row.longname || row.longName || row.shortname || row.shortName || row.name || row.title || "").trim();
}

function yahooAssetTypeFromQuoteType(value = "") {
  const type = String(value || "").toUpperCase();
  if (type === "EQUITY") return "stock";
  if (type === "ETF") return "etf";
  if (["MUTUALFUND", "FUND"].includes(type)) return "fund";
  if (type === "CRYPTOCURRENCY") return "crypto";
  return "stock";
}

function nameTokens(value = "") {
  return String(value || "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Z0-9]+/)
    .filter(token => token.length >= 2 && !["ETF", "UCITS", "FUND", "AG", "INC", "THE", "GROUP", "COMPANY", "SA", "PLC", "ACC", "DIST"].includes(token));
}

function scoreYahooNameMatch(row = {}, asset = {}) {
  const queryName = String(asset.name || asset.symbol || "").trim();
  const candidateName = yahooSearchName(row);
  if (!queryName || !candidateName) return 0;
  const query = nameTokens(queryName);
  const candidate = new Set(nameTokens(candidateName));
  if (!query.length || !candidate.size) return 0;
  let overlap = 0;
  for (const token of query) if (candidate.has(token)) overlap += 1;
  const coverage = overlap / Math.max(1, query.length);
  let score = overlap * 18 + coverage * 60;
  if (candidateName.toUpperCase().includes(queryName.toUpperCase())) score += 80;
  return score;
}

function scoreYahooLookupCandidate(candidate = {}, asset = {}) {
  const wantedCurrency = String(asset.currency || "EUR").toUpperCase();
  const symbol = cleanTicker(candidate.symbol || "");
  let score = Number(candidate.nameScore || 0);
  if (String(candidate.currency || "").toUpperCase() === wantedCurrency) score += 70;
  if ([".DE", ".F", ".HM", ".MU", ".PA", ".AS", ".MI", ".MC"].some(suffix => symbol.endsWith(suffix))) score += 30;
  if (String(candidate.quoteType || "").toUpperCase().match(/EQUITY|ETF|MUTUALFUND|FUND/)) score += 10;
  if (candidate.source?.startsWith("known")) score += 40;
  return score;
}


function yahooExactIdentifierMatch(row = {}, identifier = "") {
  const id = String(identifier || "").trim().toUpperCase();
  if (!id) return false;
  const directFields = [
    row.isin,
    row.ISIN,
    row.isIn,
    row.securityIdentifier,
    row.id,
    row.symbol,
    row.name,
    row.longname,
    row.longName,
    row.shortname,
    row.shortName,
    row.title
  ];
  if (directFields.some(value => String(value || "").trim().toUpperCase() === id)) return true;
  const compact = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const idCompact = compact(id);
  return Boolean(idCompact) && compact(JSON.stringify(row)).includes(idCompact);
}

function yahooSearchRowToMatch(row = {}, asset = {}, source = "Yahoo search") {
  const symbol = cleanTicker(row.symbol || "");
  const quoteType = String(row.quoteType || "").toUpperCase();
  const currency = String(row.currency || yahooCurrencyHint(symbol) || asset.currency || "").toUpperCase();
  const name = yahooSearchName(row) || symbol;
  return {
    symbol,
    name,
    currency,
    price: null,
    priceTime: "",
    pulledAt: new Date().toISOString(),
    exchange: row.exchDisp || row.exchange || "",
    quoteType,
    assetType: yahooAssetTypeFromQuoteType(quoteType),
    source,
    score: scoreYahooLookupCandidate({
      symbol,
      name,
      currency,
      quoteType,
      exchange: row.exchDisp || row.exchange || "",
      nameScore: scoreYahooNameMatch(row, asset),
      searchScore: scoreYahooSearchResult(row, asset)
    }, asset),
    ageDays: null,
    exactIdentifierMatch: yahooExactIdentifierMatch(row, asset.isin)
  };
}

export async function searchYahooAssetMatches(asset = {}, { limit = 5, searchLimit = 5, validateQuotes = false } = {}) {
  const maxResults = Math.max(1, Math.min(Number(limit) || 5, 5));
  const isin = String(asset.isin || "").trim().toUpperCase();
  const wkn = String(asset.wkn || "").trim().toUpperCase();
  const targetCurrency = String(asset.currency || "EUR").toUpperCase();
  const apiRows = [];
  const seenSymbols = new Set();
  const addMatch = match => {
    const symbol = cleanTicker(match?.symbol || "");
    if (!symbol || !looksLikeTicker(symbol) || seenSymbols.has(symbol)) return;
    seenSymbols.add(symbol);
    apiRows.push({ ...match, symbol });
  };

  // Keep this lookup fast: one Yahoo search request by ISIN, max 5 rows.
  if (isin) {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q: isin, quotesCount: String(Math.max(1, Math.min(Number(searchLimit) || maxResults, 5))), newsCount: "0", listsCount: "0", enableFuzzyQuery: "true" }).toString()}`;
    try {
      const data = await fetchJson(url, { timeoutMs: 7000, fast: true });
      const rows = Array.isArray(data?.quotes) ? data.quotes : [];
      rows
        .filter(row => row?.symbol && String(row.quoteType || "").toUpperCase().match(/EQUITY|ETF|MUTUALFUND|FUND|INDEX/))
        .slice(0, maxResults)
        .map(row => yahooSearchRowToMatch(row, asset, `Yahoo ISIN search ${isin}`))
        .sort((a, b) => Number(b.exactIdentifierMatch) - Number(a.exactIdentifierMatch) || b.score - a.score)
        .forEach(addMatch);
    } catch (error) {
      console.warn("Yahoo ISIN lookup failed", isin, error);
    }
  }

  // If Yahoo search explicitly includes the ISIN in one result, use that immediately.
  const exactApiMatches = apiRows.filter(match => match.exactIdentifierMatch).slice(0, 1);
  if (exactApiMatches.length) return exactApiMatches;

  // Fast fallback for known holdings. Does not call the slow chart API.
  if (!apiRows.length) {
    (YAHOO_KNOWN_BY_ISIN[isin] || []).slice(0, maxResults).forEach(symbol => addMatch({
      symbol,
      name: asset.name || symbol,
      currency: yahooCurrencyHint(symbol) || targetCurrency,
      price: null,
      priceTime: "",
      pulledAt: new Date().toISOString(),
      exchange: "",
      quoteType: asset.type === "etf" ? "ETF" : asset.type === "fund" ? "FUND" : asset.type === "stock" ? "EQUITY" : "",
      assetType: asset.type || "stock",
      source: `known ISIN ${isin}`,
      score: 90,
      ageDays: null,
      exactIdentifierMatch: true
    }));
    (YAHOO_KNOWN_BY_WKN[wkn] || []).slice(0, maxResults).forEach(symbol => addMatch({
      symbol,
      name: asset.name || symbol,
      currency: yahooCurrencyHint(symbol) || targetCurrency,
      price: null,
      priceTime: "",
      pulledAt: new Date().toISOString(),
      exchange: "",
      quoteType: asset.type === "etf" ? "ETF" : asset.type === "fund" ? "FUND" : asset.type === "stock" ? "EQUITY" : "",
      assetType: asset.type || "stock",
      source: `known WKN ${wkn}`,
      score: 70,
      ageDays: null,
      exactIdentifierMatch: false
    }));
  }

  const ordered = apiRows
    .sort((a, b) => Number(b.exactIdentifierMatch) - Number(a.exactIdentifierMatch) || b.score - a.score)
    .slice(0, maxResults);

  if (!validateQuotes) return ordered;

  const matches = [];
  for (const candidate of ordered.slice(0, maxResults)) {
    try {
      const quote = await fetchYahooQuoteCandidate(candidate);
      const age = quoteAgeDays(quote.priceTime);
      const currency = String(quote.currency || candidate.currency || targetCurrency).toUpperCase();
      matches.push({
        ...candidate,
        symbol: quote.symbol || candidate.symbol,
        name: quote.name || candidate.name || quote.symbol || candidate.symbol,
        currency,
        price: quote.price,
        priceTime: quote.priceTime,
        pulledAt: quote.pulledAt,
        exchange: quote.exchange || candidate.exchange || "",
        quoteType: quote.quoteType || candidate.quoteType || quote.raw?.instrumentType || "",
        assetType: yahooAssetTypeFromQuoteType(quote.quoteType || candidate.quoteType || quote.raw?.instrumentType || ""),
        source: candidate.source || quote.source || "Yahoo Finance",
        ageDays: age
      });
    } catch (error) {
      console.warn("Yahoo asset lookup candidate quote validation failed", candidate.symbol, error);
      matches.push(candidate);
    }
  }
  return matches.slice(0, maxResults);
}

async function searchYahooCandidates(asset) {
  const found = [];
  for (const query of searchQueriesForAsset(asset).slice(0, 5)) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q: query, quotesCount: "12", newsCount: "0", listsCount: "0", enableFuzzyQuery: "true" }).toString()}`;
      const data = await fetchJson(url);
      const rows = Array.isArray(data?.quotes) ? data.quotes : [];
      rows
        .filter(row => row?.symbol)
        .sort((a, b) => scoreYahooSearchResult(b, asset) - scoreYahooSearchResult(a, asset))
        .slice(0, 5)
        .forEach(row => addUnique(found, { symbol: row.symbol, source: `Yahoo search ${query}` }));
    } catch (error) {
      console.warn("Yahoo search skipped", query, error);
    }
  }
  return found.map(({ key, ...item }) => item);
}

export async function fetchYahooQuote(asset, { maxAgeDays = 7, targetCurrency = "EUR" } = {}) {
  const errors = [];
  const tried = new Set();
  let bestFallback = null;
  const target = String(targetCurrency || asset.currency || "EUR").toUpperCase();

  const tryCandidate = async candidate => {
    const symbol = cleanTicker(candidate.symbol);
    if (!symbol || tried.has(symbol)) return null;
    tried.add(symbol);
    try {
      const quote = await fetchYahooQuoteCandidate({ ...candidate, symbol });
      const age = quoteAgeDays(quote.priceTime);
      const fresh = age == null || age <= maxAgeDays;
      const targetMatch = String(quote.currency || "").toUpperCase() === target;
      if (fresh && targetMatch) return quote;
      const rank = [fresh && !targetMatch ? 1 : 2, targetMatch ? 0 : 1, age == null ? 999999 : age];
      const betterFallback = !bestFallback
        || rank[0] < bestFallback.rank[0]
        || (rank[0] === bestFallback.rank[0] && rank[1] < bestFallback.rank[1])
        || (rank[0] === bestFallback.rank[0] && rank[1] === bestFallback.rank[1] && rank[2] < bestFallback.rank[2]);
      if (betterFallback) bestFallback = { quote, rank, age, targetMatch, fresh };
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
    return null;
  };

  for (const candidate of yahooQuoteCandidates(asset)) {
    const quote = await tryCandidate(candidate);
    if (quote) return quote;
  }
  for (const candidate of await searchYahooCandidates(asset)) {
    const quote = await tryCandidate(candidate);
    if (quote) return quote;
  }

  if (bestFallback?.quote) return bestFallback.quote;
  const triedText = [...tried].join(", ");
  throw new Error(`Yahoo Finance did not find a usable quote for ${asset.name || asset.symbol || "this holding"}.${triedText ? ` Tried: ${triedText}.` : ""}${errors.length ? ` ${errors.slice(0, 5).join(" | ")}` : ""}`);
}

export async function fetchQuote(asset, settings) {
  const rawProvider = asset.provider || settings.marketProvider || "manual";
  const provider = ["stooq", "twelvedata"].includes(rawProvider) ? "yahoo" : rawProvider;
  if (provider === "manual") {
    const price = Number(asset.manualPrice || asset.lastPrice || 0);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Manual asset needs a manual price first.");
    const pulledAt = new Date().toISOString();
    return {
      provider: "manual",
      source: "Manual price",
      symbol: asset.symbol,
      price,
      currency: asset.currency,
      changePercent: null,
      time: pulledAt,
      pulledAt,
      priceTime: pulledAt
    };
  }
  return fetchYahooQuote(asset, { maxAgeDays: 7, targetCurrency: asset.currency || settings.primaryCurrency || "EUR" });
}

export async function fetchLatestFxRates(currencies = []) {
  const requested = [...new Set(["EUR", "USD", "GBP", "CHF", "JPY", "KRW", ...currencies].map(code => String(code || "").toUpperCase()).filter(Boolean))];
  const symbols = requested.filter(code => code !== "EUR").join(",");
  const endpoints = [
    {
      name: "Frankfurter",
      url: `https://api.frankfurter.dev/v1/latest?base=EUR${symbols ? `&symbols=${encodeURIComponent(symbols)}` : ""}`,
      parse: data => data.rates || {}
    },
    {
      name: "Frankfurter legacy",
      url: `https://api.frankfurter.app/latest?from=EUR${symbols ? `&to=${encodeURIComponent(symbols)}` : ""}`,
      parse: data => data.rates || {}
    },
    {
      name: "ExchangeRate-API open",
      url: "https://open.er-api.com/v6/latest/EUR",
      parse: data => data.rates || {}
    }
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { mode: "cors" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const apiRates = endpoint.parse(await response.json());
      const rates = { EUR: 1 };
      for (const code of requested) {
        if (code === "EUR") continue;
        const unitsPerEur = Number(apiRates[code]);
        if (Number.isFinite(unitsPerEur) && unitsPerEur > 0) rates[code] = 1 / unitsPerEur;
      }
      if (Object.keys(rates).length > 1) {
        return { rates, source: endpoint.name, time: new Date().toISOString() };
      }
      throw new Error("No usable rates returned.");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Exchange-rate refresh failed: ${lastError?.message || "no provider returned rates"}`);
}
