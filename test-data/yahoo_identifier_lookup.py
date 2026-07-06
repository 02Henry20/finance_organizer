#!/usr/bin/env python3
"""
Capito Yahoo Quick Matcher v3

Main change vs v2:
  - Yahoo search results are now ranked by the result's NAME fields first:
      name / longname / shortname
  - The script tests candidates whose name best matches your clear-text query first.
  - This is closer to how the Yahoo Finance website search bar behaves.

No API key required.

Examples:
  python capito_yahoo_quick_matcher.py "AMUNDI MSCI" 45.36 EUR
  python capito_yahoo_quick_matcher.py "Deka GlobalChampions" 433.2 EUR
  python capito_yahoo_quick_matcher.py "HSBC MSCI WORLD UCITS ETF" 42.77 EUR --quantity 36.840572 --account-id smartbroker

Fast/limited:
  python capito_yahoo_quick_matcher.py "AMUNDI MSCI" 45.36 EUR --search-limit 12 --candidate-limit 6 --show 5

More strict name matching:
  python capito_yahoo_quick_matcher.py "AMUNDI MSCI" 45.36 EUR --name-first --min-name-score 20

Broader search, slower:
  python capito_yahoo_quick_matcher.py "AMUNDI MSCI" 45.36 EUR --extra-search

No hardcoded price in JSON:
  python capito_yahoo_quick_matcher.py "AMUNDI MSCI" 45.36 EUR --no-price-in-json

Debug URLs:
  python capito_yahoo_quick_matcher.py "AMUNDI MSCI" 45.36 EUR --debug

Offline demo:
  python capito_yahoo_quick_matcher.py --offline-demo
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

ALLOWED_TYPES = {"EQUITY", "ETF", "MUTUALFUND", "FUND", "INDEX"}
EUR_SUFFIXES = {".DE", ".F", ".MU", ".HM", ".SG", ".DU", ".BE", ".HA", ".PA", ".AS", ".MI", ".MC"}


@dataclass
class Candidate:
    symbol: str
    name: str = ""
    quote_type: str = ""
    exchange: str = ""
    source: str = ""
    name_score: float = 0.0
    raw_search_rank: int = 999


@dataclass
class Match:
    symbol: str
    name: str = ""
    quote_type: str = ""
    exchange: str = ""
    full_exchange_name: str = ""
    currency: str = ""
    price: float | None = None
    previous_close: float | None = None
    price_time: str = ""
    age_days: float | None = None
    price_diff_pct: float | None = None
    within_tolerance: bool | None = None
    score: float = 0.0
    source: str = ""
    error: str = ""
    name_score: float = 0.0


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def log(message: str, quiet: bool = False) -> None:
    if quiet:
        return
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def normalize_token(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(value or "").upper())


def suffix_of(symbol: str) -> str:
    match = re.search(r"(\.[A-Za-z]+)$", symbol or "")
    return match.group(1).upper() if match else ""


def currency_hint(symbol: str) -> str:
    suffix = suffix_of(symbol)
    if suffix in EUR_SUFFIXES:
        return "EUR"
    if suffix == ".L":
        return "GBP"
    return ""


def parse_time(value: Any) -> datetime | None:
    if value in (None, "", "N/D", "NA"):
        return None

    if isinstance(value, (int, float)) or str(value).strip().isdigit():
        try:
            return datetime.fromtimestamp(int(float(value)), tz=timezone.utc)
        except Exception:
            return None

    text = str(value).strip()
    for candidate in (text, text.replace("Z", "+00:00")):
        try:
            dt = datetime.fromisoformat(candidate)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    return None


def iso_or_empty(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


def age_days(dt: datetime | None) -> float | None:
    if not dt:
        return None
    return max(0.0, (now_utc() - dt.astimezone(timezone.utc)).total_seconds() / 86400)


def request_json(url: str, params: dict[str, str], timeout: float, quiet: bool, debug: bool) -> dict[str, Any]:
    full_url = f"{url}?{urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, '')})}"
    if debug:
        log(f"GET {full_url}", quiet=quiet)

    request = urllib.request.Request(
        full_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
            "Origin": "https://finance.yahoo.com",
            "Referer": "https://finance.yahoo.com/",
            "Connection": "close",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        body = ""
        try:
            body = error.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {error.code} {error.reason}; {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"URL error: {error.reason}") from error
    except socket.timeout as error:
        raise RuntimeError("Timeout") from error

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Invalid JSON response: {raw[:300]}") from error

    if not isinstance(data, dict):
        raise RuntimeError("Yahoo returned non-object JSON.")
    return data


def name_tokens(text: str) -> list[str]:
    stop = {
        "ETF", "UCITS", "FUND", "AG", "INC", "THE", "COMPANY", "GROUP",
        "C", "CF", "UE", "SA", "PLC", "LTD", "CLASS", "ACC", "DIST"
    }
    tokens = []
    for token in re.split(r"[^A-Za-z0-9]+", text.upper()):
        if len(token) >= 2 and token not in stop:
            tokens.append(token)
    return tokens


def compact_text(text: str) -> str:
    return normalize_token(text)


def name_similarity_score(query: str, candidate_name: str, candidate_symbol: str = "") -> float:
    """
    Scores how well a Yahoo result's NAME fields match the clear-text query.
    This is used before price testing, so the script behaves more like typing
    the name into Yahoo Finance.
    """
    query_clean = clean_text(query)
    name_clean = clean_text(candidate_name)

    if not query_clean or not name_clean:
        return 0.0

    q_upper = query_clean.upper()
    n_upper = name_clean.upper()
    q_compact = compact_text(q_upper)
    n_compact = compact_text(n_upper)

    score = 0.0

    # Very strong: full query appears in Yahoo name.
    if q_upper in n_upper:
        score += 80
    if q_compact and q_compact in n_compact:
        score += 60

    q_tokens = name_tokens(query_clean)
    n_tokens = name_tokens(name_clean)

    if q_tokens and n_tokens:
        q_set = set(q_tokens)
        n_set = set(n_tokens)
        overlap = q_set & n_set
        score += len(overlap) * 18

        # Reward high coverage of search tokens.
        coverage = len(overlap) / max(1, len(q_set))
        score += coverage * 60

        # Important: token order roughly matches.
        pos = 0
        ordered = 0
        for token in q_tokens:
            try:
                idx = n_tokens.index(token, pos)
                ordered += 1
                pos = idx + 1
            except ValueError:
                pass
        score += ordered * 6

        # Penalize zero token overlap heavily.
        if not overlap:
            score -= 40

    # Small fallback if query looks like a symbol.
    if candidate_symbol and compact_text(candidate_symbol) == q_compact:
        score += 30

    return round(score, 4)


def search_terms(query: str, extra_search: bool) -> list[str]:
    query = clean_text(query)
    if not extra_search:
        return [query]

    tokens = name_tokens(query)
    terms = [query]
    if len(tokens) >= 2:
        terms.append(" ".join(tokens[:2]))
    if len(tokens) >= 3:
        terms.append(" ".join(tokens[:3]))
    return list(dict.fromkeys(terms))


def best_name_from_row(row: dict[str, Any]) -> str:
    # Yahoo's search endpoint may use several different fields.
    candidates = [
        row.get("name"),
        row.get("longname"),
        row.get("longName"),
        row.get("shortname"),
        row.get("shortName"),
        row.get("title"),
    ]
    for value in candidates:
        value = clean_text(value)
        if value:
            return value
    return ""


def yahoo_search(
    query: str,
    search_limit: int,
    timeout: float,
    quiet: bool,
    debug: bool,
) -> list[Candidate]:
    log(f'Yahoo search: "{query}" with quotesCount={search_limit}', quiet=quiet)

    try:
        data = request_json(
            YAHOO_SEARCH_URL,
            params={
                "q": query,
                "quotesCount": str(search_limit),
                "newsCount": "0",
                "listsCount": "0",
                "enableFuzzyQuery": "true",
            },
            timeout=timeout,
            quiet=quiet,
            debug=debug,
        )
    except Exception as error:
        log(f"Yahoo search failed: {error}", quiet=quiet)
        return []

    candidates: list[Candidate] = []
    for rank, row in enumerate(data.get("quotes") or [], start=1):
        if not isinstance(row, dict):
            continue

        symbol = clean_text(row.get("symbol"))
        quote_type = clean_text(row.get("quoteType")).upper()
        name = best_name_from_row(row)
        exchange = clean_text(row.get("exchDisp") or row.get("exchange"))

        if not symbol:
            continue
        if quote_type and quote_type not in ALLOWED_TYPES:
            continue

        nscore = name_similarity_score(query, name, symbol)

        candidates.append(Candidate(
            symbol=symbol,
            name=name,
            quote_type=quote_type,
            exchange=exchange,
            source=f"search:{query}",
            name_score=nscore,
            raw_search_rank=rank,
        ))

    log(f"Search returned {len(candidates)} usable candidates.", quiet=quiet)
    return candidates


def dedupe_candidates(candidates: list[Candidate]) -> list[Candidate]:
    best: dict[str, Candidate] = {}

    for c in candidates:
        key = c.symbol.upper()
        if key not in best:
            best[key] = c
            continue

        old = best[key]
        # Keep better name score; tie: earlier raw rank.
        if (c.name_score, -c.raw_search_rank) > (old.name_score, -old.raw_search_rank):
            best[key] = c

    return list(best.values())


def sort_candidates_name_first(candidates: list[Candidate], expected_currency: str) -> list[Candidate]:
    def key(c: Candidate) -> tuple[float, int, int]:
        eur_bonus = 1 if expected_currency.upper() == "EUR" and suffix_of(c.symbol) in EUR_SUFFIXES else 0
        # Sort descending name score, EUR suffix bonus, then ascending raw rank.
        return (c.name_score, eur_bonus, -c.raw_search_rank)

    return sorted(candidates, key=key, reverse=True)


def fetch_chart_price(
    candidate: Candidate,
    timeout: float,
    quiet: bool,
    debug: bool,
) -> Match | None:
    symbol = candidate.symbol
    log(f"Testing chart quote for {symbol}", quiet=quiet)

    url = YAHOO_CHART_URL.format(symbol=urllib.parse.quote(symbol, safe=""))
    data = None
    errors: list[str] = []

    for params in (
        {"range": "5d", "interval": "1d", "includePrePost": "false", "events": "history"},
        {"range": "1mo", "interval": "1d", "includePrePost": "false", "events": "history"},
    ):
        try:
            data = request_json(url, params=params, timeout=timeout, quiet=quiet, debug=debug)
            break
        except Exception as error:
            errors.append(f"{params['range']}/{params['interval']}: {error}")

    if data is None:
        log(f"  failed {symbol}: {' | '.join(errors)}", quiet=quiet)
        return Match(symbol=symbol, name=candidate.name, source=candidate.source, name_score=candidate.name_score, error=" | ".join(errors))

    chart = data.get("chart") or {}
    if chart.get("error"):
        err = str(chart["error"])
        log(f"  chart error for {symbol}: {err}", quiet=quiet)
        return Match(symbol=symbol, name=candidate.name, source=candidate.source, name_score=candidate.name_score, error=err)

    result = (chart.get("result") or [None])[0]
    if not isinstance(result, dict):
        log(f"  no chart result for {symbol}", quiet=quiet)
        return Match(symbol=symbol, name=candidate.name, source=candidate.source, name_score=candidate.name_score, error="no chart result")

    meta = result.get("meta") or {}
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    timestamps = result.get("timestamp") or []

    price = meta.get("regularMarketPrice")
    price_time_dt = parse_time(meta.get("regularMarketTime"))

    if price in (None, "", "NaN"):
        closes = quote.get("close") or []
        usable = [(i, x) for i, x in enumerate(closes) if isinstance(x, (int, float))]
        if usable:
            idx, price = usable[-1]
            if timestamps and idx < len(timestamps):
                price_time_dt = parse_time(timestamps[idx])

    if price in (None, "", "NaN"):
        log(f"  no usable price for {symbol}", quiet=quiet)
        return Match(symbol=symbol, name=candidate.name, source=candidate.source, name_score=candidate.name_score, error="no usable price")

    if not price_time_dt and timestamps:
        price_time_dt = parse_time(timestamps[-1])

    # Keep the better search result name if chart metadata does not return a useful name.
    chart_name = clean_text(meta.get("longName") or meta.get("shortName"))
    final_name = chart_name or candidate.name

    match = Match(
        symbol=clean_text(meta.get("symbol") or symbol),
        name=final_name,
        quote_type=clean_text(meta.get("instrumentType") or candidate.quote_type),
        exchange=clean_text(meta.get("exchangeName") or candidate.exchange),
        full_exchange_name=clean_text(meta.get("fullExchangeName")),
        currency=clean_text(meta.get("currency") or currency_hint(symbol)).upper(),
        price=float(price),
        price_time=iso_or_empty(price_time_dt),
        age_days=age_days(price_time_dt),
        source=f"{candidate.source};chart",
        name_score=candidate.name_score,
    )

    age = "unknown" if match.age_days is None else f"{match.age_days:.1f}d"
    log(f"  ok {match.symbol}: {match.price} {match.currency}, age={age}", quiet=quiet)
    return match


def score_match(
    match: Match,
    query: str,
    expected_value: float,
    expected_currency: str,
    tolerance: float,
    max_age_days: float,
) -> Match:
    if match.price is None:
        match.score = -9999
        return match

    score = 0.0

    # Name score remains important in final result too.
    score += match.name_score

    if match.currency.upper() == expected_currency.upper():
        score += 100
    elif match.currency:
        score -= 40

    diff = abs(match.price - expected_value) / abs(expected_value) if expected_value else 0.0
    match.price_diff_pct = diff
    match.within_tolerance = diff <= tolerance
    if match.within_tolerance:
        score += 150
        score += max(0, 40 - diff * 100)
    else:
        score -= min(150, diff * 130)

    if match.age_days is not None:
        if match.age_days <= max_age_days:
            score += 70
        else:
            score -= min(100, match.age_days)
    else:
        score -= 15

    if expected_currency.upper() == "EUR" and suffix_of(match.symbol) in EUR_SUFFIXES:
        score += 35

    # Re-score final name because chart metadata may have a better name than search result.
    final_name_score = name_similarity_score(query, match.name, match.symbol)
    score += min(80, final_name_score * 0.35)

    match.score = round(score, 4)
    return match


def capito_asset_json(
    match: Match,
    query: str,
    quantity: float,
    account_id: str,
    include_price: bool,
    wkn: str,
    isin: str,
) -> dict[str, Any]:
    quote_type = match.quote_type.upper()

    if quote_type == "EQUITY":
        asset_type = "stock"
    elif quote_type == "ETF":
        asset_type = "etf"
    elif quote_type in {"MUTUALFUND", "FUND"}:
        asset_type = "fund"
    else:
        asset_type = "manual"

    asset = {
        "id": f"asset_{normalize_token(match.symbol).lower()}",
        "symbol": match.symbol,
        "name": match.name or query,
        "type": asset_type,
        "quantity": quantity,
        "currency": match.currency or "EUR",
        "costBasis": 0,
        "buyPrice": 0,
        "wkn": wkn,
        "isin": isin,
        "manualPrice": None,
        "provider": "yahoo",
        "providerSymbol": match.symbol,
        "accountId": account_id,
        "hidden": False,
        "createdAtMs": int(now_utc().timestamp() * 1000),
        "lastPrice": None,
        "lastPriceAt": "",
        "lastChangePercent": None,
        "startingPosition": True,
        "startingAt": now_utc().date().isoformat(),
        "startingValue": 0,
        "lastProviderSymbol": match.symbol,
        "lastQuoteExchange": match.exchange,
        "lastQuoteSource": "Yahoo Finance",
        "lastQuotePriceAt": match.price_time,
        "lastQuoteCurrency": match.currency,
    }

    if include_price and match.price is not None:
        asset["manualPrice"] = match.price
        asset["lastPrice"] = match.price
        asset["lastPriceAt"] = match.price_time
        asset["startingValue"] = round(quantity * match.price, 6)

    return asset


def capito_import_json(asset: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": "capito-export-v1",
        "exportedAt": now_utc().isoformat(),
        "user": {"uid": "", "email": ""},
        "settings": {},
        "accounts": [],
        "categories": [],
        "rules": [],
        "transactions": [],
        "assets": [asset],
        "meta": {
            "createdBy": "capito_yahoo_quick_matcher_v3.py",
            "notes": [
                "Generated from one clear-text Yahoo Finance search line.",
                "Yahoo search results were ordered by name-field similarity before price testing.",
                "Uses Yahoo search + chart endpoint only; v7 quote endpoint is intentionally avoided.",
                "Review ticker, currency, price and name before importing into Capito.",
            ],
        },
    }


def offline_demo(expected_value: float, currency: str, query: str, tolerance: float, max_age_days: float) -> list[Match]:
    samples = [
        Match(
            symbol="NRJ.PA",
            name="Amundi MSCI New Energy ESG Screened UCITS ETF",
            quote_type="ETF",
            exchange="PAR",
            full_exchange_name="Paris",
            currency="EUR",
            price=45.365,
            price_time=now_utc().isoformat(),
            age_days=0.0,
            source="offline-demo",
            name_score=name_similarity_score(query, "Amundi MSCI New Energy ESG Screened UCITS ETF", "NRJ.PA"),
        ),
        Match(
            symbol="AMUN.PA",
            name="Amundi SA",
            quote_type="EQUITY",
            exchange="PAR",
            full_exchange_name="Paris",
            currency="EUR",
            price=64.2,
            price_time=now_utc().isoformat(),
            age_days=0.0,
            source="offline-demo",
            name_score=name_similarity_score(query, "Amundi SA", "AMUN.PA"),
        ),
        Match(
            symbol="ACWI.PA",
            name="Amundi MSCI World Climate Net Zero Ambition PAB UCITS ETF",
            quote_type="ETF",
            exchange="PAR",
            full_exchange_name="Paris",
            currency="EUR",
            price=604.91,
            price_time=now_utc().isoformat(),
            age_days=0.0,
            source="offline-demo",
            name_score=name_similarity_score(query, "Amundi MSCI World Climate Net Zero Ambition PAB UCITS ETF", "ACWI.PA"),
        ),
    ]
    return sorted(
        [
            score_match(s, query=query, expected_value=expected_value, expected_currency=currency, tolerance=tolerance, max_age_days=max_age_days)
            for s in samples
        ],
        key=lambda m: m.score,
        reverse=True,
    )


def find_matches(args: argparse.Namespace) -> list[Match]:
    query = args.query
    expected_value = float(args.expected_value)
    expected_currency = args.currency.upper()

    if args.offline_demo:
        log("Running offline demo. No internet requests will be made.", quiet=args.quiet)
        return offline_demo(expected_value, expected_currency, query, args.tolerance, args.max_age_days)

    log(f'Starting search line: "{query}"', quiet=args.quiet)
    log(f"Expected value: {expected_value} {expected_currency}; tolerance ±{args.tolerance * 100:.1f}%", quiet=args.quiet)
    log(f"Limits: search_limit={args.search_limit}, candidate_limit={args.candidate_limit}, min_name_score={args.min_name_score}", quiet=args.quiet)
    log("Using Yahoo search result NAME fields first, then chart endpoint for price.", quiet=args.quiet)

    candidates: list[Candidate] = []
    for term in search_terms(query, extra_search=args.extra_search):
        candidates.extend(yahoo_search(
            term,
            search_limit=args.search_limit,
            timeout=args.timeout,
            quiet=args.quiet,
            debug=args.debug,
        ))
        if args.delay:
            time.sleep(args.delay)

    candidates = dedupe_candidates(candidates)
    candidates = sort_candidates_name_first(candidates, expected_currency)

    if args.name_first:
        before = len(candidates)
        candidates = [c for c in candidates if c.name_score >= args.min_name_score]
        log(f"Name-first filter kept {len(candidates)} / {before} candidates.", quiet=args.quiet)

    candidates = candidates[:args.candidate_limit]

    log(f"Candidates after name-sort/dedupe/limit: {len(candidates)}", quiet=args.quiet)

    for i, candidate in enumerate(candidates, start=1):
        log(
            f"Candidate {i:02d}: {candidate.symbol} | nameScore={candidate.name_score:.1f} | "
            f"{candidate.name or '-'} | {candidate.quote_type or '-'} | {candidate.exchange or '-'}",
            quiet=args.quiet,
        )

    matches: list[Match] = []
    for i, candidate in enumerate(candidates, start=1):
        log(f"Candidate {i}/{len(candidates)}", quiet=args.quiet)
        match = fetch_chart_price(candidate, timeout=args.timeout, quiet=args.quiet, debug=args.debug)

        if match is None or match.price is None:
            continue

        scored = score_match(
            match,
            query=query,
            expected_value=expected_value,
            expected_currency=expected_currency,
            tolerance=args.tolerance,
            max_age_days=args.max_age_days,
        )
        matches.append(scored)

        age = "unknown" if scored.age_days is None else f"{scored.age_days:.1f}d"
        diff = "n/a" if scored.price_diff_pct is None else f"{scored.price_diff_pct * 100:.2f}%"
        log(
            f"Scored {scored.symbol}: {scored.price} {scored.currency}, nameScore={scored.name_score:.1f}, "
            f"age={age}, diff={diff}, totalScore={scored.score}",
            quiet=args.quiet,
        )

        if args.delay:
            time.sleep(args.delay)

    ranked = sorted(matches, key=lambda m: m.score, reverse=True)
    log(f"Finished. Usable matches: {len(ranked)}", quiet=args.quiet)
    return ranked


def print_matches(matches: list[Match], show: int) -> None:
    if not matches:
        print("No usable Yahoo matches found.")
        return

    print()
    print(f"Top {min(show, len(matches))} matches:")
    print("-" * 96)
    for i, match in enumerate(matches[:show], start=1):
        age = "unknown" if match.age_days is None else f"{match.age_days:.1f}d"
        diff = "n/a" if match.price_diff_pct is None else f"{match.price_diff_pct * 100:.2f}%"
        ok = "yes" if match.within_tolerance else "no"
        print(
            f"{i:02d}. {match.symbol} | {match.price} {match.currency} | age {age} | diff {diff} | "
            f"nameScore {match.name_score:.1f} | within tolerance {ok} | totalScore {match.score}\n"
            f"    {match.name or '-'}\n"
            f"    {match.quote_type or '-'} | {match.exchange or '-'} | {match.full_exchange_name or '-'}\n"
            f"    source: {match.source}\n"
        )


def interactive_args() -> argparse.Namespace:
    print("Capito Yahoo Quick Matcher v3")
    print("-----------------------------")
    query = input("Search line, e.g. AMUNDI MSCI: ").strip()
    expected_value = float(input("Expected value/price, e.g. 45.36: ").strip().replace(",", "."))
    currency = input("Currency, e.g. EUR: ").strip().upper() or "EUR"

    return argparse.Namespace(
        query=query,
        expected_value=expected_value,
        currency=currency,
        quantity=1.0,
        account_id="smartbroker",
        tolerance=0.10,
        max_age_days=7.0,
        search_limit=12,
        candidate_limit=7,
        extra_search=False,
        name_first=False,
        min_name_score=0.0,
        timeout=20.0,
        delay=0.15,
        show=5,
        out="capito_yahoo_quick_match_import.json",
        no_price_in_json=False,
        wkn="",
        isin="",
        quiet=False,
        debug=False,
        offline_demo=False,
        json_only=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Fast logged Yahoo clear-text matcher for Capito, name-first ranking.")
    parser.add_argument("query", nargs="?", help='Clear text search line, e.g. "AMUNDI MSCI".')
    parser.add_argument("expected_value", nargs="?", type=float, help="Expected price/value, e.g. 45.36.")
    parser.add_argument("currency", nargs="?", default="EUR", help="Expected currency, e.g. EUR.")

    parser.add_argument("--quantity", type=float, default=1.0, help="Quantity in Capito JSON. Default 1.")
    parser.add_argument("--account-id", default="smartbroker", help="Capito accountId. Default smartbroker.")
    parser.add_argument("--tolerance", type=float, default=0.10, help="Allowed relative price difference. Default 0.10 = 10%%.")
    parser.add_argument("--max-age-days", type=float, default=7.0, help="Freshness preference in days. Default 7.")

    parser.add_argument("--search-limit", type=int, default=12, help="Yahoo quotesCount per search. Default 12.")
    parser.add_argument("--candidate-limit", type=int, default=7, help="Max name-ranked candidates to chart/test. Default 7.")
    parser.add_argument("--extra-search", action="store_true", help="Also search shortened token versions of the query. Slower.")

    parser.add_argument("--name-first", action="store_true", help="Drop candidates whose Yahoo name fields do not match enough.")
    parser.add_argument("--min-name-score", type=float, default=0.0, help="Minimum name score when --name-first is used. Try 20 or 40.")

    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout seconds.")
    parser.add_argument("--delay", type=float, default=0.15, help="Delay between Yahoo requests.")
    parser.add_argument("--show", type=int, default=5, help="How many ranked matches to print.")
    parser.add_argument("--out", default="capito_yahoo_quick_match_import.json", help="Output Capito JSON import file.")
    parser.add_argument("--no-price-in-json", action="store_true", help="Do not include lastPrice/manualPrice in JSON.")
    parser.add_argument("--wkn", default="", help="Optional WKN to include in JSON.")
    parser.add_argument("--isin", default="", help="Optional ISIN to include in JSON.")

    parser.add_argument("--quiet", action="store_true", help="Suppress logs.")
    parser.add_argument("--debug", action="store_true", help="Print full requested URLs.")
    parser.add_argument("--json-only", action="store_true", help="Only print the final Capito import JSON.")
    parser.add_argument("--offline-demo", action="store_true", help="Use mock data, no internet.")

    args = parser.parse_args()

    if args.offline_demo:
        if args.query is None:
            args.query = "AMUNDI MSCI"
        if args.expected_value is None:
            args.expected_value = 45.36
        if not args.currency:
            args.currency = "EUR"
    elif args.query is None or args.expected_value is None:
        args = interactive_args()

    args.currency = clean_text(args.currency).upper() or "EUR"
    args.search_limit = max(1, min(int(args.search_limit), 50))
    args.candidate_limit = max(1, min(int(args.candidate_limit), 30))

    matches = find_matches(args)
    if not matches:
        return 1

    best = matches[0]
    asset = capito_asset_json(
        match=best,
        query=args.query,
        quantity=float(args.quantity),
        account_id=args.account_id,
        include_price=not args.no_price_in_json,
        wkn=args.wkn,
        isin=args.isin,
    )
    payload = capito_import_json(asset)

    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if args.json_only:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print_matches(matches, show=max(1, int(args.show)))
        print("Best Capito asset JSON:")
        print(json.dumps(asset, indent=2, ensure_ascii=False))
        print()
        print(f"Capito import JSON written to: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
