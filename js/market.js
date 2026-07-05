function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map(line => line.split(",").map(cell => cell.trim()));
  const headers = rows.shift() || [];
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function normalizeStooqSymbol(symbol) {
  const value = String(symbol || "").trim().toLowerCase();
  if (!value) return "";
  if (value.includes(".")) return value;
  return `${value}.us`;
}

function stooqSymbolCandidates(asset = {}) {
  const raw = String(asset.symbol || "").trim();
  const base = raw.toLowerCase();
  if (!base) return [];
  const candidates = [];
  const add = value => {
    const next = String(value || "").trim().toLowerCase();
    if (next && !candidates.includes(next)) candidates.push(next);
  };

  add(base.includes(".") ? base : `${base}.us`);

  const isin = String(asset.isin || "").trim().toUpperCase();
  const wkn = String(asset.wkn || "").trim().toUpperCase();
  const type = String(asset.type || "").toLowerCase();

  if (!base.includes(".")) {
    if (isin.startsWith("US")) add(`${base}.us`);
    if (isin.startsWith("DE")) add(`${base}.de`);
    if (isin.startsWith("IE") || isin.startsWith("LU") || isin.startsWith("FR")) add(`${base}.de`);
    if (type === "etf" || type === "fund") {
      add(`${base}.de`);
      add(`${base}.uk`);
      add(`${base}.nl`);
    }
    add(base);
  }

  if (wkn && !base.includes(".")) add(`${wkn.toLowerCase()}.de`);
  return candidates;
}

function stooqCurrencyForSymbol(symbol, fallback = "USD") {
  const value = String(symbol || "").toUpperCase();
  if (value.endsWith(".US")) return "USD";
  if (value.endsWith(".UK")) return "GBP";
  if (value.endsWith(".CH")) return "CHF";
  if (value.endsWith(".JP")) return "JPY";
  if (value.endsWith(".PL")) return "PLN";
  if (value.endsWith(".DE") || value.endsWith(".NL") || value.endsWith(".FR") || value.endsWith(".IT") || value.endsWith(".ES") || value.endsWith(".BE") || value.endsWith(".AT")) return "EUR";
  return fallback || "USD";
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

export async function fetchStooqQuote(asset) {
  const candidates = stooqSymbolCandidates(asset);
  if (!candidates.length) throw new Error("Missing Stooq symbol. Example: AAPL.US, VUSA.UK, IWDA.NL.");

  const errors = [];
  for (const symbol of candidates) {
    try {
      const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const [row] = parseCsv(await response.text());
      if (!row || row.Close === "N/D" || row.Date === "N/D") throw new Error("not found");
      const price = Number(row.Close);
      if (!Number.isFinite(price)) throw new Error("no price");
      const resolvedSymbol = row.Symbol || symbol.toUpperCase();
      return {
        provider: "stooq",
        symbol: resolvedSymbol,
        price,
        currency: stooqCurrencyForSymbol(resolvedSymbol, asset.currency),
        changePercent: null,
        time: row.Date ? new Date(`${row.Date}T${row.Time || "00:00:00"}`).toISOString() : new Date().toISOString()
      };
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }

  throw new Error(`Stooq did not find this symbol. Tried: ${candidates.map(item => item.toUpperCase()).join(", ")}.`);
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
