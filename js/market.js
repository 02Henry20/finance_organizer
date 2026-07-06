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
  return /^[A-Z0-9._^-]{1,24}$/.test(cleanTicker(value));
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

function quotePriceTime(data = {}) {
  return isoFromUnixSeconds(data.last_quote_at)
    || isoFromUnixSeconds(data.timestamp)
    || isoFromDateValue(data.datetime)
    || "";
}

function addUnique(list, item) {
  const symbol = cleanTicker(item?.symbol || item);
  if (!symbol || !looksLikeTicker(symbol)) return;
  const exchange = String(item?.exchange || "").trim();
  const micCode = String(item?.micCode || item?.mic_code || "").trim().toUpperCase();
  const key = [symbol, exchange.toUpperCase(), micCode].join("|");
  if (list.some(existing => existing.key === key)) return;
  list.push({ symbol, exchange, micCode, key });
}

function knownTwelveDataCandidates(asset = {}) {
  const isin = String(asset.isin || "").trim().toUpperCase();
  const wkn = String(asset.wkn || "").trim().toUpperCase();
  const rawSymbol = cleanTicker(asset.symbol || asset.providerSymbol || asset.ticker);
  const name = String(asset.name || "").toLowerCase();
  const candidates = [];

  const add = item => addUnique(candidates, item);

  if (isin === "US0378331005" || wkn === "865985" || rawSymbol === "AAPL" || name.includes("apple")) {
    add({ symbol: "AAPL", exchange: "NASDAQ", micCode: "XNGS" });
    add("AAPL");
  }
  if (isin === "US1912161007" || wkn === "850663" || rawSymbol === "KO" || name.includes("coca-cola") || name.includes("coca cola")) {
    add({ symbol: "KO", exchange: "NYSE", micCode: "XNYS" });
    add("KO");
  }
  if (isin === "DE000SHA0159" || isin === "DE000SHA0100" || wkn === "SHA015" || wkn === "SHA010" || rawSymbol === "SHA" || rawSymbol === "SHA0" || name.includes("schaeffler")) {
    add({ symbol: "SHA0", exchange: "XETRA", micCode: "XETR" });
    add("SHA0");
  }
  if (isin === "DE0007100000" || wkn === "710000" || name.includes("mercedes")) {
    add({ symbol: "MBG", exchange: "XETRA", micCode: "XETR" });
    add("MBG");
  }

  return candidates;
}

function twelveDataQuoteCandidates(asset = {}) {
  const candidates = [];
  const add = item => addUnique(candidates, item);

  knownTwelveDataCandidates(asset).forEach(add);

  const explicitExchange = asset.providerExchange || asset.exchange || asset.lastQuoteExchange || "";
  const explicitMic = asset.providerMicCode || asset.micCode || asset.lastQuoteMicCode || "";
  [asset.providerSymbol, asset.twelveDataSymbol, asset.symbol, asset.ticker].forEach(value => {
    const symbol = cleanTicker(value);
    if (!symbol || !looksLikeTicker(symbol)) return;
    add({ symbol, exchange: explicitExchange, micCode: explicitMic });
    add(symbol);
    if (String(asset.isin || "").toUpperCase().startsWith("DE")) add({ symbol, exchange: "XETRA", micCode: "XETR" });
  });

  return candidates.map(({ key, ...item }) => item);
}

function searchQueriesForAsset(asset = {}) {
  return [asset.isin, asset.wkn, asset.providerSymbol, asset.symbol, asset.name]
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index);
}

function buildTwelveDataUrl(path, params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && String(value).trim()) query.set(key, String(value).trim());
  });
  return `https://api.twelvedata.com/${path}?${query.toString()}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function twelveDataErrorMessage(data, fallback = "Twelve Data returned an error.") {
  return data?.message || data?.error || data?.status || fallback;
}

function parseTwelveDataQuote(data, candidate, url) {
  if (!data || typeof data !== "object") throw new Error("Empty Twelve Data response.");
  if (data.status === "error" || data.code) throw new Error(twelveDataErrorMessage(data));
  const price = parseNumber(data.close ?? data.price ?? data.previous_close);
  if (!Number.isFinite(price) || price <= 0) throw new Error("No usable price in Twelve Data response.");

  const pulledAt = new Date().toISOString();
  return {
    provider: "twelvedata",
    source: "Twelve Data quote",
    symbol: cleanTicker(data.symbol || candidate.symbol),
    exchange: data.exchange || candidate.exchange || "",
    micCode: data.mic_code || candidate.micCode || "",
    name: data.name || "",
    price,
    currency: data.currency || candidate.currency || "",
    changePercent: Number.isFinite(parseNumber(data.percent_change)) ? parseNumber(data.percent_change) : null,
    time: pulledAt,
    pulledAt,
    priceTime: quotePriceTime(data) || pulledAt,
    url,
    raw: data
  };
}

async function fetchTwelveDataQuoteCandidate(candidate, apiKey) {
  const url = buildTwelveDataUrl("quote", {
    symbol: candidate.symbol,
    exchange: candidate.exchange,
    mic_code: candidate.micCode,
    apikey: apiKey
  });
  const data = await fetchJson(url);
  return parseTwelveDataQuote(data, candidate, url);
}

function scoreSearchResult(result = {}, asset = {}) {
  const isin = String(asset.isin || "").trim().toUpperCase();
  const wkn = String(asset.wkn || "").trim().toUpperCase();
  const wantedSymbol = cleanTicker(asset.providerSymbol || asset.symbol || asset.ticker);
  const wantedName = String(asset.name || "").toLowerCase();
  const symbol = cleanTicker(result.symbol);
  const name = String(result.instrument_name || result.name || "").toLowerCase();
  const mic = String(result.mic_code || "").toUpperCase();
  const exchange = String(result.exchange || "").toUpperCase();
  let score = 0;
  if (symbol && wantedSymbol && symbol === wantedSymbol) score += 50;
  if (isin && String(result.isin || "").toUpperCase() === isin) score += 120;
  if (wkn && String(result.wkn || "").toUpperCase() === wkn) score += 80;
  if (wantedName && name && (name.includes(wantedName) || wantedName.includes(name))) score += 25;
  if (mic === "XETR" || exchange.includes("XETRA")) score += 10;
  if (String(result.currency || "").toUpperCase() === String(asset.currency || "").toUpperCase()) score += 8;
  if (String(result.type || "").toLowerCase().includes(String(asset.type || "").toLowerCase())) score += 3;
  return score;
}

async function searchTwelveDataCandidates(asset, apiKey) {
  const found = [];
  for (const query of searchQueriesForAsset(asset).slice(0, 5)) {
    try {
      const url = buildTwelveDataUrl("symbol_search", { symbol: query, outputsize: 12, apikey: apiKey });
      const data = await fetchJson(url);
      const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      rows
        .filter(row => row?.symbol)
        .sort((a, b) => scoreSearchResult(b, asset) - scoreSearchResult(a, asset))
        .slice(0, 4)
        .forEach(row => addUnique(found, {
          symbol: row.symbol,
          exchange: row.exchange || "",
          micCode: row.mic_code || "",
          currency: row.currency || ""
        }));
    } catch (error) {
      console.warn("Twelve Data symbol search skipped", query, error);
    }
  }
  return found.map(({ key, ...item }) => item);
}

export async function fetchTwelveDataQuote(asset, apiKey) {
  if (!apiKey) throw new Error("Add a Twelve Data API key in Settings or switch the holding provider to Manual.");

  const errors = [];
  const tried = new Set();
  const tryCandidate = async candidate => {
    const key = [cleanTicker(candidate.symbol), String(candidate.exchange || "").toUpperCase(), String(candidate.micCode || "").toUpperCase()].join("|");
    if (tried.has(key)) return null;
    tried.add(key);
    try {
      return await fetchTwelveDataQuoteCandidate(candidate, apiKey);
    } catch (error) {
      errors.push(`${candidate.symbol}${candidate.exchange ? ` @ ${candidate.exchange}` : ""}: ${error.message}`);
      return null;
    }
  };

  for (const candidate of twelveDataQuoteCandidates(asset)) {
    const quote = await tryCandidate(candidate);
    if (quote) return quote;
  }

  for (const candidate of await searchTwelveDataCandidates(asset, apiKey)) {
    const quote = await tryCandidate(candidate);
    if (quote) return quote;
  }

  const triedText = [...tried].map(item => item.split("|").filter(Boolean).join(" @ ")).join(", ");
  throw new Error(`Twelve Data did not find a usable quote for ${asset.name || asset.symbol || "this holding"}.${triedText ? ` Tried: ${triedText}.` : ""}${errors.length ? ` ${errors.slice(0, 5).join(" | ")}` : ""}`);
}

export async function fetchQuote(asset, settings) {
  const rawProvider = asset.provider || settings.marketProvider || "manual";
  const provider = rawProvider === "stooq" ? "twelvedata" : rawProvider;
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
  return fetchTwelveDataQuote(asset, settings.marketApiKeyLocalOnly || "");
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
