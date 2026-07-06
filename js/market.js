function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
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
    } else if (char === "," && !quoted) {
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

function parseCsv(text) {
  const rows = parseCsvRecords(text);
  const headers = rows.shift() || [];
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function normalizeStooqSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/:/g, ".")
    .toUpperCase();
}

function looksLikeTicker(value) {
  return /^[A-Z0-9^._-]{1,16}$/i.test(String(value || "").trim());
}

function knownStooqSymbols(asset = {}) {
  const isin = String(asset.isin || "").trim().toUpperCase();
  const wkn = String(asset.wkn || "").trim().toUpperCase();
  const symbol = normalizeStooqSymbol(asset.symbol);
  const currency = String(asset.currency || "").toUpperCase();
  const entries = [];
  const preferEur = currency === "EUR";

  const add = value => {
    const normalized = normalizeStooqSymbol(value);
    if (normalized && !entries.includes(normalized)) entries.push(normalized);
  };

  if (isin === "US0378331005" || wkn === "865985" || symbol === "AAPL") {
    if (preferEur) add("APC.DE");
    add("AAPL.US");
    if (!preferEur) add("APC.DE");
  }
  if (isin === "US1912161007" || wkn === "850663" || symbol === "KO") {
    if (preferEur) add("CCC3.DE");
    add("KO.US");
    if (!preferEur) add("CCC3.DE");
  }
  if (isin === "DE000SHA0159" || isin === "DE000SHA0100" || wkn === "SHA015" || wkn === "SHA010" || symbol === "SHA" || symbol === "SHA0") {
    add("SHA0.DE");
  }
  if (isin === "DE0007100000" || wkn === "710000") add("MBG.DE");

  return entries;
}

function stooqSymbolCandidates(asset = {}) {
  const candidates = [];
  const add = value => {
    const next = normalizeStooqSymbol(value);
    if (next && !candidates.includes(next)) candidates.push(next);
  };

  knownStooqSymbols(asset).forEach(add);
  [asset.providerSymbol, asset.stooqSymbol, asset.symbol, asset.ticker].forEach(value => {
    const normalized = normalizeStooqSymbol(value);
    if (!normalized || !looksLikeTicker(normalized)) return;
    add(normalized);
  });

  const raw = normalizeStooqSymbol(asset.providerSymbol || asset.stooqSymbol || asset.symbol || asset.ticker);
  const isin = String(asset.isin || "").trim().toUpperCase();
  const wkn = String(asset.wkn || "").trim().toUpperCase();
  const type = String(asset.type || "").toLowerCase();

  if (raw && looksLikeTicker(raw) && !raw.includes(".") && !raw.startsWith("^")) {
    if (isin.startsWith("US")) add(`${raw}.US`);
    if (isin.startsWith("DE")) {
      add(`${raw}.DE`);
      if (/^[A-Z]{2,4}$/.test(raw) && !raw.endsWith("0")) add(`${raw}0.DE`);
    }
    if (isin.startsWith("IE") || isin.startsWith("LU") || isin.startsWith("FR")) {
      add(`${raw}.DE`);
      if (type === "etf" || type === "fund") {
        add(`${raw}.UK`);
        add(`${raw}.NL`);
        add(`${raw}.PA`);
      }
    }
    add(raw);
  }

  if (wkn && looksLikeTicker(wkn)) add(`${wkn}.DE`);
  return candidates.map(item => item.toLowerCase());
}

function stooqCurrencyForSymbol(symbol, fallback = "USD") {
  const value = String(symbol || "").toUpperCase();
  if (value.endsWith(".US")) return "USD";
  if (value.endsWith(".UK")) return "GBP";
  if (value.endsWith(".CH")) return "CHF";
  if (value.endsWith(".JP")) return "JPY";
  if (value.endsWith(".PL")) return "PLN";
  if (value.endsWith(".DE") || value.endsWith(".NL") || value.endsWith(".FR") || value.endsWith(".IT") || value.endsWith(".ES") || value.endsWith(".BE") || value.endsWith(".AT") || value.endsWith(".PA")) return "EUR";
  return fallback || "USD";
}

function stooqDateTime(date, time = "") {
  const d = String(date || "").trim();
  const t = String(time || "").trim();
  if (!d || d === "N/D") return new Date().toISOString();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? `${d}T${/^\d{1,2}:\d{2}/.test(t) ? t : "00:00:00"}`
    : d;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function numberFromStooq(value) {
  const n = Number(String(value ?? "").replace(/\s/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function quoteFromStooqRow(row, requestedSymbol, source, url) {
  if (!row) throw new Error(`${source} empty response`);
  const resolvedSymbol = String(row.Symbol || requestedSymbol || "").toUpperCase();
  const close = row.Close;
  if (!resolvedSymbol || resolvedSymbol === "N/D" || close === "N/D") throw new Error(`${source} not found`);
  const price = numberFromStooq(close);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${source} no usable price`);
  return {
    provider: "stooq",
    symbol: resolvedSymbol,
    price,
    currency: stooqCurrencyForSymbol(resolvedSymbol, "USD"),
    changePercent: Number.isFinite(numberFromStooq(row.Change)) ? numberFromStooq(row.Change) : null,
    time: stooqDateTime(row.Date, row.Time),
    source,
    url
  };
}

function parseStooqListCsv(text, requestedSymbol) {
  const rows = parseCsvRecords(text);
  if (!rows.length) throw new Error("live empty response");
  const first = rows[0].map(cell => String(cell || "").trim());
  const hasHeader = first.some(cell => cell.toLowerCase() === "symbol") || first.some(cell => cell.toLowerCase() === "close");
  if (hasHeader) {
    const headers = rows.shift();
    return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])))[0];
  }
  const row = first;
  return {
    Symbol: row[0] || requestedSymbol,
    Date: row[1],
    Time: row[2],
    Open: row[3],
    High: row[4],
    Low: row[5],
    Close: row[6],
    Volume: row[7]
  };
}

function parseStooqDailyCsv(text, requestedSymbol) {
  const rows = parseCsv(text).filter(row => row && row.Close && row.Close !== "N/D");
  const row = rows.at(-1);
  if (!row) throw new Error("daily not found");
  return { Symbol: requestedSymbol, ...row };
}

export async function fetchTwelveDataQuote(asset, apiKey) {
  if (!apiKey) throw new Error("Add a Twelve Data API key in Settings or switch the asset provider to Stooq/manual.");
  const symbol = encodeURIComponent(asset.symbol);
  const response = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${encodeURIComponent(apiKey)}`, { mode: "cors" });
  if (!response.ok) throw new Error(`Twelve Data request failed: HTTP ${response.status}`);
  const data = await response.json();
  if (data.status === "error") throw new Error(data.message || "Twelve Data returned an error.");
  const price = Number(data.close || data.price || data.previous_close);
  if (!Number.isFinite(price)) throw new Error("No price in Twelve Data response.");
  return {
    provider: "twelvedata",
    symbol: data.symbol || asset.symbol,
    price,
    currency: data.currency || asset.currency,
    changePercent: Number(data.percent_change),
    time: data.datetime ? new Date(data.datetime).toISOString() : new Date().toISOString()
  };
}

async function fetchStooqLiveQuote(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&e=csv`;
  const response = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error(`live HTTP ${response.status}`);
  const row = parseStooqListCsv(await response.text(), symbol);
  return quoteFromStooqRow(row, symbol, "stooq live", url);
}

async function fetchStooqDailyFallback(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const response = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error(`daily HTTP ${response.status}`);
  const row = parseStooqDailyCsv(await response.text(), symbol);
  return quoteFromStooqRow(row, symbol, "stooq daily", url);
}

export async function fetchStooqQuote(asset) {
  const candidates = stooqSymbolCandidates(asset);
  if (!candidates.length) throw new Error("Missing Stooq ticker. Use the Symbol | ticker field, e.g. APC.DE, AAPL.US, CCC3.DE, KO.US or SHA0.DE.");

  const errors = [];
  for (const symbol of candidates) {
    try {
      return await fetchStooqLiveQuote(symbol);
    } catch (liveError) {
      errors.push(`${symbol.toUpperCase()} live: ${liveError.message}`);
      try {
        return await fetchStooqDailyFallback(symbol);
      } catch (dailyError) {
        errors.push(`${symbol.toUpperCase()} daily: ${dailyError.message}`);
      }
    }
  }

  throw new Error(`Stooq did not find this holding. Tried: ${candidates.map(item => item.toUpperCase()).join(", ")}. ${errors.slice(0, 4).join(" | ")}`);
}

export async function fetchQuote(asset, settings) {
  const provider = asset.provider || settings.marketProvider || "manual";
  if (provider === "manual") {
    const price = Number(asset.manualPrice || asset.lastPrice || 0);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Manual asset needs a manual price first.");
    return {
      provider: "manual",
      symbol: asset.symbol,
      price,
      currency: asset.currency,
      changePercent: null,
      time: new Date().toISOString()
    };
  }
  if (provider === "stooq") return fetchStooqQuote(asset);
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
